-- ═══════════════════════════════════════════════════════════════════════════════
-- Octragon System — Supabase PostgreSQL Migration
-- Run this in the Supabase SQL Editor to create all tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable pgvector for future vector operations
CREATE EXTENSION IF NOT EXISTS vector;

-- ──────────────────────────────────────────────────────────────────────────────
-- Core Pipeline Tables
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    phone_number INTEGER NOT NULL,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL DEFAULT '',
    niche TEXT NOT NULL DEFAULT 'ecom',
    display_name TEXT DEFAULT '',
    account_type TEXT NOT NULL DEFAULT 'personal',
    slot_index INTEGER NOT NULL DEFAULT 0,
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    follower_count INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    last_full_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone_number);
CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
CREATE INDEX IF NOT EXISTS idx_accounts_niche ON accounts(niche);

CREATE TABLE IF NOT EXISTS scraped_content (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL UNIQUE,
    source_platform TEXT NOT NULL,
    source_creator TEXT DEFAULT '',
    caption TEXT DEFAULT '',
    hashtags JSONB DEFAULT '[]'::jsonb,
    duration_seconds INTEGER DEFAULT 0,
    resolution TEXT DEFAULT '',
    video_path TEXT DEFAULT '',
    audio_path TEXT DEFAULT '',
    video_hash TEXT DEFAULT '',
    engagement_likes INTEGER DEFAULT 0,
    engagement_comments INTEGER DEFAULT 0,
    engagement_shares INTEGER DEFAULT 0,
    engagement_views INTEGER DEFAULT 0,
    target_niche TEXT DEFAULT 'ecom',
    target_phone INTEGER DEFAULT 1,
    telegram_group_id TEXT DEFAULT '',
    telegram_message_id INTEGER DEFAULT 0,
    scrape_status TEXT DEFAULT 'pending',
    scraped_at TIMESTAMPTZ,
    raw_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scraped_platform ON scraped_content(source_platform);
CREATE INDEX IF NOT EXISTS idx_scraped_status ON scraped_content(scrape_status);
CREATE INDEX IF NOT EXISTS idx_scraped_niche ON scraped_content(target_niche);
CREATE INDEX IF NOT EXISTS idx_scraped_phone ON scraped_content(target_phone);
CREATE INDEX IF NOT EXISTS idx_scraped_created ON scraped_content(created_at DESC);

CREATE TABLE IF NOT EXISTS video_variations (
    id TEXT PRIMARY KEY,
    scraped_content_id TEXT NOT NULL REFERENCES scraped_content(id),
    variation_index INTEGER NOT NULL,
    video_path TEXT DEFAULT '',
    video_hash TEXT DEFAULT '',
    forge_params JSONB DEFAULT '{}'::jsonb,
    cleanse_status TEXT DEFAULT 'pending',
    metadata_injected BOOLEAN DEFAULT FALSE,
    gemini_analysis JSONB DEFAULT '{}'::jsonb,
    cleansed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variations_scraped ON video_variations(scraped_content_id);
CREATE INDEX IF NOT EXISTS idx_variations_status ON video_variations(cleanse_status);

CREATE TABLE IF NOT EXISTS delivery_log (
    id TEXT PRIMARY KEY,
    variation_id TEXT NOT NULL REFERENCES video_variations(id),
    scraped_content_id TEXT NOT NULL REFERENCES scraped_content(id),
    phone_number INTEGER NOT NULL,
    target_platform TEXT NOT NULL,
    target_account TEXT DEFAULT '',
    telegram_group_id TEXT DEFAULT '',
    telegram_message_id INTEGER DEFAULT 0,
    approval_status TEXT DEFAULT 'pending',
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT DEFAULT '',
    posted_at TIMESTAMPTZ,
    post_url TEXT DEFAULT '',
    post_engagement JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_phone ON delivery_log(phone_number);
CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_log(approval_status);
CREATE INDEX IF NOT EXISTS idx_delivery_telegram ON delivery_log(telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_delivery_variation ON delivery_log(variation_id);

CREATE TABLE IF NOT EXISTS niche_config (
    phone_number INTEGER PRIMARY KEY,
    niche TEXT NOT NULL,
    niche_name TEXT NOT NULL,
    telegram_group_id TEXT NOT NULL,
    tiktok_handle TEXT DEFAULT '',
    instagram_handle TEXT DEFAULT '',
    linkedin_handle TEXT DEFAULT '',
    gps_lat_center REAL DEFAULT 47.3769,
    gps_lon_center REAL DEFAULT 8.5417,
    gps_radius REAL DEFAULT 0.01,
    device_profile TEXT DEFAULT 'iphone_15_pro',
    platforms JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Account Intelligence Tables
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_analysis (
    id TEXT PRIMARY KEY,
    scraped_content_id TEXT NOT NULL REFERENCES scraped_content(id),
    account_id TEXT NOT NULL DEFAULT '',
    verdict TEXT NOT NULL DEFAULT 'neutral',
    why_worked TEXT DEFAULT '',
    why_failed TEXT DEFAULT '',
    cmo_score INTEGER DEFAULT 0,
    hook_type TEXT DEFAULT '',
    content_type TEXT DEFAULT '',
    emotional_tone TEXT DEFAULT '',
    ideal_duration_seconds INTEGER DEFAULT 0,
    timing_analysis TEXT DEFAULT '',
    engagement_delta_pct REAL DEFAULT 0.0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analysis_scraped ON content_analysis(scraped_content_id);
CREATE INDEX IF NOT EXISTS idx_analysis_account ON content_analysis(account_id);
CREATE INDEX IF NOT EXISTS idx_analysis_verdict ON content_analysis(verdict);

CREATE TABLE IF NOT EXISTS viral_dna_profile (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    top_hooks JSONB DEFAULT '[]'::jsonb,
    optimal_posting_times JSONB DEFAULT '[]'::jsonb,
    winning_formats JSONB DEFAULT '[]'::jsonb,
    winning_emotions JSONB DEFAULT '[]'::jsonb,
    avg_engagement_rate REAL DEFAULT 0.0,
    trend_direction TEXT DEFAULT 'neutral',
    total_analyzed INTEGER DEFAULT 0,
    viral_win_count INTEGER DEFAULT 0,
    rejection_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS next_post_queue (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    script TEXT DEFAULT '',
    hook TEXT DEFAULT '',
    reference_content_id TEXT DEFAULT '',
    format_type TEXT DEFAULT '',
    rationale TEXT DEFAULT '',
    priority INTEGER DEFAULT 1,
    status TEXT DEFAULT 'queued',
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nextpost_account ON next_post_queue(account_id);
CREATE INDEX IF NOT EXISTS idx_nextpost_status ON next_post_queue(status);

-- ──────────────────────────────────────────────────────────────────────────────
-- Intelligence Layer Tables
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_todos (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    date DATE NOT NULL,
    priority INTEGER DEFAULT 1,
    action TEXT NOT NULL,
    category TEXT DEFAULT 'content',
    rationale TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_todos_account ON daily_todos(account_id);
CREATE INDEX IF NOT EXISTS idx_todos_date ON daily_todos(date);
CREATE INDEX IF NOT EXISTS idx_todos_status ON daily_todos(status);

CREATE TABLE IF NOT EXISTS account_health (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    date DATE NOT NULL,
    cmo_score INTEGER DEFAULT 0,
    trend TEXT DEFAULT 'neutral',
    strengths TEXT DEFAULT '',
    weaknesses TEXT DEFAULT '',
    recommendations TEXT DEFAULT '',
    raw_report TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_health_account ON account_health(account_id);
CREATE INDEX IF NOT EXISTS idx_health_date ON account_health(date);

CREATE TABLE IF NOT EXISTS crm_interactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    contact_handle TEXT NOT NULL,
    platform TEXT NOT NULL,
    direction TEXT DEFAULT 'inbound',
    summary TEXT DEFAULT '',
    sentiment TEXT DEFAULT 'neutral',
    tags JSONB DEFAULT '[]'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_account ON crm_interactions(account_id);
CREATE INDEX IF NOT EXISTS idx_crm_contact ON crm_interactions(contact_handle);
CREATE INDEX IF NOT EXISTS idx_crm_occurred ON crm_interactions(occurred_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- ViewTrack Killer Tables
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hook_analyses (
    id TEXT PRIMARY KEY,
    scraped_content_id TEXT NOT NULL REFERENCES scraped_content(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    hook_type TEXT DEFAULT 'unknown',
    hook_text TEXT DEFAULT '',
    hook_score INTEGER DEFAULT 0,
    open_loops JSONB DEFAULT '[]'::jsonb,
    bold_claims JSONB DEFAULT '[]'::jsonb,
    emotional_triggers JSONB DEFAULT '[]'::jsonb,
    retention_devices JSONB DEFAULT '[]'::jsonb,
    cta_strength INTEGER DEFAULT 0,
    cta_type TEXT DEFAULT 'none',
    virality_factors JSONB DEFAULT '[]'::jsonb,
    replication_blueprint TEXT DEFAULT '',
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hook_account ON hook_analyses(account_id);
CREATE INDEX IF NOT EXISTS idx_hook_score ON hook_analyses(hook_score);
CREATE INDEX IF NOT EXISTS idx_hook_type ON hook_analyses(hook_type);

CREATE TABLE IF NOT EXISTS link_tracking (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    post_id TEXT DEFAULT '',
    utm_source TEXT DEFAULT '',
    utm_medium TEXT DEFAULT '',
    utm_campaign TEXT DEFAULT '',
    utm_content TEXT DEFAULT '',
    short_url TEXT DEFAULT '',
    target_url TEXT DEFAULT '',
    platform TEXT DEFAULT '',
    clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue REAL DEFAULT 0.0,
    conversion_rate REAL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_click_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_link_account ON link_tracking(account_id);
CREATE INDEX IF NOT EXISTS idx_link_campaign ON link_tracking(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_link_revenue ON link_tracking(revenue);

-- ──────────────────────────────────────────────────────────────────────────────
-- Row Level Security (for Creator Portals)
-- ──────────────────────────────────────────────────────────────────────────────

-- Enable RLS on key tables
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hook_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_tracking ENABLE ROW LEVEL SECURITY;

-- Service role bypass (for our Python backend)
CREATE POLICY "Service role full access" ON accounts FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role full access" ON content_analysis FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role full access" ON account_health FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role full access" ON daily_todos FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role full access" ON crm_interactions FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role full access" ON hook_analyses FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Service role full access" ON link_tracking FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ──────────────────────────────────────────────────────────────────────────────
-- Enable Realtime on high-frequency tables
-- ──────────────────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE crm_interactions;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_todos;
ALTER PUBLICATION supabase_realtime ADD TABLE account_health;
ALTER PUBLICATION supabase_realtime ADD TABLE hook_analyses;


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 1: Smart Indexing
-- ═══════════════════════════════════════════════════════════════════════════════

-- GIN indexes with jsonb_path_ops (40% smaller, 2x faster for containment)
CREATE INDEX IF NOT EXISTS idx_scraped_meta_path ON scraped_content
  USING GIN (raw_metadata jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_hook_loops_path ON hook_analyses
  USING GIN (open_loops jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_hook_claims_path ON hook_analyses
  USING GIN (bold_claims jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_crm_tags_path ON crm_interactions
  USING GIN (tags jsonb_path_ops);

-- Composite indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_accounts_platform_niche ON accounts(platform, niche);
CREATE INDEX IF NOT EXISTS idx_scraped_phone_created ON scraped_content(target_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_account_date ON account_health(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_account_occurred ON crm_interactions(account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hook_text_pattern ON hook_analyses(hook_text text_pattern_ops);


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 8: Generated Columns (auto-computed, zero manual work)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Auto-compute engagement rate on every row
ALTER TABLE scraped_content ADD COLUMN IF NOT EXISTS engagement_rate REAL
  GENERATED ALWAYS AS (
    CASE WHEN engagement_views > 0
    THEN (engagement_likes + engagement_comments + engagement_shares)::real / engagement_views
    ELSE 0 END
  ) STORED;

-- Auto-compute hook tier (S/A/B/C) from score
ALTER TABLE hook_analyses ADD COLUMN IF NOT EXISTS hook_tier TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN hook_score >= 80 THEN 'S-tier'
      WHEN hook_score >= 60 THEN 'A-tier'
      WHEN hook_score >= 40 THEN 'B-tier'
      ELSE 'C-tier'
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_hook_tier ON hook_analyses(hook_tier);
CREATE INDEX IF NOT EXISTS idx_engagement_rate ON scraped_content(engagement_rate DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 3: PostgreSQL Triggers (automated processing)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Auto-tag CRM interactions (hot leads, partnerships)
CREATE OR REPLACE FUNCTION fn_auto_tag_crm()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sentiment = 'positive' AND NEW.direction = 'inbound' THEN
    NEW.tags = NEW.tags || '["hot_lead"]'::jsonb;
  END IF;
  IF NEW.summary ILIKE '%collab%' OR NEW.summary ILIKE '%partner%' THEN
    NEW.tags = NEW.tags || '["partnership"]'::jsonb;
  END IF;
  IF NEW.summary ILIKE '%buy%' OR NEW.summary ILIKE '%purchase%' OR NEW.summary ILIKE '%order%' THEN
    NEW.tags = NEW.tags || '["purchase_intent"]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_tag_crm
  BEFORE INSERT OR UPDATE ON crm_interactions
  FOR EACH ROW EXECUTE FUNCTION fn_auto_tag_crm();

-- Auto-update viral DNA counters on new content analysis
CREATE OR REPLACE FUNCTION fn_update_dna_on_analysis()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO viral_dna_profile (account_id, total_analyzed, viral_win_count, rejection_count, updated_at)
  VALUES (
    NEW.account_id, 1,
    CASE WHEN NEW.verdict = 'viral' THEN 1 ELSE 0 END,
    CASE WHEN NEW.verdict = 'skip' THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (account_id) DO UPDATE SET
    total_analyzed = viral_dna_profile.total_analyzed + 1,
    viral_win_count = viral_dna_profile.viral_win_count + CASE WHEN NEW.verdict = 'viral' THEN 1 ELSE 0 END,
    rejection_count = viral_dna_profile.rejection_count + CASE WHEN NEW.verdict = 'skip' THEN 1 ELSE 0 END,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_dna_on_analysis
  AFTER INSERT ON content_analysis
  FOR EACH ROW EXECUTE FUNCTION fn_update_dna_on_analysis();

-- Audit trail table + trigger
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  row_id TEXT,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_changed ON audit_log(changed_at DESC);

CREATE OR REPLACE FUNCTION fn_audit_trail()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data)
  VALUES (
    TG_TABLE_NAME, TG_OP,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_accounts AFTER INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trail();
CREATE TRIGGER trg_audit_delivery AFTER INSERT OR UPDATE OR DELETE ON delivery_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trail();
CREATE TRIGGER trg_audit_link_tracking AFTER INSERT OR UPDATE OR DELETE ON link_tracking
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trail();


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 2: Materialized Views (dashboard precomputation)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pipeline_stats AS
SELECT
  (SELECT count(*) FROM scraped_content) AS total_scraped,
  (SELECT count(*) FROM scraped_content WHERE scrape_status = 'pending') AS pending_scrapes,
  (SELECT count(*) FROM video_variations WHERE cleanse_status = 'done') AS variations_ready,
  (SELECT count(*) FROM delivery_log WHERE approval_status = 'posted') AS total_posted,
  (SELECT count(*) FROM accounts WHERE active = true) AS active_accounts,
  (SELECT count(*) FROM crm_interactions) AS total_crm,
  (SELECT count(*) FROM hook_analyses) AS total_hooks,
  NOW() AS refreshed_at;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_account_performance AS
SELECT
  a.id,
  a.display_name,
  a.platform,
  a.niche,
  a.phone_number,
  a.account_type,
  COALESCE(h.latest_score, 0) AS cmo_score,
  COALESCE(h.trend, 'neutral') AS trend,
  COALESCE(ca.total_analyses, 0) AS total_analyses,
  COALESCE(ca.avg_score, 0) AS avg_content_score,
  COALESCE(crm.total_interactions, 0) AS total_crm_interactions
FROM accounts a
LEFT JOIN LATERAL (
  SELECT cmo_score AS latest_score, trend
  FROM account_health WHERE account_id = a.id ORDER BY date DESC LIMIT 1
) h ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS total_analyses, avg(cmo_score)::int AS avg_score
  FROM content_analysis WHERE account_id = a.id
) ca ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS total_interactions
  FROM crm_interactions WHERE account_id = a.id
) crm ON true
WHERE a.active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_account_perf_id ON mv_account_performance(id);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_hooks AS
SELECT
  hook_type,
  avg(hook_score)::int AS avg_score,
  count(*) AS total,
  mode() WITHIN GROUP (ORDER BY cta_type) AS most_common_cta,
  avg(cta_strength)::int AS avg_cta_strength
FROM hook_analyses
GROUP BY hook_type
ORDER BY avg_score DESC;


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 5: Creator Portal Access (RLS-optimized)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portal_access (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id UUID NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  access_level TEXT DEFAULT 'read',
  granted_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_client ON portal_access(client_id);
CREATE INDEX IF NOT EXISTS idx_portal_account ON portal_access(account_id);

ALTER TABLE portal_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Portal users see own access" ON portal_access
  FOR SELECT USING (client_id = (SELECT auth.uid()));


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 7: RPC Helper Functions (for Edge Functions + dashboard)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Increment link clicks atomically (for UTM redirect edge function)
CREATE OR REPLACE FUNCTION increment_clicks(link_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE link_tracking
  SET clicks = clicks + 1, last_click_at = NOW()
  WHERE id = link_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Record conversion + revenue atomically
CREATE OR REPLACE FUNCTION record_conversion(link_id TEXT, conv_revenue REAL)
RETURNS VOID AS $$
BEGIN
  UPDATE link_tracking
  SET conversions = conversions + 1,
      revenue = revenue + conv_revenue,
      conversion_rate = (conversions + 1)::real / GREATEST(clicks, 1)
  WHERE id = link_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 4: pg_cron (scheduled automation)
-- Run these AFTER the migration, via: SELECT cron.schedule(...)
-- NOTE: pg_cron must be enabled in Supabase dashboard first
-- ═══════════════════════════════════════════════════════════════════════════════

-- Uncomment and run after enabling pg_cron:
-- SELECT cron.schedule('refresh-pipeline-stats', '*/5 * * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pipeline_stats');
-- SELECT cron.schedule('refresh-account-perf', '*/5 * * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_account_performance');
-- SELECT cron.schedule('refresh-top-hooks', '*/15 * * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_hooks');
-- SELECT cron.schedule('cleanup-stale-scrapes', '0 3 * * *',
--   $$UPDATE scraped_content SET scrape_status = 'expired'
--     WHERE scrape_status = 'pending'
--     AND created_at < NOW() - INTERVAL '7 days'$$);
-- SELECT cron.schedule('vacuum-crm', '0 4 * * *',
--   'VACUUM ANALYZE crm_interactions');


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 10: SOURCE CREATORS WATCHLIST + POSTING QUEUE
-- ═══════════════════════════════════════════════════════════════════════════════

-- Source Creators — persistent watchlist of accounts to patrol for viral content
CREATE TABLE IF NOT EXISTS source_creators (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'tiktok',
  display_name TEXT DEFAULT '',
  follower_count INT DEFAULT 0,
  niche TEXT NOT NULL DEFAULT 'ecom',
  sub_niches JSONB DEFAULT '[]'::jsonb,
  content_style JSONB DEFAULT '[]'::jsonb,
  follower_tier TEXT DEFAULT 'unknown',
  baseline_avg_views INT DEFAULT 0,
  baseline_avg_er FLOAT DEFAULT 0.0,
  total_videos_tracked INT DEFAULT 0,
  viral_hit_count INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  added_via TEXT DEFAULT 'telegram',
  last_patrol_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_creators_niche ON source_creators(niche);
CREATE INDEX IF NOT EXISTS idx_source_creators_status ON source_creators(status);
CREATE INDEX IF NOT EXISTS idx_source_creators_platform ON source_creators(platform);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_creators_handle_platform
  ON source_creators(handle, platform);

-- Posting Queue — daily schedule of what to post where
CREATE TABLE IF NOT EXISTS posting_queue (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  scraped_content_id TEXT REFERENCES scraped_content(id),
  variation_id TEXT REFERENCES video_variations(id),
  platform TEXT NOT NULL,
  date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  caption TEXT DEFAULT '',
  music_url TEXT DEFAULT '',
  hashtags JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'queued',
  priority INT DEFAULT 5,
  cross_platform_source TEXT DEFAULT '',
  posted_at TIMESTAMPTZ,
  telegram_thread_id BIGINT,
  telegram_message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posting_queue_date ON posting_queue(date, status);
CREATE INDEX IF NOT EXISTS idx_posting_queue_account ON posting_queue(account_id, date);

-- Enable Realtime on posting_queue for dashboard live updates
ALTER PUBLICATION supabase_realtime ADD TABLE posting_queue;


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 11: Farm Tables (Phone Farm Device Management)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS farm_devices (
  id TEXT PRIMARY KEY,
  phone_number INTEGER NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  voice_prefix TEXT NOT NULL,
  usb_udid TEXT DEFAULT '',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_farm_devices_phone ON farm_devices(phone_number);
CREATE INDEX IF NOT EXISTS idx_farm_devices_active ON farm_devices(active);

CREATE TABLE IF NOT EXISTS farm_device_health (
  device_id TEXT PRIMARY KEY REFERENCES farm_devices(id),
  usb_connected BOOLEAN DEFAULT FALSE,
  last_usb_seen_at TIMESTAMPTZ,
  session_state TEXT DEFAULT 'idle',
  current_task_id TEXT DEFAULT '',
  swipes INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  profiles INTEGER DEFAULT 0,
  last_action TEXT DEFAULT '',
  last_action_at TIMESTAMPTZ,
  jitter_variance REAL DEFAULT 0.0,
  error TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_farm_health_state ON farm_device_health(session_state);
CREATE INDEX IF NOT EXISTS idx_farm_health_updated ON farm_device_health(updated_at);

CREATE TABLE IF NOT EXISTS farm_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  device_id TEXT REFERENCES farm_devices(id),
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  payload JSONB DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_farm_tasks_scheduled ON farm_tasks(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_farm_tasks_status ON farm_tasks(status);
CREATE INDEX IF NOT EXISTS idx_farm_tasks_device ON farm_tasks(device_id);

CREATE TABLE IF NOT EXISTS farm_events (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT NOT NULL DEFAULT 'info',
  device_id TEXT REFERENCES farm_devices(id),
  task_id TEXT REFERENCES farm_tasks(id),
  event TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_farm_events_ts ON farm_events(ts);
CREATE INDEX IF NOT EXISTS idx_farm_events_device ON farm_events(device_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 12: Watchlist + System Settings
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'tiktok',
  niche TEXT NOT NULL DEFAULT 'ecom',
  phone_number INTEGER NOT NULL DEFAULT 1,
  added_via TEXT DEFAULT 'telegram',
  last_scanned_at TIMESTAMPTZ,
  viral_hit_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(handle, platform)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_niche ON watchlist(niche);
CREATE INDEX IF NOT EXISTS idx_watchlist_phone ON watchlist(phone_number);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedule_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  platform TEXT,
  slot TEXT,
  account_id TEXT,
  video_path TEXT,
  caption TEXT,
  hashtags JSONB DEFAULT '[]'::jsonb,
  duration_minutes INTEGER DEFAULT 30,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled',
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_schedule_events_scheduled ON schedule_events(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_schedule_events_status ON schedule_events(status);

-- Enable Realtime for farm device health monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE farm_device_health;
ALTER PUBLICATION supabase_realtime ADD TABLE farm_events;

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 13: Cloud-Native Scheduler Tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- Scheduler job state — persists last/next run, status, and error across restarts
CREATE TABLE IF NOT EXISTS scheduler_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  cron_expr TEXT,
  interval_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_status ON scheduler_jobs(status);

-- Auto-update updated_at on upsert
CREATE OR REPLACE FUNCTION fn_scheduler_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scheduler_updated_at
  BEFORE UPDATE ON scheduler_jobs
  FOR EACH ROW EXECUTE FUNCTION fn_scheduler_updated_at();

-- Cybernetic log — system-level alerts and failure records (used by scheduler + other subsystems)
CREATE TABLE IF NOT EXISTS cybernetic_log (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'system',
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cybernetic_log_level ON cybernetic_log(level);
CREATE INDEX IF NOT EXISTS idx_cybernetic_log_source ON cybernetic_log(source);
CREATE INDEX IF NOT EXISTS idx_cybernetic_log_created ON cybernetic_log(created_at DESC);

-- Enable Realtime on cybernetic_log for Mission Control feed
ALTER PUBLICATION supabase_realtime ADD TABLE cybernetic_log;


-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 14: SaaS Subscription Layer — Stripe + Tier Management
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT 'solo',
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'trialing',
  current_period_end TIMESTAMPTZ,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_step INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_stripe_customer ON user_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON user_subscriptions(subscription_status);

CREATE TABLE IF NOT EXISTS usage_records (
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  posts_count INTEGER NOT NULL DEFAULT 0,
  accounts_count INTEGER NOT NULL DEFAULT 0,
  phones_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_records(user_id, date DESC);

-- Tier limits reference (informational)
-- solo:       1 phone / 3 accounts / 50 posts per day   / $49/mo
-- studio:     5 phones / 20 accounts / 500 posts per day / $199/mo
-- enterprise: unlimited                                   / $799/mo
