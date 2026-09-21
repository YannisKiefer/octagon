import { NextResponse } from "next/server";
import crypto from "crypto";
import { getFarmDb, listFarmAgents } from "@/lib/farmDb";
import type { FarmAgent, FarmAgentRole } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES: FarmAgentRole[] = ["phone", "monitor", "supervisor", "custom"];

function isRole(v: any): v is FarmAgentRole {
  return VALID_ROLES.includes(v);
}

// GET /api/agents -> { success, agents: [...] } - active agents only,
// ordered by creation.
export async function GET() {
  try {
    const agents = listFarmAgents();
    return NextResponse.json({ success: true, agents });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e), agents: [] }, { status: 500 });
  }
}

// POST /api/agents {name, role, device_id?} -> { success, agent }
// - name: 2-24 chars, unique case-insensitive
// - role: phone | monitor | supervisor | custom
// - phone agents require a device_id that exists; one agent per device max.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body?.name || "").trim();
    const role = body?.role;
    const deviceId = body?.device_id ? String(body.device_id) : null;

    if (name.length < 2 || name.length > 24) {
      return NextResponse.json({ success: false, error: "name must be 2-24 characters" }, { status: 400 });
    }
    if (!isRole(role)) {
      return NextResponse.json({ success: false, error: "role must be one of: phone, monitor, supervisor, custom" }, { status: 400 });
    }

    const db = getFarmDb({ readonly: false });
    const now = new Date().toISOString();

    const nameTaken = db.prepare("SELECT id FROM farm_agents WHERE LOWER(name) = LOWER(?)").get(name);
    if (nameTaken) {
      return NextResponse.json({ success: false, error: "an agent with that name already exists" }, { status: 409 });
    }

    if (role === "phone") {
      if (!deviceId) {
        return NextResponse.json({ success: false, error: "phone agents require a device_id" }, { status: 400 });
      }
      const device = db.prepare("SELECT id FROM farm_devices WHERE id = ?").get(deviceId);
      if (!device) {
        return NextResponse.json({ success: false, error: "unknown device_id" }, { status: 400 });
      }
      const perDevice = db.prepare("SELECT id FROM farm_agents WHERE device_id = ?").get(deviceId);
      if (perDevice) {
        return NextResponse.json({ success: false, error: "that device already has an agent" }, { status: 409 });
      }
    }

    const agent: FarmAgent = {
      id: crypto.randomUUID(),
      name,
      role,
      device_id: role === "phone" ? deviceId : null,
      color: "#529BFF",
      status: "idle",
      active: 1,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      "INSERT INTO farm_agents (id, name, role, device_id, color, status, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(agent.id, agent.name, agent.role, agent.device_id, agent.color, agent.status, agent.active, agent.created_at, agent.updated_at);

    return NextResponse.json({ success: true, agent });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
