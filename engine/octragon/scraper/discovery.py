"""
Octragon Competitor Discovery Engine (v2 — Creator Feed Strategy)

TikTok hashtag pages and Instagram Reels feeds are blocked by yt-dlp
(marked as broken). The reliable extraction path is:
  - TikTok: user profile pages (@creator) with session cookies
  - Instagram: individual Reel URLs (discovered via manual or API)
  - LinkedIn: skip automated discovery (use manual URL drops in Telegram)

This module uses CURATED NICHE CREATOR LISTS — viral accounts per niche
already known to perform. Their latest videos are pulled, scored, and
the best ones are surfaced to Telegram for easy one-tap scraping.
"""

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Optional

from loguru import logger

from octragon.config import OctragonConfig
from octragon.models import NicheType, SourcePlatform, TargetPlatform

# ─── Curated creator lists per niche ──────────────────────────────────────────
# These are real viral TikTok creators in each niche category.
# Update this list as new creators go viral.

NICHE_CREATORS: dict[NicheType, dict] = {
    NicheType.ECOM: {
        "tiktok": [
            "@hayden_bowles", "@rileybennett_", "@bashar.j",
            "@nick_theriot", "@davie504",  # fills for testing
            "@shopify", "@mybrandnew",
        ],
        "min_views": 80_000,
        "min_likes": 3_000,
        "videos_per_creator": 5,
    },
    NicheType.AI_TECH: {
        "tiktok": [
            "@mattgpt", "@sallysmith.ai", "@futurepedia.io",
            "@theaigrids", "@mr.beast",  # fills for testing
            "@openai", "@anthropic_ai",
        ],
        "min_views": 30_000,
        "min_likes": 1_000,
        "videos_per_creator": 5,
    },
    NicheType.BUSINESS: {
        "tiktok": [
            "@alexhormozi", "@garyvee", "@codie.sanchez",
            "@theblockstreet", "@ycombinator",
        ],
        "min_views": 50_000,
        "min_likes": 2_000,
        "videos_per_creator": 5,
    },
    NicheType.LIFESTYLE: {
        "tiktok": [
            "@callmesirron", "@matthewbault", "@yourlifebyyou",
            "@jessicaolie", "@markmanson_",
        ],
        "min_views": 150_000,
        "min_likes": 8_000,
        "videos_per_creator": 5,
    },
}


# ─── Video candidate ──────────────────────────────────────────────────────────

class VideoCandidate:
    def __init__(
        self,
        url: str,
        platform: SourcePlatform,
        creator: str,
        title: str,
        view_count: int,
        like_count: int,
        comment_count: int,
        share_count: int,
        duration: int,
        discovered_via: str,
        niche: NicheType,
        phone: int,
    ):
        self.url = url
        self.platform = platform
        self.creator = creator
        self.title = title
        self.view_count = view_count
        self.like_count = like_count
        self.comment_count = comment_count
        self.share_count = share_count
        self.duration = duration
        self.discovered_via = discovered_via
        self.niche = niche
        self.phone = phone
        self.url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "platform": self.platform.value,
            "creator": self.creator,
            "title": self.title,
            "view_count": self.view_count,
            "like_count": self.like_count,
            "comment_count": self.comment_count,
            "share_count": self.share_count,
            "duration": self.duration,
            "discovered_via": self.discovered_via,
            "niche": self.niche.value,
            "phone": self.phone,
        }


# ─── Discovery engine ─────────────────────────────────────────────────────────

