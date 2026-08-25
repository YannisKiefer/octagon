"""
Instagram Graph API — Reels Uploader

Posts video Reels to Instagram Business accounts via the Graph API.
2-step process: (1) create container, (2) publish.

API: https://developers.facebook.com/docs/instagram-api/reference/ig-user/media
Requires: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID per phone
"""

import asyncio
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

GRAPH_BASE = "https://graph.facebook.com/v22.0"


class InstagramUploader:
    """
    Upload Reels to Instagram via Graph API.
    Requires a business/creator account with a connected Facebook Page.
    """

    def __init__(self, access_token: str, account_id: str):
        self.access_token = access_token
        self.account_id = account_id
        self.client = httpx.AsyncClient(timeout=300)

    def _graph(self, endpoint: str) -> str:
        return f"{GRAPH_BASE}/{endpoint}"

    async def upload_reel(
        self,
        video_path: str,
        caption: str,
        hashtags: Optional[list[str]] = None,
        cover_url: Optional[str] = None,
        share_to_feed: bool = True,
    ) -> Optional[dict]:
        """
        Upload a Reel using the resumable video upload flow:
        1. Create media container with video_url or file upload session
        2. Poll until FINISHED
        3. Publish the container

        For local files, we use the Resumable Upload API first (file → CDN URL),
        then pass the CDN URL to the Reels container creation endpoint.
        """
        path = Path(video_path)
        if not path.exists():
            logger.error(f"[Instagram] File not found: {video_path}")
            return None

        full_caption = caption
        if hashtags:
            full_caption += "\n\n" + " ".join(f"#{t.lstrip('#')}" for t in hashtags[:30])

        # Step 1: Start a resumable upload session to get CDN URL
        file_size = path.stat().st_size
        session_resp = await self.client.post(
            self._graph(f"{self.account_id}/media"),
            params={
                "access_token": self.access_token,
                "upload_type": "resumable",
                "media_type": "REELS",
                "file_size": file_size,
            },
        )
        if not session_resp.is_success:
            logger.error(f"[Instagram] Session init failed: {session_resp.text}")
            return None

        session_data = session_resp.json()
        upload_session_id = session_data.get("id") or session_data.get("upload_session_id")
        if not upload_session_id:
            logger.error(f"[Instagram] No session ID: {session_data}")
            return None

        logger.info(f"[Instagram] Upload session: {upload_session_id}")

        # Step 2: Upload file bytes
        with open(video_path, "rb") as f:
            video_bytes = f.read()

        upload_resp = await self.client.post(
            f"https://rupload.facebook.com/video-upload/v22.0/{upload_session_id}",
            headers={
                "Authorization": f"OAuth {self.access_token}",
                "offset": "0",
                "file_size": str(file_size),
                "Content-Type": "application/octet-stream",
            },
            content=video_bytes,
            timeout=600,
        )
        if not upload_resp.is_success:
            logger.error(f"[Instagram] Upload failed: {upload_resp.text}")
            return None

        logger.info(f"[Instagram] Video uploaded — creating container")

        # Step 3: Create the Reels container
        container_params = {
            "access_token": self.access_token,
            "media_type": "REELS",
            "video_id": upload_session_id,
            "caption": full_caption[:2200],
            "share_to_feed": "true" if share_to_feed else "false",
        }
        if cover_url:
            container_params["thumb_offset"] = "1000"

        container_resp = await self.client.post(
            self._graph(f"{self.account_id}/media"),
            params=container_params,
        )
        if not container_resp.is_success:
            logger.error(f"[Instagram] Container creation failed: {container_resp.text}")
            return None

        container_id = container_resp.json().get("id")
        if not container_id:
            logger.error(f"[Instagram] No container ID: {container_resp.json()}")
            return None

        logger.info(f"[Instagram] Container created: {container_id}")

        # Step 4: Poll container status until FINISHED
        for attempt in range(30):
            await asyncio.sleep(10)
            status_resp = await self.client.get(
                self._graph(container_id),
                params={
                    "fields": "status_code,status",
                    "access_token": self.access_token,
                },
            )
            status_data = status_resp.json()
            status_code = status_data.get("status_code", "")
            logger.info(f"[Instagram] Container status: {status_code}")
            if status_code == "FINISHED":
                break
            if status_code in ("ERROR", "EXPIRED"):
                logger.error(f"[Instagram] Container failed: {status_data}")
                return None
        else:
            logger.error("[Instagram] Container processing timed out")
            return None

        # Step 5: Publish
        publish_resp = await self.client.post(
            self._graph(f"{self.account_id}/media_publish"),
            params={
                "access_token": self.access_token,
                "creation_id": container_id,
            },
        )
        if not publish_resp.is_success:
            logger.error(f"[Instagram] Publish failed: {publish_resp.text}")
            return None

        media_id = publish_resp.json().get("id")
        post_url = f"https://www.instagram.com/reel/{media_id}/" if media_id else ""
        logger.success(f"[Instagram] Published! ID: {media_id}")
        return {"media_id": media_id, "post_url": post_url}

    async def close(self):
        await self.client.aclose()
