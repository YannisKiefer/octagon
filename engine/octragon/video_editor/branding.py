"""
Octragon Video Editor — EcomBrain Branding Injection

Overlays the EcomBrain logo dead-center on a video using FFmpeg.
Mimics Stake-style watermark placement: centered, ~15% of video width, slight transparency.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from loguru import logger


class BrandingInjector:
    """Overlays the EcomBrain logo onto a video via FFmpeg."""

    def __init__(self, logo_path: str):
        self.logo_path = Path(logo_path)
        if not self.logo_path.exists():
            raise FileNotFoundError(
                f"EcomBrain logo not found at: {logo_path}\n"
                f"Expected a transparent PNG file."
            )
        logger.info(f"[Branding] Logo loaded: {self.logo_path}")

    async def apply(
        self,
        input_path: str,
        output_path: str,
        logo_scale_pct: float = 0.15,
        logo_opacity: float = 0.85,
    ) -> str:
        """
        Overlay the EcomBrain logo centered on the video.

        Args:
            input_path: Path to the input video
            output_path: Path for the branded output video
            logo_scale_pct: Logo width as percentage of video width (default 15%)
            logo_opacity: Logo opacity 0.0-1.0 (default 85%)

        Returns:
            Path to the branded video
        """
        input_file = Path(input_path)
        if not input_file.exists():
            raise FileNotFoundError(f"Input video not found: {input_path}")

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Probe the input video to get its actual dimensions
        probe_cmd = [
            "ffprobe", "-v", "quiet",
            "-show_entries", "stream=width,height",
            "-of", "json", input_path,
        ]
        proc = await asyncio.create_subprocess_exec(
            *probe_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        import json
        probe_data = json.loads(stdout.decode())

        video_width = 1080  # default
        for stream in probe_data.get("streams", []):
            if stream.get("width"):
                video_width = int(stream["width"])
                break

        # Calculate logo width in pixels (e.g. 15% of video width)
        logo_width_px = int(video_width * logo_scale_pct)

        # Build filter: scale logo to exact pixel width, apply opacity, center overlay
        filter_complex = (
            f"[1:v]scale={logo_width_px}:-1,format=rgba,"
            f"colorchannelmixer=aa={logo_opacity}[logo];"
            f"[0:v][logo]overlay=(W-w)/2:(H-h)/2"
        )

        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-i", str(self.logo_path),
            "-filter_complex", filter_complex,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-c:a", "copy",
            "-map_metadata", "-1",
            output_path,
            "-loglevel", "error",
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError("FFmpeg branding timed out after 300s")

        if proc.returncode != 0:
            stderr_text = stderr.decode()
            logger.warning(f"[Branding] Complex filter failed, trying simple overlay: {stderr_text[:150]}")

            # Fallback: simpler filter without main_w reference
            filter_simple = (
                f"[1:v]scale=-1:-1,format=rgba,"
                f"colorchannelmixer=aa={logo_opacity}[logo];"
                f"[0:v][logo]overlay=(W-w)/2:(H-h)/2"
            )

            cmd_fallback = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-i", str(self.logo_path),
                "-filter_complex", filter_simple,
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "18",
                "-c:a", "copy",
                "-map_metadata", "-1",
                output_path,
                "-loglevel", "error",
            ]
            proc2 = await asyncio.create_subprocess_exec(
                *cmd_fallback,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr2 = await asyncio.wait_for(proc2.communicate(), timeout=300)
            if proc2.returncode != 0:
                raise RuntimeError(f"FFmpeg branding failed: {stderr2.decode()[:300]}")

        if not Path(output_path).exists():
            raise RuntimeError(f"Branded video not created: {output_path}")

        size_mb = Path(output_path).stat().st_size / (1024 * 1024)
        logger.success(f"[Branding] ✅ Branded video: {output_path} ({size_mb:.1f}MB)")
        return output_path
