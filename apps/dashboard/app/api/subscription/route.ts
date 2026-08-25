import { NextResponse } from "next/server";
import { getUserSubscription, getTodayUsage, getDefaultUserId } from "@/lib/subscriptions";
import { getTierConfig } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = getDefaultUserId();
    const sub = getUserSubscription(userId);
    const usage = getTodayUsage(userId);
    const tierConfig = getTierConfig(sub?.tier || "solo");

    return NextResponse.json({
      subscription: sub,
      usage,
      tierConfig,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
