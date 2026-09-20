import { NextResponse } from "next/server";
import { getFarmSummary } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Canonical summary windows. Any numeric hours value is clamped into [1, 168];
// a missing/empty param defaults to 24.
const MIN_HOURS = 1;
const MAX_HOURS = 168;
const DEFAULT_HOURS = 24;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("hours");

    let rangeHours = DEFAULT_HOURS;
    if (raw !== null && raw !== "") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return NextResponse.json(
          { success: false, error: "Invalid hours: expected 1, 24 or 168" },
          { status: 400 },
        );
      }
      rangeHours = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(parsed)));
    }

    const summary = getFarmSummary(rangeHours);
    return NextResponse.json({ success: true, ts: new Date().toISOString(), ...summary });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 },
    );
  }
}
