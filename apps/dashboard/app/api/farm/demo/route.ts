import { NextResponse } from "next/server";
import crypto from "crypto";
import { getFarmDb } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Synthetic demo transcript - the same events as scripts/seed-demo.js, so the
// in-app onboarding produces exactly what the CLI seeder produces. All of it
// is fake and about wiring checks / pacing sessions.
const DEMO_EVENTS: Array<{ device: string; min: number; side: "user" | "agent"; text: string }> = [
  { device: "phone1", min: 240, side: "user", text: "run 20" },
  { device: "phone1", min: 240, side: "agent", text: "Queued a 20-minute session for Alpha. It starts when the hub is running; progress lands here." },
  { device: "phone1", min: 238, side: "agent", text: "Session started. Voice Control link looks good — Alpha answered its cue." },
  { device: "phone1", min: 219, side: "agent", text: "Session finished: 214 swipes in 20 min, average gap 4.9s. No errors." },
  { device: "phone2", min: 180, side: "user", text: "status" },
  { device: "phone2", min: 180, side: "agent", text: "Bravo: idle, 0 sessions today, no errors. Last USB seen 3 min ago." },
  { device: "phone4", min: 95, side: "user", text: "run 15" },
  { device: "phone4", min: 95, side: "agent", text: "Queued a 15-minute session for Delta." },
  { device: "phone4", min: 80, side: "agent", text: "Session finished: 151 swipes in 15 min, average gap 5.2s. No errors." },
  { device: "phone1", min: 30, side: "agent", text: "Hub heartbeat healthy. 3 devices online, 1 offline (Charlie is unplugged)." },
];

// The health counters the transcript cites (same values as scripts/seed-demo.js):
// [usb_connected, swipes, last_action, last_action_at_minutes_ago, jitter_variance]
const DEMO_HEALTH: Record<string, [number, number, string, number | null, number]> = {
  phone1: [1, 214, "Swipe Next", 219, 0.35],
  phone2: [1, 0, "", null, 0],
  phone3: [0, 0, "", null, 0],
  phone4: [1, 151, "Swipe Next", 80, 0.35],
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// POST /api/farm/demo -> fills a FRESH database with the synthetic demo
// transcript. Guard: zero events AND exactly the 4 default devices - demo
// data is only for a fresh start, never on top of real data.
export async function POST() {
  try {
    const db = getFarmDb({ readonly: false });

    const eventCount = (db.prepare("SELECT COUNT(*) AS c FROM farm_events").get() as { c: number }).c;
    const deviceCount = (db.prepare("SELECT COUNT(*) AS c FROM farm_devices").get() as { c: number }).c;
    const defaults = db
      .prepare("SELECT id FROM farm_devices WHERE id IN ('phone1','phone2','phone3','phone4')")
      .all() as Array<{ id: string }>;

    if (eventCount > 0 || deviceCount !== 4 || defaults.length !== 4) {
      return NextResponse.json(
        { success: false, error: "Database not empty - demo data is only for a fresh start" },
        { status: 409 },
      );
    }

    const insertEvent = db.prepare(
      "INSERT INTO farm_events (id, ts, level, device_id, task_id, event, data) VALUES (?, ?, 'info', ?, NULL, ?, ?)",
    );
    const updateHealth = db.prepare(`
      UPDATE farm_device_health
      SET usb_connected = ?, swipes = ?, last_action = ?, last_action_at = ?, jitter_variance = ?, updated_at = ?
      WHERE device_id = ?
    `);

    for (const [deviceId, [usb, swipes, lastAction, lastActionMin, jitter]] of Object.entries(DEMO_HEALTH)) {
      updateHealth.run(usb, swipes, lastAction, lastActionMin === null ? null : minutesAgo(lastActionMin), jitter, new Date().toISOString(), deviceId);
    }

    for (const e of DEMO_EVENTS) {
      insertEvent.run(crypto.randomUUID(), minutesAgo(e.min), e.device, e.text, JSON.stringify({ side: e.side }));
    }

    return NextResponse.json({ success: true, events: DEMO_EVENTS.length });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