class CompetitorDiscovery:
    """
    Pulls recent videos from curated niche creator profiles using yt-dlp.
    Works with session cookies for authenticated requests.
    """

    def __init__(self, config: OctragonConfig):
        self.config = config
        self._seen_hashes: set[str] = set()

    def _cookies_path(self, platform: str) -> Optional[str]:
        if not self.config.yt_dlp_cookies_dir:
            return None
        p = Path(self.config.yt_dlp_cookies_dir) / f"{platform}_cookies.txt"
        return str(p) if p.exists() else None

    async def _fetch_creator_videos(
        self,
        handle: str,
        platform: SourcePlatform,
        max_videos: int = 5,
        cookies_path: Optional[str] = None,
    ) -> list[dict]:
        """Fetch recent videos from a creator's profile using yt-dlp --dump-json."""
        if platform == SourcePlatform.TIKTOK:
            # Normalize: remove @ prefix for URL
            clean = handle.lstrip("@")
            url = f"https://www.tiktok.com/@{clean}"
        elif platform == SourcePlatform.INSTAGRAM:
            clean = handle.lstrip("@")
            url = f"https://www.instagram.com/{clean}/reels/"
        else:
            return []

        cmd = [
            "yt-dlp",
            "--skip-download",
            "--dump-json",
            "--playlist-end", str(max_videos),
            "--no-warnings",
            "--quiet",
        ]
        if cookies_path:
            cmd += ["--cookies", cookies_path]
        cmd.append(url)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=90)
        except asyncio.TimeoutError:
            logger.warning(f"[Discovery] Timeout fetching {handle}")
            return []

        results = []
        for line in stdout.decode(errors="replace").strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                results.append({
                    "url": data.get("webpage_url") or data.get("url", ""),
                    "creator": data.get("uploader") or data.get("creator") or handle,
                    "title": data.get("title") or data.get("description") or "",
                    "view_count": int(data.get("view_count") or 0),
                    "like_count": int(data.get("like_count") or 0),
                    "comment_count": int(data.get("comment_count") or 0),
                    "repost_count": int(data.get("repost_count") or data.get("share_count") or 0),
                    "duration": int(data.get("duration") or 0),
                })
            except (json.JSONDecodeError, ValueError):
                continue

        logger.info(f"[Discovery] {handle}: {len(results)} videos fetched")
        return results

    async def discover_creator(
        self,
        handle: str,
        platform: SourcePlatform,
        niche: NicheType,
        phone: int,
        targets: dict,
        cookies_path: Optional[str] = None,
    ) -> list[VideoCandidate]:
        """Fetch + filter videos from one creator."""
        max_v = targets.get("videos_per_creator", 5)
        raw = await self._fetch_creator_videos(handle, platform, max_v, cookies_path)

        candidates = []
        for item in raw:
            if not item["url"]:
                continue
            url_hash = hashlib.sha256(item["url"].encode()).hexdigest()[:16]
            if url_hash in self._seen_hashes:
                continue
            # Apply view threshold (relax by 50% for creator-feed since these are time-gated)
            min_views = targets.get("min_views", 50_000) // 2
            min_likes = targets.get("min_likes", 2_000) // 2
            if item["view_count"] < min_views and item["view_count"] > 0:
                continue
            if item["like_count"] < min_likes and item["like_count"] > 0:
                continue
            self._seen_hashes.add(url_hash)
            candidates.append(VideoCandidate(
                url=item["url"],
                platform=platform,
                creator=item["creator"],
                title=item["title"],
                view_count=item["view_count"],
                like_count=item["like_count"],
                comment_count=item["comment_count"],
                share_count=item["repost_count"],
                duration=item["duration"],
                discovered_via=f"{platform.value}_creator:{handle}",
                niche=niche,
                phone=phone,
            ))
        return candidates

    async def run_discovery_for_phone(
        self,
        phone: int,
        niche: NicheType,
        platforms: list[TargetPlatform],
    ) -> list["VideoCandidate"]:
        """Run all creator discovery tasks for a given phone/niche."""
        targets = NICHE_CREATORS.get(niche, {})
        creators = targets.get("tiktok", [])
        tiktok_cookies = self._cookies_path("tiktok")
        ig_cookies = self._cookies_path("instagram")

        tasks = []
        if TargetPlatform.TIKTOK in platforms:
            for handle in creators[:4]:  # max 4 creators per run
                tasks.append(self.discover_creator(
                    handle, SourcePlatform.TIKTOK, niche, phone, targets, tiktok_cookies
                ))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        all_candidates: list[VideoCandidate] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning(f"[Discovery] Creator task failed: {r}")
            else:
                all_candidates.extend(r)

        logger.info(f"[Discovery] Phone {phone} ({niche.value}): {len(all_candidates)} candidates")
        return all_candidates

    async def run_all_phones(
        self,
        niche_map: dict[int, tuple[NicheType, list[TargetPlatform]]],
    ) -> dict[int, list["VideoCandidate"]]:
        results = {}
        for phone, (niche, platforms) in niche_map.items():
            results[phone] = await self.run_discovery_for_phone(phone, niche, platforms)
        return results
