"""
TikTok Content Posting API v2 Uploader

Uses TikTok's official Content Posting API for direct video upload.
Supports both FILE_UPLOAD (direct) and PULL_FROM_URL modes.

API: https://developers.tiktok.com/doc/content-posting-api-get-started/

Requires:
  - TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (oauth2 app credentials)
  - Per-account access tokens stored in the DB / env
"""

import asyncio
import json
import mimetypes
import os
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from octragon.config import OctragonConfig

TIKTOK_UPLOAD_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"
TIKTOK_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
TIKTOK_CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"
CHUNK_SIZE = 10 * 1024 * 1024  # 10 MB


class TikTokUploader:
    """
    Uploads a video file to TikTok using the Content Posting API v2.
    Uses FILE_UPLOAD (direct binary) for videos under 4 GB.
    """

    def __init__(self, config: OctragonConfig, access_token: str):
        self.config = config
        self.access_token = access_token
        self.client = httpx.AsyncClient(timeout=120)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json; charset=UTF-8",
        }

    async def query_creator_info(self) -> Optional[dict]:
        """Query creator info to check privacy levels and upload capabilities."""
        try:
            resp = await self.client.post(
                TIKTOK_CREATOR_INFO_URL,
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", {})
        except Exception as e:
            logger.error(f"[TikTok] Creator info query failed: {e}")
            return None

    async def upload_video(
        self,
        video_path: str,
        caption: str,
        privacy_level: str = "SELF_ONLY",  # Start with SELF_ONLY for safety
        disable_comment: bool = False,
        disable_duet: bool = True,
        disable_stitch: bool = True,
        hashtags: Optional[list[str]] = None,
    ) -> Optional[dict]:
        """
        Upload a video to TikTok using FILE_UPLOAD mode.
        Returns publish_id and status if successful.

        privacy_level options:
          SELF_ONLY   — only visible to creator (safe default / review mode)
          FRIENDS_ONLY
          MUTUAL_FOLLOW_FRIENDS
          PUBLIC_TO_EVERYONE
        """
        path = Path(video_path)
        if not path.exists():
            logger.error(f"[TikTok] Video not found: {video_path}")
            return None

        file_size = path.stat().st_size
        chunk_count = max(1, (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE)

        # Build caption with hashtags
        full_caption = caption
        if hashtags:
            tag_str = " ".join(f"#{t.lstrip('#')}" for t in hashtags[:5])
            full_caption = f"{caption} {tag_str}"

        # Step 1: Initialize upload
        init_payload = {
            "post_info": {
                "title": full_caption[:2200],
                "privacy_level": privacy_level,
                "disable_comment": disable_comment,
                "disable_duet": disable_duet,
                "disable_stitch": disable_stitch,
                "video_cover_timestamp_ms": 1000,
            },
            "source_info": {
                "source": "FILE_UPLOAD",
                "video_size": file_size,
                "chunk_size": min(CHUNK_SIZE, file_size),
                "total_chunk_count": chunk_count,
            },
        }

        logger.info(f"[TikTok] Initializing upload: {path.name} ({file_size/1e6:.1f} MB)")
        try:
            resp = await self.client.post(
                TIKTOK_UPLOAD_URL,
                headers=self._headers(),
                json=init_payload,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(f"[TikTok] Init failed ({e.response.status_code}): {e.response.text}")
            return None

        init_data = resp.json().get("data", {})
        publish_id = init_data.get("publish_id")
        upload_url = init_data.get("upload_url")

        if not publish_id or not upload_url:
            logger.error(f"[TikTok] No publish_id/upload_url in response: {resp.json()}")
            return None

        logger.info(f"[TikTok] publish_id: {publish_id}")

        # Step 2: Upload file chunks
        with open(video_path, "rb") as f:
            for chunk_idx in range(chunk_count):
                chunk_data = f.read(CHUNK_SIZE)
                start = chunk_idx * CHUNK_SIZE
                end = start + len(chunk_data) - 1

                try:
                    chunk_resp = await self.client.put(
                        upload_url,
                        content=chunk_data,
                        headers={
                            "Content-Type": "video/mp4",
                            "Content-Length": str(len(chunk_data)),
                            "Content-Range": f"bytes {start}-{end}/{file_size}",
                        },
                        timeout=300,
                    )
                    if chunk_resp.status_code not in (200, 201, 206):
                        logger.error(f"[TikTok] Chunk {chunk_idx} failed: {chunk_resp.status_code}")
                        return None
                    logger.info(f"[TikTok] Chunk {chunk_idx + 1}/{chunk_count} uploaded")
                except Exception as e:
                    logger.error(f"[TikTok] Chunk upload error: {e}")
                    return None

        logger.success(f"[TikTok] Upload complete — publish_id: {publish_id}")
        return {"publish_id": publish_id, "privacy_level": privacy_level}

    async def poll_status(self, publish_id: str, max_polls: int = 20) -> Optional[str]:
        """Poll until published or failed. Returns final status string."""
        for i in range(max_polls):
            await asyncio.sleep(15)
            try:
                resp = await self.client.post(
                    TIKTOK_STATUS_URL,
                    headers=self._headers(),
                    json={"publish_id": publish_id},
                )
                resp.raise_for_status()
                data = resp.json().get("data", {})
                status = data.get("status", "UNKNOWN")
                logger.info(f"[TikTok] Poll {i+1}: {status}")
                if status in ("PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"):
                    return status
                if status in ("FAILED",):
                    logger.error(f"[TikTok] Publish failed: {data}")
                    return status
            except Exception as e:
                logger.warning(f"[TikTok] Status poll failed: {e}")
        return "TIMEOUT"

    async def close(self):
        await self.client.aclose()
