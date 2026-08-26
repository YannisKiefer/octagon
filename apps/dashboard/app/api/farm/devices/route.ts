import { NextResponse } from "next/server";
import { createFarmDevice, getFarmHealth, listFarmDevices } from "@/lib/farmDb";

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

// Add a new phone-agent to the farm.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prefix = String(body?.prefix || "").trim().replace(/[^\w\- ]/g, "");
    if (!prefix || prefix.length < 2 || prefix.length > 20) {
      return NextResponse.json({ success: false, error: "prefix must be 2-20 characters" }, { status: 400 });
    }
    const device = createFarmDevice(prefix);
    return NextResponse.json({ success: true, device });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}

