/**
 * GET /api/agents/status — Returns status of all agent pipelines
 */
import { NextResponse } from "next/server";
import { getAllAgentStats } from "@/lib/agents-data";

export async function GET() {
  try {
    const stats = getAllAgentStats();
    return NextResponse.json({ agents: stats });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
