/**
 * Supabase-backed data layer for the dashboard.
 * Falls back gracefully when Supabase is not configured.
 */
import { supabase, isSupabaseConfigured } from "./supabase";
import type { PipelineStats } from "./db";

export async function getSupabasePipelineStats(): Promise<PipelineStats | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const [scraped, pendingScrapes, variations, variationsReady, pendingApprovals, delivered] = await Promise.all([
      supabase.from("scraped_content").select("*", { count: "exact", head: true }),
      supabase.from("scraped_content").select("*", { count: "exact", head: true }).eq("scrape_status", "pending"),
      supabase.from("video_variations").select("*", { count: "exact", head: true }),
      supabase.from("video_variations").select("*", { count: "exact", head: true }).eq("cleanse_status", "done"),
      supabase.from("delivery_log").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
      supabase.from("delivery_log").select("*", { count: "exact", head: true }).eq("approval_status", "posted"),
    ]);

    const by_phone: PipelineStats["by_phone"] = {};
    for (const phone of [1, 2, 3, 4]) {
      const [phoneScrape, phonePost, nicheRes] = await Promise.all([
        supabase.from("scraped_content").select("*", { count: "exact", head: true }).eq("target_phone", phone),
        supabase.from("delivery_log").select("*", { count: "exact", head: true }).eq("phone_number", phone).eq("approval_status", "posted"),
        supabase.from("niche_config").select("niche_name").eq("phone_number", phone).maybeSingle(),
      ]);
      by_phone[phone] = {
        scraped: phoneScrape.count ?? 0,
        posted: phonePost.count ?? 0,
        niche_name: (nicheRes.data as { niche_name?: string } | null)?.niche_name ?? `Phone ${phone}`,
      };
    }

    return {
      total_scraped: scraped.count ?? 0,
      pending_scrapes: pendingScrapes.count ?? 0,
      total_variations: variations.count ?? 0,
      variations_ready: variationsReady.count ?? 0,
      pending_approvals: pendingApprovals.count ?? 0,
      total_delivered: delivered.count ?? 0,
      by_phone,
    };
  } catch (err) {
    console.error("[supabase-db] getSupabasePipelineStats error:", err);
    return null;
  }
}
