/**
 * Unified data access factory for the Octragon Dashboard.
 *
 * Selects the correct backend based on the OCTAGON_DB_BACKEND env var:
 *   "supabase"  → queries Supabase (PostgreSQL)
 *   "sqlite"    → queries local SQLite file via better-sqlite3 (default)
 *
 * All functions return the same TypeScript types regardless of backend,
 * so callers never need to know which backend is in use.
 */

import { isSupabaseConfigured, supabase } from "./supabase";
import {
  getPipelineStats,
  getNicheConfigs,
  getRecentScraped,
  getAllVariations,
  getDeliveryQueue,
  getUnifiedKPIs,
  getTopVideos,
  getTopAccounts,
  getAccountWatchlist,
  getRecentAnalyses,
  getAllViralDNA,
  getLatestPrescriptions,
  getVariationStats,
  type PipelineStats,
  type NicheConfig,
  type ScrapedContent,
  type VideoVariation,
  type DeliveryLog,
  type UnifiedKPIs,
  type TopVideo,
  type TopAccount,
  type AccountWatchlist,
  type ContentAnalysis,
  type ViralDNAProfile,
  type NextPostQueue,
  type VariationStat,
} from "./db";

export type {
  PipelineStats,
  NicheConfig,
  ScrapedContent,
  VideoVariation,
  DeliveryLog,
  UnifiedKPIs,
  TopVideo,
  TopAccount,
  AccountWatchlist,
  ContentAnalysis,
  ViralDNAProfile,
  NextPostQueue,
  VariationStat,
};

function useSupabase(): boolean {
  return process.env.OCTAGON_DB_BACKEND === "supabase" && isSupabaseConfigured();
}

// ---- Pipeline Stats -------------------------------------------------------

async function getSupabasePipelineStats(): Promise<PipelineStats> {
  const empty: PipelineStats = {
    total_scraped: 0, pending_scrapes: 0, total_variations: 0,
    variations_ready: 0, pending_approvals: 0, total_delivered: 0,
    by_phone: { 1: { scraped: 0, posted: 0, niche_name: "Phone 1" }, 2: { scraped: 0, posted: 0, niche_name: "Phone 2" }, 3: { scraped: 0, posted: 0, niche_name: "Phone 3" }, 4: { scraped: 0, posted: 0, niche_name: "Phone 4" } },
  };
  try {
    const [sc, ps, vv, vr, pa, dl] = await Promise.all([
      supabase.from("scraped_content").select("*", { count: "exact", head: true }),
      supabase.from("scraped_content").select("*", { count: "exact", head: true }).eq("scrape_status", "pending"),
      supabase.from("video_variations").select("*", { count: "exact", head: true }),
      supabase.from("video_variations").select("*", { count: "exact", head: true }).eq("cleanse_status", "done"),
      supabase.from("delivery_log").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
      supabase.from("delivery_log").select("*", { count: "exact", head: true }).eq("approval_status", "posted"),
    ]);
    const by_phone: PipelineStats["by_phone"] = {};
    for (const phone of [1, 2, 3, 4]) {
      const [phoneSc, phoneDl, niche] = await Promise.all([
        supabase.from("scraped_content").select("*", { count: "exact", head: true }).eq("target_phone", phone),
        supabase.from("delivery_log").select("*", { count: "exact", head: true }).eq("phone_number", phone).eq("approval_status", "posted"),
        supabase.from("niche_config").select("niche_name").eq("phone_number", phone).maybeSingle(),
      ]);
      by_phone[phone] = {
        scraped: phoneSc.count ?? 0,
        posted: phoneDl.count ?? 0,
        niche_name: (niche.data as { niche_name?: string } | null)?.niche_name ?? `Phone ${phone}`,
      };
    }
    return { total_scraped: sc.count ?? 0, pending_scrapes: ps.count ?? 0, total_variations: vv.count ?? 0, variations_ready: vr.count ?? 0, pending_approvals: pa.count ?? 0, total_delivered: dl.count ?? 0, by_phone };
  } catch (e) {
    console.error("[data] getSupabasePipelineStats error:", e);
    return empty;
  }
}

export async function fetchPipelineStats(): Promise<PipelineStats> {
  if (useSupabase()) return getSupabasePipelineStats();
  return getPipelineStats();
}

// ---- Niche Configs --------------------------------------------------------

export async function fetchNicheConfigs(): Promise<NicheConfig[]> {
  if (useSupabase()) {
    try {
      const { data, error } = await supabase.from("niche_config").select("*").order("phone_number");
      if (error) throw error;
      return (data ?? []) as NicheConfig[];
    } catch (e) {
      console.error("[data] fetchNicheConfigs supabase error:", e);
      return [];
    }
  }
  return getNicheConfigs();
}

// ---- Scraped Content ------------------------------------------------------

export async function fetchRecentScraped(limit = 20): Promise<ScrapedContent[]> {
  if (useSupabase()) {
    try {
      const { data, error } = await supabase.from("scraped_content").select("*").order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as ScrapedContent[];
    } catch (e) {
      console.error("[data] fetchRecentScraped supabase error:", e);
      return [];
    }
  }
  return getRecentScraped(limit);
}

// ---- Video Variations -----------------------------------------------------

export async function fetchAllVariations(limit = 30): Promise<VideoVariation[]> {
  if (useSupabase()) {
    try {
      const { data, error } = await supabase.from("video_variations").select("*").order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as VideoVariation[];
    } catch (e) {
      console.error("[data] fetchAllVariations supabase error:", e);
      return [];
    }
  }
  return getAllVariations(limit);
}

// ---- Delivery Queue -------------------------------------------------------

export async function fetchDeliveryQueue(status?: string): Promise<DeliveryLog[]> {
  if (useSupabase()) {
    try {
      let q = supabase.from("delivery_log").select("*").order("created_at", { ascending: false }).limit(50);
      if (status) q = q.eq("approval_status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DeliveryLog[];
    } catch (e) {
      console.error("[data] fetchDeliveryQueue supabase error:", e);
      return [];
    }
  }
  return getDeliveryQueue(status);
}

// ---- KPIs & Accounts ------------------------------------------------------

export async function fetchUnifiedKPIs(platform?: string): Promise<UnifiedKPIs> {
  return getUnifiedKPIs(platform);
}

export async function fetchTopVideos(limit = 5, platform?: string): Promise<TopVideo[]> {
  return getTopVideos(limit, platform);
}

export async function fetchTopAccounts(limit = 5, platform?: string): Promise<TopAccount[]> {
  return getTopAccounts(limit, platform);
}

// ---- CMO ------------------------------------------------------------------

export async function fetchAccountWatchlist(): Promise<AccountWatchlist[]> {
  if (useSupabase()) {
    try {
      const { data, error } = await supabase.from("watchlist").select("*").order("viral_hit_count", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AccountWatchlist[];
    } catch (e) {
      console.error("[data] fetchAccountWatchlist supabase error:", e);
      return [];
    }
  }
  return getAccountWatchlist();
}

export async function fetchRecentAnalyses(limit = 10): Promise<(ContentAnalysis & { source_creator: string; source_url: string })[]> {
  return getRecentAnalyses(limit);
}

export async function fetchAllViralDNA(): Promise<(ViralDNAProfile & { handle: string })[]> {
  return getAllViralDNA();
}

export async function fetchLatestPrescriptions(limit = 10): Promise<(NextPostQueue & { handle: string })[]> {
  return getLatestPrescriptions(limit);
}

export async function fetchVariationStats(): Promise<VariationStat[]> {
  return getVariationStats();
}
