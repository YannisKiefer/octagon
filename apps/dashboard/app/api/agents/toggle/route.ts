/**
 * POST /api/agents/toggle — Start/stop an agent pipeline
 * Body: { team: "skool" | "whop", action: "start" | "stop" }
 */
import { NextRequest, NextResponse } from "next/server";
import { toggleAgent, AgentTeam } from "@/lib/agents-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { team, action } = body as { team: AgentTeam; action: "start" | "stop" };

    if (!team || !action) {
      return NextResponse.json(
        { error: "Missing team or action" },
        { status: 400 }
      );
    }

    if (!["start", "stop"].includes(action)) {
      return NextResponse.json(
        { error: "Action must be 'start' or 'stop'" },
        { status: 400 }
      );
    }

    const result = toggleAgent(team, action);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
