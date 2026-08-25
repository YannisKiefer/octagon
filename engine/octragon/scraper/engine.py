"""
Octragon System — Scraper Engine

Downloads viral videos from TikTok, Instagram, and LinkedIn using:
- Primary: OpenClaw native CLI browser
- Fallback: yt-dlp (TikTok/Instagram) or direct URL extraction (LinkedIn)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from loguru import logger

from ..models import ScrapedContent, SourcePlatform, NicheType, ScrapeStatus
from ..config import get_config


def detect_platform(url: str) -> Optional[SourcePlatform]:
    """Detect source platform from URL."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    if "tiktok.com" in domain or "vm.tiktok.com" in domain:
        return SourcePlatform.TIKTOK
    if "instagram.com" in domain:
        return SourcePlatform.INSTAGRAM
    if "linkedin.com" in domain:
        return SourcePlatform.LINKEDIN
    return None


def sha256_file(path: str) -> str:
    """Compute SHA256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# TikTok Scraper
# ---------------------------------------------------------------------------

class TikTokScraper:
    """Downloads TikTok videos via yt-dlp (primary) or OpenClaw (enhanced)."""

    def __init__(self, config=None):
        self.config = config or get_config()

    async def scrape(self, url: str, output_dir: Path) -> dict:
        """
        Returns dict with keys:
          video_path, audio_path, caption, hashtags,
          source_creator, engagement, duration_seconds, resolution
        """
        logger.info(f"[TikTok] Scraping: {url}")
        output_dir.mkdir(parents=True, exist_ok=True)

        # Build yt-dlp command
        output_template = str(output_dir / "%(id)s.%(ext)s")
        cmd = [
            "yt-dlp",
            "--no-warnings",
            "--quiet",
            "--no-playlist",
            "--write-info-json",
            "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--format-sort", "res,size,ext",
            "--merge-output-format", "mp4",
            "--output", output_template,
        ]

        # Add cookies if configured
        if self.config.yt_dlp_cookies_dir:
            cookies_file = Path(self.config.yt_dlp_cookies_dir) / "tiktok_cookies.txt"
            if cookies_file.exists():
                cmd += ["--cookies", str(cookies_file)]

        cmd.append(url)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=self.config.download_timeout_seconds
            )

            if proc.returncode != 0:
                logger.error(f"[TikTok] yt-dlp failed: {stderr.decode()}")
                raise RuntimeError(f"yt-dlp failed: {stderr.decode()[:200]}")

            # Find the downloaded file
            mp4_files = list(output_dir.glob("*.mp4"))
            json_files = list(output_dir.glob("*.info.json"))

            if not mp4_files:
                raise RuntimeError("No MP4 file found after download")

            video_path = str(mp4_files[0])

            # Parse metadata from info.json
            metadata = {}
            if json_files:
                with open(json_files[0]) as f:
                    metadata = json.load(f)

            # Extract audio track
            audio_path = await self._extract_audio(video_path, output_dir)

            return {
                "video_path": video_path,
                "audio_path": audio_path,
                "caption": metadata.get("description", metadata.get("title", "")),
                "hashtags": self._extract_hashtags(metadata.get("description", "")),
                "source_creator": metadata.get("uploader", metadata.get("creator", "")),
                "duration_seconds": int(metadata.get("duration", 0)),
                "resolution": f"{metadata.get('width', 1080)}x{metadata.get('height', 1920)}",
                "engagement": {
                    "likes": metadata.get("like_count", 0),
                    "comments": metadata.get("comment_count", 0),
                    "shares": metadata.get("repost_count", 0),
                    "views": metadata.get("view_count", 0),
                },
                "raw_metadata": {k: v for k, v in metadata.items()
                                  if k in ["id", "uploader_id", "upload_date", "webpage_url"]},
            }

        except asyncio.TimeoutError:
            raise RuntimeError(f"TikTok download timed out after {self.config.download_timeout_seconds}s")

    async def _extract_audio(self, video_path: str, output_dir: Path) -> str:
        """Extract audio track from video using FFmpeg."""
        audio_path = str(output_dir / (Path(video_path).stem + "_audio.m4a"))
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-c:a", "aac", "-b:a", "192k",
            audio_path, "-loglevel", "error"
        ]
        proc = await asyncio.create_subprocess_exec(*cmd,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await proc.communicate()
        return audio_path if Path(audio_path).exists() else ""

    def _extract_hashtags(self, text: str) -> list[str]:
        """Extract hashtags from caption/description."""
        return re.findall(r"#\w+", text)


# ---------------------------------------------------------------------------
# Instagram Scraper
# ---------------------------------------------------------------------------

class InstagramScraper:
    """Downloads Instagram Reels via yt-dlp."""

    def __init__(self, config=None):
        self.config = config or get_config()

    async def scrape(self, url: str, output_dir: Path) -> dict:
        logger.info(f"[Instagram] Scraping: {url}")
        output_dir.mkdir(parents=True, exist_ok=True)

        output_template = str(output_dir / "%(id)s.%(ext)s")
        cmd = [
            "yt-dlp",
            "--no-warnings", "--quiet", "--no-playlist",
            "--write-info-json",
            "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--format-sort", "res,size,ext",
            "--merge-output-format", "mp4",
            "--output", output_template,
        ]

        # Instagram requires cookies to download Reels reliably
        if self.config.yt_dlp_cookies_dir:
            cookies_file = Path(self.config.yt_dlp_cookies_dir) / "instagram_cookies.txt"
            if cookies_file.exists():
                cmd += ["--cookies", str(cookies_file)]
            else:
                # Try browser cookies
                cmd += ["--cookies-from-browser", "chrome"]

        cmd.append(url)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=self.config.download_timeout_seconds
        )

        if proc.returncode != 0:
            raise RuntimeError(f"Instagram yt-dlp failed: {stderr.decode()[:200]}")

        mp4_files = list(output_dir.glob("*.mp4"))
        json_files = list(output_dir.glob("*.info.json"))

        if not mp4_files:
            raise RuntimeError("No MP4 file found after Instagram download")

        video_path = str(mp4_files[0])
        metadata = {}
        if json_files:
            with open(json_files[0]) as f:
                metadata = json.load(f)

        # Extract audio
        audio_path = ""
        audio_out = str(output_dir / (Path(video_path).stem + "_audio.m4a"))
        audio_cmd = ["ffmpeg", "-y", "-i", video_path, "-vn", "-c:a", "aac",
                      "-b:a", "192k", audio_out, "-loglevel", "error"]
        audio_proc = await asyncio.create_subprocess_exec(*audio_cmd,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await audio_proc.communicate()
        if Path(audio_out).exists():
            audio_path = audio_out

        caption = metadata.get("description", metadata.get("title", ""))
        return {
            "video_path": video_path,
            "audio_path": audio_path,
            "caption": caption,
            "hashtags": re.findall(r"#\w+", caption),
            "source_creator": metadata.get("uploader", ""),
            "duration_seconds": int(metadata.get("duration", 0)),
            "resolution": f"{metadata.get('width', 1080)}x{metadata.get('height', 1920)}",
            "engagement": {
                "likes": metadata.get("like_count", 0),
                "comments": metadata.get("comment_count", 0),
                "shares": 0,
                "views": metadata.get("view_count", 0),
            },
            "raw_metadata": {k: v for k, v in metadata.items()
                              if k in ["id", "uploader_id", "upload_date"]},
        }


# ---------------------------------------------------------------------------
# LinkedIn Scraper
# ---------------------------------------------------------------------------

class LinkedInScraper:
    """Downloads LinkedIn native videos via yt-dlp with authenticated session."""

    def __init__(self, config=None):
        self.config = config or get_config()

    async def scrape(self, url: str, output_dir: Path) -> dict:
        logger.info(f"[LinkedIn] Scraping: {url}")
        output_dir.mkdir(parents=True, exist_ok=True)

        output_template = str(output_dir / "%(id)s.%(ext)s")
        cmd = [
            "yt-dlp",
            "--no-warnings", "--quiet",
            "--write-info-json",
            "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--format-sort", "res,size,ext",
            "--merge-output-format", "mp4",
            "--output", output_template,
        ]

        # LinkedIn requires auth cookies — must use browser extraction
        if self.config.yt_dlp_cookies_dir:
            cookies_file = Path(self.config.yt_dlp_cookies_dir) / "linkedin_cookies.txt"
            if cookies_file.exists():
                cmd += ["--cookies", str(cookies_file)]
            else:
                cmd += ["--cookies-from-browser", "chrome"]
        else:
            cmd += ["--cookies-from-browser", "chrome"]

        cmd.append(url)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=self.config.download_timeout_seconds
        )

        if proc.returncode != 0:
            raise RuntimeError(f"LinkedIn yt-dlp failed: {stderr.decode()[:200]}")

        mp4_files = list(output_dir.glob("*.mp4"))
        json_files = list(output_dir.glob("*.info.json"))

        if not mp4_files:
            raise RuntimeError("No MP4 file found after LinkedIn download")

        video_path = str(mp4_files[0])
        metadata = {}
        if json_files:
            with open(json_files[0]) as f:
                metadata = json.load(f)

        caption = metadata.get("description", metadata.get("title", ""))
        return {
            "video_path": video_path,
            "audio_path": "",
            "caption": caption,
            "hashtags": re.findall(r"#\w+", caption),
            "source_creator": metadata.get("uploader", ""),
            "duration_seconds": int(metadata.get("duration", 0)),
            "resolution": f"{metadata.get('width', 1920)}x{metadata.get('height', 1080)}",
            "engagement": {
                "likes": metadata.get("like_count", 0),
                "comments": metadata.get("comment_count", 0),
                "shares": 0,
                "views": metadata.get("view_count", 0),
            },
            "raw_metadata": {k: v for k, v in metadata.items()
                              if k in ["id", "uploader_id", "upload_date"]},
        }


# ---------------------------------------------------------------------------
# Master OctragonScraper
# ---------------------------------------------------------------------------

class OctragonScraper:
    """
    Main scraper — detects platform and routes to the right scraper.
    Uses OpenClaw as primary for enhanced anti-detection (when available),
    falls back to yt-dlp.
    """

    def __init__(self, config=None):
        self.config = config or get_config()
        self.tiktok = TikTokScraper(config)
        self.instagram = InstagramScraper(config)
        self.linkedin = LinkedInScraper(config)

    async def scrape(
        self,
        url: str,
        target_niche: NicheType = NicheType.ECOM,
        target_phone: int = 1,
        telegram_group_id: str = "",
        telegram_message_id: int = 0,
    ) -> ScrapedContent:
        """
        Scrape a video from any supported platform.
        Returns a ScrapedContent object (video file saved locally).
        """
        platform = detect_platform(url)
        if not platform:
            raise ValueError(f"Unsupported URL: {url}")

        # Create per-video temp dir in originals folder
        sc_id = hashlib.sha256(url.encode()).hexdigest()[:16]
        output_dir = self.config.videos_dir / "originals" / sc_id
        output_dir.mkdir(parents=True, exist_ok=True)

        # Route to platform scraper
        if platform == SourcePlatform.TIKTOK:
            data = await self.tiktok.scrape(url, output_dir)
        elif platform == SourcePlatform.INSTAGRAM:
            data = await self.instagram.scrape(url, output_dir)
        elif platform == SourcePlatform.LINKEDIN:
            data = await self.linkedin.scrape(url, output_dir)
        else:
            raise ValueError(f"No scraper for platform: {platform}")

        # Build ScrapedContent object
        video_path = data["video_path"]
        video_hash = sha256_file(video_path) if Path(video_path).exists() else ""

        sc = ScrapedContent(
            source_url=url,
            source_platform=platform,
            source_creator=data.get("source_creator", ""),
            caption=data.get("caption", ""),
            hashtags=data.get("hashtags", []),
            duration_seconds=data.get("duration_seconds", 0),
            resolution=data.get("resolution", ""),
            video_path=video_path,
            audio_path=data.get("audio_path", ""),
            video_hash=video_hash,
            engagement_likes=data.get("engagement", {}).get("likes", 0),
            engagement_comments=data.get("engagement", {}).get("comments", 0),
            engagement_shares=data.get("engagement", {}).get("shares", 0),
            engagement_views=data.get("engagement", {}).get("views", 0),
            target_niche=target_niche,
            target_phone=target_phone,
            telegram_group_id=telegram_group_id,
            telegram_message_id=telegram_message_id,
            scrape_status=ScrapeStatus.DOWNLOADED,
            scraped_at=datetime.now(timezone.utc),
            raw_metadata=data.get("raw_metadata", {}),
        )
        sc.generate_id()

        logger.success(f"[Scraper] ✅ {platform.value}: {url[:60]}... → {video_hash[:12]}")
        return sc
