import { NextResponse } from "next/server";
import { getFarmDb, getFarmHealth, listFarmDevices } from "@/lib/farmDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const devices = listFarmDevices();
    const health = getFarmHealth();
    const db = getFarmDb({ readonly: true });

    let sessionStats: any[] = [];
    try {
      sessionStats = db
        .prepare(
          `SELECT
            device_id,
            SUM(swipes) as swipes,
            SUM(likes) as likes,
            SUM(saves) as saves,
            SUM(comments) as comments,
            SUM(profiles) as profiles,
            jitter_variance,
            session_state,
            last_action,
            last_action_at,
            updated_at
          FROM farm_device_health
          GROUP BY device_id`
        )
        .all();
    } catch {}

    const parityScores = devices.map((device) => {
      const h = health.find((hh) => hh.device_id === device.id);
      if (!h) return { device_id: device.id, display_name: device.display_name, parity_score: 0 };

      const total = (h.swipes || 0) + (h.likes || 0) + (h.saves || 0) + (h.comments || 0);
      const likeRatio = total > 0 ? (h.likes || 0) / total : 0;
      const saveRatio = total > 0 ? (h.saves || 0) / total : 0;
      const jitterOk = (h.jitter_variance || 0) > 0.1 && (h.jitter_variance || 0) < 0.9;
      const ratioScore = Math.min(1, 1 - Math.abs(likeRatio - 0.35) - Math.abs(saveRatio - 0.08));
      const parity_score = Math.max(0, Math.round((ratioScore * (jitterOk ? 1 : 0.7)) * 100));

      return {
        device_id: device.id,
        display_name: device.display_name,
        phone_number: device.phone_number,
        parity_score,
        swipes: h.swipes || 0,
        likes: h.likes || 0,
        saves: h.saves || 0,
        comments: h.comments || 0,
        jitter_variance: h.jitter_variance || 0,
        session_state: h.session_state || "idle",
      };
    });

    return NextResponse.json({
      success: true,
      parityScores,
      sessionStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error), parityScores: [], sessionStats: [] },
      { status: 500 }
    );
  }
}
