/**
 * SQLite data layer for the Octragon Dashboard.
 * Reads from the same farm.db used by the Python backend.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(
  process.env.FARM_DB_PATH || process.env.OCTRAGON_DB_PATH ||
  path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db")
);

let _db: Database.Database | null = null;
let _dbMissing = false;

function getDb(): Database.Database {
  if (_dbMissing) throw new Error(`[db] SQLite DB not found: ${DB_PATH}`);
  if (!_db) {
    if (!fs.existsSync(DB_PATH)) {
      _dbMissing = true;
      throw new Error(`[db] SQLite DB not found: ${DB_PATH}`);
    }
    _db = new Database(DB_PATH, { readonly: true });
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}

// ---- Types ----------------------------------------------------------------

export type ScrapedContent = {
  id: string;
  source_url: string;
  source_platform: string;
  source_creator: string;
  caption: string;
  hashtags: string;
  duration_seconds: number;
  resolution: string;
  video_path: string;
  video_hash: string;
  engagement_likes: number;
  engagement_comments: number;
  engagement_shares: number;
  engagement_views: number;
  target_niche: string;
  target_phone: number;
  scrape_status: string;
  scraped_at: string | null;
  created_at: string;
};

export type VideoVariation = {
  id: string;
  scraped_content_id: string;
  variation_index: number;
  video_path: string;
  video_hash: string;
  forge_params: string;
  cleanse_status: string;
  metadata_injected: number;
  gemini_analysis: string;
  cleansed_at: string | null;
  created_at: string;
};

export type DeliveryLog = {
  id: string;
  variation_id: string;
  scraped_content_id: string;
  phone_number: number;
  target_platform: string;
  target_account: string;
  approval_status: string;
  approved_at: string | null;
  posted_at: string | null;
  post_url: string;
  created_at: string;
};

export type NicheConfig = {
  phone_number: number;
  niche: string;
  niche_name: string;
  telegram_group_id: string;
  tiktok_handle: string;
  instagram_handle: string;
  linkedin_handle: string;
  platforms: string;
  active: number;
};

export type PipelineStats = {
  total_scraped: number;
  pending_scrapes: number;
  total_variations: number;
  variations_ready: number;
  pending_approvals: number;
  total_delivered: number;
  by_phone: Record<number, { scraped: number; posted: number; niche_name: string }>;
};

// ---- Queries ---------------------------------------------------------------

const EMPTY_PIPELINE_STATS: PipelineStats = {
  total_scraped: 0,
  pending_scrapes: 0,
  total_variations: 0,
  variations_ready: 0,
  pending_approvals: 0,
  total_delivered: 0,
  by_phone: { 1: { scraped: 0, posted: 0, niche_name: "Phone 1" }, 2: { scraped: 0, posted: 0, niche_name: "Phone 2" }, 3: { scraped: 0, posted: 0, niche_name: "Phone 3" }, 4: { scraped: 0, posted: 0, niche_name: "Phone 4" } },
};

export function getPipelineStats(): PipelineStats {
  let db: Database.Database;
  try { db = getDb(); } catch { return EMPTY_PIPELINE_STATS; }
  const total_scraped = (db.prepare("SELECT COUNT(*) as c FROM scraped_content").get() as { c: number }).c;
  const pending_scrapes = (db.prepare("SELECT COUNT(*) as c FROM scraped_content WHERE scrape_status = 'pending'").get() as { c: number }).c;
  const total_variations = (db.prepare("SELECT COUNT(*) as c FROM video_variations").get() as { c: number }).c;
  const variations_ready = (db.prepare("SELECT COUNT(*) as c FROM video_variations WHERE cleanse_status = 'done'").get() as { c: number }).c;
  const pending_approvals = (db.prepare("SELECT COUNT(*) as c FROM delivery_log WHERE approval_status = 'pending'").get() as { c: number }).c;
  const total_delivered = (db.prepare("SELECT COUNT(*) as c FROM delivery_log WHERE approval_status = 'posted'").get() as { c: number }).c;

  const by_phone: PipelineStats["by_phone"] = {};
  for (const phone of [1, 2, 3, 4]) {
    const nc = db.prepare("SELECT niche_name FROM niche_config WHERE phone_number = ?").get(phone) as { niche_name: string } | undefined;
    by_phone[phone] = {
      scraped: (db.prepare("SELECT COUNT(*) as c FROM scraped_content WHERE target_phone=?").get(phone) as { c: number }).c,
      posted: (db.prepare("SELECT COUNT(*) as c FROM delivery_log WHERE phone_number=? AND approval_status='posted'").get(phone) as { c: number }).c,
      niche_name: nc?.niche_name ?? `Phone ${phone}`,
    };
  }
  return { total_scraped, pending_scrapes, total_variations, variations_ready, pending_approvals, total_delivered, by_phone };
}

export function getRecentScraped(limit = 20): ScrapedContent[] {
  try { return getDb().prepare("SELECT * FROM scraped_content ORDER BY created_at DESC LIMIT ?").all(limit) as ScrapedContent[]; } catch { return []; }
}

export function getVariations(scraped_content_id: string): VideoVariation[] {
  try { return getDb().prepare("SELECT * FROM video_variations WHERE scraped_content_id = ? ORDER BY variation_index").all(scraped_content_id) as VideoVariation[]; } catch { return []; }
}

export function getAllVariations(limit = 30): VideoVariation[] {
  try { return getDb().prepare("SELECT * FROM video_variations ORDER BY created_at DESC LIMIT ?").all(limit) as VideoVariation[]; } catch { return []; }
}

export function getDeliveryQueue(status?: string): DeliveryLog[] {
  try {
    if (status) {
      return getDb().prepare("SELECT * FROM delivery_log WHERE approval_status = ? ORDER BY created_at DESC").all(status) as DeliveryLog[];
    }
    return getDb().prepare("SELECT * FROM delivery_log ORDER BY created_at DESC LIMIT 50").all() as DeliveryLog[];
  } catch { return []; }
}

export function getNicheConfigs(): NicheConfig[] {
  try { return getDb().prepare("SELECT * FROM niche_config ORDER BY phone_number").all() as NicheConfig[]; } catch { return []; }
}

export type VariationStat = {
  variation_index: number;
  count: number;
  avg_crf: number | null;
  avg_pitch: number | null;
};

export function getVariationStats(): VariationStat[] {
  try {
    return getDb()
      .prepare(`
        SELECT
          v.variation_index,
          COUNT(*) as count,
          AVG(CAST(json_extract(v.forge_params, '$.noise_seed') AS REAL)) as avg_crf,
          AVG(CAST(json_extract(v.forge_params, '$.audio_pitch_shift') AS REAL)) as avg_pitch
        FROM video_variations v
        GROUP BY v.variation_index
        ORDER BY v.variation_index
      `)
      .all() as VariationStat[];
  } catch {
    return [];
  }
}

// ---- ViewTrack Clone Queries ----------------------------------------------

export type UnifiedKPIs = {
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  avg_engagement_rate: number;
};

const EMPTY_UNIFIED_KPIS: UnifiedKPIs = { total_views: 0, total_likes: 0, total_comments: 0, total_shares: 0, avg_engagement_rate: 0 };

export function getUnifiedKPIs(platform?: string): UnifiedKPIs {
  let db: Database.Database;
  try { db = getDb(); } catch { return EMPTY_UNIFIED_KPIS; }
  let query = `
    SELECT 
      SUM(engagement_views) as views,
      SUM(engagement_likes) as likes,
      SUM(engagement_comments) as comments,
      SUM(engagement_shares) as shares
    FROM scraped_content
  `;
  let params: any[] = [];
  
  if (platform && platform !== "all") {
    query += ` WHERE source_platform = ?`;
    params.push(platform);
  }

  const result = db.prepare(query).get(...params) as { views: number, likes: number, comments: number, shares: number } | undefined;
  
  const views = result?.views || 0;
  const likes = result?.likes || 0;
  const eng = views > 0 ? ((likes + (result?.comments || 0) + (result?.shares || 0)) / views) * 100 : 0;

  return {
    total_views: views,
    total_likes: likes,
    total_comments: result?.comments || 0,
    total_shares: result?.shares || 0,
    avg_engagement_rate: Number(eng.toFixed(2))
  };
}

export type TopVideo = ScrapedContent & {
  cmo_score?: number;
};

export function getTopVideos(limit = 5, platform?: string): TopVideo[] {
  try {
    let db: Database.Database;
    try { db = getDb(); } catch { return []; }
    let query = `SELECT s.*, c.cmo_score FROM scraped_content s LEFT JOIN content_analysis c ON s.id = c.scraped_content_id`;
    const params: any[] = [];
    if (platform && platform !== "all") { query += ` WHERE s.source_platform = ?`; params.push(platform); }
    query += ` ORDER BY s.engagement_views DESC LIMIT ?`;
    params.push(limit);
    return db.prepare(query).all(...params) as TopVideo[];
  } catch { return []; }
}

export type TopAccount = {
  handle: string;
  platform: string;
  total_views: number;
  total_videos: number;
};

export function getTopAccounts(limit = 5, platform?: string): TopAccount[] {
  try {
    let db: Database.Database;
    try { db = getDb(); } catch { return []; }
    let query = `SELECT source_creator as handle, source_platform as platform, SUM(engagement_views) as total_views, COUNT(id) as total_videos FROM scraped_content WHERE source_creator != ''`;
    const params: any[] = [];
    if (platform && platform !== "all") { query += ` AND source_platform = ?`; params.push(platform); }
    query += ` GROUP BY source_creator, source_platform ORDER BY total_views DESC LIMIT ?`;
    params.push(limit);
    return db.prepare(query).all(...params) as TopAccount[];
  } catch { return []; }
}

// ---- CMO v2.1 Intelligence Models -----------------------------------------

export type AccountWatchlist = {
  id: string;
  handle: string;
  platform: string;
  niche: string;
  phone_number: number;
  status: string;
  added_at: string;
  last_scanned_at: string | null;
  viral_hit_count: number;
  baseline_avg_views: number;
  total_videos_tracked: number;
};

export type ContentAnalysis = {
  id: string;
  scraped_content_id: string;
  account_id: string;
  verdict: string;
  why_worked: string;
  why_failed: string;
  cmo_score: number;
  hook_type: string;
  content_type: string;
  emotional_tone: string;
  ideal_duration_seconds: number;
  timing_analysis: string;
  engagement_delta_pct: number;
  generated_at: string;
  embedding_json: string;
  axis_hook_power: number;
  axis_curiosity_gap: number;
  axis_emotional_velocity: number;
  axis_retention_architecture: number;
  axis_social_currency: number;
  axis_platform_fitness: number;
  axis_niche_authority: number;
  axis_caption_amplification: number;
  axis_shareability_trigger: number;
  axis_algorithm_hygiene: number;
  highest_leverage_intervention: string;
  viral_atoms_json: string;
  clone_priority: string;
};

export type ViralDNAProfile = {
  account_id: string;
  top_hooks: string;
  optimal_posting_times: string;
  winning_formats: string;
  winning_emotions: string;
  avg_engagement_rate: number;
  trend_direction: string;
  total_analyzed: number;
  viral_win_count: number;
  rejection_count: number;
  updated_at: string;
  genome_embedding_json: string;
  genome_signature: string;
  competitor_exploitation_gap: string;
  viral_atoms_library: string;
  optimal_duration_range: string;
  dominant_axis_strengths: string;
  critical_axis_weaknesses: string;
  trajectory_note: string;
  cluster_labels: string;
};

export type NextPostQueue = {
  id: string;
  account_id: string;
  script: string;
  hook: string;
  reference_content_id: string;
  format_type: string;
  rationale: string;
  priority: number;
  status: string;
  generated_at: string;
};

// ---- CMO Queries ----------------------------------------------------------

export function getAccountWatchlist(): AccountWatchlist[] {
  try { return getDb().prepare("SELECT * FROM watchlist ORDER BY viral_hit_count DESC").all() as AccountWatchlist[]; } catch { return []; }
}

export function getContentAnalysis(scrapedContentId: string): ContentAnalysis | null {
  try { return getDb().prepare("SELECT * FROM content_analysis WHERE scraped_content_id = ?").get(scrapedContentId) as ContentAnalysis | null; } catch { return null; }
}

export function getRecentAnalyses(limit = 10): (ContentAnalysis & { source_creator: string, source_url: string })[] {
  try {
    return getDb().prepare(`SELECT c.*, s.source_creator, s.source_url FROM content_analysis c JOIN scraped_content s ON c.scraped_content_id = s.id ORDER BY c.generated_at DESC LIMIT ?`).all(limit) as (ContentAnalysis & { source_creator: string, source_url: string })[];
  } catch { return []; }
}

export function getViralDNA(accountId: string): ViralDNAProfile | null {
  try { return getDb().prepare("SELECT * FROM viral_dna_profile WHERE account_id = ?").get(accountId) as ViralDNAProfile | null; } catch { return null; }
}

export function getAllViralDNA(): (ViralDNAProfile & { handle: string })[] {
  try {
    return getDb().prepare(`SELECT v.*, a.handle FROM viral_dna_profile v JOIN accounts a ON v.account_id = a.id ORDER BY v.viral_win_count DESC`).all() as (ViralDNAProfile & { handle: string })[];
  } catch { return []; }
}

export function getAccountAudits(): (ContentAnalysis & { account_handle: string })[] {
  try {
    return getDb().prepare(`SELECT c.*, a.handle as account_handle FROM content_analysis c JOIN accounts a ON c.account_id = a.id ORDER BY c.generated_at DESC LIMIT 20`).all() as (ContentAnalysis & { account_handle: string })[];
  } catch { return []; }
}

export function getLatestPrescriptions(limit = 10): (NextPostQueue & { handle: string })[] {
  try {
    return getDb().prepare(`SELECT n.*, a.handle FROM next_post_queue n JOIN accounts a ON n.account_id = a.id ORDER BY n.generated_at DESC LIMIT ?`).all(limit) as (NextPostQueue & { handle: string })[];
  } catch { return []; }
}
