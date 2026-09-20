import { NextResponse } from "next/server";
import { insertFarmEvent, listFarmEvents, getFarmDb } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const phoneId = url.searchParams.get("phoneId") || undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const events = listFarmEvents(limit, phoneId);
    return NextResponse.json({ success: true, events });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e), events: [] }, { status: 500 });
  }
}

// The rule-based chat brain: stores the user message, does the work it can do
// honestly, and answers. Commands: run (queue a pacing session), status, stop.
// Anything else gets an honest "logged only" reply - it never claims work it
// did not do.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const deviceId = body?.deviceId ? String(body.deviceId) : null;
    const text = String(body?.text || "").trim();
    if (!text) return NextResponse.json({ success: false, error: "text required" }, { status: 400 });
    if (text.length > 2000) return NextResponse.json({ success: false, error: "text too long" }, { status: 400 });
    if (deviceId) {
      const db = getFarmDb({ readonly: true });
      const exists = db.prepare("SELECT id FROM farm_devices WHERE id = ?").get(deviceId);
      if (!exists) return NextResponse.json({ success: false, error: "unknown device" }, { status: 400 });
    }

    const userEvent = insertFarmEvent(deviceId, text, "info", { side: "user" });

    const lower = text.toLowerCase();
    let reply: string;
    // "run 20" means 20 minutes; "run 1.5h" means 90. A bare "run" defaults to 10.
    const minutesMatch = lower.match(/(\d{1,3}(?:\.\d)?)\s*(hours?|h\b|minutes?|min|m\b)?/);
    let minutes = 10;
    let badDuration = false;
    if (minutesMatch) {
      const n = parseFloat(minutesMatch[1]);
      const inHours = Boolean(minutesMatch[2] && /h/.test(minutesMatch[2]));
      const total = inHours ? n * 60 : n;
      if (!Number.isFinite(total) || total <= 0) badDuration = true;
      else minutes = Math.min(Math.round(total), 180);
    }

    if (badDuration) {
      reply = "How many minutes? Give me a number above zero, like: run 20";
      const replyEvent = insertFarmEvent(deviceId, reply, "info", { side: "agent" });
      return NextResponse.json({ success: true, userEvent, replyEvent });
    }

    if (/\b(run|start|session|pace)\b/.test(lower) && !/\b(status|stop|cancel)\b/.test(lower)) {
      const db = getFarmDb({ readonly: false });
      const now = new Date().toISOString();
      db.prepare("INSERT INTO farm_tasks (id, type, device_id, scheduled_for, status, payload, created_at, updated_at) VALUES (?, 'session', ?, ?, 'scheduled', ?, ?, ?)")
        .run(crypto.randomUUID(), deviceId, now, JSON.stringify({ duration_minutes: minutes, source: "chat" }), now, now);
      reply = `Queued a ${minutes}-minute session. It runs while the hub is up ("node infra/farm/hub.js"); progress and a summary land here. In --dry-run mode nothing is spoken aloud.`;
    } else if (/\b(status|health|report)\b/.test(lower)) {
      const db = getFarmDb({ readonly: true });
      const h: any = deviceId ? db.prepare("SELECT * FROM farm_device_health WHERE device_id = ?").get(deviceId) : null;
      reply = h
        ? `Status: ${h.session_state}, ${h.swipes} swipes recorded, last action ${h.last_action || "none"}.${h.error ? ` Errors: ${h.error}` : " No errors logged."}`
        : "Open a device on the left and ask again for its status.";
    } else if (/\b(stop|cancel)\b/.test(lower)) {
      const db = getFarmDb({ readonly: false });
      const now = new Date().toISOString();
      const r = deviceId
        ? db.prepare("UPDATE farm_tasks SET status='canceled', updated_at=? WHERE device_id=? AND status IN ('scheduled','running')").run(now, deviceId)
        : db.prepare("UPDATE farm_tasks SET status='canceled', updated_at=? WHERE status IN ('scheduled','running')").run(now);
      reply = r.changes > 0 ? `Canceled ${r.changes} queued task(s).` : "Nothing queued to cancel.";
    } else if (/\b(post|upload|video|publish)\b/.test(lower)) {
      reply = "Posting is not implemented yet. This build runs pacing sessions, status checks, and task scheduling only - it will not pretend otherwise. Posting your own content over Voice Control is on the roadmap.";
    } else {
      reply = "Logged. I only act on: run <minutes> (queue a session), status, stop. Everything stays on this Mac.";
    }

    const replyEvent = insertFarmEvent(deviceId, reply, "info", { side: "agent" });
    return NextResponse.json({ success: true, userEvent, replyEvent });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
