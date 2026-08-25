import { NextResponse } from "next/server";
import crypto from "crypto";
import { getFarmDb, listFarmTasks } from "@/lib/farmDb";
import type { FarmTaskType } from "@/lib/farmTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TASK_TYPES: FarmTaskType[] = ["warmup", "audit", "post", "smoke", "dm", "outreach", "scout", "scroll"];

function isTaskType(v: any): v is FarmTaskType {
  return VALID_TASK_TYPES.includes(v);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date"); // YYYY-MM-DD in local TZ

    if (date) {
      const startLocal = new Date(`${date}T00:00:00`);
      const endLocal = new Date(`${date}T00:00:00`);
      endLocal.setDate(endLocal.getDate() + 1);
      const tasks = listFarmTasks(startLocal.toISOString(), endLocal.toISOString());
      return NextResponse.json({ success: true, tasks });
    }

    const tasks = listFarmTasks();
    return NextResponse.json({ success: true, tasks });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e), tasks: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!isTaskType(body?.type)) {
      return NextResponse.json({ success: false, error: "Invalid task type" }, { status: 400 });
    }

    const type: FarmTaskType = body.type;
    const deviceId: string | null = body.device_id ? String(body.device_id) : null;
    const scheduledFor = body.scheduled_for ? String(body.scheduled_for) : new Date().toISOString();
    const payload = body.payload ?? {};

    const scheduledAt = new Date(scheduledFor);
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ success: false, error: "Invalid scheduled_for ISO date" }, { status: 400 });
    }

    const db = getFarmDb({ readonly: false });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    if (deviceId) {
      const exists = db.prepare("SELECT id FROM farm_devices WHERE id = ? AND active = 1").get(deviceId) as { id: string } | undefined;
      if (!exists) {
        return NextResponse.json({ success: false, error: "Unknown device_id" }, { status: 400 });
      }
    }

    db.prepare(
      `INSERT INTO farm_tasks
        (id, type, device_id, scheduled_for, status, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
    ).run(id, type, deviceId, scheduledAt.toISOString(), JSON.stringify(payload), now, now);

    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
