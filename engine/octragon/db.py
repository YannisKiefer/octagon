"""
Octragon System — SQLite Persistence Layer

Handles all storage for scraped content, video variations, delivery logs, and niche configs.
WAL mode for concurrent reads. Extends patterns from content-engine/src/core/db.py.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from .models import (
    ScrapedContent, VideoVariation, DeliveryLog, NicheConfig,
    ForgeParams, NicheType, SourcePlatform, TargetPlatform,
    ScrapeStatus, CleanseStatus, ApprovalStatus, DeviceProfile,
    Account, AccountType, ContentAnalysis, CMOVerdict, ViralDNAProfile,
    NextPostQueue, NextPostStatus,
)


DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "infra" / "db" / "farm.db"


class OctragonDB:
    """SQLite database for the Octragon System."""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DEFAULT_DB_PATH
        if isinstance(self.db_path, Path):
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_db()
        self._migrate_schema()

    def _init_db(self):
        try:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA foreign_keys=ON")
            self._create_tables()
            logger.info("[DB] Database initialized.")
        except Exception as e:
            logger.error(f"[DB] Init failed: {e}")

    def _migrate_schema(self):
        """Add missing columns to existing tables."""
        migrations = [
            ("content_analysis", "embedding_json", "TEXT DEFAULT '{}'"),
            # Viral DNA v2 fields (genome_signature used as semantic query text)
            ("viral_dna_profile", "genome_signature", "TEXT DEFAULT ''"),
            ("viral_dna_profile", "critical_axis_weaknesses", "TEXT DEFAULT '[]'"),
            ("viral_dna_profile", "optimal_duration_range", "TEXT DEFAULT '[15, 30]'"),
            ("viral_dna_profile", "genome_embedding_json", "TEXT DEFAULT '{}'"),
            ("viral_dna_profile", "cluster_labels", "TEXT DEFAULT '[]'"),
            # Embedding index columns — no FK, no strict account linkage
            ("content_embeddings", "model_version", "TEXT DEFAULT 'gemini-embedding-001'"),
            ("content_embeddings", "niche", "TEXT NOT NULL DEFAULT ''"),
        ]
        
        # Fix legacy content_embeddings: if it was created with an FK on account_id,
        # recreate without FK so we can store global scrape embeddings (account_id="").
        self._maybe_drop_embeddings_fk()

        for table, col, def_val in migrations:
            try:
                # Check if column exists
                cursor = self.conn.execute(f"PRAGMA table_info({table})")
                cols = [row["name"] for row in cursor.fetchall()]
                if col not in cols:
                    logger.info(f"[DB] Migrating: Adding {col} to {table}...")
                    self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {def_val}")
                    self.conn.commit()
            except Exception as e:
                logger.error(f"[DB] Migration failed for {table}.{col}: {e}")

    def _maybe_drop_embeddings_fk(self) -> None:
        """Recreate content_embeddings without FK constraint if needed.

        Older schema versions created content_embeddings with
        FOREIGN KEY (account_id) REFERENCES accounts(id).
        With FK enforcement on, inserting embeddings with account_id=""
        (global scrape embeddings) would fail. This migration detects the
        FK and rebuilds the table preserving all existing rows.
        """
        try:
            # PRAGMA foreign_key_list columns: id, seq, table, from, to, ...
            # sqlite3.Row supports both row["table"] and row[2]
            fk_rows = self.conn.execute(
                "PRAGMA foreign_key_list(content_embeddings)"
            ).fetchall()
            has_account_fk = any(row[2] == "accounts" for row in fk_rows)
        except Exception:
            return  # Table doesn't exist yet — will be created fresh

        if not has_account_fk:
            return  # Already clean

        logger.info("[DB] Migrating: Rebuilding content_embeddings to remove FK constraint...")
        try:
            self.conn.executescript("""
                PRAGMA foreign_keys = OFF;

                CREATE TABLE IF NOT EXISTS content_embeddings_new (
                    id TEXT PRIMARY KEY,
                    content_id TEXT NOT NULL,
                    account_id TEXT NOT NULL DEFAULT '',
                    niche TEXT NOT NULL DEFAULT '',
                    embedding BLOB NOT NULL,
                    text_source TEXT DEFAULT 'caption',
                    task_type TEXT DEFAULT 'RETRIEVAL_DOCUMENT',
                    model_version TEXT DEFAULT 'gemini-embedding-001',
                    created_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO content_embeddings_new
                    (id, content_id, account_id, embedding, text_source, task_type, created_at)
                SELECT id, content_id, account_id, embedding, text_source, task_type, created_at
                FROM content_embeddings;

                DROP TABLE content_embeddings;
                ALTER TABLE content_embeddings_new RENAME TO content_embeddings;

                CREATE INDEX IF NOT EXISTS idx_embeddings_account ON content_embeddings(account_id);
                CREATE INDEX IF NOT EXISTS idx_embeddings_content ON content_embeddings(content_id);
                CREATE INDEX IF NOT EXISTS idx_embeddings_niche ON content_embeddings(niche);

                PRAGMA foreign_keys = ON;
            """)
            self.conn.commit()
            logger.success("[DB] content_embeddings FK migration complete.")
        except Exception as e:
            logger.error(f"[DB] content_embeddings FK migration failed: {e}")

    def _create_tables(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS scraped_content (
                id TEXT PRIMARY KEY,
                source_url TEXT NOT NULL UNIQUE,
                source_platform TEXT NOT NULL,
                source_creator TEXT DEFAULT '',
                caption TEXT DEFAULT '',
                hashtags TEXT DEFAULT '[]',
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
                scraped_at TEXT,
                raw_metadata TEXT DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS video_variations (
                id TEXT PRIMARY KEY,
                scraped_content_id TEXT NOT NULL,
                variation_index INTEGER NOT NULL,
                video_path TEXT DEFAULT '',
                video_hash TEXT DEFAULT '',
                forge_params TEXT DEFAULT '{}',
                cleanse_status TEXT DEFAULT 'pending',
                metadata_injected INTEGER DEFAULT 0,
                gemini_analysis TEXT DEFAULT '{}',
                cleansed_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (scraped_content_id) REFERENCES scraped_content(id)
            );

            CREATE TABLE IF NOT EXISTS delivery_log (
                id TEXT PRIMARY KEY,
                variation_id TEXT NOT NULL,
                scraped_content_id TEXT NOT NULL,
                phone_number INTEGER NOT NULL,
                target_platform TEXT NOT NULL,
                target_account TEXT DEFAULT '',
                telegram_group_id TEXT DEFAULT '',
                telegram_message_id INTEGER DEFAULT 0,
                approval_status TEXT DEFAULT 'pending',
                approved_at TEXT,
                rejected_at TEXT,
                rejection_reason TEXT DEFAULT '',
                posted_at TEXT,
                post_url TEXT DEFAULT '',
                post_engagement TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY (variation_id) REFERENCES video_variations(id),
                FOREIGN KEY (scraped_content_id) REFERENCES scraped_content(id)
            );

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
                platforms TEXT DEFAULT '[]',
                active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_scraped_platform ON scraped_content(source_platform);
            CREATE INDEX IF NOT EXISTS idx_scraped_status ON scraped_content(scrape_status);
            CREATE INDEX IF NOT EXISTS idx_scraped_niche ON scraped_content(target_niche);
            CREATE INDEX IF NOT EXISTS idx_scraped_phone ON scraped_content(target_phone);
            CREATE INDEX IF NOT EXISTS idx_scraped_created ON scraped_content(created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_variations_scraped ON video_variations(scraped_content_id);
            CREATE INDEX IF NOT EXISTS idx_variations_status ON video_variations(cleanse_status);

            CREATE INDEX IF NOT EXISTS idx_delivery_phone ON delivery_log(phone_number);
            CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_log(approval_status);
            CREATE INDEX IF NOT EXISTS idx_delivery_telegram ON delivery_log(telegram_message_id);
            CREATE INDEX IF NOT EXISTS idx_delivery_variation ON delivery_log(variation_id);

            -- ═══════════════════════════════════════════════════════════════
            -- NEW: Account-based tables (PRD v2)
            -- ═══════════════════════════════════════════════════════════════

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
                active INTEGER DEFAULT 1,
                last_full_sync_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS content_analysis (
                id TEXT PRIMARY KEY,
                scraped_content_id TEXT NOT NULL,
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
                embedding_json TEXT DEFAULT '{}',
                generated_at TEXT NOT NULL,
                FOREIGN KEY (scraped_content_id) REFERENCES scraped_content(id)
            );

            CREATE TABLE IF NOT EXISTS viral_dna_profile (
                account_id TEXT PRIMARY KEY,
                top_hooks TEXT DEFAULT '[]',
                optimal_posting_times TEXT DEFAULT '[]',
                winning_formats TEXT DEFAULT '[]',
                winning_emotions TEXT DEFAULT '[]',
                avg_engagement_rate REAL DEFAULT 0.0,
                trend_direction TEXT DEFAULT 'neutral',
                total_analyzed INTEGER DEFAULT 0,
                viral_win_count INTEGER DEFAULT 0,
                rejection_count INTEGER DEFAULT 0,
                genome_signature TEXT DEFAULT '',
                critical_axis_weaknesses TEXT DEFAULT '[]',
                optimal_duration_range TEXT DEFAULT '[15, 30]',
                genome_embedding_json TEXT DEFAULT '{}',
                cluster_labels TEXT DEFAULT '[]',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS next_post_queue (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                script TEXT DEFAULT '',
                hook TEXT DEFAULT '',
                reference_content_id TEXT DEFAULT '',
                format_type TEXT DEFAULT '',
                rationale TEXT DEFAULT '',
                priority INTEGER DEFAULT 1,
                status TEXT DEFAULT 'queued',
                generated_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            -- New indexes
            CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone_number);
            CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
            CREATE INDEX IF NOT EXISTS idx_analysis_scraped ON content_analysis(scraped_content_id);
            CREATE INDEX IF NOT EXISTS idx_analysis_account ON content_analysis(account_id);
            CREATE INDEX IF NOT EXISTS idx_analysis_verdict ON content_analysis(verdict);
            CREATE INDEX IF NOT EXISTS idx_nextpost_account ON next_post_queue(account_id);
            CREATE INDEX IF NOT EXISTS idx_nextpost_status ON next_post_queue(status);

            -- ═══════════════════════════════════════════════════════════════
            -- Phase B-E: Intelligence Layer Tables
            -- ═══════════════════════════════════════════════════════════════

            CREATE TABLE IF NOT EXISTS content_embeddings (
                id TEXT PRIMARY KEY,
                content_id TEXT NOT NULL,
                account_id TEXT NOT NULL DEFAULT '',
                niche TEXT NOT NULL DEFAULT '',
                embedding BLOB NOT NULL,
                text_source TEXT DEFAULT 'caption',
                task_type TEXT DEFAULT 'RETRIEVAL_DOCUMENT',
                model_version TEXT DEFAULT 'gemini-embedding-001',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_embeddings_account ON content_embeddings(account_id);
            CREATE INDEX IF NOT EXISTS idx_embeddings_content ON content_embeddings(content_id);
            CREATE INDEX IF NOT EXISTS idx_embeddings_niche ON content_embeddings(niche);

            CREATE TABLE IF NOT EXISTS daily_todos (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                date TEXT NOT NULL,
                priority INTEGER DEFAULT 1,
                action TEXT NOT NULL,
                category TEXT DEFAULT 'content',
                rationale TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_todos_account ON daily_todos(account_id);
            CREATE INDEX IF NOT EXISTS idx_todos_date ON daily_todos(date);
            CREATE INDEX IF NOT EXISTS idx_todos_status ON daily_todos(status);

            CREATE TABLE IF NOT EXISTS account_health (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                date TEXT NOT NULL,
                cmo_score INTEGER DEFAULT 0,
                trend TEXT DEFAULT 'neutral',
                strengths TEXT DEFAULT '',
                weaknesses TEXT DEFAULT '',
                recommendations TEXT DEFAULT '',
                raw_report TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_health_account ON account_health(account_id);
            CREATE INDEX IF NOT EXISTS idx_health_date ON account_health(date);

            CREATE TABLE IF NOT EXISTS crm_interactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                contact_handle TEXT NOT NULL,
                platform TEXT NOT NULL,
                direction TEXT DEFAULT 'inbound',
                summary TEXT DEFAULT '',
                sentiment TEXT DEFAULT 'neutral',
                tags TEXT DEFAULT '',
                occurred_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_crm_account ON crm_interactions(account_id);
            CREATE INDEX IF NOT EXISTS idx_crm_contact ON crm_interactions(contact_handle);
            CREATE INDEX IF NOT EXISTS idx_crm_occurred ON crm_interactions(occurred_at);

            -- ═══════════════════════════════════════════════════════════════
            -- Phase G: ViewTrack Killer Tables
            -- ═══════════════════════════════════════════════════════════════

            CREATE TABLE IF NOT EXISTS hook_analyses (
                id TEXT PRIMARY KEY,
                scraped_content_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                hook_type TEXT DEFAULT 'unknown',
                hook_text TEXT DEFAULT '',
                hook_score INTEGER DEFAULT 0,
                open_loops TEXT DEFAULT '[]',
                bold_claims TEXT DEFAULT '[]',
                emotional_triggers TEXT DEFAULT '[]',
                retention_devices TEXT DEFAULT '[]',
                cta_strength INTEGER DEFAULT 0,
                cta_type TEXT DEFAULT 'none',
                virality_factors TEXT DEFAULT '[]',
                replication_blueprint TEXT DEFAULT '',
                analyzed_at TEXT NOT NULL,
                FOREIGN KEY (scraped_content_id) REFERENCES scraped_content(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_hook_account ON hook_analyses(account_id);
            CREATE INDEX IF NOT EXISTS idx_hook_score ON hook_analyses(hook_score);
            CREATE INDEX IF NOT EXISTS idx_hook_type ON hook_analyses(hook_type);

            CREATE TABLE IF NOT EXISTS link_tracking (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
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
                created_at TEXT NOT NULL,
                last_click_at TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_link_account ON link_tracking(account_id);
            CREATE INDEX IF NOT EXISTS idx_link_campaign ON link_tracking(utm_campaign);
            CREATE INDEX IF NOT EXISTS idx_link_revenue ON link_tracking(revenue);

            -- ═══════════════════════════════════════════════════════════════
            -- Phase FARM: Multi-device iOS Voice Control QA Lab
            -- ═══════════════════════════════════════════════════════════════

            CREATE TABLE IF NOT EXISTS farm_devices (
                id TEXT PRIMARY KEY,
                phone_number INTEGER NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                voice_prefix TEXT NOT NULL,
                usb_udid TEXT DEFAULT '',
                active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_farm_devices_phone ON farm_devices(phone_number);
            CREATE INDEX IF NOT EXISTS idx_farm_devices_active ON farm_devices(active);

            CREATE TABLE IF NOT EXISTS farm_device_health (
                device_id TEXT PRIMARY KEY,
                usb_connected INTEGER DEFAULT 0,
                last_usb_seen_at TEXT,
                session_state TEXT DEFAULT 'idle',
                current_task_id TEXT DEFAULT '',
                swipes INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                saves INTEGER DEFAULT 0,
                comments INTEGER DEFAULT 0,
                profiles INTEGER DEFAULT 0,
                last_action TEXT DEFAULT '',
                last_action_at TEXT,
                jitter_variance REAL DEFAULT 0.0,
                error TEXT DEFAULT '',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (device_id) REFERENCES farm_devices(id)
            );
            CREATE INDEX IF NOT EXISTS idx_farm_health_state ON farm_device_health(session_state);
            CREATE INDEX IF NOT EXISTS idx_farm_health_updated ON farm_device_health(updated_at);

            CREATE TABLE IF NOT EXISTS farm_tasks (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                device_id TEXT,
                scheduled_for TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'scheduled',
                payload TEXT DEFAULT '{}',
                started_at TEXT,
                finished_at TEXT,
                result TEXT DEFAULT '',
                error TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (device_id) REFERENCES farm_devices(id)
            );
            CREATE INDEX IF NOT EXISTS idx_farm_tasks_scheduled ON farm_tasks(scheduled_for);
            CREATE INDEX IF NOT EXISTS idx_farm_tasks_status ON farm_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_farm_tasks_device ON farm_tasks(device_id);

            CREATE TABLE IF NOT EXISTS farm_events (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                level TEXT NOT NULL DEFAULT 'info',
                device_id TEXT,
                task_id TEXT,
                event TEXT NOT NULL,
                data TEXT DEFAULT '{}',
                FOREIGN KEY (device_id) REFERENCES farm_devices(id),
                FOREIGN KEY (task_id) REFERENCES farm_tasks(id)
            );
            CREATE INDEX IF NOT EXISTS idx_farm_events_ts ON farm_events(ts);
            CREATE INDEX IF NOT EXISTS idx_farm_events_device ON farm_events(device_id);

            -- ═══════════════════════════════════════════════════════════════
            -- Watchlist: competitor creator handles to auto-scan
            -- ═══════════════════════════════════════════════════════════════

            CREATE TABLE IF NOT EXISTS watchlist (
                id TEXT PRIMARY KEY,
                handle TEXT NOT NULL,
                platform TEXT NOT NULL DEFAULT 'tiktok',
                niche TEXT NOT NULL DEFAULT 'ecom',
                phone_number INTEGER NOT NULL DEFAULT 1,
                added_via TEXT DEFAULT 'telegram',
                last_scanned_at TEXT,
                viral_hit_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL,
                UNIQUE(handle, platform)
            );
            CREATE INDEX IF NOT EXISTS idx_watchlist_niche ON watchlist(niche);
            CREATE INDEX IF NOT EXISTS idx_watchlist_phone ON watchlist(phone_number);
            CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status);

            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
        self.conn.commit()
        self._seed_accounts()
        self._seed_farm_devices()

    # -----------------------------------------------------------------------
    # Watchlist — competitor creator handles for auto-scanning
    # -----------------------------------------------------------------------

    def add_watchlist_creator(
        self,
        handle: str,
        platform: str = "tiktok",
        niche: str = "ecom",
        phone_number: int = 1,
        added_via: str = "telegram",
    ) -> dict:
        """Add a creator handle to the watchlist. Returns the row."""
        import hashlib
        row_id = hashlib.sha256(f"{handle}:{platform}".encode()).hexdigest()[:16]
        now = datetime.now(timezone.utc).isoformat()
        try:
            self.conn.execute(
                """
                INSERT OR IGNORE INTO watchlist (id, handle, platform, niche, phone_number, added_via, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(handle, platform) DO UPDATE SET
                    niche = excluded.niche,
                    phone_number = excluded.phone_number,
                    status = 'active'
                """,
                (row_id, handle.lstrip("@"), platform, niche, phone_number, added_via, now),
            )
            self.conn.commit()
            logger.info(f"[DB] Watchlist: added @{handle} ({platform}) → {niche} / phone {phone_number}")
        except Exception as e:
            logger.error(f"[DB] Watchlist add error: {e}")
        return {"id": row_id, "handle": handle, "platform": platform, "niche": niche, "phone_number": phone_number}

    def remove_watchlist_creator(self, handle: str, platform: str = "tiktok") -> bool:
        """Remove or deactivate a creator from the watchlist."""
        cur = self.conn.execute(
            "UPDATE watchlist SET status = 'inactive' WHERE handle = ? AND platform = ?",
            (handle.lstrip("@"), platform),
        )
        self.conn.commit()
        return cur.rowcount > 0

    # ---------------------------------------------------------------------
    # Global Settings
    # ---------------------------------------------------------------------

    def get_setting(self, key: str, default: str = "") -> str:
        row = self.conn.execute("SELECT value FROM system_settings WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set_setting(self, key: str, value: str):
        self.conn.execute(
            "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, datetime.now(timezone.utc).isoformat())
        )
        self.conn.commit()
        # The original instruction had `return cur.rowcount > 0` here, but `cur` is not defined.
        # Assuming it's not needed or should be handled differently if a return value is desired.

    def get_watchlist(self, phone_number: Optional[int] = None, niche: Optional[str] = None) -> list[dict]:
        """Return active watchlist entries, optionally filtered by phone/niche."""
        query = "SELECT * FROM watchlist WHERE status = 'active'"
        params: list = []
        if phone_number is not None:
            query += " AND phone_number = ?"
            params.append(phone_number)
        if niche:
            query += " AND niche = ?"
            params.append(niche)
        query += " ORDER BY viral_hit_count DESC, created_at DESC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def update_watchlist_scanned(self, handle: str, platform: str = "tiktok", viral_hit: bool = False):
        """Mark a creator as just scanned; optionally increment viral_hit_count."""
        now = datetime.now(timezone.utc).isoformat()
        if viral_hit:
            self.conn.execute(
                "UPDATE watchlist SET last_scanned_at = ?, viral_hit_count = viral_hit_count + 1 WHERE handle = ? AND platform = ?",
                (now, handle.lstrip("@"), platform),
            )
        else:
            self.conn.execute(
                "UPDATE watchlist SET last_scanned_at = ? WHERE handle = ? AND platform = ?",
                (now, handle.lstrip("@"), platform),
            )
        self.conn.commit()


    # -----------------------------------------------------------------------
    # Farm Device Seeding (Voice Control QA Lab)
    # -----------------------------------------------------------------------

    def _seed_farm_devices(self) -> None:
        """
        Ensure the 4-phone farm device registry exists.

        Seed values come from env vars when present:
          FARM_PHONE1_PREFIX, FARM_PHONE1_UDID, ... up to PHONE4
        """
        import os
        from datetime import datetime, timezone

        existing = self.conn.execute("SELECT COUNT(*) FROM farm_devices").fetchone()[0]
        if existing >= 4:
            return

        default_prefixes = {1: "Alpha", 2: "Bravo", 3: "Charlie", 4: "Delta"}
        now = datetime.now(timezone.utc).isoformat()

        for phone in range(1, 5):
            device_id = f"phone{phone}"
            prefix = os.getenv(f"FARM_PHONE{phone}_PREFIX", default_prefixes[phone])
            udid = os.getenv(f"FARM_PHONE{phone}_UDID", "")

            nc = self.conn.execute(
                "SELECT niche_name FROM niche_config WHERE phone_number = ?",
                (phone,),
            ).fetchone()
            niche_name = (nc["niche_name"] if nc and "niche_name" in nc.keys() else f"Phone {phone}")
            display_name = f"{niche_name} (Phone {phone})"

            self.conn.execute(
                """
                INSERT OR IGNORE INTO farm_devices
                (id, phone_number, display_name, voice_prefix, usb_udid, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (device_id, phone, display_name, prefix, udid, now, now),
            )

            self.conn.execute(
                """
                INSERT OR IGNORE INTO farm_device_health
                (device_id, usb_connected, session_state, updated_at)
                VALUES (?, 0, 'idle', ?)
                """,
                (device_id, now),
            )

        self.conn.commit()

    # -----------------------------------------------------------------------
    # Scraped Content
    # -----------------------------------------------------------------------

    def save_scraped_content(self, sc: ScrapedContent) -> None:
        """Alias for upsert_scraped_content."""
        self.upsert_scraped_content(sc)

    def upsert_scraped_content(self, sc: ScrapedContent) -> None:
        """Insert or update scraped content, then auto-embed for semantic search."""
        if not sc.id:
            sc.generate_id()
        self.conn.execute("""
            INSERT OR REPLACE INTO scraped_content (
                id, source_url, source_platform, source_creator,
                caption, hashtags, duration_seconds, resolution,
                video_path, audio_path, video_hash,
                engagement_likes, engagement_comments, engagement_shares, engagement_views,
                target_niche, target_phone,
                telegram_group_id, telegram_message_id,
                scrape_status, scraped_at, raw_metadata, created_at
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?,
                ?, ?,
                ?, ?, ?, ?
            )
        """, (
            sc.id, sc.source_url, sc.source_platform.value, sc.source_creator,
            sc.caption, json.dumps(sc.hashtags), sc.duration_seconds, sc.resolution,
            sc.video_path, sc.audio_path, sc.video_hash,
            sc.engagement_likes, sc.engagement_comments, sc.engagement_shares, sc.engagement_views,
            sc.target_niche.value, sc.target_phone,
            sc.telegram_group_id, sc.telegram_message_id,
            sc.scrape_status.value,
            sc.scraped_at.isoformat() if sc.scraped_at else None,
            json.dumps(sc.raw_metadata),
            sc.created_at.isoformat(),
        ))
        self.conn.commit()
        # Auto-embed into the semantic search index after every successful upsert.
        # account_id is left as empty string (no FK constraint — content_embeddings
        # is a search index, not a relational entity).
        self._auto_embed_after_upsert(sc)

    def _auto_embed_after_upsert(self, sc: "ScrapedContent") -> None:
        """Embed content into the vector search index after every upsert.

        Called from upsert_scraped_content() — the single authoritative write
        point — so all ingest paths (Telegram, CLI, CMO scrape, etc.) embed
        automatically without additional wiring.

        Skips silently when GEMINI_API_KEY is absent or caption is empty.
        account_id="" is intentional: content_embeddings has no FK constraint.
        """
        caption = getattr(sc, "caption", "") or ""
        if not caption.strip():
            return
        content_id = sc.id or ""
        if not content_id:
            return
        try:
            from octragon.intelligence.ingest_hook import auto_embed_scraped_content
            hashtags = getattr(sc, "hashtags", []) or []
            niche_val = getattr(sc.target_niche, "value", str(sc.target_niche)) if hasattr(sc, "target_niche") else ""
            auto_embed_scraped_content(
                content_id=content_id,
                caption=caption,
                hashtags=hashtags,
                niche=niche_val,
                account_id="",
                db=self,
            )
        except Exception as exc:
            logger.warning(f"[DB] Auto-embed failed for {content_id[:8]}: {exc}")

    def get_scraped_content(self, content_id: str) -> Optional[ScrapedContent]:
        row = self.conn.execute(
            "SELECT * FROM scraped_content WHERE id = ?", (content_id,)
        ).fetchone()
        return self._row_to_scraped_content(row) if row else None

    def get_scraped_by_url(self, url: str) -> Optional[ScrapedContent]:
        row = self.conn.execute(
            "SELECT * FROM scraped_content WHERE source_url = ?", (url,)
        ).fetchone()
        return self._row_to_scraped_content(row) if row else None

    def get_scraped_by_telegram_msg(self, message_id: int) -> Optional[ScrapedContent]:
        row = self.conn.execute(
            "SELECT * FROM scraped_content WHERE telegram_message_id = ?", (message_id,)
        ).fetchone()
        return self._row_to_scraped_content(row) if row else None

    def update_scrape_status(self, content_id: str, status: ScrapeStatus,
                              video_path: str = "", video_hash: str = "",
                              audio_path: str = "") -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute("""
            UPDATE scraped_content
            SET scrape_status = ?, scraped_at = ?,
                video_path = CASE WHEN ? != '' THEN ? ELSE video_path END,
                video_hash = CASE WHEN ? != '' THEN ? ELSE video_hash END,
                audio_path = CASE WHEN ? != '' THEN ? ELSE audio_path END
            WHERE id = ?
        """, (status.value, now,
              video_path, video_path,
              video_hash, video_hash,
              audio_path, audio_path,
              content_id))
        self.conn.commit()

    def get_pending_scrapes(self, phone: Optional[int] = None) -> list[ScrapedContent]:
        if phone:
            rows = self.conn.execute(
                "SELECT * FROM scraped_content WHERE scrape_status = 'pending' AND target_phone = ?",
                (phone,)
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM scraped_content WHERE scrape_status = 'pending'"
            ).fetchall()
        return [self._row_to_scraped_content(r) for r in rows]

    def get_recent_scraped(self, hours: int = 24, limit: int = 50) -> list[ScrapedContent]:
        rows = self.conn.execute("""
            SELECT * FROM scraped_content
            WHERE created_at >= datetime('now', ? || ' hours')
            ORDER BY created_at DESC LIMIT ?
        """, (f"-{hours}", limit)).fetchall()
        return [self._row_to_scraped_content(r) for r in rows]

    def _row_to_scraped_content(self, row) -> ScrapedContent:
        d = dict(row)
        sc = ScrapedContent(
            id=d["id"],
            source_url=d["source_url"],
            source_platform=SourcePlatform(d["source_platform"]),
            source_creator=d.get("source_creator", ""),
            caption=d.get("caption", ""),
            hashtags=json.loads(d.get("hashtags", "[]")),
            duration_seconds=d.get("duration_seconds", 0),
            resolution=d.get("resolution", ""),
            video_path=d.get("video_path", ""),
            audio_path=d.get("audio_path", ""),
            video_hash=d.get("video_hash", ""),
            engagement_likes=d.get("engagement_likes", 0),
            engagement_comments=d.get("engagement_comments", 0),
            engagement_shares=d.get("engagement_shares", 0),
            engagement_views=d.get("engagement_views", 0),
            target_niche=NicheType(d.get("target_niche", "ecom")),
            target_phone=d.get("target_phone", 1),
            telegram_group_id=d.get("telegram_group_id", ""),
            telegram_message_id=d.get("telegram_message_id", 0),
            scrape_status=ScrapeStatus(d.get("scrape_status", "pending")),
            raw_metadata=json.loads(d.get("raw_metadata", "{}")),
        )
        if d.get("scraped_at"):
            sc.scraped_at = datetime.fromisoformat(d["scraped_at"])
        if d.get("created_at"):
            sc.created_at = datetime.fromisoformat(d["created_at"])
        return sc

    # -----------------------------------------------------------------------
    # Video Variations
    # -----------------------------------------------------------------------

    def save_variation(self, var: VideoVariation) -> None:
        if not var.id:
            var.generate_id()
        self.conn.execute("""
            INSERT OR REPLACE INTO video_variations (
                id, scraped_content_id, variation_index,
                video_path, video_hash, forge_params,
                cleanse_status, metadata_injected, gemini_analysis,
                cleansed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            var.id, var.scraped_content_id, var.variation_index,
            var.video_path, var.video_hash,
            json.dumps(var.forge_params.to_dict()),
            var.cleanse_status.value, int(var.metadata_injected),
            json.dumps(var.gemini_analysis or {}),
            var.cleansed_at.isoformat() if var.cleansed_at else None,
            var.created_at.isoformat(),
        ))
        self.conn.commit()

    def get_variations(self, scraped_content_id: str) -> list[VideoVariation]:
        rows = self.conn.execute(
            "SELECT * FROM video_variations WHERE scraped_content_id = ? ORDER BY variation_index",
            (scraped_content_id,)
        ).fetchall()
        return [self._row_to_variation(r) for r in rows]

    def get_variation(self, variation_id: str) -> Optional[VideoVariation]:
        row = self.conn.execute(
            "SELECT * FROM video_variations WHERE id = ?", (variation_id,)
        ).fetchone()
        return self._row_to_variation(row) if row else None

    def update_variation_status(self, variation_id: str, status: CleanseStatus,
                                 video_path: str = "", video_hash: str = "",
                                 metadata_injected: bool = False,
                                 gemini_analysis: Optional[dict] = None) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute("""
            UPDATE video_variations
            SET cleanse_status = ?,
                video_path = CASE WHEN ? != '' THEN ? ELSE video_path END,
                video_hash = CASE WHEN ? != '' THEN ? ELSE video_hash END,
                metadata_injected = ?,
                gemini_analysis = CASE WHEN ? != '{}' THEN ? ELSE gemini_analysis END,
                cleansed_at = ?
            WHERE id = ?
        """, (
            status.value,
            video_path, video_path,
            video_hash, video_hash,
            int(metadata_injected),
            json.dumps(gemini_analysis or {}), json.dumps(gemini_analysis or {}),
            now, variation_id,
        ))
        self.conn.commit()

    def _row_to_variation(self, row) -> VideoVariation:
        d = dict(row)
        params_dict = json.loads(d.get("forge_params", "{}"))
        params = ForgeParams(
            fps=params_dict.get("fps", 29.97),
            crop_top=params_dict.get("crop_top", 2),
            crop_bottom=params_dict.get("crop_bottom", 2),
            crop_left=params_dict.get("crop_left", 2),
            crop_right=params_dict.get("crop_right", 2),
            audio_pitch_shift=params_dict.get("audio_pitch_shift", 1.02),
            video_bitrate=params_dict.get("video_bitrate", "4500k"),
            audio_bitrate=params_dict.get("audio_bitrate", "192k"),
            codec=params_dict.get("codec", "libx264"),
            noise_seed=params_dict.get("noise_seed", 42),
            gps_latitude=params_dict.get("gps_latitude", 47.3769),
            gps_longitude=params_dict.get("gps_longitude", 8.5417),
            device_profile=DeviceProfile(params_dict.get("device_profile", "iphone_15_pro")),
        )
        var = VideoVariation(
            id=d["id"],
            scraped_content_id=d["scraped_content_id"],
            variation_index=d["variation_index"],
            video_path=d.get("video_path", ""),
            video_hash=d.get("video_hash", ""),
            forge_params=params,
            cleanse_status=CleanseStatus(d.get("cleanse_status", "pending")),
            metadata_injected=bool(d.get("metadata_injected", 0)),
            gemini_analysis=json.loads(d.get("gemini_analysis", "{}")),
        )
        if d.get("cleansed_at"):
            var.cleansed_at = datetime.fromisoformat(d["cleansed_at"])
        if d.get("created_at"):
            var.created_at = datetime.fromisoformat(d["created_at"])
        return var

    # -----------------------------------------------------------------------
    # Delivery Log
    # -----------------------------------------------------------------------

    def save_delivery(self, dl: DeliveryLog) -> None:
        if not dl.id:
            dl.generate_id()
        self.conn.execute("""
            INSERT OR REPLACE INTO delivery_log (
                id, variation_id, scraped_content_id,
                phone_number, target_platform, target_account,
                telegram_group_id, telegram_message_id,
                approval_status, approved_at, rejected_at, rejection_reason,
                posted_at, post_url, post_engagement, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            dl.id, dl.variation_id, dl.scraped_content_id,
            dl.phone_number, dl.target_platform.value, dl.target_account,
            dl.telegram_group_id, dl.telegram_message_id,
            dl.approval_status.value,
            dl.approved_at.isoformat() if dl.approved_at else None,
            dl.rejected_at.isoformat() if dl.rejected_at else None,
            dl.rejection_reason,
            dl.posted_at.isoformat() if dl.posted_at else None,
            dl.post_url,
            json.dumps(dl.post_engagement),
            dl.created_at.isoformat(),
        ))
        self.conn.commit()

    def get_delivery_by_telegram_msg(self, message_id: int) -> list[DeliveryLog]:
        rows = self.conn.execute(
            "SELECT * FROM delivery_log WHERE telegram_message_id = ?", (message_id,)
        ).fetchall()
        return [self._row_to_delivery(r) for r in rows]

    def approve_variation(self, message_id: int, variation_id: str) -> bool:
        """Approve a specific variation via telegram message ID."""
        now = datetime.now(timezone.utc).isoformat()
        # Reject all others for same telegram message
        self.conn.execute("""
            UPDATE delivery_log
            SET approval_status = 'rejected', rejected_at = ?
            WHERE telegram_message_id = ? AND variation_id != ? AND approval_status = 'pending'
        """, (now, message_id, variation_id))
        # Approve chosen one
        cursor = self.conn.execute("""
            UPDATE delivery_log
            SET approval_status = 'approved', approved_at = ?
            WHERE telegram_message_id = ? AND variation_id = ?
        """, (now, message_id, variation_id))
        self.conn.commit()
        return cursor.rowcount > 0

    def get_approved_pending_post(self, phone: Optional[int] = None) -> list[DeliveryLog]:
        if phone:
            rows = self.conn.execute("""
                SELECT * FROM delivery_log WHERE approval_status = 'approved' AND phone_number = ?
                ORDER BY approved_at ASC
            """, (phone,)).fetchall()
        else:
            rows = self.conn.execute("""
                SELECT * FROM delivery_log WHERE approval_status = 'approved'
                ORDER BY approved_at ASC
            """).fetchall()
        return [self._row_to_delivery(r) for r in rows]

    def _row_to_delivery(self, row) -> DeliveryLog:
        d = dict(row)
        dl = DeliveryLog(
            id=d["id"],
            variation_id=d["variation_id"],
            scraped_content_id=d["scraped_content_id"],
            phone_number=d["phone_number"],
            target_platform=TargetPlatform(d["target_platform"]),
            target_account=d.get("target_account", ""),
            telegram_group_id=d.get("telegram_group_id", ""),
            telegram_message_id=d.get("telegram_message_id", 0),
            approval_status=ApprovalStatus(d.get("approval_status", "pending")),
            rejection_reason=d.get("rejection_reason", ""),
            post_url=d.get("post_url", ""),
            post_engagement=json.loads(d.get("post_engagement", "{}")),
        )
        for ts_field in ["approved_at", "rejected_at", "posted_at", "created_at"]:
            if d.get(ts_field):
                setattr(dl, ts_field, datetime.fromisoformat(d[ts_field]))
        return dl


    def get_posted_videos_with_stats(self, days: int = 7) -> list[dict]:
        """Fetch posted videos, their initial scraped caption/hashtags, and final engagement."""
        rows = self.conn.execute("""
            SELECT sc.source_creator, sc.caption, sc.hashtags, sc.target_niche,
                   dl.phone_number, dl.target_platform, dl.post_engagement, dl.posted_at
            FROM delivery_log dl
            JOIN scraped_content sc ON dl.scraped_content_id = sc.id
            WHERE dl.approval_status = 'posted'
              AND dl.posted_at >= datetime('now', ? || ' days')
            ORDER BY dl.posted_at DESC
        """, (f"-{days}",)).fetchall()
        
        results = []
        for r in rows:
            d = dict(r)
            d["hashtags"] = json.loads(d.get("hashtags", "[]"))
            d["post_engagement"] = json.loads(d.get("post_engagement", "{}"))
            results.append(d)
        return results


    def get_ab_test_data(self, days: int = 7) -> list[dict]:
        """Fetch variation parameters and their corresponding post engagement."""
        rows = self.conn.execute("""
            SELECT v.variation_index, v.forge_params,
                   dl.target_platform, dl.post_engagement, dl.posted_at
            FROM delivery_log dl
            JOIN video_variations v ON dl.variation_id = v.id
            WHERE dl.approval_status = 'posted'
              AND dl.posted_at >= datetime('now', ? || ' days')
        """, (f"-{days}",)).fetchall()
        
        results = []
        for r in rows:
            d = dict(r)
            d["forge_params"] = json.loads(d.get("forge_params", "{}"))
            d["post_engagement"] = json.loads(d.get("post_engagement", "{}"))
            results.append(d)
        return results

    # -----------------------------------------------------------------------
    # Niche Config
    # -----------------------------------------------------------------------

    def save_niche_config(self, nc: NicheConfig) -> None:
        self.conn.execute("""
            INSERT OR REPLACE INTO niche_config (
                phone_number, niche, niche_name, telegram_group_id,
                tiktok_handle, instagram_handle, linkedin_handle,
                gps_lat_center, gps_lon_center, gps_radius, device_profile,
                platforms, active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            nc.phone_number, nc.niche.value, nc.niche_name, nc.telegram_group_id,
            nc.tiktok_handle, nc.instagram_handle, nc.linkedin_handle,
            nc.gps_lat_center, nc.gps_lon_center, nc.gps_radius,
            nc.device_profile.value,
            json.dumps([p.value for p in nc.platforms]),
            int(nc.active), nc.created_at.isoformat(),
        ))
        self.conn.commit()

    def get_niche_config(self, phone: int) -> Optional[NicheConfig]:
        row = self.conn.execute(
            "SELECT * FROM niche_config WHERE phone_number = ?", (phone,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        return NicheConfig(
            phone_number=d["phone_number"],
            niche=NicheType(d["niche"]),
            niche_name=d["niche_name"],
            telegram_group_id=d["telegram_group_id"],
            tiktok_handle=d.get("tiktok_handle", ""),
            instagram_handle=d.get("instagram_handle", ""),
            linkedin_handle=d.get("linkedin_handle", ""),
            gps_lat_center=d.get("gps_lat_center", 47.3769),
            gps_lon_center=d.get("gps_lon_center", 8.5417),
            gps_radius=d.get("gps_radius", 0.01),
            device_profile=DeviceProfile(d.get("device_profile", "iphone_15_pro")),
            platforms=[TargetPlatform(p) for p in json.loads(d.get("platforms", "[]"))],
            active=bool(d.get("active", 1)),
        )

    def get_all_niche_configs(self) -> list[NicheConfig]:
        rows = self.conn.execute(
            "SELECT * FROM niche_config WHERE active = 1 ORDER BY phone_number"
        ).fetchall()
        return [self.get_niche_config(dict(r)["phone_number"]) for r in rows]

    def get_niche_by_telegram_group(self, group_id: str) -> Optional[NicheConfig]:
        row = self.conn.execute(
            "SELECT * FROM niche_config WHERE telegram_group_id = ?", (group_id,)
        ).fetchone()
        if not row:
            return None
        return self.get_niche_config(dict(row)["phone_number"])

    # -----------------------------------------------------------------------
    # Analytics
    # -----------------------------------------------------------------------

    def get_pipeline_stats(self) -> dict:
        """Aggregate stats for dashboard."""
        stats = {}
        stats["total_scraped"] = self.conn.execute(
            "SELECT COUNT(*) FROM scraped_content"
        ).fetchone()[0]
        stats["pending_scrapes"] = self.conn.execute(
            "SELECT COUNT(*) FROM scraped_content WHERE scrape_status = 'pending'"
        ).fetchone()[0]
        stats["total_variations"] = self.conn.execute(
            "SELECT COUNT(*) FROM video_variations"
        ).fetchone()[0]
        stats["variations_ready"] = self.conn.execute(
            "SELECT COUNT(*) FROM video_variations WHERE cleanse_status = 'done'"
        ).fetchone()[0]
        stats["pending_approvals"] = self.conn.execute(
            "SELECT COUNT(*) FROM delivery_log WHERE approval_status = 'pending'"
        ).fetchone()[0]
        stats["total_delivered"] = self.conn.execute(
            "SELECT COUNT(*) FROM delivery_log WHERE approval_status = 'posted'"
        ).fetchone()[0]
        # Per-phone breakdown
        stats["by_phone"] = {}
        for phone in range(1, 5):
            stats["by_phone"][phone] = {
                "scraped": self.conn.execute(
                    "SELECT COUNT(*) FROM scraped_content WHERE target_phone = ?", (phone,)
                ).fetchone()[0],
                "posted": self.conn.execute(
                    "SELECT COUNT(*) FROM delivery_log WHERE phone_number = ? AND approval_status = 'posted'",
                    (phone,)
                ).fetchone()[0],
            }
        return stats

    def close(self):
        self.conn.close()

    # -----------------------------------------------------------------------
    # Account Seeding (auto-creates 8 accounts from niche_config)
    # -----------------------------------------------------------------------

    def _seed_accounts(self):
        """Auto-create 28 accounts if they don't exist.

        Architecture: 2 NICHES PER PHONE — each platform has 2 accounts,
        one for niche A (slot 0) and one for niche B (slot 1).
        Content gets rotated through all platforms but separated by niche.

        Layout:
          Phone 1: 2×TikTok, 2×Instagram, 2×YouTube, 2×LinkedIn, 2×X = 10
          Phone 2: 2×TikTok, 2×Instagram, 2×YouTube = 6
          Phone 3: 2×TikTok, 2×Instagram, 2×YouTube = 6
          Phone 4: 2×TikTok, 2×Instagram, 2×YouTube = 6
          Total: 28
        """
        existing = self.conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        if existing >= 28:
            return
        # Clear and re-seed
        if existing > 0:
            self.conn.execute("DELETE FROM accounts")

        # 2 niches per phone: (niche_A_key, niche_B_key)
        phone_niches = {
            1: [("ecom", "E-commerce"), ("ai_tech", "AI / Tech")],
            2: [("ecom", "E-commerce"), ("business", "Business")],
            3: [("ai_tech", "AI / Tech"), ("lifestyle", "Lifestyle")],
            4: [("business", "Business"), ("lifestyle", "Lifestyle")],
        }

        # Platforms per phone
        phone_platforms = {
            1: ["tiktok", "instagram", "youtube", "linkedin", "twitter"],
            2: ["tiktok", "instagram", "youtube"],
            3: ["tiktok", "instagram", "youtube"],
            4: ["tiktok", "instagram", "youtube"],
        }

        now = datetime.now(timezone.utc).isoformat()
        count = 0

        for phone in range(1, 5):
            niches = phone_niches[phone]
            platforms = phone_platforms[phone]

            for platform in platforms:
                for slot, (niche_key, niche_label) in enumerate(niches):
                    acct_type = "business" if slot == 1 else "personal"
                    platform_label = platform.capitalize()
                    if platform == "twitter":
                        platform_label = "X"

                    display = f"{niche_label} {platform_label} {'Business' if slot == 1 else 'Personal'}"
                    handle_slug = niche_label.lower().replace(" / ", "_").replace(" ", "_")
                    handle = f"{handle_slug}_{platform}_{slot + 1}"

                    acct = Account(
                        phone_number=phone,
                        platform=TargetPlatform(platform),
                        handle=handle,
                        niche=NicheType(niche_key),
                        display_name=display,
                        account_type=AccountType(acct_type),
                        slot_index=slot,
                    )
                    acct.generate_id()

                    self.conn.execute("""
                        INSERT OR IGNORE INTO accounts
                        (id, phone_number, platform, handle, niche, display_name,
                         account_type, slot_index, active, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    """, (
                        acct.id, phone, platform, acct.handle, niche_key,
                        acct.display_name, acct_type, slot, now,
                    ))
                    count = count + 1

        self.conn.commit()
        if count > 0:
            logger.info(f"[DB] Seeded {count} accounts (2 niches × all platforms)")

    # -----------------------------------------------------------------------
    # Account CRUD
    # -----------------------------------------------------------------------

    def get_all_accounts(self) -> list[Account]:
        rows = self.conn.execute(
            "SELECT * FROM accounts WHERE active = 1 ORDER BY phone_number, platform"
        ).fetchall()
        return [self._row_to_account(r) for r in rows]

    def get_account(self, account_id: str) -> Optional[Account]:
        row = self.conn.execute(
            "SELECT * FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()
        if not row:
            return None
        return self._row_to_account(row)

    def get_accounts_for_phone(self, phone: int) -> list[Account]:
        rows = self.conn.execute(
            "SELECT * FROM accounts WHERE phone_number = ? AND active = 1 ORDER BY platform",
            (phone,)
        ).fetchall()
        return [self._row_to_account(r) for r in rows]

    def get_account_by_handle_and_platform(self, handle: str, platform: TargetPlatform | str) -> Optional[Account]:
        p_val = platform.value if hasattr(platform, 'value') else platform
        row = self.conn.execute(
            "SELECT * FROM accounts WHERE handle = ? AND platform = ?",
            (handle, p_val)
        ).fetchone()
        if not row:
            return None
        return self._row_to_account(row)

    def save_account(self, acct: Account):
        """Insert or replace an account."""
        if not acct.id:
            acct.generate_id()
        self.conn.execute("""
            INSERT OR REPLACE INTO accounts (
                id, phone_number, platform, handle, niche, display_name,
                account_type, slot_index, bio, avatar_url, follower_count, active, 
                last_full_sync_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            acct.id, acct.phone_number, acct.platform.value, acct.handle, 
            acct.niche.value, acct.display_name, acct.account_type.value, 
            acct.slot_index, acct.bio, acct.avatar_url, acct.follower_count, 
            int(acct.active), 
            acct.last_full_sync_at.isoformat() if acct.last_full_sync_at else None,
            acct.created_at.isoformat(),
        ))
        self.conn.commit()

    def update_account(self, acct: Account):
        self.conn.execute("""
            UPDATE accounts SET handle=?, display_name=?, bio=?, avatar_url=?,
            follower_count=?, active=?, last_full_sync_at=? WHERE id=?
        """, (
            acct.handle, acct.display_name, acct.bio, acct.avatar_url,
            acct.follower_count, int(acct.active),
            acct.last_full_sync_at.isoformat() if acct.last_full_sync_at else None,
            acct.id,
        ))
        self.conn.commit()

    def _row_to_account(self, row) -> Account:
        d = dict(row)
        return Account(
            id=d["id"],
            phone_number=d["phone_number"],
            platform=TargetPlatform(d["platform"]),
            handle=d.get("handle", ""),
            niche=NicheType(d.get("niche", "ecom")),
            display_name=d.get("display_name", ""),
            account_type=AccountType(d.get("account_type", "personal")),
            slot_index=d.get("slot_index", 0),
            bio=d.get("bio", ""),
            avatar_url=d.get("avatar_url", ""),
            follower_count=d.get("follower_count", 0),
            active=bool(d.get("active", 1)),
        )

    # -----------------------------------------------------------------------
    # Content Analysis CRUD
    # -----------------------------------------------------------------------

    def save_content_analysis(self, ca: ContentAnalysis):
        self.conn.execute("""
            INSERT OR REPLACE INTO content_analysis
            (id, scraped_content_id, account_id, verdict, why_worked, why_failed,
             cmo_score, hook_type, content_type, emotional_tone,
             ideal_duration_seconds, timing_analysis, engagement_delta_pct, 
             embedding_json, generated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            ca.id, ca.scraped_content_id, ca.account_id, ca.verdict.value,
            ca.why_worked, ca.why_failed, ca.cmo_score, ca.hook_type,
            ca.content_type, ca.emotional_tone, ca.ideal_duration_seconds,
            ca.timing_analysis, ca.engagement_delta_pct,
            ca.embedding_json or "{}",
            ca.generated_at.isoformat(),
        ))
        self.conn.commit()

    def get_content_analysis(self, scraped_content_id: str) -> Optional[ContentAnalysis]:
        row = self.conn.execute(
            "SELECT * FROM content_analysis WHERE scraped_content_id = ?",
            (scraped_content_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        return ContentAnalysis(
            id=d["id"], scraped_content_id=d["scraped_content_id"],
            account_id=d.get("account_id", ""),
            verdict=CMOVerdict(d.get("verdict", "neutral")),
            why_worked=d.get("why_worked", ""),
            why_failed=d.get("why_failed", ""),
            cmo_score=d.get("cmo_score", 0),
            hook_type=d.get("hook_type", ""),
            content_type=d.get("content_type", ""),
            emotional_tone=d.get("emotional_tone", ""),
            engagement_delta_pct=d.get("engagement_delta_pct", 0.0),
            embedding_json=d.get("embedding_json", "{}"),
        )

    def get_analyses_for_account(self, account_id: str, limit: int = 50) -> list[dict]:
        rows = self.conn.execute("""
            SELECT ca.*, sc.caption, sc.engagement_views, sc.source_creator
            FROM content_analysis ca
            JOIN scraped_content sc ON ca.scraped_content_id = sc.id
            WHERE ca.account_id = ?
            ORDER BY ca.generated_at DESC LIMIT ?
        """, (account_id, limit)).fetchall()
        return [dict(r) for r in rows]

    # -----------------------------------------------------------------------
    # Viral DNA Profile CRUD
    # -----------------------------------------------------------------------

    def save_viral_dna(self, vdna: ViralDNAProfile):
        self.conn.execute("""
            INSERT OR REPLACE INTO viral_dna_profile
            (account_id, top_hooks, optimal_posting_times, winning_formats,
             winning_emotions, avg_engagement_rate, trend_direction,
             total_analyzed, viral_win_count, rejection_count,
             genome_signature, critical_axis_weaknesses, optimal_duration_range,
             genome_embedding_json, cluster_labels, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            vdna.account_id,
            json.dumps(vdna.top_hooks),
            json.dumps(vdna.optimal_posting_times),
            json.dumps(vdna.winning_formats),
            json.dumps(vdna.winning_emotions),
            vdna.avg_engagement_rate, vdna.trend_direction,
            vdna.total_analyzed, vdna.viral_win_count, vdna.rejection_count,
            vdna.genome_signature or "",
            json.dumps(vdna.critical_axis_weaknesses if isinstance(vdna.critical_axis_weaknesses, list) else []),
            json.dumps(vdna.optimal_duration_range if isinstance(vdna.optimal_duration_range, list) else [15, 30]),
            vdna.genome_embedding_json or "{}",
            json.dumps(getattr(vdna, "cluster_labels", []) or []),
            vdna.updated_at.isoformat(),
        ))
        self.conn.commit()

    def get_viral_dna(self, account_id: str) -> Optional[ViralDNAProfile]:
        row = self.conn.execute(
            "SELECT * FROM viral_dna_profile WHERE account_id = ?", (account_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        return ViralDNAProfile(
            account_id=d["account_id"],
            top_hooks=json.loads(d.get("top_hooks", "[]")),
            optimal_posting_times=json.loads(d.get("optimal_posting_times", "[]")),
            winning_formats=json.loads(d.get("winning_formats", "[]")),
            winning_emotions=json.loads(d.get("winning_emotions", "[]")),
            avg_engagement_rate=d.get("avg_engagement_rate", 0.0),
            trend_direction=d.get("trend_direction", "neutral"),
            total_analyzed=d.get("total_analyzed", 0),
            viral_win_count=d.get("viral_win_count", 0),
            rejection_count=d.get("rejection_count", 0),
            genome_signature=d.get("genome_signature", ""),
            critical_axis_weaknesses=json.loads(d.get("critical_axis_weaknesses", "[]")),
            optimal_duration_range=json.loads(d.get("optimal_duration_range", "[15, 30]")),
            genome_embedding_json=d.get("genome_embedding_json", "{}"),
            cluster_labels=json.loads(d.get("cluster_labels", "[]")),
        )

    # -----------------------------------------------------------------------
    # Next Post Queue CRUD
    # -----------------------------------------------------------------------

    def save_next_post(self, np: NextPostQueue):
        self.conn.execute("""
            INSERT OR REPLACE INTO next_post_queue
            (id, account_id, script, hook, reference_content_id, format_type,
             rationale, priority, status, generated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            np.id, np.account_id, np.script, np.hook, np.reference_content_id,
            np.format_type, np.rationale, np.priority, np.status.value,
            np.generated_at.isoformat(),
        ))
        self.conn.commit()

    def get_next_posts_for_account(self, account_id: str, status: str = "queued") -> list[NextPostQueue]:
        rows = self.conn.execute("""
            SELECT * FROM next_post_queue
            WHERE account_id = ? AND status = ?
            ORDER BY priority ASC, generated_at DESC
        """, (account_id, status)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            result.append(NextPostQueue(
                id=d["id"], account_id=d["account_id"],
                script=d.get("script", ""), hook=d.get("hook", ""),
                reference_content_id=d.get("reference_content_id", ""),
                format_type=d.get("format_type", ""),
                rationale=d.get("rationale", ""),
                priority=d.get("priority", 1),
                status=NextPostStatus(d.get("status", "queued")),
            ))
        return result

        return result

    def close(self):
        """Close the database connection."""
        if hasattr(self, "conn") and self.conn:
            self.conn.close()
            logger.info("[DB] Connection closed.")
