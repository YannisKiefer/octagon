"""
Octragon Video Editor — Gemini Decision Matrix

Extracts frames from a video, sends them to Gemini 3.1 Pro Vision,
and returns a strict decision: IGNORE, CROP, or REJECT.

Rules (from CTO Directive):
  - NEVER blur watermarks
  - Only 3 options: Ignore, Crop, Reject
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger


class WatermarkAction(str, Enum):
    IGNORE = "ignore"
    CROP = "crop"
    REJECT = "reject"


@dataclass
class CropCoordinates:
    """FFmpeg-compatible crop coordinates."""
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0

    def to_ffmpeg_filter(self) -> str:
        return f"crop={self.width}:{self.height}:{self.x}:{self.y}"


@dataclass
class WatermarkDecision:
    """The output of the Gemini Decision Matrix."""
    action: WatermarkAction
    crop_coordinates: Optional[CropCoordinates] = None
    reasoning: str = ""
    confidence: float = 0.0
    watermark_locations: list[str] = None

    def __post_init__(self):
        if self.watermark_locations is None:
            self.watermark_locations = []


DECISION_PROMPT = """You are a professional video editor AI. Analyze these video frames for foreign watermarks, logos, or text overlays (TikTok, Instagram, creator handles, etc).

Your task: decide what to do about any watermarks found.

RULES:
1. NEVER suggest blurring. It looks weird and unprofessional.
2. You have EXACTLY 3 options:

   IGNORE — Use when:
   - No watermark found
   - Watermark is tiny/barely visible
   - Watermark only appears in last 5 seconds
   - Watermark is a standard platform UI element that viewers expect

   CROP — Use when:
   - Watermark is at edges (top, bottom, corners) and can be cropped out
   - The core subject of the video remains fully in frame after cropping
   - Must maintain 9:16 aspect ratio for vertical video or 16:9 for horizontal

   REJECT — Use when:
   - Watermark covers the center/main subject
   - Text overlay is baked across the entire frame
   - Cannot crop without losing the main content

VIDEO DIMENSIONS: {width}x{height}

Return ONLY valid JSON in this exact format:
{{
  "action": "ignore" | "crop" | "reject",
  "crop_coordinates": {{
    "x": <left offset in pixels>,
    "y": <top offset in pixels>,
    "width": <crop width in pixels>,
    "height": <crop height in pixels>
  }},
  "reasoning": "<brief explanation>",
  "confidence": <0.0 to 1.0>,
  "watermark_locations": ["top-left", "bottom-center", etc]
}}

