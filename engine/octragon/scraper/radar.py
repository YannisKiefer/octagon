"""
Octragon System — Radar Scanner (Lightweight Mass Discovery)

Fast, non-downloading scan of competitor accounts using httpx + HTML parsing.
10x faster than yt-dlp --dump-json because it:
  - Doesn't resolve video URLs
  - Doesn't extract full metadata
  - Just grabs: title, view count, like count, duration from HTML/JSON-LD

Falls back gracefully when platforms block scraping.
Feeds candidates into the existing scorer.py pipeline.

Usage:
    radar = RadarScanner(config)
    candidates = await radar.scan_creator("@alexhormozi", SourcePlatform.TIKTOK, ...)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from typing import Optional
from urllib.parse import quote

import httpx
from loguru import logger

from octragon.config import OctragonConfig, get_config
from octragon.models import NicheType, SourcePlatform, TargetPlatform
from octragon.scraper.discovery import VideoCandidate, NICHE_CREATORS

# ── User agents ────────────────────────────────────────────────────────────

USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

# ── HTML parsing helpers ───────────────────────────────────────────────────

def _extract_json_ld(html: str) -> list[dict]:
    """Extract JSON-LD structured data from HTML."""
    results = []
    for match in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.DOTALL
    ):
        try:
            data = json.loads(match.group(1))
            if isinstance(data, list):
                results.extend(data)
            else:
                results.append(data)
        except json.JSONDecodeError:
            continue
    return results


def _extract_sigi_state(html: str) -> dict:
    """Extract TikTok's SIGI_STATE (server-rendered data) from HTML."""
    match = re.search(
        r'<script[^>]*id=["\']__UNIVERSAL_DATA_FOR_REHYDRATION__["\'][^>]*>(.*?)</script>',
        html, re.DOTALL
    )
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Fallback: older TikTok SIGI_STATE format
    match = re.search(
        r'<script[^>]*id=["\']SIGI_STATE["\'][^>]*>(.*?)</script>',
        html, re.DOTALL
    )
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    return {}


def _extract_meta_content(html: str, property_name: str) -> str:
    """Extract content from a meta tag by property or name."""
    pattern = rf'<meta\s+(?:property|name)=["\'](?:og:)?{re.escape(property_name)}["\'][^>]*content=["\']([^"\']*)["\']'
    match = re.search(pattern, html, re.IGNORECASE)
    if match:
        return match.group(1)
    # Try reversed attribute order
    pattern2 = rf'<meta\s+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\'](?:og:)?{re.escape(property_name)}["\']'
    match2 = re.search(pattern2, html, re.IGNORECASE)
    return match2.group(1) if match2 else ""


def _parse_count(text: str) -> int:
    """Parse human-readable counts like '1.2M', '45K', '892'."""
    if not text:
        return 0
    text = text.strip().upper().replace(",", "")
    multipliers = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
    for suffix, mult in multipliers.items():
        if text.endswith(suffix):
            try:
                return int(float(text[:-1]) * mult)
            except ValueError:
                return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


# ── TikTok HTML parser ────────────────────────────────────────────────────

def _parse_tiktok_profile(html: str, handle: str) -> list[dict]:
    """Parse TikTok profile page HTML for video URLs and engagement."""
    videos = []

    # Method 1: Parse SIGI_STATE / UNIVERSAL_DATA
    state = _extract_sigi_state(html)
    if state:
        # Navigate TikTok's nested state structure
        item_list = None

        # Try __DEFAULT_SCOPE__ path (modern TikTok)
        default_scope = state.get("__DEFAULT_SCOPE__", {})
        user_detail = default_scope.get("webapp.user-detail", {})
        if user_detail:
            item_list = user_detail.get("userInfo", {}).get("itemList", [])

        # Try ItemModule path (older TikTok)
        if not item_list:
            item_module = state.get("ItemModule", {})
            if item_module:
                item_list = list(item_module.values())

        if item_list:
            for item in item_list[:10]:
                video_id = item.get("id", "")
                if not video_id:
                    continue
                stats = item.get("stats", {})
                videos.append({
                    "url": f"https://www.tiktok.com/@{handle.lstrip('@')}/video/{video_id}",
                    "title": item.get("desc", ""),
                    "view_count": int(stats.get("playCount", 0)),
                    "like_count": int(stats.get("diggCount", 0)),
                    "comment_count": int(stats.get("commentCount", 0)),
                    "share_count": int(stats.get("shareCount", 0)),
                    "duration": int(item.get("video", {}).get("duration", 0)),
                })

    # Method 2: Fallback to JSON-LD
    if not videos:
        for ld in _extract_json_ld(html):
            if ld.get("@type") == "VideoObject":
                videos.append({
                    "url": ld.get("url", ""),
                    "title": ld.get("name", ld.get("description", "")),
                    "view_count": _parse_count(str(ld.get("interactionStatistic", [{}])[0].get("userInteractionCount", 0))) if ld.get("interactionStatistic") else 0,
                    "like_count": 0,
                    "comment_count": 0,
                    "share_count": 0,
                    "duration": 0,
                })

    # Method 3: Regex fallback for video links
    if not videos:
        for match in re.finditer(
            r'href=["\']/([@\w.-]+)/video/(\d+)["\']', html
        ):
            creator, vid_id = match.group(1), match.group(2)
            videos.append({
                "url": f"https://www.tiktok.com/@{creator}/video/{vid_id}",
                "title": "",
                "view_count": 0,
                "like_count": 0,
                "comment_count": 0,
                "share_count": 0,
                "duration": 0,
            })

    return videos


