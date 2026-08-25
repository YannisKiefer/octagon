import { NextResponse } from "next/server";
import { getFarmDb, listFarmDevices, getFarmHealth } from "@/lib/farmDb";
import { getDeliveryQueue } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const devices = listFarmDevices();
    const health = getFarmHealth();
    const scheduled = getDeliveryQueue("approved");

    let hubStatus = null;
    try {
      const db = getFarmDb({ readonly: true });
      hubStatus = db.prepare("SELECT * FROM hub_status WHERE id = ?").get("hub") || null;
    } catch {}

    return NextResponse.json({
      success: true,
      devices,
      health,
      scheduled,
      hubStatus,
      ts: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error), devices: [], health: [], scheduled: [] },
      { status: 500 }
    );
  }
}
