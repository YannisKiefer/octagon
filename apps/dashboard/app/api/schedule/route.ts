import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.OCTRAGON_DB_PATH ||
  path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getScheduleDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: false });
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      platform TEXT,
      slot TEXT,
      account_id TEXT,
      video_path TEXT,
      caption TEXT,
      hashtags TEXT,
      duration_minutes INTEGER DEFAULT 30,
      scheduled_at TEXT NOT NULL,
      status TEXT DEFAULT 'scheduled',
      result TEXT,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

export async function GET() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ success: true, events: [], warmupHistory: [] });
    }
    const db = getScheduleDb();

    const events = db
      .prepare(
        `SELECT * FROM schedule_events
         WHERE scheduled_at >= datetime('now', '-7 days')
         ORDER BY scheduled_at ASC`
      )
      .all();

    let warmupHistory: any[] = [];
    try {
      warmupHistory = db
        .prepare(
          `SELECT
            account_id,
            platform,
            DATE(timestamp) as day,
            strftime('%H', timestamp) as hour,
            COUNT(*) as total_actions,
            COUNT(CASE WHEN action_key = 'swipeNext' THEN 1 END) as swipes,
            COUNT(CASE WHEN action_key = 'likePost' THEN 1 END) as likes,
            COUNT(CASE WHEN action_key = 'savePost' THEN 1 END) as saves,
            COUNT(CASE WHEN action_key = 'openComments' THEN 1 END) as comments,
            COUNT(CASE WHEN action_key = 'openProfile' THEN 1 END) as profiles,
            ROUND(AVG(wait_ms), 0) as avg_wait_ms
          FROM session_log
          WHERE timestamp >= datetime('now', '-7 days')
          GROUP BY account_id, day, hour
          ORDER BY day DESC, hour ASC`
        )
        .all();
    } catch {}

    db.close();
    return NextResponse.json({ success: true, events, warmupHistory });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error), events: [], warmupHistory: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const db = getScheduleDb();
    const body = await request.json();

    if (!body.scheduled_at) {
      return NextResponse.json({ success: false, error: "scheduled_at is required" }, { status: 400 });
    }

    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    db.prepare(
      `INSERT INTO schedule_events (id, event_type, title, platform, slot, account_id, video_path, caption, hashtags, duration_minutes, scheduled_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`
    ).run(
      id,
      body.event_type || "warmup",
      body.title || `${body.event_type || "warmup"} - ${body.platform || "tiktok"}`,
      body.platform || null,
      body.slot || null,
      body.account_id || null,
      body.video_path || null,
      body.caption || null,
      body.hashtags || null,
      body.duration_minutes || 30,
      body.scheduled_at,
      new Date().toISOString()
    );

    db.close();
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}

const ALLOWED_UPDATE_FIELDS = new Set([
  "title",
  "platform",
  "slot",
  "caption",
  "hashtags",
  "video_path",
  "duration_minutes",
  "status",
]);

export async function PUT(request: Request) {
  try {
    const db = getScheduleDb();
    const body = await request.json();

    if (!body.id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    if (body.action === "move") {
      if (!body.scheduled_at) {
        return NextResponse.json({ success: false, error: "scheduled_at is required for move" }, { status: 400 });
      }
      db.prepare("UPDATE schedule_events SET scheduled_at = ? WHERE id = ?").run(body.scheduled_at, body.id);
    } else if (body.action === "delete") {
      db.prepare("DELETE FROM schedule_events WHERE id = ?").run(body.id);
    } else if (body.action === "update") {
      const sets: string[] = [];
      const vals: any[] = [];
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (body[key] !== undefined) {
          sets.push(`${key} = ?`);
          vals.push(body[key]);
        }
      }
      if (sets.length > 0) {
        vals.push(body.id);
        db.prepare(`UPDATE schedule_events SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      }
    } else {
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }

    db.close();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}
