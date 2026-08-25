import { NextResponse } from "next/server";
import {
  getRecentAnalyses,
  getAllViralDNA,
  getLatestPrescriptions,
  getAccountWatchlist,
  getUnifiedKPIs,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const analyses = getRecentAnalyses(20);
    const viralDNA = getAllViralDNA();
    const prescriptions = getLatestPrescriptions(15);
    const watchlist = getAccountWatchlist();
    const kpis = getUnifiedKPIs();

    const avgScore =
      analyses.length > 0
        ? Number((analyses.reduce((sum, a) => sum + (a.cmo_score || 0), 0) / analyses.length).toFixed(1))
        : 0;

    const topAxes = analyses.length > 0
      ? {
          hook_power: avg(analyses.map((a) => a.axis_hook_power)),
          curiosity_gap: avg(analyses.map((a) => a.axis_curiosity_gap)),
          emotional_velocity: avg(analyses.map((a) => a.axis_emotional_velocity)),
          retention_architecture: avg(analyses.map((a) => a.axis_retention_architecture)),
          social_currency: avg(analyses.map((a) => a.axis_social_currency)),
          platform_fitness: avg(analyses.map((a) => a.axis_platform_fitness)),
          niche_authority: avg(analyses.map((a) => a.axis_niche_authority)),
          caption_amplification: avg(analyses.map((a) => a.axis_caption_amplification)),
          shareability_trigger: avg(analyses.map((a) => a.axis_shareability_trigger)),
          algorithm_hygiene: avg(analyses.map((a) => a.axis_algorithm_hygiene)),
        }
      : null;

    return NextResponse.json({
      success: true,
      summary: {
        totalAnalyzed: analyses.length,
        avgCmoScore: avgScore,
        totalWatchlistAccounts: watchlist.length,
        totalPrescriptions: prescriptions.length,
        kpis,
      },
      topAxes,
      recentAnalyses: analyses.slice(0, 10),
      viralDNA,
      prescriptions: prescriptions.slice(0, 10),
      watchlist: watchlist.slice(0, 20),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Number((nums.reduce((s, n) => s + (n || 0), 0) / nums.length).toFixed(2));
}
