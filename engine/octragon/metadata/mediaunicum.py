"""
Octragon — mediaunicum.xyz Metadata Stripping Client

Sends a video file to the mediaunicum.xyz web service which:
  ✅ Changes the source video file bytes
  ✅ Overlays invisible elements
  ✅ Alters the audio track
  ✅ Removes all metadata

Used AFTER forgery so the video gets an additional layer of
uniquification on top of the FFmpeg 5-layer hash bypass.

Falls back silently if the service is unavailable.
"""

from __future__ import annotations

import asyncio
import re
import tempfile
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

# The upload endpoint from @clicklead_media_bot
UPLOAD_URL = "https://mediaunicum.xyz/upload/775460e7-3916-4cf2-b9cf-03e8f9decab2"
BASE_URL = "https://mediaunicum.xyz"

# Timeouts: allow up to 5 minutes for a large video to process
CONNECT_TIMEOUT = 15.0
UPLOAD_TIMEOUT = 120.0
POLL_TIMEOUT = 300.0
POLL_INTERVAL = 5.0  # seconds between status checks


async def strip_metadata_via_web(
    video_path: str | Path,
    output_path: Optional[str | Path] = None,
) -> Optional[Path]:
    """
    Upload a video to mediaunicum.xyz, wait for processing, download the result.

    Returns the path to the stripped video, or None if the service fails.
    The caller should keep a fallback (local ExifTool strip) for when this returns None.
    """
    video_path = Path(video_path)
    if not video_path.exists():
        logger.error(f"[mediaunicum] File not found: {video_path}")
        return None

    file_size_mb = video_path.stat().st_size / (1024 * 1024)
    if file_size_mb > 19.5:
        logger.warning(
            f"[mediaunicum] File too large ({file_size_mb:.1f}MB > 20MB limit). "
            "Falling back to local ExifTool."
        )
        return None

    logger.info(f"[mediaunicum] Uploading {video_path.name} ({file_size_mb:.1f}MB)...")

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(UPLOAD_TIMEOUT, connect=CONNECT_TIMEOUT),
        follow_redirects=True,
    ) as client:
        try:
            # Step 1: GET the upload page to grab CSRF token / form fields
            resp = await client.get(UPLOAD_URL)
            resp.raise_for_status()
            html = resp.text

            # Extract any hidden form fields (CSRF, _token, etc.)
            hidden_fields = {}
            for match in re.finditer(
                r'<input[^>]+type=["\']hidden["\'][^>]+name=["\']([^"\']+)["\'][^>]+value=["\']([^"\']*)["\']',
                html, re.IGNORECASE
            ):
                hidden_fields[match.group(1)] = match.group(2)
            # Also try reversed attribute order
            for match in re.finditer(
                r'<input[^>]+name=["\']([^"\']+)["\'][^>]+type=["\']hidden["\'][^>]+value=["\']([^"\']*)["\']',
                html, re.IGNORECASE
            ):
                hidden_fields[match.group(1)] = match.group(2)

            logger.debug(f"[mediaunicum] Hidden fields: {list(hidden_fields.keys())}")

            # Step 2: POST multipart upload
            with open(video_path, "rb") as f:
                form_data = {k: (None, v) for k, v in hidden_fields.items()}
                form_data["file"] = (video_path.name, f, "video/mp4")

                upload_resp = await client.post(
                    UPLOAD_URL,
                    files=form_data,
                )

            logger.debug(f"[mediaunicum] Upload response: {upload_resp.status_code}")
            logger.debug(f"[mediaunicum] Response body: {upload_resp.text[:500]}")

            if upload_resp.status_code not in (200, 201, 302):
                logger.warning(
                    f"[mediaunicum] Upload failed with status {upload_resp.status_code}. "
                    "Falling back to local ExifTool."
                )
                return None

            # Step 3: Parse the response to find the download link or job ID
            result_html = upload_resp.text

            # Try to find a direct download link
            download_match = re.search(
                r'href=["\']([^"\']*(?:download|result|output|processed)[^"\']*)["\']',
                result_html, re.IGNORECASE
            )
            if not download_match:
                # Try any .mp4 link in the response
                download_match = re.search(
                    r'href=["\']([^"\']*\.mp4[^"\']*)["\']',
                    result_html, re.IGNORECASE
                )

            if download_match:
                download_url = download_match.group(1)
                if not download_url.startswith("http"):
                    download_url = BASE_URL + download_url
                return await _download_result(client, download_url, video_path, output_path)

            # Step 4: If no direct link, check for a job/status polling URL
            job_match = re.search(
                r'(?:job|task|status|id)["\s]*[:=]["\s]*([a-zA-Z0-9_-]{8,})',
                result_html, re.IGNORECASE
            )
            if job_match:
                job_id = job_match.group(1)
                logger.info(f"[mediaunicum] Job ID: {job_id} — polling for result...")
                return await _poll_for_result(client, job_id, video_path, output_path)

            logger.warning(
                "[mediaunicum] Could not parse download link from response. "
                "Falling back to local ExifTool."
            )
            return None

        except httpx.HTTPError as e:
            logger.warning(f"[mediaunicum] HTTP error: {e}. Falling back to local ExifTool.")
            return None
        except Exception as e:
            logger.exception(f"[mediaunicum] Unexpected error: {e}. Falling back to local ExifTool.")
            return None


