import { NextResponse } from "next/server";
import { getFarmDb } from "@/lib/farmDb";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set(["warmup", "post", "audit", "stealth", "hub_start", "stop"]);
const VALID_PLATFORMS = new Set(["tiktok", "instagram", "linkedin"]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, platform, slot, duration } = body;

    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(", ")}` },
        { status: 400 }
      );
    }

    if (platform && !VALID_PLATFORMS.has(platform)) {
      return NextResponse.json(
        { success: false, error: `Invalid platform. Must be one of: ${[...VALID_PLATFORMS].join(", ")}` },
        { status: 400 }
      );
    }

    const slotNum = slot ? parseInt(String(slot), 10) : 1;
    if (isNaN(slotNum) || slotNum < 1 || slotNum > 8) {
      return NextResponse.json({ success: false, error: "Slot must be between 1 and 8" }, { status: 400 });
    }

    const durationNum = duration ? parseInt(String(duration), 10) : 30;
    if (isNaN(durationNum) || durationNum < 1 || durationNum > 180) {
      return NextResponse.json({ success: false, error: "Duration must be between 1 and 180 minutes" }, { status: 400 });
    }

    let description = "";
    switch (action) {
      case "warmup":
        description = `Warmup ${platform || "tiktok"} on slot ${slotNum}`;
        break;
      case "post":
        description = `Post to ${platform || "tiktok"} on slot ${slotNum}`;
        break;
      case "audit":
        description = "Running parity audit";
        break;
      case "stealth":
        description = "Running stealth check";
        break;
      case "hub_start":
        description = `Starting hub with ${slotNum} slots`;
        break;
      case "stop":
        description = "All farm processes stopped";
        break;
    }

    try {
      const db = getFarmDb({ readonly: false });
      db.exec(`
        CREATE TABLE IF NOT EXISTS trigger_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          platform TEXT,
          slot INTEGER,
          description TEXT,
          status TEXT DEFAULT 'queued',
          triggered_at TEXT NOT NULL
        )
      `);

      db.prepare(
        "INSERT INTO trigger_log (id, action, platform, slot, description, status, triggered_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        crypto.randomUUID(),
        action,
        platform || null,
        slotNum,
        description,
        action === "stop" ? "completed" : "queued",
        new Date().toISOString()
      );
    } catch {}

    return NextResponse.json({ success: true, description, action, slot: slotNum });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = getFarmDb({ readonly: true });

    let triggers: any[] = [];
    try {
      triggers = db
        .prepare("SELECT * FROM trigger_log ORDER BY triggered_at DESC LIMIT 50")
        .all();
    } catch {}

    return NextResponse.json({ success: true, triggers });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error), triggers: [] });
  }
}
