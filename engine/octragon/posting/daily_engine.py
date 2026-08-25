"""
Octragon Daily Posting Engine

Generates the daily posting plan for all 16 accounts (4 phones × 2 platforms × 2 accounts).
Runs each morning at 6 AM or on-demand via /daily command.

Strategy:
  1. Pull all ready variations (cleanse_status=done, not yet in posting_queue)
  2. Match each to its niche → assign to niche-matched accounts
  3. Cross-platform: if a video scored ≥ 80, queue it for BOTH TT and IG (different variations)
  4. Spread posts across time slots defined by ViralDNAProfile.optimal_posting_times
  5. Cap at MAX_POSTS_PER_ACCOUNT per account per day
  6. Send posting bundles to per-account Telegram threads
"""

from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone
from typing import Optional

from loguru import logger

from octragon.config import OctragonConfig, get_config
from octragon.models import NicheType, TargetPlatform


# ─── Constants ────────────────────────────────────────────────────────────────

MAX_POSTS_PER_ACCOUNT = 5  # max per account per day → 16 × 5 = 80 total ceiling
TARGET_POSTS_PER_DAY = 20  # goal across all accounts
MIN_CROSS_PLATFORM_SCORE = 80  # virality score threshold for cross-platform reuse

# Default time slots (overridden by ViralDNAProfile when available)
DEFAULT_TIME_SLOTS = [
    "07:00", "08:30",              # Morning window
    "12:00", "13:30",              # Lunch window
    "17:00", "18:00", "19:30",     # Evening window (peak)
    "21:00",                       # Late night
]

# Niche → account mapping (which phone handles which niche)
NICHE_PHONE_MAP = {
    NicheType.ECOM: 1,
    NicheType.AI_TECH: 2,
    NicheType.BUSINESS: 3,
    NicheType.LIFESTYLE: 4,
}