If action is "ignore" or "reject", set crop_coordinates to null.
If action is "crop", the crop must maintain the aspect ratio and keep the main subject centered."""


class GeminiAnalyzer:
    """Analyzes video frames with Gemini 3.1 Pro Vision for watermark decisions."""

    def __init__(self, api_key: str, model: str = "gemini-3.1-pro-preview"):
        self.api_key = api_key
        self.model = model
        self._client = httpx.AsyncClient(timeout=90.0)

    async def extract_frames(self, video_path: str, num_frames: int = 5) -> list[str]:
        """
        Extract evenly-spaced frames from a video as JPEG files.
        Returns list of frame file paths.
        """
        video = Path(video_path)
        if not video.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        frames_dir = video.parent / f"{video.stem}_frames"
        frames_dir.mkdir(exist_ok=True)

        # Get video duration first
        probe_cmd = [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-show_entries", "stream=width,height",
            "-of", "json",
            video_path,
        ]
        proc = await asyncio.create_subprocess_exec(
            *probe_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        probe_data = json.loads(stdout.decode())

        duration = float(probe_data.get("format", {}).get("duration", 10))
        # Get dimensions from first video stream
        width, height = 1080, 1920
        for stream in probe_data.get("streams", []):
            if stream.get("width"):
                width = stream["width"]
                height = stream["height"]
                break

        # Extract frames at evenly spaced intervals
        interval = duration / (num_frames + 1)
        frame_paths = []

        for i in range(num_frames):
            timestamp = interval * (i + 1)
            frame_path = str(frames_dir / f"frame_{i:03d}.jpg")

            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{timestamp:.2f}",
                "-i", video_path,
                "-vframes", "1",
                "-q:v", "2",
                frame_path,
                "-loglevel", "error",
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

            if Path(frame_path).exists():
                frame_paths.append(frame_path)

        logger.info(f"[GeminiAnalyzer] Extracted {len(frame_paths)} frames from {video_path}")
        return frame_paths, width, height

    async def analyze(self, video_path: str) -> WatermarkDecision:
        """
        Run the full Gemini Decision Matrix on a video.
        Returns a WatermarkDecision with the action to take.
        """
        if not self.api_key:
            logger.warning("[GeminiAnalyzer] No API key — defaulting to IGNORE")
            return WatermarkDecision(
                action=WatermarkAction.IGNORE,
                reasoning="No Gemini API key configured",
                confidence=0.5,
            )

        try:
            frame_paths, width, height = await self.extract_frames(video_path)
            if not frame_paths:
                logger.warning("[GeminiAnalyzer] No frames extracted — defaulting to IGNORE")
                return WatermarkDecision(
                    action=WatermarkAction.IGNORE,
                    reasoning="Could not extract frames",
                    confidence=0.3,
                )

            # Build the Gemini request with inline images
            parts = []
            for fp in frame_paths:
                with open(fp, "rb") as f:
                    img_data = base64.b64encode(f.read()).decode()
                parts.append({
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": img_data,
                    }
                })

            # Add the text prompt
            prompt = DECISION_PROMPT.format(width=width, height=height)
            parts.append({"text": prompt})

            # Call Gemini API
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/"
                f"models/{self.model}:generateContent?key={self.api_key}"
            )
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 1024,
                },
            }

            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

            # Parse response
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            decision = self._parse_decision(text, width, height)

            logger.info(
                f"[GeminiAnalyzer] Decision: {decision.action.value} "
                f"(confidence={decision.confidence:.0%}) — {decision.reasoning}"
            )
            return decision

        except Exception as e:
            logger.exception(f"[GeminiAnalyzer] Analysis failed: {e}")
            return WatermarkDecision(
                action=WatermarkAction.IGNORE,
                reasoning=f"Analysis error (defaulting to ignore): {str(e)[:100]}",
                confidence=0.3,
            )

        finally:
            # Cleanup extracted frames
            try:
                video = Path(video_path)
                frames_dir = video.parent / f"{video.stem}_frames"
                if frames_dir.exists():
                    for f in frames_dir.iterdir():
                        f.unlink()
                    frames_dir.rmdir()
            except Exception:
                pass

    def _parse_decision(self, text: str, video_width: int, video_height: int) -> WatermarkDecision:
        """Parse Gemini's JSON response into a WatermarkDecision."""
        # Strip markdown code fences
        clean = text.strip()
        if clean.startswith("```"):
            clean = re.sub(r"^```(?:json)?\n?", "", clean)
            clean = re.sub(r"\n?```$", "", clean)

        try:
            data = json.loads(clean)
        except json.JSONDecodeError:
            # Try regex extraction
            match = re.search(r"\{[\s\S]*\}", clean)
            if match:
                data = json.loads(match.group())
            else:
                return WatermarkDecision(
                    action=WatermarkAction.IGNORE,
                    reasoning="Failed to parse Gemini response",
                    confidence=0.2,
                )

        action = WatermarkAction(data.get("action", "ignore").lower())

        crop_coords = None
        if action == WatermarkAction.CROP and data.get("crop_coordinates"):
            cc = data["crop_coordinates"]
            crop_coords = CropCoordinates(
                x=int(cc.get("x", 0)),
                y=int(cc.get("y", 0)),
                width=int(cc.get("width", video_width)),
                height=int(cc.get("height", video_height)),
            )
            # Validate crop is sane (at least 50% of original dimensions)
            if crop_coords.width < video_width * 0.5 or crop_coords.height < video_height * 0.5:
                return WatermarkDecision(
                    action=WatermarkAction.REJECT,
                    reasoning="Crop would remove too much content — rejecting instead",
                    confidence=0.7,
                )

        return WatermarkDecision(
            action=action,
            crop_coordinates=crop_coords,
            reasoning=data.get("reasoning", ""),
            confidence=float(data.get("confidence", 0.5)),
            watermark_locations=data.get("watermark_locations", []),
        )

    async def close(self):
        await self._client.aclose()
