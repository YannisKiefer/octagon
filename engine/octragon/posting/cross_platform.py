"""
Octragon Cross-Platform Reposting Engine

Handles the logic for reposting viral content across platforms:
  - TikTok viral → different variation for Instagram
  - Instagram viral → different variation for TikTok
  - High-score content → queue for Twitter/LinkedIn (text adaptation)

Rules:
  1. NEVER use the same variation on the same platform
  2. Minimum 2-hour gap between cross-platform posts of same content
  3. Different caption per platform (via CaptionEngine)
  4. Different hashtag set per platform
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from loguru import logger

from octragon.config import OctragonConfig, get_config


# ─── Constants ────────────────────────────────────────────────────────────────

MIN_SCORE_FOR_CROSS_PLATFORM = 70   # virality score threshold
MIN_GAP_HOURS = 2                    # minimum gap between cross-platform posts
PLATFORM_VARIATION_MAP = {
    # original_platform → cross_post_platform → preferred variation index
    "tiktok":    {"instagram": 1, "twitter": 2},
    "instagram": {"tiktok": 0,    "twitter": 2},
    "twitter":   {"tiktok": 0,    "instagram": 1},
}

# Platform-specific caption guidelines
PLATFORM_CAPTION_STYLE = {
    "tiktok": {
        "max_length": 150,
        "hashtag_count": 4,
        "style": "short_punchy",
        "cta": False,
    },
    "instagram": {
        "max_length": 2200,
        "hashtag_count": 15,
        "style": "storytelling",
        "cta": True,
    },
    "twitter": {
        "max_length": 280,
        "hashtag_count": 2,
        "style": "hook_only",
        "cta": False,
    },
    "linkedin": {
        "max_length": 3000,
        "hashtag_count": 5,
        "style": "professional",
        "cta": True,
    },
}


class CrossPlatformEngine:
    """Manages cross-platform content reuse and deduplication."""

    def __init__(self, db, config: Optional[OctragonConfig] = None):
        self.db = db
        self.config = config or get_config()

    def find_cross_platform_candidates(self, date: str) -> list[dict]:
        """
        Find content in today's posting queue that qualifies for cross-platform reuse.

        Returns list of cross-platform posting suggestions.
        """
        queue = self.db.get_posting_queue_for_date(date)
        suggestions = []

        for item in queue:
            virality = item.get("priority", 5)
            # Lower priority number = higher score (1 is best)
            if virality > 3:
                continue

            original_platform = item.get("platform", "")
            scraped_content_id = item.get("scraped_content_id", "")
            time_slot = item.get("time_slot", "07:00")

            # Get cross-platform targets
            targets = PLATFORM_VARIATION_MAP.get(original_platform, {})

            for target_platform, preferred_var_idx in targets.items():
                # Check if already queued for this platform + content combo
                if self._is_already_queued(scraped_content_id, target_platform, date):
                    continue

                # Find an unused variation for this content
                variation_id = self._find_unused_variation(
                    scraped_content_id, target_platform, preferred_var_idx
                )
                if not variation_id:
                    continue

                # Calculate time slot (at least MIN_GAP_HOURS later)
                cross_time = self._calculate_cross_time(time_slot)

                suggestions.append({
                    "scraped_content_id": scraped_content_id,
                    "variation_id": variation_id,
                    "source_platform": original_platform,
                    "target_platform": target_platform,
                    "time_slot": cross_time,
                    "original_post_id": item.get("id", ""),
                })

        logger.info(f"[CrossPlatform] Found {len(suggestions)} cross-platform candidates for {date}")
        return suggestions

    def apply_cross_platform_queue(self, date: str) -> int:
        """
        Find and queue all cross-platform reposts for a given date.

        Returns number of cross-platform items added.
        """
        candidates = self.find_cross_platform_candidates(date)
        created = 0

        for candidate in candidates:
            # Find a matching account on the target platform
            target_account = self._find_account_for_platform(
                candidate["target_platform"],
                candidate["scraped_content_id"],
            )
            if not target_account:
                continue

            acc_id = target_account.id if hasattr(target_account, 'id') else target_account.get("id", "")

            try:
                self.db.create_posting_item(
                    account_id=acc_id,
                    scraped_content_id=candidate["scraped_content_id"],
                    variation_id=candidate["variation_id"],
                    platform=candidate["target_platform"],
                    date=date,
                    time_slot=candidate["time_slot"],
                    priority=2,  # slightly lower than original
                    cross_platform_source=candidate["original_post_id"],
                )
                created += 1
            except Exception as e:
                logger.warning(f"[CrossPlatform] Failed to queue: {e}")

        logger.info(f"[CrossPlatform] Queued {created} cross-platform posts for {date}")
        return created

    def _is_already_queued(self, scraped_content_id: str, platform: str, date: str) -> bool:
        """Check if this content is already queued for this platform today."""
        try:
            result = self.db.client.table("posting_queue") \
                .select("id", count="exact") \
                .eq("scraped_content_id", scraped_content_id) \
                .eq("platform", platform) \
                .eq("date", date) \
                .execute()
            return (result.count or 0) > 0
        except Exception:
            return False

    def _find_unused_variation(self, scraped_content_id: str, target_platform: str,
                                preferred_idx: int) -> Optional[str]:
        """Find a variation of this content not yet used on the target platform."""
        try:
            # Get all variations for this content
            result = self.db.client.table("video_variations") \
                .select("id, variation_index") \
                .eq("scraped_content_id", scraped_content_id) \
                .eq("cleanse_status", "done") \
                .execute()

            if not result.data:
                return None

            # Get already-used variation IDs on this platform
            used = self.db.client.table("posting_queue") \
                .select("variation_id") \
                .eq("scraped_content_id", scraped_content_id) \
                .eq("platform", target_platform) \
                .execute()

            used_ids = {r.get("variation_id") for r in (used.data or [])}

            # Prefer the requested variation index, fall back to any available
            available = [v for v in result.data if v["id"] not in used_ids]
            if not available:
                return None

            # Try preferred index first
            for v in available:
                if v.get("variation_index") == preferred_idx:
                    return v["id"]

            return available[0]["id"]

        except Exception:
            return None

    def _calculate_cross_time(self, original_time: str) -> str:
        """Calculate cross-platform posting time (at least MIN_GAP_HOURS later)."""
        try:
            hour, minute = map(int, original_time.split(":"))
            cross_hour = hour + MIN_GAP_HOURS
            if cross_hour >= 22:  # don't post after 10 PM
                cross_hour = 22
            return f"{cross_hour:02d}:{minute:02d}"
        except (ValueError, AttributeError):
            return "19:00"

    def _find_account_for_platform(self, platform: str, scraped_content_id: str):
        """Find an account on the target platform in the same niche as the content."""
        try:
            # Get content niche
            sc = self.db.client.table("scraped_content") \
                .select("target_niche") \
                .eq("id", scraped_content_id) \
                .single() \
                .execute()

            target_niche = sc.data.get("target_niche", "ecom") if sc.data else "ecom"

            # Find account on target platform for this niche
            accounts = self.db.get_all_accounts()
            for acc in accounts:
                acc_platform = acc.platform.value if hasattr(acc.platform, 'value') else str(acc.get("platform", ""))
                acc_niche = acc.niche.value if hasattr(acc.niche, 'value') else str(acc.get("niche", ""))
                acc_active = acc.active if hasattr(acc, 'active') else acc.get("active", False)

                if acc_platform == platform and acc_niche == target_niche and acc_active:
                    return acc
            return None

        except Exception:
            return None

    @staticmethod
    def get_caption_style(platform: str) -> dict:
        """Get platform-specific caption guidelines."""
        return PLATFORM_CAPTION_STYLE.get(platform, PLATFORM_CAPTION_STYLE["tiktok"])
