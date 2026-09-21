import { NextResponse } from "next/server";
import { insertFarmEvent, listFarmEvents, getFarmDb, listFarmAgents } from "@/lib/farmDb";
import type { FarmAgent } from "@/lib/farmDb";

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

// Who answers: an explicit "@<name>" mention of an active agent wins
// (longest name first, so "@Alpha Agent" is not eaten by a hypothetical
// agent named "Alpha"); anything else is answered by the supervisor.
function resolveAddressedAgent(text: string): FarmAgent | undefined {
  if (!text.startsWith("@")) return undefined;
  const afterMention = text.slice(1).trimStart().toLowerCase();
  if (!afterMention) return undefined;
  const candidates = listFarmAgents().sort((a, b) => b.name.length - a.name.length);
  return candidates.find(
    (a) => afterMention === a.name.toLowerCase() || afterMention.startsWith(`${a.name.toLowerCase()} `),
  );
}

// The rule-based chat brain: stores the user message, does the work it can do
// honestly, and answers. Commands: run (queue a pacing session), status, stop.
// Anything else gets an honest "logged only" reply - it never claims work it
// did not do. The reply is attributed to the addressed agent (@mention) or
// the supervisor "Nova"; its identity rides on the event's data.
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

    const addressed = resolveAddressedAgent(text);
    const agents = listFarmAgents();
    const replier: { id: string | null; name: string; role?: string } = addressed
      ? { id: addressed.id, name: addressed.name, role: addressed.role }
      : (() => {
          const supervisor = agents.find((a) => a.role === "supervisor") ?? null;
          return { id: supervisor?.id ?? null, name: supervisor?.name ?? "Octagon", role: supervisor?.role };
        })();
    const replyData = { side: "agent", agentId: replier.id, agentName: replier.name };

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
      if (!Number.isFinite(total) || total < 1) badDuration = true;
      else minutes = Math.min(Math.ceil(total), 180);
    }

    if (badDuration) {
      reply = "How many minutes? Give me a number above zero, like: run 20";
      const replyEvent = insertFarmEvent(deviceId, reply, "info", replyData);
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
      if (h) {
        reply = `Status: ${h.session_state}, ${h.swipes} swipes recorded, last action ${h.last_action || "none"}.${h.error ? ` Errors: ${h.error}` : " No errors logged."}`;
      } else {
        // No device in context: one honest summary across ALL devices. A
        // monitor adds the queue, because watching the queue is its job.
        const health = db.prepare("SELECT * FROM farm_device_health").all() as any[];
        const totalDevices = (db.prepare("SELECT COUNT(*) AS c FROM farm_devices WHERE active = 1").get() as any)?.c ?? 0;
        const connected = health.filter((r) => r.usb_connected === 1).length;
        const running = health.filter((r) => r.session_state === "session").length;
        const swipes = health.reduce((sum, r) => sum + (Number(r.swipes) || 0), 0);
        const errored = health.filter((r) => r.error);
        reply =
          `Fleet status: ${connected}/${totalDevices} devices connected via USB, ` +
          `${running} session(s) running, ${swipes} swipes recorded across the fleet.`;
        if (errored.length > 0) {
          reply += ` Devices with errors: ${errored.map((r) => `${r.device_id} (${r.error})`).join(", ")}.`;
        }
        if (replier.role === "monitor") {
          const queued = (db.prepare("SELECT COUNT(*) AS c FROM farm_tasks WHERE status IN ('scheduled', 'running')").get() as any)?.c ?? 0;
          reply += ` ${queued} task(s) in the queue.`;
        }
      }
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

    const replyEvent = insertFarmEvent(deviceId, reply, "info", replyData);
    return NextResponse.json({ success: true, userEvent, replyEvent });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
