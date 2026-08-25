import { NextResponse } from "next/server";
import { getFarmDb } from "@/lib/farmDb";
import type { FarmTaskStatus } from "@/lib/farmTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isStatus(v: any): v is FarmTaskStatus {
  return v === "scheduled" || v === "running" || v === "succeeded" || v === "failed" || v === "canceled";
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const taskId = String(id);
    const body = await req.json();

    const patch: Record<string, any> = {};
    if (body?.scheduled_for !== undefined) {
      const d = new Date(String(body.scheduled_for));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ success: false, error: "Invalid scheduled_for ISO date" }, { status: 400 });
      }
      patch.scheduled_for = d.toISOString();
    }
    if (body?.device_id !== undefined) {
      patch.device_id = body.device_id ? String(body.device_id) : null;
    }
    if (body?.status !== undefined) {
      if (!isStatus(body.status)) {
        return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
      }
      patch.status = body.status as FarmTaskStatus;
    }

    const db = getFarmDb({ readonly: false });
    const existing = db.prepare("SELECT id FROM farm_tasks WHERE id = ?").get(taskId) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
    }

    if (patch.device_id) {
      const dev = db.prepare("SELECT id FROM farm_devices WHERE id = ? AND active = 1").get(patch.device_id) as { id: string } | undefined;
      if (!dev) {
        return NextResponse.json({ success: false, error: "Unknown device_id" }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    patch.updated_at = now;

    // When re-scheduling, clear run metadata.
    if (patch.status === "scheduled") {
      patch.started_at = null;
      patch.finished_at = null;
      patch.error = "";
      patch.result = "";
    }

    const cols = Object.keys(patch);
    if (cols.length === 0) {
      return NextResponse.json({ success: true });
    }

    const setSql = cols.map((c) => `${c} = @${c}`).join(", ");
    db.prepare(`UPDATE farm_tasks SET ${setSql} WHERE id = @id`).run({ id: taskId, ...patch });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
