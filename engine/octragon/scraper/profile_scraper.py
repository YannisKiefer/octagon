"""
Octragon — Account Profile Scraper

Scrapes profile data (avatar, bio, follower count, verified status) for all
20 accounts using httpx + HTML parsing. Extends RadarScanner patterns.

Platforms:
  - TikTok: SIGI_STATE userInfo parsing
  - Instagram: og:image + JSON-LD
  - X/Twitter: og:image + meta tags
  - LinkedIn: graceful skip (requires auth)
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from octragon.config import get_config, OctragonConfig
from octragon.scraper.radar import USER_AGENTS, _extract_sigi_state, _extract_meta_content, _parse_count


class ProfileScraper:
    """Scrape profile metadata for Octragon accounts."""

    def __init__(self, config: Optional[OctragonConfig] = None):
        self.config = config or get_config()
        self.avatars_dir = self.config.data_dir / "avatars"
        self.avatars_dir.mkdir(parents=True, exist_ok=True)
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            import random
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=10.0),
                follow_redirects=True,
                headers={
                    "User-Agent": random.choice(USER_AGENTS),
                    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
        return self._client

    async def scrape_tiktok_profile(self, handle: str) -> dict:
        """Parse TikTok profile for avatar, bio, follower count."""
        client = await self._get_client()
        clean = handle.lstrip("@")
        url = f"https://www.tiktok.com/@{clean}"

        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}
            html = resp.text
        except httpx.HTTPError as e:
            return {"error": str(e)}

        result = {"platform": "tiktok", "handle": clean}

        # Parse SIGI_STATE for user info
        state = _extract_sigi_state(html)
        if state:
            default_scope = state.get("__DEFAULT_SCOPE__", {})
            user_detail = default_scope.get("webapp.user-detail", {})
            user_info = user_detail.get("userInfo", {}).get("user", {})
            user_stats = user_detail.get("userInfo", {}).get("stats", {})

            if user_info:
                result.update({
                    "display_name": user_info.get("nickname", ""),
                    "bio": user_info.get("signature", ""),
                    "avatar_url": user_info.get("avatarLarger", user_info.get("avatarMedium", "")),
                    "verified": user_info.get("verified", False),
                })
            if user_stats:
                result.update({
                    "follower_count": int(user_stats.get("followerCount", 0)),
                    "following_count": int(user_stats.get("followingCount", 0)),
                    "like_count": int(user_stats.get("heartCount", 0)),
                    "video_count": int(user_stats.get("videoCount", 0)),
                })

        # Fallback: meta tags
        if "avatar_url" not in result:
            result["avatar_url"] = _extract_meta_content(html, "image")
        if "bio" not in result:
            result["bio"] = _extract_meta_content(html, "description")

        return result

    async def scrape_instagram_profile(self, handle: str) -> dict:
        """Parse Instagram profile (limited — mostly meta tags)."""
        client = await self._get_client()
        clean = handle.lstrip("@")
        url = f"https://www.instagram.com/{clean}/"

        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}
            html = resp.text
        except httpx.HTTPError as e:
            return {"error": str(e)}

        result = {"platform": "instagram", "handle": clean}
        result["avatar_url"] = _extract_meta_content(html, "image")
        result["bio"] = _extract_meta_content(html, "description")

        # Try to parse follower count from description meta
        desc = result.get("bio", "")
        follower_match = re.search(r'([\d,.]+[KMB]?)\s*Followers', desc, re.IGNORECASE)
        if follower_match:
            result["follower_count"] = _parse_count(follower_match.group(1))

        return result

    async def scrape_twitter_profile(self, handle: str) -> dict:
        """Parse X/Twitter profile (limited without auth)."""
        client = await self._get_client()
        clean = handle.lstrip("@")
        url = f"https://x.com/{clean}"

        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}
            html = resp.text
        except httpx.HTTPError as e:
            return {"error": str(e)}

        result = {"platform": "twitter", "handle": clean}
        result["avatar_url"] = _extract_meta_content(html, "image")
        result["bio"] = _extract_meta_content(html, "description")

        return result

    async def scrape_linkedin_profile(self, handle: str) -> dict:
        """LinkedIn requires auth — returns placeholder."""
        return {
            "platform": "linkedin",
            "handle": handle.lstrip("@"),
            "error": "LinkedIn requires authenticated session — manual entry needed",
        }

    async def download_avatar(self, account_id: str, avatar_url: str) -> Optional[str]:
        """Download avatar image and save locally."""
        if not avatar_url or avatar_url.startswith("data:"):
            return None

        client = await self._get_client()
        try:
            resp = await client.get(avatar_url)
            if resp.status_code != 200:
                return None

            ext = "jpg"
            ct = resp.headers.get("content-type", "")
            if "png" in ct:
                ext = "png"
            elif "webp" in ct:
                ext = "webp"

            path = self.avatars_dir / f"{account_id}.{ext}"
            path.write_bytes(resp.content)
            logger.info(f"[Profile] Downloaded avatar for {account_id} → {path.name}")
            return str(path)
        except Exception as e:
            logger.warning(f"[Profile] Avatar download failed: {e}")
            return None

    async def scrape_account(self, account) -> dict:
        """Scrape profile for a single account."""
        platform = account.platform.value
        handle = account.handle

        if platform == "tiktok":
            return await self.scrape_tiktok_profile(handle)
        elif platform == "instagram":
            return await self.scrape_instagram_profile(handle)
        elif platform == "twitter":
            return await self.scrape_twitter_profile(handle)
        elif platform == "linkedin":
            return await self.scrape_linkedin_profile(handle)
        else:
            return {"error": f"Unknown platform: {platform}"}

    async def scrape_all_accounts(self) -> dict:
        """Scrape profiles for all 20 accounts. Returns summary."""
        from octragon.db import OctragonDB
        db = OctragonDB()
        accounts = db.get_all_accounts()

        results = {"success": 0, "failed": 0, "skipped": 0}

        for acct in accounts:
            logger.info(f"[Profile] Scraping {acct.platform.value}/@{acct.handle}...")
            profile = await self.scrape_account(acct)

            if "error" in profile:
                logger.warning(f"[Profile] {acct.handle}: {profile['error']}")
                results["failed"] += 1
                continue

            # Download avatar
            avatar_path = None
            if profile.get("avatar_url"):
                avatar_path = await self.download_avatar(acct.id, profile["avatar_url"])

            # Update DB
            db.conn.execute("""
                UPDATE accounts SET
                    display_name = COALESCE(NULLIF(?, ''), display_name),
                    bio = COALESCE(?, bio),
                    avatar_url = COALESCE(?, avatar_url),
                    follower_count = CASE WHEN ? > 0 THEN ? ELSE follower_count END
                WHERE id = ?
            """, (
                profile.get("display_name", ""),
                profile.get("bio", ""),
                avatar_path or profile.get("avatar_url", ""),
                profile.get("follower_count", 0),
                profile.get("follower_count", 0),
                acct.id,
            ))
            db.conn.commit()
            results["success"] += 1

            # Rate limit: 1 second between requests
            await asyncio.sleep(1)

        db.close()
        logger.info(f"[Profile] Done: {results}")
        return results

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
