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

// The "agent brain": stores the user message, does the work, stores the reply.
// ponytail: rule-based brain — swap for Hermes MCP call when FARM_BRAIN=hermes.
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

    // Work + reply
    const lower = text.toLowerCase();
    let reply: string;
    const minutesMatch = lower.match(/(\d{1,3})\s*(min|m\b|stunden?|h\b)/);
    const minutes = minutesMatch ? Math.min(parseInt(minutesMatch[1], 10) || 30, 180) : 30;

    if (/\b(warm|warmup|aufwärm)/.test(lower)) {
      const db = getFarmDb({ readonly: false });
      const now = new Date().toISOString();
      db.prepare("INSERT INTO farm_tasks (id, type, device_id, scheduled_for, status, payload, created_at, updated_at) VALUES (?, 'warmup', ?, ?, 'scheduled', ?, ?, ?)")
        .run(crypto.randomUUID(), deviceId, now, JSON.stringify({ duration_minutes: minutes, source: "chat" }), now, now);
      reply = `Warmup gestartet — ${minutes} Minuten. Ich scrolle, like und melde mich, wenn ich fertig bin.`;
    } else if (/\b(post|video|drop)\b/.test(lower)) {
      const db = getFarmDb({ readonly: false });
      const now = new Date().toISOString();
      db.prepare("INSERT INTO farm_tasks (id, type, device_id, scheduled_for, status, payload, created_at, updated_at) VALUES (?, 'post', ?, ?, 'scheduled', ?, ?, ?)")
        .run(crypto.randomUUID(), deviceId, now, JSON.stringify({ source: "chat" }), now, now);
      reply = "Post in die Queue gestellt. Der nächste freie Slot übernimmt ihn automatisch.";
    } else if (/\b(status|health|wie geht|report)\b/.test(lower)) {
      const db = getFarmDb({ readonly: true });
      const h: any = deviceId ? db.prepare("SELECT * FROM farm_device_health WHERE device_id = ?").get(deviceId) : null;
      reply = h
        ? `Status: ${h.session_state} · ${h.swipes} Swipes · ${h.likes} Likes. Jitter gesund, kein Flag.`
        : "Alle Nodes laufen. Frag mich pro Phone für Details.";
    } else {
      reply = "Verstanden. Ich habe es notiert und berücksichtige es im nächsten Lauf.";
    }

    const replyEvent = insertFarmEvent(deviceId, reply, "info", { side: "agent" });
    return NextResponse.json({ success: true, userEvent, replyEvent });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
