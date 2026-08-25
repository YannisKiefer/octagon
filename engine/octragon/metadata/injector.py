"""
Octragon System — Metadata Injection Engine

Uses ExifTool to:
1. Strip ALL original metadata from forged video
2. Inject realistic iPhone device metadata + randomized GPS coords
"""

from __future__ import annotations

import asyncio
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
import random

from loguru import logger

from ..models import VideoVariation, DeviceProfile
from ..config import get_config, DEVICE_METADATA


def _fmt_gps_dms(degrees: float) -> str:
    """Convert decimal degrees to DMS string for ExifTool."""
    d = int(abs(degrees))
    m = int((abs(degrees) - d) * 60)
    s = ((abs(degrees) - d) * 60 - m) * 60
    return f"{d} {m} {s:.4f}"


async def _run_exiftool(cmd: list[str], timeout: int = 60) -> tuple[int, str]:
    """Run exiftool command asynchronously."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        output = stdout.decode() + stderr.decode()
        return proc.returncode, output
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"ExifTool timed out after {timeout}s")


def _check_exiftool() -> bool:
    """Check if exiftool is installed."""
    try:
        result = subprocess.run(["exiftool", "-ver"],
                                 capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


class MetadataInjector:
    """Strips and re-injects video metadata using ExifTool."""

    def __init__(self, config=None):
        self.config = config or get_config()
        self._exiftool_available = _check_exiftool()
        if not self._exiftool_available:
            logger.warning("[Metadata] ExifTool not found — install with: brew install exiftool")

    async def inject(
        self,
        variation: VideoVariation,
        destination_dir: Optional[Path] = None,
        phone_number: int = 1,
    ) -> str:
        """
        Strip all metadata from a variation video and inject full forensic-level
        Apple iPhone metadata including MakerNote structure.

        This goes beyond basic EXIF — it injects Apple MakerNote binary tags
        (ContentIdentifier, MediaGroupUUID, MediaType) that forensic detectors
        check for, plus enforces cross-field consistency across ALL date tags,
        GPS fields, and iOS version strings.

        Returns the path to the final ready-for-posting video.
        """
        if not self._exiftool_available:
            logger.warning("[Metadata] Skipping injection — ExifTool not available")
            return variation.video_path

        source_path = variation.video_path
        if not Path(source_path).exists():
            raise FileNotFoundError(f"Variation video not found: {source_path}")

        # Output to 'ready' directory
        if destination_dir is None:
            destination_dir = (
                self.config.videos_dir / "ready" / variation.scraped_content_id
            )
        destination_dir.mkdir(parents=True, exist_ok=True)

        ready_path = str(
            destination_dir / f"ready_{variation.variation_label}.mp4"
        )

        # Step 1: Copy to ready dir (ExifTool modifies in place)
        import shutil
        shutil.copy2(source_path, ready_path)

        # Step 2: Strip ALL existing metadata (including encoded MakerNotes)
        logger.info(f"[Metadata] Stripping original metadata from {Path(ready_path).name}...")
        rc, out = await _run_exiftool([
            "exiftool",
            "-all=",
            "-overwrite_original",
            ready_path,
        ])
        if rc != 0:
            logger.warning(f"[Metadata] Strip warning: {out[:100]}")

        # Step 3: Generate full forensic-level Apple EXIF profile
        from ..metadata.device_profiles import generate_profile, profile_to_exiftool_args
        device_key = variation.forge_params.device_profile.value
        profile = generate_profile(
            device_key=device_key,
            phone_number=phone_number,
            gps_lat=variation.forge_params.gps_latitude,
            gps_lon=variation.forge_params.gps_longitude,
        )

        # Step 4: Build complete injection command
        exiftool_args = profile_to_exiftool_args(profile)
        inject_cmd = [
            "exiftool",
            *exiftool_args,
            "-overwrite_original",
            ready_path,
        ]

        logger.info(
            f"[Metadata] Injecting {profile.model} iOS {profile.software} @ "
            f"{profile.gps_latitude:.4f},{profile.gps_longitude:.4f} "
            f"UUID={profile.content_identifier[:8]}... → {Path(ready_path).name}"
        )
        rc, out = await _run_exiftool(inject_cmd)

        if rc != 0 and "Error" in out:
            logger.warning(f"[Metadata] Injection warning: {out[:200]}")
        else:
            logger.success(
                f"[Metadata] ✅ {profile.model} (iOS {profile.software}) "
                f"MakerNote injected → {Path(ready_path).name}"
            )

        return ready_path


    async def verify(self, video_path: str) -> dict:
        """Read back metadata to verify injection succeeded."""
        if not self._exiftool_available:
            return {}
        rc, out = await _run_exiftool([
            "exiftool", "-json",
            video_path,
        ])
        if rc != 0:
            return {}
        import json
        try:
            data = json.loads(out)
            return data[0] if data else {}
        except Exception:
            return {}

    async def inject_all(
        self, variations: list[VideoVariation], scraped_content_id: str
    ) -> list[str]:
        """Inject metadata for all variations. Returns list of ready file paths."""
        ready_paths = []
        dest = self.config.videos_dir / "ready" / scraped_content_id
        for var in variations:
            path = await self.inject(var, destination_dir=dest)
            ready_paths.append(path)
        return ready_paths
