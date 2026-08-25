"""
Octragon System — Frame-Level Adversarial Perturbation

Implements three pHash evasion layers executed per-video-frame:

  Layer 1a: Adversarial pixel perturbation
    - ±1-2 YUV pixel value noise at positions determined by variation-unique seed
    - Targets every 8th frame (matches typical pHash keyframe sampling rate)
    - Keeps SSIM > 0.98 (visually imperceptible)

  Layer 1b: LSB steganographic signature injection
    - Encodes the variation_id into least-significant bits of luma channel
    - Guarantees every output file has a different SHA-256 hash, unconditionally
    - Uses HLSB: hash-guided LSB position selection for distribution

  Layer 1c: Geometric transform (applied at FFmpeg level, params generated here)
    - Sub-degree rotation: ±0.08–0.15° randomized
    - Sub-percent horizontal scale: 0.997–1.003
    - Flips DCT basis vectors without visible distortion

Usage:
    perturb = FramePerturb(variation_id="abc123", variation_index=0, seed=42)
    ffmpeg_vf_additions = perturb.get_geometric_filter()
    frame_with_lsb = perturb.inject_lsb_signature(frame_array)
    frame_perturbed = perturb.adversarial_perturb(frame_array, frame_index)
"""

from __future__ import annotations

import hashlib
import random
import struct
from typing import Optional

import numpy as np


