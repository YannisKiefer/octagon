import { NextResponse } from "next/server";
import { getFarmDb } from "@/lib/farmDb";
import type { FarmAgent } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/agents/[id] {name?, device_id?, active?} -> { success, agent }
// Retiring an agent sets active=0; it stays in the database but disappears
// from the active roster and the chat.
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const agentId = String(id);
    const body = await req.json();

    const db = getFarmDb({ readonly: false });
    const existing = db.prepare("SELECT * FROM farm_agents WHERE id = ?").get(agentId) as FarmAgent | undefined;
    if (!existing) {
      return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
    }

    const patch: Record<string, any> = {};

    if (body?.name !== undefined) {
      const name = String(body.name || "").trim();
      if (name.length < 2 || name.length > 24) {
        return NextResponse.json({ success: false, error: "name must be 2-24 characters" }, { status: 400 });
      }
      const taken = db.prepare("SELECT id FROM farm_agents WHERE LOWER(name) = LOWER(?) AND id != ?").get(name, agentId);
      if (taken) {
        return NextResponse.json({ success: false, error: "an agent with that name already exists" }, { status: 409 });
      }
      patch.name = name;
    }

    if (body?.device_id !== undefined) {
      const deviceId = body.device_id ? String(body.device_id) : null;
      if (deviceId) {
        const device = db.prepare("SELECT id FROM farm_devices WHERE id = ?").get(deviceId);
        if (!device) {
          return NextResponse.json({ success: false, error: "unknown device_id" }, { status: 400 });
        }
        const perDevice = db.prepare("SELECT id FROM farm_agents WHERE device_id = ? AND id != ?").get(deviceId, agentId);
        if (perDevice) {
          return NextResponse.json({ success: false, error: "that device already has an agent" }, { status: 409 });
        }
      }
      patch.device_id = deviceId;
    }

    if (body?.active !== undefined) {
      patch.active = body.active ? 1 : 0;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true, agent: existing });
    }

    patch.updated_at = new Date().toISOString();
    const setSql = Object.keys(patch).map((c) => `${c} = @${c}`).join(", ");
    db.prepare(`UPDATE farm_agents SET ${setSql} WHERE id = @id`).run({ id: agentId, ...patch });

    const agent = db.prepare("SELECT * FROM farm_agents WHERE id = ?").get(agentId) as FarmAgent;
    return NextResponse.json({ success: true, agent });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
