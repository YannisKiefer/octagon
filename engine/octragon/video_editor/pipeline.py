"""
Octragon Video Editor — 4-Step Pipeline Orchestrator

The autonomous pipeline:
  Step 1: Ultra HD Ingestion (download via yt-dlp or use local file)
  Step 2: Gemini Decision Matrix (watermark analysis → ignore/crop/reject)
  Step 3: FFmpeg Processing (crop if needed) + EcomBrain Branding Injection
  Step 4: Return final branded video path for Telegram delivery
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

from loguru import logger

from .gemini_analyzer import GeminiAnalyzer, WatermarkAction, WatermarkDecision
from .branding import BrandingInjector


class EditStatus(str, Enum):
    SUCCESS = "success"
    REJECTED = "rejected"
    ERROR = "error"


@dataclass
class EditResult:
    """Result of the full video editor pipeline."""
    status: EditStatus
    input_path: str = ""
    output_path: str = ""
    decision: Optional[WatermarkDecision] = None
    error_message: str = ""
    processing_time_seconds: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VideoEditorPipeline:
    """
    The 4-step autonomous video editor.
    
    Usage:
        pipeline = VideoEditorPipeline(config)
        result = await pipeline.process(video_path)
        # or
        result = await pipeline.process_url(url)
    """

    def __init__(self, config):
        self.config = config
        self.analyzer = GeminiAnalyzer(
            api_key=config.gemini_api_key,
            model="gemini-3.1-pro-preview",
        )
        self.branding = BrandingInjector(str(config.ecombrain_logo_path))

        # Ensure output directory exists
        self.output_dir = config.videos_dir / "edited"
        self.output_dir.mkdir(parents=True, exist_ok=True)

    async def process(self, video_path: str, output_name: str = None) -> EditResult:
        """
        Run the full 4-step pipeline on a local video file.

        Args:
            video_path: Path to the input video
            output_name: Optional custom output filename (without extension)

        Returns:
            EditResult with status, output path, and decision details
        """
        import time
        start = time.monotonic()

        try:
            input_file = Path(video_path)
            if not input_file.exists():
                return EditResult(
                    status=EditStatus.ERROR,
                    input_path=video_path,
                    error_message=f"Input video not found: {video_path}",
                )

            name = output_name or f"edited_{input_file.stem}"

            # ── STEP 2: Gemini Decision Matrix ──────────────────────────
            logger.info(f"[VideoEditor] Step 2: Running Gemini Decision Matrix...")
            decision = await self.analyzer.analyze(video_path)

            # ── Handle REJECT ──────────────────────────────────────────
            if decision.action == WatermarkAction.REJECT:
                elapsed = time.monotonic() - start
                logger.warning(
                    f"[VideoEditor] ❌ REJECTED: {decision.reasoning}"
                )
                return EditResult(
                    status=EditStatus.REJECTED,
                    input_path=video_path,
                    decision=decision,
                    error_message=f"Video rejected: {decision.reasoning}",
                    processing_time_seconds=elapsed,
                )

            # ── STEP 3a: Crop (if needed) ──────────────────────────────
            working_path = video_path

            if decision.action == WatermarkAction.CROP and decision.crop_coordinates:
                logger.info(f"[VideoEditor] Step 3a: Cropping watermark...")
                cropped_path = str(self.output_dir / f"{name}_cropped.mp4")
                await self._ffmpeg_crop(
                    video_path,
                    cropped_path,
                    decision.crop_coordinates.to_ffmpeg_filter(),
                )
                working_path = cropped_path
                logger.success(f"[VideoEditor] ✅ Cropped: {decision.crop_coordinates}")
            else:
                logger.info(f"[VideoEditor] Step 3a: No crop needed (IGNORE)")

            # ── STEP 3b: Branding Injection ────────────────────────────
            logger.info(f"[VideoEditor] Step 3b: Applying EcomBrain branding...")
            branded_path = str(self.output_dir / f"{name}_branded.mp4")
            await self.branding.apply(working_path, branded_path)

            # Clean up intermediate cropped file
            if working_path != video_path and Path(working_path).exists():
                Path(working_path).unlink()

            elapsed = time.monotonic() - start
            logger.success(
                f"[VideoEditor] ✅ Pipeline complete in {elapsed:.1f}s → {branded_path}"
            )

            return EditResult(
                status=EditStatus.SUCCESS,
                input_path=video_path,
                output_path=branded_path,
                decision=decision,
                processing_time_seconds=elapsed,
            )

        except Exception as e:
            elapsed = time.monotonic() - start
            logger.exception(f"[VideoEditor] Pipeline error: {e}")
            return EditResult(
                status=EditStatus.ERROR,
                input_path=video_path,
                error_message=str(e),
                processing_time_seconds=elapsed,
            )

    async def process_url(self, url: str, output_name: str = None) -> EditResult:
        """
        Step 1 + Steps 2-4: Download a video from URL, then process it.
        Reuses the existing OctragonScraper for Ultra HD ingestion.
        """
        import time
        start = time.monotonic()

        try:
            # ── STEP 1: Ultra HD Ingestion ─────────────────────────────
            logger.info(f"[VideoEditor] Step 1: Downloading {url}...")
            download_path = str(self.output_dir / "download_temp.mp4")

            cmd = [
                "yt-dlp",
                "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "--no-playlist",
                "--output", download_path,
                "--force-overwrites",
                url,
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=self.config.download_timeout_seconds
                )
            except asyncio.TimeoutError:
                proc.kill()
                return EditResult(
                    status=EditStatus.ERROR,
                    error_message=f"Download timed out after {self.config.download_timeout_seconds}s",
                    processing_time_seconds=time.monotonic() - start,
                )

            if proc.returncode != 0:
                error = stderr.decode()[:300]
                return EditResult(
                    status=EditStatus.ERROR,
                    error_message=f"Download failed: {error}",
                    processing_time_seconds=time.monotonic() - start,
                )

            if not Path(download_path).exists():
                return EditResult(
                    status=EditStatus.ERROR,
                    error_message="Download completed but file not found",
                    processing_time_seconds=time.monotonic() - start,
                )

            logger.success(
                f"[VideoEditor] Step 1: Downloaded "
                f"({Path(download_path).stat().st_size / 1024 / 1024:.1f}MB)"
            )

            # ── Run Steps 2-4 ──────────────────────────────────────────
            result = await self.process(download_path, output_name)
            result.processing_time_seconds = time.monotonic() - start

            # Clean up download temp
            if Path(download_path).exists() and result.output_path != download_path:
                Path(download_path).unlink()

            return result

        except Exception as e:
            return EditResult(
                status=EditStatus.ERROR,
                error_message=str(e),
                processing_time_seconds=time.monotonic() - start,
            )

    async def _ffmpeg_crop(self, input_path: str, output_path: str, crop_filter: str):
        """Apply an FFmpeg crop filter to a video."""
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-vf", crop_filter,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-c:a", "copy",
            output_path,
            "-loglevel", "error",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg crop failed: {stderr.decode()[:300]}")

    async def close(self):
        """Cleanup resources."""
        await self.analyzer.close()