# ── RadarScanner ──────────────────────────────────────────────────────────

class RadarScanner:
    """
    Lightweight mass scanner for competitor accounts.

    Unlike the full discovery engine (yt-dlp --dump-json, slow):
    - Uses httpx for raw HTML fetches (fast, parallel)
    - Parses video data from embedded JSON / meta tags
    - Doesn't download any video files
    - Feeds candidates into the scorer pipeline
    """

    def __init__(self, config: Optional[OctragonConfig] = None):
        self.config = config or get_config()
        self._seen: set[str] = set()
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            import random
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=10.0),
                follow_redirects=True,
                headers={
                    "User-Agent": random.choice(USER_AGENTS),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
        return self._client

    async def scan_creator(
        self,
        handle: str,
        platform: SourcePlatform,
        niche: NicheType,
        phone: int,
        min_views: int = 50_000,
        min_likes: int = 2_000,
        max_videos: int = 8,
    ) -> list[VideoCandidate]:
        """
        Fast scan of a creator's profile page.
        Returns scored VideoCandidate objects without downloading anything.
        """
        client = await self._get_client()
        clean = handle.lstrip("@")

        if platform == SourcePlatform.TIKTOK:
            url = f"https://www.tiktok.com/@{clean}"
        elif platform == SourcePlatform.INSTAGRAM:
            url = f"https://www.instagram.com/{clean}/reels/"
        else:
            return []

        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning(f"[Radar] {handle}: HTTP {resp.status_code}")
                return []
            html = resp.text
        except httpx.HTTPError as e:
            logger.warning(f"[Radar] {handle}: {e}")
            return []

        # Parse based on platform
        if platform == SourcePlatform.TIKTOK:
            raw_videos = _parse_tiktok_profile(html, handle)
        else:
            # Instagram profile parsing (meta tags fallback)
            raw_videos = []
            for ld in _extract_json_ld(html):
                if ld.get("@type") in ("VideoObject", "MediaObject"):
                    raw_videos.append({
                        "url": ld.get("url", ""),
                        "title": ld.get("name", ""),
                        "view_count": 0,
                        "like_count": 0,
                        "comment_count": 0,
                        "share_count": 0,
                        "duration": 0,
                    })

        # Filter and convert to VideoCandidate
        candidates = []
        for v in raw_videos[:max_videos]:
            if not v.get("url"):
                continue
            url_hash = hashlib.sha256(v["url"].encode()).hexdigest()[:16]
            if url_hash in self._seen:
                continue

            # Apply view/like threshold (relaxed by 50% since we're radar scanning)
            if v["view_count"] > 0 and v["view_count"] < min_views // 2:
                continue
            if v["like_count"] > 0 and v["like_count"] < min_likes // 2:
                continue

            self._seen.add(url_hash)
            candidates.append(VideoCandidate(
                url=v["url"],
                platform=platform,
                creator=clean,
                title=v.get("title", ""),
                view_count=v.get("view_count", 0),
                like_count=v.get("like_count", 0),
                comment_count=v.get("comment_count", 0),
                share_count=v.get("share_count", 0),
                duration=v.get("duration", 0),
                discovered_via=f"radar:{platform.value}:{handle}",
                niche=niche,
                phone=phone,
            ))

        logger.info(f"[Radar] {handle}: {len(candidates)} candidates from {len(raw_videos)} found")
        return candidates

    async def sweep_niche(
        self,
        phone: int,
        niche: NicheType,
        platforms: list[TargetPlatform],
    ) -> list[VideoCandidate]:
        """Sweep all curated creators for a niche. Parallel for speed."""
        targets = NICHE_CREATORS.get(niche, {})
        creators = targets.get("tiktok", [])
        min_views = targets.get("min_views", 50_000)
        min_likes = targets.get("min_likes", 2_000)

        tasks = []
        if TargetPlatform.TIKTOK in platforms:
            for handle in creators[:6]:  # Max 6 per sweep
                tasks.append(
                    self.scan_creator(
                        handle, SourcePlatform.TIKTOK, niche, phone,
                        min_views=min_views, min_likes=min_likes,
                    )
                )

        results = await asyncio.gather(*tasks, return_exceptions=True)
        all_candidates: list[VideoCandidate] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning(f"[Radar] Sweep error: {r}")
            else:
                all_candidates.extend(r)

        logger.info(f"[Radar] Phone {phone} ({niche.value}): {len(all_candidates)} total candidates")
        return all_candidates

    async def sweep_all_phones(
        self,
        niche_map: Optional[dict] = None,
    ) -> dict[int, list[VideoCandidate]]:
        """Run radar sweep across all 4 phones. Returns phone → candidates."""
        from octragon.scraper.scheduler import NICHE_MAP
        if niche_map is None:
            niche_map = NICHE_MAP

        results = {}
        for phone, (niche, platforms) in niche_map.items():
            try:
                results[phone] = await self.sweep_niche(phone, niche, platforms)
            except Exception as e:
                logger.exception(f"[Radar] Phone {phone} sweep failed: {e}")
                results[phone] = []
        return results

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