async def _poll_for_result(
    client: httpx.AsyncClient,
    job_id: str,
    original_path: Path,
    output_path: Optional[Path],
    max_wait: float = POLL_TIMEOUT,
) -> Optional[Path]:
    """Poll the mediaunicum API for job completion and download the result."""
    status_url = f"{BASE_URL}/status/{job_id}"
    elapsed = 0.0

    while elapsed < max_wait:
        await asyncio.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

        try:
            resp = await client.get(status_url)
            data = resp.text

            # Look for a download URL in the status response
            download_match = re.search(
                r'href=["\']([^"\']*(?:download|result|output)[^"\']*)["\']|'
                r'"(?:url|download_url|result_url)"\s*:\s*"([^"]+)"',
                data, re.IGNORECASE
            )
            if download_match:
                download_url = download_match.group(1) or download_match.group(2)
                if not download_url.startswith("http"):
                    download_url = BASE_URL + download_url
                return await _download_result(client, download_url, original_path, output_path)

            # Check if still processing
            if "processing" in data.lower() or "pending" in data.lower():
                logger.debug(f"[mediaunicum] Still processing... ({elapsed:.0f}s elapsed)")
                continue

            # Check for error
            if "error" in data.lower() or "failed" in data.lower():
                logger.warning(f"[mediaunicum] Service reported an error on job {job_id}")
                return None

        except httpx.HTTPError as e:
            logger.warning(f"[mediaunicum] Polling error: {e}")

    logger.warning(f"[mediaunicum] Timed out waiting for job {job_id} after {max_wait}s")
    return None


async def _download_result(
    client: httpx.AsyncClient,
    download_url: str,
    original_path: Path,
    output_path: Optional[Path],
) -> Optional[Path]:
    """Download the processed video from mediaunicum."""
    logger.info(f"[mediaunicum] Downloading result from {download_url}")

    if output_path is None:
        stem = original_path.stem
        output_path = original_path.parent / f"{stem}_stripped.mp4"

    output_path = Path(output_path)

    try:
        async with client.stream("GET", download_url) as resp:
            resp.raise_for_status()
            with open(output_path, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=8192):
                    f.write(chunk)

        size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"[mediaunicum] ✅ Downloaded stripped video: {output_path.name} ({size_mb:.1f}MB)")
        return output_path

    except Exception as e:
        logger.error(f"[mediaunicum] Download failed: {e}")
        if output_path.exists():
            output_path.unlink()
        return None
