"""
Octragon System — Supabase Persistence Layer

Replaces SQLite with Supabase (PostgreSQL + pgvector + Realtime).
Drop-in replacement for OctragonDB — same method signatures.
"""

from __future__ import annotations

import json
import hashlib
import os
from datetime import datetime, timezone
from typing import Optional

from loguru import logger
from supabase import create_client, Client

from .models import (
    ScrapedContent, VideoVariation, DeliveryLog, NicheConfig,
    ForgeParams, NicheType, SourcePlatform, TargetPlatform,
    ScrapeStatus, CleanseStatus, ApprovalStatus, DeviceProfile,
    Account, AccountType, ContentAnalysis, CMOVerdict, ViralDNAProfile,
    NextPostQueue, NextPostStatus,
)


def _get_supabase_client() -> Client:
    """Initialize Supabase client from env vars."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise ValueError(
            "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. "
            "Add them to your .env file."
        )
    return create_client(url, key)


class OctragonSupabaseDB:
    """Supabase-backed database for the Octragon System.

    Same API as OctragonDB (SQLite) for seamless swap.
    Uses service role key for full access — RLS bypass.
    """

    def __init__(self, client: Optional[Client] = None):
        self.client = client or _get_supabase_client()
        self._seed_accounts()
        logger.info("[DB] Supabase client initialized")

    # -----------------------------------------------------------------------
    # Account Seeding
    # -----------------------------------------------------------------------

    def _seed_accounts(self):
        """Auto-create 28 accounts if they don't exist."""
        result = self.client.table("accounts").select("id", count="exact").execute()
        if result.count and result.count >= 28:
            return

        # Clear and re-seed
        self.client.table("accounts").delete().neq("id", "").execute()

        phone_niches = {
            1: [("ecom", "E-commerce"), ("ai_tech", "AI / Tech")],
            2: [("ecom", "E-commerce"), ("business", "Business")],
            3: [("ai_tech", "AI / Tech"), ("lifestyle", "Lifestyle")],
            4: [("business", "Business"), ("lifestyle", "Lifestyle")],
        }
        phone_platforms = {
            1: ["tiktok", "instagram", "youtube", "linkedin", "twitter"],
            2: ["tiktok", "instagram", "youtube"],
            3: ["tiktok", "instagram", "youtube"],
            4: ["tiktok", "instagram", "youtube"],
        }

        now = datetime.now(timezone.utc).isoformat()
        rows = []

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

                    raw = f"account:{phone}:{platform}:{acct_type}:{slot}"
                    acct_id = hashlib.sha256(raw.encode()).hexdigest()[:16]

                    rows.append({
                        "id": acct_id,
                        "phone_number": phone,
                        "platform": platform,
                        "handle": handle,
                        "niche": niche_key,
                        "display_name": display,
                        "account_type": acct_type,
                        "slot_index": slot,
                        "active": True,
                        "created_at": now,
                    })

        self.client.table("accounts").insert(rows).execute()
        logger.info(f"[DB] Seeded {len(rows)} accounts into Supabase")

    # -----------------------------------------------------------------------
    # Account CRUD
    # -----------------------------------------------------------------------

    def get_all_accounts(self) -> list[Account]:
        result = self.client.table("accounts") \
            .select("*") \
            .eq("active", True) \
            .order("phone_number") \
            .order("platform") \
            .execute()
        return [self._row_to_account(r) for r in result.data]

    def get_account(self, account_id: str) -> Optional[Account]:
        result = self.client.table("accounts") \
            .select("*") \
            .eq("id", account_id) \
            .maybe_single() \
            .execute()
        return self._row_to_account(result.data) if result.data else None

    def get_accounts_for_phone(self, phone: int) -> list[Account]:
        result = self.client.table("accounts") \
            .select("*") \
            .eq("phone_number", phone) \
            .eq("active", True) \
            .order("platform") \
            .execute()
        return [self._row_to_account(r) for r in result.data]

    def update_account(self, acct: Account):
        self.client.table("accounts").update({
            "handle": acct.handle,
            "display_name": acct.display_name,
            "bio": acct.bio,
            "avatar_url": acct.avatar_url,
            "follower_count": acct.follower_count,
            "active": acct.active,
            "last_full_sync_at": acct.last_full_sync_at.isoformat() if acct.last_full_sync_at else None,
        }).eq("id", acct.id).execute()

    def _row_to_account(self, d: dict) -> Account:
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
            active=bool(d.get("active", True)),
        )

    # -----------------------------------------------------------------------
    # Scraped Content
    # -----------------------------------------------------------------------

    def upsert_scraped_content(self, sc: ScrapedContent) -> None:
        if not sc.id:
            sc.generate_id()
        self.client.table("scraped_content").upsert({
            "id": sc.id,
            "source_url": sc.source_url,
            "source_platform": sc.source_platform.value,
            "source_creator": sc.source_creator,
            "caption": sc.caption,
            "hashtags": sc.hashtags,  # JSONB — direct list
            "duration_seconds": sc.duration_seconds,
            "resolution": sc.resolution,
            "video_path": sc.video_path,
            "audio_path": sc.audio_path,
            "video_hash": sc.video_hash,
            "engagement_likes": sc.engagement_likes,
            "engagement_comments": sc.engagement_comments,
            "engagement_shares": sc.engagement_shares,
            "engagement_views": sc.engagement_views,
            "target_niche": sc.target_niche.value,
            "target_phone": sc.target_phone,
            "telegram_group_id": sc.telegram_group_id,
            "telegram_message_id": sc.telegram_message_id,
            "scrape_status": sc.scrape_status.value,
            "scraped_at": sc.scraped_at.isoformat() if sc.scraped_at else None,
            "raw_metadata": sc.raw_metadata,  # JSONB
            "created_at": sc.created_at.isoformat(),
        }).execute()

    def get_scraped_content(self, content_id: str) -> Optional[ScrapedContent]:
        result = self.client.table("scraped_content") \
            .select("*").eq("id", content_id).maybe_single().execute()
        return self._row_to_scraped_content(result.data) if result.data else None

    def get_scraped_by_url(self, url: str) -> Optional[ScrapedContent]:
        result = self.client.table("scraped_content") \
            .select("*").eq("source_url", url).maybe_single().execute()
        return self._row_to_scraped_content(result.data) if result.data else None

    def get_pending_scrapes(self, phone: Optional[int] = None) -> list[ScrapedContent]:
        q = self.client.table("scraped_content").select("*").eq("scrape_status", "pending")
        if phone:
            q = q.eq("target_phone", phone)
        result = q.execute()
        return [self._row_to_scraped_content(r) for r in result.data]

    def update_scrape_status(self, content_id: str, status: ScrapeStatus,
                              video_path: str = "", video_hash: str = "",
                              audio_path: str = "") -> None:
        update = {"scrape_status": status.value, "scraped_at": datetime.now(timezone.utc).isoformat()}
        if video_path:
            update["video_path"] = video_path
        if video_hash:
            update["video_hash"] = video_hash
        if audio_path:
            update["audio_path"] = audio_path
        self.client.table("scraped_content").update(update).eq("id", content_id).execute()

    def get_recent_scraped(self, hours: int = 24, limit: int = 50) -> list[ScrapedContent]:
        cutoff = datetime.now(timezone.utc).isoformat()
        result = self.client.table("scraped_content") \
            .select("*") \
            .order("created_at", desc=True) \
            .limit(limit) \
            .execute()
        return [self._row_to_scraped_content(r) for r in result.data]

    def _row_to_scraped_content(self, d: dict) -> ScrapedContent:
        hashtags = d.get("hashtags", [])
        if isinstance(hashtags, str):
            hashtags = json.loads(hashtags)
        raw_meta = d.get("raw_metadata", {})
        if isinstance(raw_meta, str):
            raw_meta = json.loads(raw_meta)
        sc = ScrapedContent(
            id=d["id"],
            source_url=d["source_url"],
            source_platform=SourcePlatform(d["source_platform"]),
            source_creator=d.get("source_creator", ""),
            caption=d.get("caption", ""),
            hashtags=hashtags,
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
            raw_metadata=raw_meta,
        )
        return sc

    # -----------------------------------------------------------------------
    # Video Variations
    # -----------------------------------------------------------------------

    def save_variation(self, var: VideoVariation) -> None:
        if not var.id:
            var.generate_id()
        forge = var.forge_params.to_dict() if var.forge_params else {}
        self.client.table("video_variations").upsert({
            "id": var.id,
            "scraped_content_id": var.scraped_content_id,
            "variation_index": var.variation_index,
            "video_path": var.video_path,
            "video_hash": var.video_hash,
            "forge_params": forge,
            "cleanse_status": var.cleanse_status.value,
            "metadata_injected": var.metadata_injected,
            "gemini_analysis": var.gemini_analysis or {},
            "cleansed_at": var.cleansed_at.isoformat() if var.cleansed_at else None,
            "created_at": var.created_at.isoformat(),
        }).execute()

    def get_variations(self, scraped_content_id: str) -> list[VideoVariation]:
        result = self.client.table("video_variations") \
            .select("*") \
            .eq("scraped_content_id", scraped_content_id) \
            .order("variation_index") \
            .execute()
        return [self._row_to_variation(r) for r in result.data]

    def get_variation(self, variation_id: str) -> Optional[VideoVariation]:
        result = self.client.table("video_variations") \
            .select("*").eq("id", variation_id).maybe_single().execute()
        return self._row_to_variation(result.data) if result.data else None

    def _row_to_variation(self, d: dict) -> VideoVariation:
        params_dict = d.get("forge_params", {})
        if isinstance(params_dict, str):
            params_dict = json.loads(params_dict)
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
        return VideoVariation(
            id=d["id"],
            scraped_content_id=d["scraped_content_id"],
            variation_index=d["variation_index"],
            video_path=d.get("video_path", ""),
            video_hash=d.get("video_hash", ""),
            forge_params=params,
            cleanse_status=CleanseStatus(d.get("cleanse_status", "pending")),
            metadata_injected=bool(d.get("metadata_injected", False)),
            gemini_analysis=d.get("gemini_analysis", {}),
        )

    # -----------------------------------------------------------------------
    # Delivery Log
    # -----------------------------------------------------------------------

    def save_delivery(self, dl: DeliveryLog) -> None:
        if not dl.id:
            dl.generate_id()
        self.client.table("delivery_log").upsert({
            "id": dl.id,
            "variation_id": dl.variation_id,
            "scraped_content_id": dl.scraped_content_id,
            "phone_number": dl.phone_number,
            "target_platform": dl.target_platform.value,
            "target_account": dl.target_account,
            "telegram_group_id": dl.telegram_group_id,
            "telegram_message_id": dl.telegram_message_id,
            "approval_status": dl.approval_status.value,
            "approved_at": dl.approved_at.isoformat() if dl.approved_at else None,
            "rejected_at": dl.rejected_at.isoformat() if dl.rejected_at else None,
            "rejection_reason": dl.rejection_reason,
            "posted_at": dl.posted_at.isoformat() if dl.posted_at else None,
            "post_url": dl.post_url,
            "post_engagement": dl.post_engagement or {},
            "created_at": dl.created_at.isoformat(),
        }).execute()

    def get_delivery_log(self, delivery_id: str) -> Optional[dict]:
        result = self.client.table("delivery_log") \
            .select("*").eq("id", delivery_id).maybe_single().execute()
        return result.data

    def get_pending_approvals(self, phone: Optional[int] = None) -> list[dict]:
        q = self.client.table("delivery_log").select("*").eq("approval_status", "pending")
        if phone:
            q = q.eq("phone_number", phone)
        result = q.order("created_at", desc=True).execute()
        return result.data

    # -----------------------------------------------------------------------
    # Content Analysis CRUD
    # -----------------------------------------------------------------------

    def save_content_analysis(self, ca: ContentAnalysis):
        self.client.table("content_analysis").upsert({
            "id": ca.id,
            "scraped_content_id": ca.scraped_content_id,
            "account_id": ca.account_id,
            "verdict": ca.verdict.value,
            "why_worked": ca.why_worked,
            "why_failed": ca.why_failed,
            "cmo_score": ca.cmo_score,
            "hook_type": ca.hook_type,
            "content_type": ca.content_type,
            "emotional_tone": ca.emotional_tone,
            "ideal_duration_seconds": ca.ideal_duration_seconds,
            "timing_analysis": ca.timing_analysis,
            "engagement_delta_pct": ca.engagement_delta_pct,
            "generated_at": ca.generated_at.isoformat(),
        }).execute()

    def get_content_analysis(self, scraped_content_id: str) -> Optional[ContentAnalysis]:
        result = self.client.table("content_analysis") \
            .select("*").eq("scraped_content_id", scraped_content_id) \
            .maybe_single().execute()
        if not result.data:
            return None
        d = result.data
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
        )

    def get_analyses_for_account(self, account_id: str, limit: int = 50) -> list[dict]:
        result = self.client.table("content_analysis") \
            .select("*, scraped_content(caption, engagement_views, source_creator)") \
            .eq("account_id", account_id) \
            .order("generated_at", desc=True) \
            .limit(limit) \
            .execute()
        return result.data

    # -----------------------------------------------------------------------
    # Viral DNA Profile CRUD
    # -----------------------------------------------------------------------

    def save_viral_dna(self, vdna: ViralDNAProfile):
        self.client.table("viral_dna_profile").upsert({
            "account_id": vdna.account_id,
            "top_hooks": vdna.top_hooks,
            "optimal_posting_times": vdna.optimal_posting_times,
            "winning_formats": vdna.winning_formats,
            "winning_emotions": vdna.winning_emotions,
            "avg_engagement_rate": vdna.avg_engagement_rate,
            "trend_direction": vdna.trend_direction,
            "total_analyzed": vdna.total_analyzed,
            "viral_win_count": vdna.viral_win_count,
            "rejection_count": vdna.rejection_count,
            "updated_at": vdna.updated_at.isoformat(),
        }).execute()

    def get_viral_dna(self, account_id: str) -> Optional[ViralDNAProfile]:
        result = self.client.table("viral_dna_profile") \
            .select("*").eq("account_id", account_id).maybe_single().execute()
        if not result.data:
            return None
        d = result.data
        return ViralDNAProfile(
            account_id=d["account_id"],
            top_hooks=d.get("top_hooks", []),
            optimal_posting_times=d.get("optimal_posting_times", []),
            winning_formats=d.get("winning_formats", []),
            winning_emotions=d.get("winning_emotions", []),
            avg_engagement_rate=d.get("avg_engagement_rate", 0.0),
            trend_direction=d.get("trend_direction", "neutral"),
            total_analyzed=d.get("total_analyzed", 0),
            viral_win_count=d.get("viral_win_count", 0),
            rejection_count=d.get("rejection_count", 0),
        )

    # -----------------------------------------------------------------------
    # Next Post Queue CRUD
    # -----------------------------------------------------------------------

    def save_next_post(self, np: NextPostQueue):
        self.client.table("next_post_queue").upsert({
            "id": np.id,
            "account_id": np.account_id,
            "script": np.script,
            "hook": np.hook,
            "reference_content_id": np.reference_content_id,
            "format_type": np.format_type,
            "rationale": np.rationale,
            "priority": np.priority,
            "status": np.status.value,
            "generated_at": np.generated_at.isoformat(),
        }).execute()

    def get_next_posts_for_account(self, account_id: str, status: str = "queued") -> list[NextPostQueue]:
        result = self.client.table("next_post_queue") \
            .select("*") \
            .eq("account_id", account_id) \
            .eq("status", status) \
            .order("priority") \
            .order("generated_at", desc=True) \
            .execute()
        return [self._row_to_next_post(r) for r in result.data]

    def get_all_next_posts(self, limit: int = 20) -> list[NextPostQueue]:
        result = self.client.table("next_post_queue") \
            .select("*") \
            .eq("status", "queued") \
            .order("priority") \
            .order("generated_at", desc=True) \
            .limit(limit) \
            .execute()
        return [self._row_to_next_post(r) for r in result.data]

    def _row_to_next_post(self, d: dict) -> NextPostQueue:
        return NextPostQueue(
            id=d["id"], account_id=d["account_id"],
            script=d.get("script", ""), hook=d.get("hook", ""),
            reference_content_id=d.get("reference_content_id", ""),
            format_type=d.get("format_type", ""),
            rationale=d.get("rationale", ""),
            priority=d.get("priority", 1),
            status=NextPostStatus(d.get("status", "queued")),
        )

    # -----------------------------------------------------------------------
    # Analytics — Using Materialized Views (Layer 2)
    # -----------------------------------------------------------------------

    def get_pipeline_stats(self) -> dict:
        """Read from mv_pipeline_stats for instant dashboard load.

        Falls back to live queries if materialized view not yet created.
        """
        try:
            result = self.client.table("mv_pipeline_stats").select("*").execute()
            if result.data:
                return result.data[0]
        except Exception:
            pass
        # Fallback: live count queries
        stats = {}
        r = self.client.table("scraped_content").select("id", count="exact").execute()
        stats["total_scraped"] = r.count or 0
        r = self.client.table("scraped_content").select("id", count="exact").eq("scrape_status", "pending").execute()
        stats["pending_scrapes"] = r.count or 0
        r = self.client.table("video_variations").select("id", count="exact").eq("cleanse_status", "done").execute()
        stats["variations_ready"] = r.count or 0
        r = self.client.table("delivery_log").select("id", count="exact").eq("approval_status", "posted").execute()
        stats["total_posted"] = r.count or 0
        r = self.client.table("accounts").select("id", count="exact").eq("active", True).execute()
        stats["active_accounts"] = r.count or 0
        return stats

    def get_account_leaderboard(self) -> list[dict]:
        """Read from mv_account_performance for instant leaderboard.

        Falls back to accounts table if materialized view not available.
        """
        try:
            result = self.client.table("mv_account_performance") \
                .select("*") \
                .order("cmo_score", desc=True) \
                .execute()
            return result.data
        except Exception:
            return [self._row_to_account(r).__dict__ for r in
                    self.client.table("accounts").select("*").eq("active", True).execute().data]

    def get_top_hooks(self) -> list[dict]:
        """Read from mv_top_hooks for instant hook leaderboard."""
        try:
            result = self.client.table("mv_top_hooks").select("*").execute()
            return result.data
        except Exception:
            return []

    # -----------------------------------------------------------------------
    # CRM Interactions (auto-tagged by PostgreSQL trigger)
    # -----------------------------------------------------------------------

    def save_crm_interaction(self, account_id: str, contact_handle: str,
                              platform: str, direction: str = "inbound",
                              summary: str = "", sentiment: str = "neutral",
                              tags: list[str] | None = None) -> dict:
        """Save a CRM interaction. Auto-tagging happens in PostgreSQL trigger."""
        import hashlib
        raw = f"crm:{account_id}:{contact_handle}:{datetime.now(timezone.utc).isoformat()}"
        crm_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        data = {
            "id": crm_id,
            "account_id": account_id,
            "contact_handle": contact_handle,
            "platform": platform,
            "direction": direction,
            "summary": summary,
            "sentiment": sentiment,
            "tags": tags or [],
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        result = self.client.table("crm_interactions").insert(data).execute()
        return result.data[0] if result.data else data

    def get_crm_for_account(self, account_id: str, limit: int = 50) -> list[dict]:
        result = self.client.table("crm_interactions") \
            .select("*") \
            .eq("account_id", account_id) \
            .order("occurred_at", desc=True) \
            .limit(limit) \
            .execute()
        return result.data

    def get_recent_crm(self, limit: int = 30) -> list[dict]:
        result = self.client.table("crm_interactions") \
            .select("*, accounts(display_name, platform)") \
            .order("occurred_at", desc=True) \
            .limit(limit) \
            .execute()
        return result.data

    def search_crm_by_tag(self, tag: str) -> list[dict]:
        """Find CRM interactions with a specific tag (uses GIN index)."""
        result = self.client.table("crm_interactions") \
            .select("*") \
            .contains("tags", [tag]) \
            .order("occurred_at", desc=True) \
            .execute()
        return result.data

    # -----------------------------------------------------------------------
    # Daily Todos
    # -----------------------------------------------------------------------

    def save_daily_todo(self, account_id: str, date: str, action: str,
                         priority: int = 1, category: str = "content",
                         rationale: str = "") -> dict:
        import hashlib
        raw = f"todo:{account_id}:{date}:{action[:20]}"
        todo_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        data = {
            "id": todo_id,
            "account_id": account_id,
            "date": date,
            "priority": priority,
            "action": action,
            "category": category,
            "rationale": rationale,
            "status": "pending",
        }
        result = self.client.table("daily_todos").upsert(data).execute()
        return result.data[0] if result.data else data

    def get_todos_for_date(self, date: str) -> list[dict]:
        result = self.client.table("daily_todos") \
            .select("*, accounts(display_name, platform)") \
            .eq("date", date) \
            .order("priority") \
            .execute()
        return result.data

    # -----------------------------------------------------------------------
    # Account Health
    # -----------------------------------------------------------------------

    def save_account_health(self, account_id: str, date: str, cmo_score: int,
                             trend: str = "neutral", strengths: str = "",
                             weaknesses: str = "", recommendations: str = "",
                             raw_report: str = "") -> dict:
        import hashlib
        raw = f"health:{account_id}:{date}"
        health_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        data = {
            "id": health_id,
            "account_id": account_id,
            "date": date,
            "cmo_score": cmo_score,
            "trend": trend,
            "strengths": strengths,
            "weaknesses": weaknesses,
            "recommendations": recommendations,
            "raw_report": raw_report,
        }
        result = self.client.table("account_health").upsert(data).execute()
        return result.data[0] if result.data else data

    def get_health_history(self, account_id: str, limit: int = 30) -> list[dict]:
        result = self.client.table("account_health") \
            .select("*") \
            .eq("account_id", account_id) \
            .order("date", desc=True) \
            .limit(limit) \
            .execute()
        return result.data

    # -----------------------------------------------------------------------
    # Link Tracking (ViewTrack — Layer 7)
    # -----------------------------------------------------------------------

    def create_tracking_link(self, account_id: str, target_url: str,
                              utm_source: str = "", utm_medium: str = "",
                              utm_campaign: str = "", utm_content: str = "",
                              platform: str = "", post_id: str = "") -> dict:
        import hashlib, secrets
        link_id = hashlib.sha256(f"link:{account_id}:{target_url}:{secrets.token_hex(4)}".encode()).hexdigest()[:16]
        short_url = secrets.token_urlsafe(6)
        data = {
            "id": link_id,
            "account_id": account_id,
            "post_id": post_id,
            "utm_source": utm_source,
            "utm_medium": utm_medium,
            "utm_campaign": utm_campaign,
            "utm_content": utm_content,
            "short_url": short_url,
            "target_url": target_url,
            "platform": platform,
        }
        result = self.client.table("link_tracking").insert(data).execute()
        return result.data[0] if result.data else data

    def get_links_for_account(self, account_id: str) -> list[dict]:
        result = self.client.table("link_tracking") \
            .select("*") \
            .eq("account_id", account_id) \
            .order("created_at", desc=True) \
            .execute()
        return result.data

    def get_revenue_by_campaign(self) -> list[dict]:
        result = self.client.table("link_tracking") \
            .select("utm_campaign, platform") \
            .order("revenue", desc=True) \
            .execute()
        return result.data

    # -----------------------------------------------------------------------
    # Audit Log (Layer 3)
    # -----------------------------------------------------------------------

    def get_audit_log(self, table_name: Optional[str] = None, limit: int = 50) -> list[dict]:
        q = self.client.table("audit_log").select("*").order("changed_at", desc=True).limit(limit)
        if table_name:
            q = q.eq("table_name", table_name)
        return q.execute().data

    # -----------------------------------------------------------------------
    # Niche Config
    # -----------------------------------------------------------------------

    def save_niche_config(self, nc: NicheConfig) -> None:
        self.client.table("niche_config").upsert({
            "phone_number": nc.phone_number,
            "niche": nc.niche.value,
            "niche_name": nc.niche_name,
            "telegram_group_id": nc.telegram_group_id,
            "tiktok_handle": nc.tiktok_handle,
            "instagram_handle": nc.instagram_handle,
            "linkedin_handle": nc.linkedin_handle,
            "gps_lat_center": nc.gps_lat_center,
            "gps_lon_center": nc.gps_lon_center,
            "gps_radius": nc.gps_radius,
            "device_profile": nc.device_profile.value,
            "platforms": [p.value for p in nc.platforms],
            "active": nc.active,
            "created_at": nc.created_at.isoformat(),
        }).execute()

    # -----------------------------------------------------------------------
    # Source Creators Watchlist (Layer 10)
    # -----------------------------------------------------------------------

    def add_source_creator(self, handle: str, platform: str, niche: str,
                            display_name: str = "", follower_count: int = 0,
                            sub_niches: list[str] | None = None,
                            content_style: list[str] | None = None,
                            added_via: str = "telegram") -> dict:
        """Add a creator to the watchlist. Upserts if handle+platform exists."""
        import hashlib
        raw = f"creator:{handle}:{platform}"
        creator_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        tier = "mega" if follower_count >= 1_000_000 else \
               "macro" if follower_count >= 100_000 else \
               "mid" if follower_count >= 10_000 else "micro"
        data = {
            "id": creator_id,
            "handle": handle.lstrip("@"),
            "platform": platform,
            "display_name": display_name,
            "follower_count": follower_count,
            "niche": niche,
            "sub_niches": sub_niches or [],
            "content_style": content_style or [],
            "follower_tier": tier,
            "status": "active",
            "added_via": added_via,
        }
        result = self.client.table("source_creators").upsert(data).execute()
        return result.data[0] if result.data else data

    def remove_source_creator(self, handle: str, platform: str) -> bool:
        self.client.table("source_creators") \
            .update({"status": "archived"}) \
            .eq("handle", handle.lstrip("@")) \
            .eq("platform", platform) \
            .execute()
        return True

    def get_active_creators(self, niche: str | None = None) -> list[dict]:
        q = self.client.table("source_creators") \
            .select("*") \
            .eq("status", "active") \
            .order("viral_hit_count", desc=True)
        if niche:
            q = q.eq("niche", niche)
        return q.execute().data

    def get_all_source_creators(self) -> list[dict]:
        return self.client.table("source_creators") \
            .select("*") \
            .neq("status", "archived") \
            .order("created_at", desc=True) \
            .execute().data

    def update_creator_patrol(self, creator_id: str, avg_views: int = 0,
                               avg_er: float = 0.0, videos_tracked: int = 0,
                               viral_hits: int = 0) -> None:
        self.client.table("source_creators").update({
            "baseline_avg_views": avg_views,
            "baseline_avg_er": avg_er,
            "total_videos_tracked": videos_tracked,
            "viral_hit_count": viral_hits,
            "last_patrol_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", creator_id).execute()

    def get_creators_for_patrol(self) -> list[dict]:
        """Get creators due for patrol (not patrolled in last 2 hours)."""
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        return self.client.table("source_creators") \
            .select("*") \
            .eq("status", "active") \
            .or_(f"last_patrol_at.is.null,last_patrol_at.lt.{cutoff}") \
            .execute().data

    # -----------------------------------------------------------------------
    # Posting Queue (Layer 10)
    # -----------------------------------------------------------------------

    def create_posting_item(self, account_id: str, scraped_content_id: str,
                             variation_id: str, platform: str, date: str,
                             time_slot: str, caption: str = "",
                             music_url: str = "", hashtags: list[str] | None = None,
                             priority: int = 5, cross_platform_source: str = "") -> dict:
        import hashlib, secrets
        raw = f"post:{account_id}:{date}:{time_slot}:{secrets.token_hex(4)}"
        post_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        data = {
            "id": post_id,
            "account_id": account_id,
            "scraped_content_id": scraped_content_id,
            "variation_id": variation_id,
            "platform": platform,
            "date": date,
            "time_slot": time_slot,
            "caption": caption,
            "music_url": music_url,
            "hashtags": hashtags or [],
            "status": "queued",
            "priority": priority,
            "cross_platform_source": cross_platform_source,
        }
        result = self.client.table("posting_queue").insert(data).execute()
        return result.data[0] if result.data else data

    def get_posting_queue_for_date(self, date: str) -> list[dict]:
        return self.client.table("posting_queue") \
            .select("*, accounts(display_name, platform, handle)") \
            .eq("date", date) \
            .order("time_slot") \
            .order("priority") \
            .execute().data

    def get_posting_queue_for_account(self, account_id: str, date: str) -> list[dict]:
        return self.client.table("posting_queue") \
            .select("*") \
            .eq("account_id", account_id) \
            .eq("date", date) \
            .order("time_slot") \
            .execute().data

    def mark_posted(self, post_id: str, telegram_message_id: int = 0) -> None:
        self.client.table("posting_queue").update({
            "status": "posted",
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "telegram_message_id": telegram_message_id,
        }).eq("id", post_id).execute()

    def get_queued_count_for_date(self, date: str) -> int:
        result = self.client.table("posting_queue") \
            .select("id", count="exact") \
            .eq("date", date) \
            .eq("status", "queued") \
            .execute()
        return result.count or 0

    def get_posted_count_for_date(self, date: str) -> int:
        result = self.client.table("posting_queue") \
            .select("id", count="exact") \
            .eq("date", date) \
            .eq("status", "posted") \
            .execute()
        return result.count or 0

    def close(self):
        """No-op for compatibility. Supabase client doesn't need explicit close."""
        pass
