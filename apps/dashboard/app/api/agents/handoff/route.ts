import { NextResponse } from "next/server";
import { getFarmDb, getFarmAgent, humanizeTaskTitle, insertFarmEvent } from "@/lib/farmDb";
import type { FarmAgent, FarmTask } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/handoff {taskId, toAgentId, note?} -> { success, task }
//
// Hands a scheduled task to a phone agent: the task moves to that agent's
// device. Monitor and supervisor agents do not execute sessions, so handing
// a task to them is refused honestly and the task is left in place.
//
// On success this logs a farm_events row
//   "Handoff: <from> handed '<task title>' to <to>" (+ note)
// with data {agentId, kind:"handoff"}, and stamps the task payload with
// payload.handoff = {to, at}.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const taskId = body?.taskId ? String(body.taskId) : "";
    const toAgentId = body?.toAgentId ? String(body.toAgentId) : "";
    const note = body?.note ? String(body.note).slice(0, 500) : "";
    if (!taskId) return NextResponse.json({ success: false, error: "taskId required" }, { status: 400 });
    if (!toAgentId) return NextResponse.json({ success: false, error: "toAgentId required" }, { status: 400 });

    const db = getFarmDb({ readonly: false });

    const task = db.prepare("SELECT * FROM farm_tasks WHERE id = ?").get(taskId) as FarmTask | undefined;
    if (!task) return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });

    const toAgent = getFarmAgent(toAgentId);
    if (!toAgent || !toAgent.active) {
      return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
    }

    if (toAgent.role !== "phone") {
      return NextResponse.json(
        {
          success: false,
          error:
            `${toAgent.name} is a ${toAgent.role} agent - ` +
            "monitor/supervisor agents do not execute sessions - the task was left in place",
        },
        { status: 400 },
      );
    }
    if (!toAgent.device_id) {
      return NextResponse.json(
        { success: false, error: `${toAgent.name} has no device - the task was left in place` },
        { status: 400 },
      );
    }

    // Who holds the task today? The agent bound to its current device, or the
    // device's own name when no agent is bound, or "Unassigned".
    let fromName = task.device_id ? task.device_id : "Unassigned";
    if (task.device_id) {
      const fromAgent = db
        .prepare("SELECT * FROM farm_agents WHERE device_id = ? AND active = 1 LIMIT 1")
        .get(task.device_id) as FarmAgent | undefined;
      if (fromAgent) {
        fromName = fromAgent.name;
      } else {
        const dev = db.prepare("SELECT voice_prefix FROM farm_devices WHERE id = ?").get(task.device_id) as
          | { voice_prefix: string }
          | undefined;
        if (dev) fromName = dev.voice_prefix;
      }
    }

    const now = new Date().toISOString();
    const title = humanizeTaskTitle(task.type, task.payload);

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(task.payload || "{}") as Record<string, unknown>;
    } catch {
      payload = {};
    }
    payload.handoff = { to: toAgent.id, at: now };

    db.prepare("UPDATE farm_tasks SET device_id = ?, payload = ?, updated_at = ? WHERE id = ?")
      .run(toAgent.device_id, JSON.stringify(payload), now, taskId);

    const updated = db.prepare("SELECT * FROM farm_tasks WHERE id = ?").get(taskId) as FarmTask;

    insertFarmEvent(
      toAgent.device_id,
      `Handoff: ${fromName} handed '${title}' to ${toAgent.name}` + (note ? ` - ${note}` : ""),
      "info",
      { agentId: toAgent.id, kind: "handoff" },
    );

    return NextResponse.json({ success: true, task: updated });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