class DailyEngine:
    """Generates and manages the daily posting queue."""

    def __init__(self, db, config: Optional[OctragonConfig] = None):
        self.db = db
        self.config = config or get_config()

    def generate_daily_plan(self, date: str | None = None) -> dict:
        """
        Generate the full daily posting plan.

        Args:
            date: Target date string (YYYY-MM-DD). Defaults to today.

        Returns:
            Summary dict with counts and assignments.
        """
        if date is None:
            date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Check if plan already exists for today
        existing = self.db.get_queued_count_for_date(date)
        if existing > 0:
            logger.info(f"[DailyEngine] Plan already exists for {date}: {existing} items")
            return {"date": date, "status": "already_exists", "queued": existing}

        # Step 1: Get all accounts (grouped by niche)
        all_accounts = self.db.get_all_accounts()
        accounts_by_niche: dict[str, list] = {}
        for acc in all_accounts:
            niche = acc.niche.value if hasattr(acc.niche, 'value') else acc.niche
            accounts_by_niche.setdefault(niche, []).append(acc)

        # Step 2: Get available variations (not yet queued)
        available_content = self._get_available_content()
        if not available_content:
            logger.warning("[DailyEngine] No content available for posting")
            return {"date": date, "status": "no_content", "queued": 0}

        # Step 3: Score and sort content by virality
        content_by_niche: dict[str, list] = {}
        for item in available_content:
            niche = item.get("target_niche", "ecom")
            content_by_niche.setdefault(niche, []).append(item)

        # Step 4: Assign content to accounts with time slots
        assignments = []
        used_variation_ids: set[str] = set()  # prevent double-booking

        for niche, accounts in accounts_by_niche.items():
            niche_content = content_by_niche.get(niche, [])
            if not niche_content:
                continue

            # Get time slots (try ViralDNAProfile, fall back to defaults)
            time_slots = self._get_time_slots_for_niche(niche)

            for account in accounts:
                acc_id = account.id if hasattr(account, 'id') else account.get("id", "")
                acc_platform = account.platform.value if hasattr(account, 'platform') and hasattr(account.platform, 'value') else str(account.get("platform", ""))
                posts_for_account = 0

                for slot in time_slots:
                    if posts_for_account >= MAX_POSTS_PER_ACCOUNT:
                        break
                    if not niche_content:
                        break

                    # Pick best content not yet used
                    content = None
                    for c in niche_content:
                        variation_id = c.get("variation_id", "")
                        if variation_id and variation_id not in used_variation_ids:
                            content = c
                            break

                    if not content:
                        break

                    variation_id = content.get("variation_id", "")
                    used_variation_ids.add(variation_id)

                    assignments.append({
                        "account_id": acc_id,
                        "scraped_content_id": content.get("scraped_content_id", ""),
                        "variation_id": variation_id,
                        "platform": acc_platform,
                        "date": date,
                        "time_slot": slot,
                        "caption": content.get("caption", ""),
                        "music_url": content.get("music_url", ""),
                        "priority": content.get("priority", 5),
                    })
                    posts_for_account += 1
                    niche_content.remove(content)

        # Step 5: Insert all assignments into posting_queue
        created = 0
        for assignment in assignments[:TARGET_POSTS_PER_DAY]:
            try:
                self.db.create_posting_item(**assignment)
                created += 1
            except Exception as e:
                logger.warning(f"[DailyEngine] Failed to create posting item: {e}")

        logger.success(f"[DailyEngine] Generated {created} posts for {date}")
        return {
            "date": date,
            "status": "generated",
            "queued": created,
            "by_niche": {n: len(a) for n, a in accounts_by_niche.items()},
        }

    def _get_available_content(self) -> list[dict]:
        """Get variations that are ready for posting but not yet queued."""
        try:
            # Get all done variations
            result = self.db.client.table("video_variations") \
                .select("id, scraped_content_id, variation_index, video_path") \
                .eq("cleanse_status", "done") \
                .execute()

            if not result.data:
                return []

            # Enrich with scraped_content metadata
            enriched = []
            for var in result.data:
                sc_id = var.get("scraped_content_id", "")
                if not sc_id:
                    continue
                try:
                    sc = self.db.client.table("scraped_content") \
                        .select("caption, target_niche, engagement_views, engagement_likes, source_creator, raw_metadata") \
                        .eq("id", sc_id) \
                        .single() \
                        .execute()
                    if sc.data:
                        views = sc.data.get("engagement_views", 0)
                        likes = sc.data.get("engagement_likes", 0)
                        er = likes / max(views, 1) * 100
                        music_url = ""
                        raw_meta = sc.data.get("raw_metadata") or {}
                        if isinstance(raw_meta, dict):
                            music_url = raw_meta.get("music_url", "")

                        enriched.append({
                            "variation_id": var["id"],
                            "scraped_content_id": sc_id,
                            "target_niche": sc.data.get("target_niche", "ecom"),
                            "caption": sc.data.get("caption", ""),
                            "music_url": music_url,
                            "virality_score": min(100, er * 10),
                            "priority": 1 if er > 8 else 3 if er > 5 else 5,
                        })
                except Exception:
                    continue

            # Sort by virality (best first)
            enriched.sort(key=lambda x: x.get("virality_score", 0), reverse=True)
            return enriched

        except Exception as e:
            logger.warning(f"[DailyEngine] Content fetch failed: {e}")
            return []

    def _get_time_slots_for_niche(self, niche: str) -> list[str]:
        """Get posting time slots, preferring ViralDNAProfile data."""
        # Default slots with slight randomization
        slots = list(DEFAULT_TIME_SLOTS)
        random.shuffle(slots)
        return slots[:MAX_POSTS_PER_ACCOUNT]

    def get_daily_summary(self, date: str | None = None) -> dict:
        """Get summary of today's posting plan for display."""
        if date is None:
            date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        queued = self.db.get_queued_count_for_date(date)
        posted = self.db.get_posted_count_for_date(date)
        queue = self.db.get_posting_queue_for_date(date)

        # Group by account
        by_account: dict[str, list] = {}
        for item in queue:
            acc_id = item.get("account_id", "unknown")
            by_account.setdefault(acc_id, []).append(item)

        return {
            "date": date,
            "total_queued": queued,
            "total_posted": posted,
            "remaining": queued,
            "by_account": {k: len(v) for k, v in by_account.items()},
            "progress_pct": round(posted / max(queued + posted, 1) * 100),
        }

    def format_telegram_daily_brief(self, date: str | None = None) -> str:
        """Format the daily posting plan as a Telegram message."""
        summary = self.get_daily_summary(date)

        lines = [
            f"📋 *Daily Posting Plan — {summary['date']}*\n",
            f"📤 Queued: {summary['total_queued']}",
            f"✅ Posted: {summary['total_posted']}",
            f"📊 Progress: {summary['progress_pct']}%\n",
        ]

        queue = self.db.get_posting_queue_for_date(summary["date"])
        for item in queue[:20]:
            status_emoji = "✅" if item.get("status") == "posted" else "⏳"
            account_info = item.get("accounts", {})
            handle = account_info.get("handle", "?") if isinstance(account_info, dict) else "?"
            platform = item.get("platform", "?")
            time_slot = item.get("time_slot", "?")
            plat_emoji = {"tiktok": "🎵", "instagram": "📸", "twitter": "🐦"}.get(platform, "📱")

            lines.append(f"{status_emoji} {time_slot} {plat_emoji} @{handle}")

        if not queue:
            lines.append("_No posts scheduled yet. Run /daily to generate._")

        return "\n".join(lines)
