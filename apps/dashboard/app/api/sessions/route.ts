import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.OCTRAGON_DB_PATH ||
  path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ success: true, sessions: [], actionBreakdown: [] });
    }
    const db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id");
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "200", 10)));

    let sessions: any[] = [];
    try {
      if (accountId) {
        sessions = db
          .prepare(
            `SELECT action_key, wait_ms, swipe_count, session_minute, timestamp
             FROM session_log WHERE account_id = ?
             ORDER BY timestamp DESC LIMIT ?`
          )
          .all(accountId, limit);
      } else {
        sessions = db
          .prepare(
            `SELECT account_id, platform, action_key, wait_ms, swipe_count, session_minute, timestamp
             FROM session_log
             ORDER BY timestamp DESC LIMIT ?`
          )
          .all(limit);
      }
    } catch {}

    let actionBreakdown: any[] = [];
    try {
      if (accountId) {
        actionBreakdown = db
          .prepare(
            `SELECT
              action_key,
              COUNT(*) as count,
              ROUND(AVG(wait_ms), 0) as avg_wait,
              MIN(wait_ms) as min_wait,
              MAX(wait_ms) as max_wait
            FROM session_log
            WHERE account_id = ?
            GROUP BY action_key
            ORDER BY count DESC`
          )
          .all(accountId);
      } else {
        actionBreakdown = db
          .prepare(
            `SELECT
              action_key,
              COUNT(*) as count,
              ROUND(AVG(wait_ms), 0) as avg_wait,
              MIN(wait_ms) as min_wait,
              MAX(wait_ms) as max_wait
            FROM session_log
            GROUP BY action_key
            ORDER BY count DESC`
          )
          .all();
      }
    } catch {}

    db.close();
    return NextResponse.json({ success: true, sessions, actionBreakdown });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error), sessions: [], actionBreakdown: [] },
      { status: 500 }
    );
  }
}