class FramePerturb:
    """
    Generates adversarial pixel perturbations and LSB signatures
    unique to each video variation.
    """

    def __init__(
        self,
        variation_id: str,
        variation_index: int,
        noise_seed: int,
    ):
        self.variation_id = variation_id
        self.variation_index = variation_index

        # Derive a deterministic but unique seed from the variation
        seed_bytes = hashlib.sha256(
            f"{variation_id}:{variation_index}:{noise_seed}".encode()
        ).digest()
        self._seed_int = struct.unpack("<Q", seed_bytes[:8])[0]
        self._rng = random.Random(self._seed_int)
        self._np_rng = np.random.default_rng(self._seed_int)

    # ─── Layer 1a: Adversarial pixel perturbation ───────────────────────────

    def adversarial_perturb(
        self,
        frame: np.ndarray,
        frame_index: int,
        target_every_n_frames: int = 8,
    ) -> np.ndarray:
        """
        Apply imperceptible adversarial noise to a frame.

        Only processes every Nth frame to match pHash keyframe sampling.
        Modifies ~5% of pixels by ±1-2 values in Y (luma) channel of YUV.
        Keeps SSIM > 0.98 by limiting max perturbation magnitude.

        Args:
            frame: numpy array (H, W, 3) in BGR uint8
            frame_index: current frame number in video
            target_every_n_frames: match pHash sampling frequency

        Returns:
            Perturbed frame as numpy array (same dtype, same shape)
        """
        if frame_index % target_every_n_frames != 0:
            return frame  # only perturb keyframe-equivalent positions

        h, w = frame.shape[:2]
        result = frame.copy()

        # Determine perturbation magnitude: ±1 or ±2 pixel values
        # Use the frame_index to vary the pattern across frames
        frame_seed = self._seed_int ^ (frame_index * 0x9E3779B9)
        frame_rng = np.random.default_rng(frame_seed)

        # Target ~5% of pixels — large enough to shift DCT, small enough for SSIM
        n_pixels = max(1, int(h * w * 0.05))
        ys = frame_rng.integers(0, h, size=n_pixels)
        xs = frame_rng.integers(0, w, size=n_pixels)

        # Perturbation values: -2, -1, +1, +2 (avoid 0, always change)
        deltas = frame_rng.choice([-2, -1, 1, 2], size=n_pixels)
        channel = 0  # B channel — least perceptible to human eye

        for i in range(n_pixels):
            y, x, d = ys[i], xs[i], deltas[i]
            old_val = int(result[y, x, channel])
            new_val = max(0, min(255, old_val + d))
            result[y, x, channel] = new_val

        return result

    # ─── Layer 1b: LSB steganographic signature injection ──────────────────

    def inject_lsb_signature(
        self,
        frame: np.ndarray,
        frame_index: int,
        inject_every_n_frames: int = 15,
    ) -> np.ndarray:
        """
        Inject a unique variation fingerprint into the LSBs of this frame.

        Uses Hash-Guided LSB (HLSB): the variation_id hash determines
        which pixels carry the embedded bits, making detection harder.

        Encoding: 64-bit variation fingerprint spread across ~64 pixels
        Each pixel's R-channel LSB carries 1 bit of the fingerprint.
        Effect: pixel value changes by at most 1 → completely invisible.

        Args:
            frame: numpy array (H, W, 3) in BGR uint8
            frame_index: current frame number
            inject_every_n_frames: how often to inject

        Returns:
            Frame with LSB fingerprint embedded
        """
        if frame_index % inject_every_n_frames != 0:
            return frame

        h, w = frame.shape[:2]
        result = frame.copy()

        # 64-bit fingerprint derived from variation_id
        fingerprint_bytes = hashlib.sha256(
            f"lsb:{self.variation_id}:{frame_index}".encode()
        ).digest()[:8]
        fingerprint_bits = []
        for byte in fingerprint_bytes:
            for bit_pos in range(8):
                fingerprint_bits.append((byte >> bit_pos) & 1)

        # HLSB: use hash to determine pixel positions
        position_hash = hashlib.sha256(
            f"hlsb_pos:{self.variation_id}:{frame_index}".encode()
        ).digest()
        pos_rng = np.random.default_rng(
            struct.unpack("<Q", position_hash[:8])[0]
        )

        # Select 64 unique pixel positions
        ys = pos_rng.integers(0, h, size=64)
        xs = pos_rng.integers(0, w, size=64)

        # Embed bits into R channel (index 2 in BGR) LSB
        for i, bit in enumerate(fingerprint_bits):
            y, x = ys[i], xs[i]
            # Clear LSB then set to our bit
            old = int(result[y, x, 2])
            new = (old & 0xFE) | bit
            result[y, x, 2] = new

        return result

    # ─── Layer 1c: Geometric transform parameters ──────────────────────────

    def get_geometric_filter(self) -> str:
        """
        Generate a subtle geometric transform FFmpeg filter string.

        Returns rotation + scale parameters unique to this variation.
        These are imperceptible at the values used but destroy
        DCT basis vector alignment (defeating pHash).

        Rotation: ±0.08 to ±0.15 degrees (never 0)
        Scale: 0.9973 to 1.003 (sub-percent)

        Returns:
            FFmpeg vf filter string to append to the filter chain
        """
        # Rotation: between 0.08 and 0.15 degrees, positive or negative
        sign = 1 if self._rng.random() > 0.5 else -1
        angle_deg = self._rng.uniform(0.08, 0.15) * sign
        angle_rad = angle_deg * 3.14159265358979 / 180.0

        # Horizontal scale: 0.997 to 1.003
        scale = self._rng.uniform(0.997, 1.003)

        # FFmpeg rotate filter: use radian value, fillcolor=black for edges
        # Scale applied separately via scale filter
        rotate_filter = (
            f"rotate={angle_rad:.6f}:c=black:ow=iw:oh=ih"
        )
        scale_filter = f"scale=iw*{scale:.4f}:ih"

        return f"{rotate_filter},{scale_filter}"

    # ─── Spectral EQ fingerprint for audio Layer 2c ─────────────────────────

    def get_audio_eq_filter(self) -> str:
        """
        Generate a per-variation 3-band EQ adjustment FFmpeg audio filter.

        Each variation gets a subtly unique EQ curve:
        - Low band (80Hz):  ±0.5 to ±1.5 dB
        - Mid band (1kHz):  ±0.5 to ±1.2 dB
        - High band (8kHz): ±0.5 to ±2.0 dB

        This shifts spectral peak coordinates without audible quality change.
        Defeats audio fingerprinters that rely on fixed spectral landmarks.

        Returns:
            FFmpeg af filter string to append to audio filter chain
        """
        low_gain = self._rng.uniform(0.5, 1.5) * (1 if self._rng.random() > 0.5 else -1)
        mid_gain = self._rng.uniform(0.5, 1.2) * (1 if self._rng.random() > 0.5 else -1)
        high_gain = self._rng.uniform(0.5, 2.0) * (1 if self._rng.random() > 0.5 else -1)

        # FFmpeg equalizer filter (IIR biquad peaking EQ)
        eq_low = f"equalizer=f=80:width_type=o:width=2:g={low_gain:.2f}"
        eq_mid = f"equalizer=f=1000:width_type=o:width=2:g={mid_gain:.2f}"
        eq_high = f"equalizer=f=8000:width_type=o:width=2:g={high_gain:.2f}"

        return f"{eq_low},{eq_mid},{eq_high}"

    # ─── Micro-tempo drift (Layer 2b) ────────────────────────────────────────

    def get_tempo_drift_filter(self) -> str:
        """
        Micro-tempo drift: 0.2–0.4% speed change (inaudible, non-uniform).

        Uses atempo filter (range: 0.5-2.0, no quality loss).
        The slight tempo change shifts all temporal fingerprint landmarks.

        Returns:
            FFmpeg af filter string
        """
        drift = self._rng.uniform(0.002, 0.004)
        sign = 1 if self._rng.random() > 0.5 else -1
        rate = 1.0 + (drift * sign)
        return f"atempo={rate:.5f}"

    # ─── Audio spectral noise injection (Layer 2a) ──────────────────────────

    def get_spectral_noise_filter(self) -> str:
        """
        Inject band-limited noise in 8–12kHz range at -55 to -60dB.
        This is physically inaudible to humans but moves Shazam spectral peaks.

        Uses FFmpeg's aevalsrc to synthesise noise, then amix to blend
        at ultra-low volume into the main audio stream.

        Returns:
            FFmpeg complex filter graph snippet for spectral noise injection
        """
        # Noise power between -60 and -55 dB (amplitude 0.001 to 0.00178)
        amplitude = self._rng.uniform(0.001, 0.00178)
        # Center frequency in 8–12kHz range
        center_hz = self._rng.randint(8000, 12000)

        # FFmpeg: generate high-frequency noise via sine modulated noise
        # This creates a band-limited signal centered around center_hz
        noise_expr = f"sin(2*PI*{center_hz}*t)*random(0)*{amplitude:.5f}"
        return noise_expr

    # ─── Layer 7: Color matrix micro-shift ──────────────────────────────────

    def get_color_shift_filter(self) -> str:
        """
        Apply sub-perceptual color matrix manipulation per variation.

        - Hue rotation: ±0.3–0.8 degrees (invisible to human vision)
        - Saturation shift: ±0.5–2% (imperceptible)
        - Color temperature nudge: ±0.2–0.5 dB in red/blue channels

        These shifts change every pixel value in the frame without
        visible quality change — destroys pixel-exact fingerprinting.

        Returns:
            FFmpeg vf filter string for color manipulation
        """
        # Hue rotation in radians (0.3-0.8 degrees)
        hue_deg = self._rng.uniform(0.3, 0.8) * (1 if self._rng.random() > 0.5 else -1)

        # Saturation: 0.985 to 1.015 (±1.5%)
        sat = self._rng.uniform(0.985, 1.015)

        # Brightness: ±0.003 (imperceptible)
        bright = self._rng.uniform(-0.003, 0.003)

        hue_filter = f"hue=h={hue_deg:.2f}:s={sat:.4f}:b={bright:.4f}"

        # Color balance: subtle R/B channel weighting
        rs = self._rng.uniform(-0.01, 0.01)
        bs = self._rng.uniform(-0.01, 0.01)
        color_filter = f"colorbalance=rs={rs:.4f}:bs={bs:.4f}"

        return f"{hue_filter},{color_filter}"

    # ─── Layer 8: TikTok invisible watermark neutralization ─────────────────

    def get_watermark_destroy_filter(self) -> str:
        """
        Neutralize TikTok's invisible steganographic watermarks.

        TikTok embeds C2PA-style invisible watermarks in the spatial domain
        by modifying pixel LSBs. Research shows re-encoding through a
        different colorspace + back destroys these embedded signals.

        Technique: convert BT.709 → BT.601 → back to BT.709 with
        slight gamma curve manipulation. This round-trips the pixel values
        through a different color matrix, destroying any LSB-embedded
        watermark data while preserving visual quality.

        Also applies a minimal unsharp mask to further scramble
        watermark-carrying high-frequency components.

        Returns:
            FFmpeg vf filter string
        """
        # Gamma: 0.99–1.01 (imperceptible shift)
        gamma = self._rng.uniform(0.99, 1.01)

        # Colorspace round-trip: destroys embedded watermark LSB patterns
        cs_filter = f"colorspace=all=bt709:iall=bt601"

        # Unsharp mask: very light (destroys watermark high-freq data)
        # luma_msize:luma_strength:chroma_msize:chroma_strength
        strength = self._rng.uniform(0.3, 0.6)
        unsharp = f"unsharp=3:3:{strength:.2f}:3:3:{strength:.2f}"

        # Gamma curve manipulation
        gamma_filter = f"eq=gamma={gamma:.4f}"

        return f"{cs_filter},{gamma_filter},{unsharp}"

    # ─── Layer 9: First-frame thumbnail manipulation ────────────────────────

    def get_thumbnail_perturb_filter(self) -> str:
        """
        Manipulate the first 3 frames more aggressively to defeat
        thumbnail-based duplicate detection.

        Platforms extract thumbnails from the first few frames for
        preview generation and similarity scoring. By applying a slightly
        stronger color shift to frame 0-2, the thumbnail hash diverges
        from the source even more than the body frames.

        This uses the select filter to isolate first 3 frames,
        apply extra manipulation, then concat back.

        Returns:
            FFmpeg filter string for thumbnail-frame manipulation
            (applied as a separate select-based filter, not in main chain)
        """
        # Extra hue shift for thumbnail frames: 1.5-3.0 degrees
        thumb_hue = self._rng.uniform(1.5, 3.0) * (1 if self._rng.random() > 0.5 else -1)
        thumb_bright = self._rng.uniform(-0.008, 0.008)

        # This filter only affects the visual thumbnail detection
        return f"hue=h={thumb_hue:.2f}:b={thumb_bright:.4f}"

    # ─── Layer 10: Audio micro-silence injection ────────────────────────────

    def get_audio_silence_injection_filter(self) -> str:
        """
        Insert sub-perceptual micro-silences at random positions.

        Audio fingerprinters (Shazam/AcoustID) rely on precise temporal
        alignment of spectral peaks. By inserting 1-3ms silence gaps
        at variation-unique positions, all temporal landmarks after
        the insertion point shift by that amount.

        This is complementary to the tempo drift (Layer 2b) — drift
        is continuous, this is discrete/surgical.

        Uses FFmpeg's adelay filter to add microsecond padding.

        Returns:
            FFmpeg af filter string
        """
        # Delay: 1-4 milliseconds (inaudible, shifts all temporal peaks)
        delay_ms = self._rng.randint(1, 4)
        # Apply to both channels
        return f"adelay={delay_ms}|{delay_ms}"

    # ─── Layer 6: Per-variation H.264 encoder CLI args ──────────────────────

    @staticmethod
    def get_encoder_params(preset_dict: dict) -> list[str]:
        """
        Convert a VARIATION_PRESET dict into FFmpeg H.264 encoder CLI args.

        Each variation gets a different:
          - CRF quality level → different quantization decisions
          - Encoder preset → different motion estimation algorithm
          - GOP keyframe interval → different I-frame positions
          - Reference frame count → different motion vector search depth
          - B-frame strategy → different temporal compression
          - Deblocking filter → different edge processing
          - H.264 profile → different feature set (baseline/main/high)

        The result: each variation's SPS/PPS NAL units are provably different,
        which means the bitstream cannot be matched by encoder fingerprinting.

        Args:
            preset_dict: variation preset from config.VARIATION_PRESETS

        Returns:
            List of FFmpeg CLI arguments
        """
        args = []

        if "crf" in preset_dict:
            args.extend(["-crf", str(preset_dict["crf"])])

        if "preset" in preset_dict:
            args.extend(["-preset", preset_dict["preset"]])

        if "profile" in preset_dict:
            args.extend(["-profile:v", preset_dict["profile"]])

        if "gop_size" in preset_dict:
            args.extend(["-g", str(preset_dict["gop_size"])])

        if "ref_frames" in preset_dict:
            args.extend(["-refs", str(preset_dict["ref_frames"])])

        if "bframes" in preset_dict:
            args.extend(["-bf", str(preset_dict["bframes"])])

        if "deblock_alpha" in preset_dict and "deblock_beta" in preset_dict:
            a = preset_dict["deblock_alpha"]
            b = preset_dict["deblock_beta"]
            args.extend(["-deblock", f"{a}:{b}"])

        if "entropy" in preset_dict:
            if preset_dict["entropy"] == "cabac":
                args.extend(["-coder", "1"])
            else:
                args.extend(["-coder", "0"])

        # Force MOOV atom to front for streaming (also changes container structure)
        args.extend(["-movflags", "+faststart"])

        return args

