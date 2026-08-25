"""
Octragon System — Forgery Pipeline

5-layer video hash bypass:
  1. Frame rate alteration
  2. Sub-pixel crop + pad
  3. Audio pitch shift
  4. Re-encoding (different codec params)
  5. Noise injection (via Gemini Vision analysis)

Generates 3 unique variations per scraped video.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from ..models import VideoVariation, ForgeParams, CleanseStatus, DeviceProfile
from ..config import get_config, VARIATION_PRESETS


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# FFmpeg Operations
# ---------------------------------------------------------------------------

class FFmpegOps:
    """Wraps FFmpeg subprocess calls for the forgery pipeline."""

    @staticmethod
    async def run(cmd: list[str], timeout: int = 300) -> tuple[int, str]:
        """Run an FFmpeg command asynchronously."""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            return proc.returncode, stderr.decode()
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError(f"FFmpeg timed out after {timeout}s")

    @staticmethod
    async def apply_forgery(
        input_path: str,
        output_path: str,
        params: ForgeParams,
        perturb: "FramePerturb | None" = None,
    ) -> None:
        """
        Apply 5-layer elite forgery in a single FFmpeg pass.

        Layer 1a/1c: Geometric transform (unique rotation + scale per variation)
                     → destroys DCT basis vector alignment → defeats pHash
        Layer 1a:    DCT quantization noise (noise filter with unique seed)
                     → changes frequency domain coefficients
        Layer 2:     Audio multi-layer fingerprint bypass:
                     - Per-variation 3-band EQ → shifts spectral peaks
                     - Micro-tempo drift (0.2–0.4%) → defeats time-stretch fingerprinters
                     - Pitch shift (existing) → compound effect
        Layers 3-4:  Re-encode with new codec params → unique bitstream
        """
        from ..forgery.frame_perturb import FramePerturb

        if perturb is None:
            perturb = FramePerturb(
                variation_id=str(hash(output_path)),
                variation_index=params.noise_seed % 3,
                noise_seed=params.noise_seed,
            )

        # ── Video filter chain (10-layer) ──────────────────────────────────
        crop_w = f"iw-{params.crop_left + params.crop_right}"
        crop_h = f"ih-{params.crop_top + params.crop_bottom}"
        crop_x = str(params.crop_left)
        crop_y = str(params.crop_top)

        # Layer 1c: geometric transform (DCT basis vector destruction)
        geo_filter = perturb.get_geometric_filter()

        # Layer 1a: DCT quantization noise (unique per variation)
        noise_level = params.noise_seed % 20 + 1
        noise_filter = f"noise=alls={noise_level}:allf=t"

        # Layer 7: color matrix micro-shift (hue/sat/colorbalance)
        color_filter = perturb.get_color_shift_filter()

        # Layer 8: TikTok invisible watermark neutralization
        #          (colorspace round-trip + gamma + unsharp)
        watermark_filter = perturb.get_watermark_destroy_filter()

        vf_chain = ",".join([
            f"fps={params.fps}",
            f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}",
            f"pad=iw+{params.crop_left + params.crop_right}:ih+{params.crop_top + params.crop_bottom}:{params.crop_left}:{params.crop_top}:black",
            watermark_filter,   # Layer 8: destroy embedded watermarks FIRST
            geo_filter,         # Layer 1c: rotation + scale
            noise_filter,       # Layer 1a: DCT quantization noise
            color_filter,       # Layer 7: color matrix micro-shift
        ])

        # ── Audio filter chain (5-layer) ───────────────────────────────────
        # Base pitch shift (existing)
        pitch_rate = int(44100 * params.audio_pitch_shift)

        # Layer 2b: micro-tempo drift
        tempo_filter = perturb.get_tempo_drift_filter()

        # Layer 2c: per-variation EQ randomization
        eq_filter = perturb.get_audio_eq_filter()

        # Layer 10: micro-silence injection (shifts temporal peaks)
        silence_filter = perturb.get_audio_silence_injection_filter()

        # Layer 2a: spectral noise injection (8–12kHz band, -55dB)
        noise_expr = perturb.get_spectral_noise_filter()

        af_chain = ",".join([
            silence_filter,     # Layer 10: micro-silence shift
            eq_filter,          # Layer 2c: per-variation 3-band EQ
            f"asetrate={pitch_rate}",  # pitch shift
            f"aresample=44100",
            tempo_filter,       # Layer 2b: micro-tempo drift
        ])

        # ── Layer 6: Per-variation H.264 encoder params ────────────────────
        # Import the preset for this specific variation
        from ..config import VARIATION_PRESETS
        preset_idx = params.noise_seed % len(VARIATION_PRESETS)
        preset_dict = VARIATION_PRESETS[preset_idx]
        encoder_args = FramePerturb.get_encoder_params(preset_dict)

        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            # Inject inaudible high-frequency noise as second input
            "-f", "lavfi", "-i",
            f"aevalsrc={noise_expr}:s=44100:d=999",
            "-filter_complex",
            # Apply main video filter chain
            f"[0:v]{vf_chain}[v];"
            # Apply audio chain to main audio
            f"[0:a]{af_chain}[amain];"
            # Mix inaudible noise at near-zero volume
            f"[amain][1:a]amix=inputs=2:duration=first:weights=1 0.0005[a]",
            "-map", "[v]",
            "-map", "[a]",
            "-c:v", params.codec,
            *encoder_args,      # Layer 6: per-variation encoder params
            "-c:a", "aac",
            "-b:a", params.audio_bitrate,
            "-ar", "44100",
            "-map_metadata", "-1",  # Strip all source metadata
            output_path,
            "-loglevel", "error",
        ]


        returncode, stderr = await FFmpegOps.run(cmd, timeout=600)
        if returncode != 0:
            # Fallback: simpler chain without the complex filter if lavfi fails
            logger.warning(f"[Forgery] Elite filter failed, using fallback chain: {stderr[:100]}")
            vf_simple = ",".join([
                f"fps={params.fps}",
                f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}",
                f"pad=iw+{params.crop_left + params.crop_right}:ih+{params.crop_top + params.crop_bottom}:{params.crop_left}:{params.crop_top}:black",
                noise_filter,
            ])
            af_simple = f"{eq_filter},asetrate={pitch_rate},aresample=44100,{tempo_filter}"
            cmd_fallback = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-vf", vf_simple,
                "-af", af_simple,
                "-c:v", params.codec,
                "-b:v", params.video_bitrate,
                "-preset", "medium",
                "-c:a", "aac",
                "-b:a", params.audio_bitrate,
                "-ar", "44100",
                "-map_metadata", "-1",
                output_path,
                "-loglevel", "error",
            ]
            returncode2, stderr2 = await FFmpegOps.run(cmd_fallback, timeout=600)
            if returncode2 != 0:
                raise RuntimeError(f"FFmpeg forgery failed: {stderr2[:300]}")


    @staticmethod
    async def get_video_info(path: str) -> dict:
        """Get video metadata using ffprobe."""
        cmd = [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams", "-show_format",
            path,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        try:
            return json.loads(stdout.decode())
        except Exception:
            return {}


# ---------------------------------------------------------------------------
# Gemini Vision Analysis
# ---------------------------------------------------------------------------

async def analyze_with_gemini(video_path: str, api_key: str) -> dict:
    """
    Use Gemini Vision to analyze the video and suggest optimal noise injection points.
    Returns analysis dict with quality assessment.
    """
    try:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-3.1-pro-preview")

        # Upload video file for analysis
        with open(video_path, "rb") as f:
            video_data = f.read()

        # Analyze visual quality and suggest parameters
        response = model.generate_content([
            {
                "mime_type": "video/mp4",
                "data": video_data[:1_000_000],  # First 1MB for efficiency
            },
            """Analyze this video for content quality. Return JSON with:
            {
              "quality_score": 0-100,
              "content_type": "talking_head|product_demo|lifestyle|tutorial|other",
              "has_text_overlay": true/false,
              "primary_colors": ["hex1", "hex2"],
              "recommended_noise_level": 1-5,
              "recommended_crop_safe_zone": "tight|normal|loose"
            }
            Respond ONLY with valid JSON."""
        ])

        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)

    except Exception as e:
        logger.warning(f"[Gemini] Analysis failed (non-fatal): {e}")
        return {"quality_score": 75, "content_type": "other", "recommended_noise_level": 3}


# ---------------------------------------------------------------------------
# Variation Generator
# ---------------------------------------------------------------------------

class VariationGenerator:
    """Generates 3 forged variations from a single scraped video."""

    def __init__(self, config=None):
        self.config = config or get_config()
        self.ffmpeg = FFmpegOps()

    async def generate(
        self,
        scraped_content_id: str,
        video_path: str,
        gps_lat_center: float = 47.3769,
        gps_lon_center: float = 8.5417,
        device_profile: DeviceProfile = DeviceProfile.IPHONE_15_PRO,
    ) -> list[VideoVariation]:
        """
        Run the full forgery pipeline and return 3 unique VideoVariation objects.
        Each variation is saved to data/videos/variations/{scraped_id}/{index}/
        """
        # Optional: Gemini analysis for quality insights
        gemini_result = {}
        if self.config.gemini_api_key:
            logger.info(f"[Forgery] Running Gemini Vision analysis...")
            gemini_result = await analyze_with_gemini(video_path, self.config.gemini_api_key)
            logger.info(f"[Forgery] Gemini: quality={gemini_result.get('quality_score', '?')}")

        variations = []
        for i, preset in enumerate(VARIATION_PRESETS[:self.config.num_variations]):
            logger.info(f"[Forgery] Generating variation {['A','B','C'][i]}...")

            # Build output path
            out_dir = self.config.videos_dir / "variations" / scraped_content_id
            out_dir.mkdir(parents=True, exist_ok=True)
            output_path = str(out_dir / f"variation_{['A','B','C'][i]}.mp4")

            # Randomize GPS for this variation
            gps_lat = gps_lat_center + random.uniform(-0.008, 0.008)
            gps_lon = gps_lon_center + random.uniform(-0.008, 0.008)

            # Build forge params from preset
            params = ForgeParams(
                fps=preset["fps"],
                crop_top=preset["crop_top"],
                crop_bottom=preset["crop_bottom"],
                crop_left=preset["crop_left"],
                crop_right=preset["crop_right"],
                audio_pitch_shift=preset["audio_pitch_shift"],
                video_bitrate=preset["video_bitrate"],
                audio_bitrate=preset["audio_bitrate"],
                codec=preset["codec"],
                noise_seed=preset["noise_seed"],
                gps_latitude=round(gps_lat, 6),
                gps_longitude=round(gps_lon, 6),
                device_profile=device_profile,
            )

            # Adjust noise level based on Gemini recommendation
            if gemini_result.get("recommended_noise_level"):
                noise_level = min(5, gemini_result["recommended_noise_level"])
                # Higher noise = more unique but slightly more visible
                params.noise_seed = preset["noise_seed"] + (noise_level * 7)

            # Apply forgery
            await FFmpegOps.apply_forgery(video_path, output_path, params)

            # Verify output exists and compute hash
            if not Path(output_path).exists():
                raise RuntimeError(f"Forgery failed: output file not created ({output_path})")

            output_hash = sha256_file(output_path)
            logger.success(
                f"[Forgery] ✅ Variation {['A','B','C'][i]}: "
                f"{output_hash[:12]}... ({Path(output_path).stat().st_size // 1024}KB)"
            )

            var = VideoVariation(
                scraped_content_id=scraped_content_id,
                variation_index=i,
                video_path=output_path,
                video_hash=output_hash,
                forge_params=params,
                cleanse_status=CleanseStatus.DONE,
                cleansed_at=datetime.now(timezone.utc),
                gemini_analysis=gemini_result if i == 0 else {},  # store analysis on first var only
            )
            var.generate_id()
            variations.append(var)

        return variations
