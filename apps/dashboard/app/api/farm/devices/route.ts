import { NextResponse } from "next/server";
import { getFarmHealth, listFarmDevices } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const devices = listFarmDevices();
    const health = getFarmHealth();
    return NextResponse.json({
      success: true,
      devices,
      health,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e), devices: [], health: [] }, { status: 500 });
  }
}

