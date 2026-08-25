"""
LinkedIn Video Share API Uploader

Posts videos to a LinkedIn personal profile or company page using the
LinkedIn Marketing APIs (UGC Posts + Video Upload).

Requires:
  - LINKEDIN_ACCESS_TOKEN per phone (OAuth 2.0)
  - LINKEDIN_PERSON_URN or LINKEDIN_ORGANIZATION_URN

API docs:
  https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
  https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api
"""

import asyncio
import json
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

LINKEDIN_BASE = "https://api.linkedin.com/v2"
CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB chunks


class LinkedInUploader:
    """
    Post native video to LinkedIn via UGC Posts + Vector Asset API.
    Works for both personal profiles and company pages.
    """

    def __init__(self, access_token: str, author_urn: str):
        """
        access_token: OAuth2 token with w_member_social scope
        author_urn:   e.g. "urn:li:person:XXXXX" or "urn:li:organization:XXXXX"
        """
        self.access_token = access_token
        self.author_urn = author_urn
        self.client = httpx.AsyncClient(
            timeout=300,
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-Restli-Protocol-Version": "2.0.0",
                "LinkedIn-Version": "202501",
            },
        )

    async def _register_upload(self, file_size: int) -> Optional[dict]:
        """Register a video upload and get upload URL + asset URN."""
        payload = {
            "registerUploadRequest": {
                "recipes": ["urn:li:digitalmediaRecipe:feedshare-video"],
                "owner": self.author_urn,
                "serviceRelationships": [
                    {
                        "relationshipType": "OWNER",
                        "identifier": "urn:li:userGeneratedContent",
                    }
                ],
                "supportedUploadMechanism": ["MULTIPART_UPLOAD"],
                "fileSize": file_size,
            }
        }
        resp = await self.client.post(
            f"{LINKEDIN_BASE}/assets?action=registerUpload",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        if not resp.is_success:
            logger.error(f"[LinkedIn] Register upload failed: {resp.text}")
            return None
        return resp.json().get("value", {})

    async def upload_video(
        self,
        video_path: str,
        caption: str,
        hashtags: Optional[list[str]] = None,
        visibility: str = "PUBLIC",
    ) -> Optional[dict]:
        """
        Upload video and create a UGC post.
        visibility: PUBLIC | CONNECTIONS | LOGGED_IN | CONTAINER
        """
        path = Path(video_path)
        if not path.exists():
            logger.error(f"[LinkedIn] File not found: {video_path}")
            return None

        file_size = path.stat().st_size
        logger.info(f"[LinkedIn] Registering upload: {path.name} ({file_size/1e6:.1f} MB)")

        # Step 1: Register upload
        upload_info = await self._register_upload(file_size)
        if not upload_info:
            return None

        asset_urn = upload_info.get("asset")
        upload_mechanisms = upload_info.get("uploadMechanism", {})
        multipart = upload_mechanisms.get(
            "com.linkedin.digitalmedia.uploading.MultipartUpload", {}
        )
        upload_url = multipart.get("uploadInstructions", [{}])[0].get("uploadUrl")
        headers_info = multipart.get("uploadInstructions", [{}])[0].get("headers", {})

        if not asset_urn or not upload_url:
            logger.error(f"[LinkedIn] Missing asset/uploadUrl in: {upload_info}")
            return None

        logger.info(f"[LinkedIn] Asset URN: {asset_urn}")

        # Step 2: Upload file in chunks
        with open(video_path, "rb") as f:
            chunk_idx = 0
            while True:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                chunk_headers = {
                    "Content-Type": "application/octet-stream",
                    **headers_info,
                }
                try:
                    upload_resp = await self.client.put(
                        upload_url,
                        content=chunk,
                        headers=chunk_headers,
                        timeout=300,
                    )
                    if upload_resp.status_code not in (200, 201):
                        logger.error(f"[LinkedIn] Chunk {chunk_idx} failed: {upload_resp.status_code}")
                        return None
                    logger.info(f"[LinkedIn] Chunk {chunk_idx + 1} uploaded")
                    chunk_idx += 1
                except Exception as e:
                    logger.error(f"[LinkedIn] Upload error: {e}")
                    return None

        # Step 3: Build caption with hashtags
        commentary = caption
        if hashtags:
            tag_str = " ".join(f"#{t.lstrip('#')}" for t in hashtags[:5])
            commentary = f"{caption}\n\n{tag_str}"

        # Step 4: Create UGC post with the asset
        ugc_post = {
            "author": self.author_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {
                        "text": commentary[:3000],
                    },
                    "shareMediaCategory": "VIDEO",
                    "media": [
                        {
                            "status": "READY",
                            "description": {"text": commentary[:200]},
                            "media": asset_urn,
                            "title": {"text": caption[:200]},
                        }
                    ],
                }
            },
            "visibility": {
                "com.linkedin.ugc.MemberNetworkVisibility": visibility,
            },
        }

        logger.info(f"[LinkedIn] Creating UGC post")
        post_resp = await self.client.post(
            f"{LINKEDIN_BASE}/ugcPosts",
            json=ugc_post,
            headers={"Content-Type": "application/json"},
        )
        if not post_resp.is_success:
            logger.error(f"[LinkedIn] UGC post failed: {post_resp.text}")
            return None

        post_id = post_resp.headers.get("x-restli-id") or post_resp.json().get("id", "")
        post_url = f"https://www.linkedin.com/feed/update/{post_id}/" if post_id else ""
        logger.success(f"[LinkedIn] Published! Post ID: {post_id}")
        return {"post_id": post_id, "post_url": post_url, "asset_urn": asset_urn}

    async def close(self):
        await self.client.aclose()
