"""
Octragon Sensor Spoof — Accelerometer/Gyroscope Data Generator

Generates realistic hand-held motion data that matches the CoreMotion
fingerprint of a human holding and using a phone.

Three motion profiles:
  1. Idle Hold: Low-amplitude tremor (0.01-0.05g) simulating hand shake
  2. Active Browsing: Periodic micro-tilts during thumb swiping
  3. Walking Mode: Sinusoidal body-motion overlay on hand tremor

Output formats:
  - JSON (CoreMotion-compatible for injection)
  - CSV (for physical motion rig control via Arduino/RPi)

Usage:
  python farm/audit/sensor-spoof.py --mode=active --duration=60 --output=json
  python farm/audit/sensor-spoof.py --mode=walking --duration=30 --output=csv --file=motion.csv
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Generator


# ─── Constants ──────────────────────────────────────────────────────────────────

SAMPLE_RATE_HZ = 50  # CoreMotion typical: 50-100 Hz

# Gravity vector when phone held upright slightly tilted (portrait, ~75° from ground)
BASE_GRAVITY = {"x": 0.0, "y": -0.96, "z": -0.28}

# Hand tremor parameters (from medical research on physiological tremor)
TREMOR_FREQ_RANGE = (6.0, 12.0)     # Hz — human hand tremor frequency band
TREMOR_AMP_RANGE = (0.008, 0.045)   # g — amplitude of physiological tremor


# ─── Data Models ────────────────────────────────────────────────────────────────

@dataclass
class SensorSample:
    """One CoreMotion sample."""
    timestamp: float              # Seconds since session start
    accel_x: float                # User acceleration X (g)
    accel_y: float                # User acceleration Y (g)
    accel_z: float                # User acceleration Z (g)
    gravity_x: float              # Gravity X
    gravity_y: float              # Gravity Y
    gravity_z: float              # Gravity Z
    gyro_x: float                 # Rotation rate X (rad/s)
    gyro_y: float                 # Rotation rate Y (rad/s)
    gyro_z: float                 # Rotation rate Z (rad/s)


# ─── Motion Generators ─────────────────────────────────────────────────────────

def _tremor_component(t: float, seed: int = 0) -> tuple[float, float, float]:
    """Generate physiological hand tremor for a given timestamp."""
    rng = random.Random(seed)
    freq_x = rng.uniform(*TREMOR_FREQ_RANGE)
    freq_y = rng.uniform(*TREMOR_FREQ_RANGE)
    freq_z = rng.uniform(*TREMOR_FREQ_RANGE)
    amp = rng.uniform(*TREMOR_AMP_RANGE)

    # Add slight frequency modulation (tremor is not perfectly periodic)
    fm = math.sin(t * 0.3) * 0.5 + 1.0  # Slow modulation

    x = amp * math.sin(2 * math.pi * freq_x * t * fm) + rng.gauss(0, amp * 0.1)
    y = amp * math.sin(2 * math.pi * freq_y * t * fm + 1.2) + rng.gauss(0, amp * 0.1)
    z = amp * 0.5 * math.sin(2 * math.pi * freq_z * t * fm + 2.4) + rng.gauss(0, amp * 0.05)

    return x, y, z


def _swipe_gesture(t: float, last_swipe: float, swipe_duration: float = 0.4) -> tuple[float, float, float]:
    """
    Simulate thumb swipe acceleration.
    During a swipe, there's a brief spike in Y acceleration (upward push).
    """
    if last_swipe < 0:
        return 0.0, 0.0, 0.0

    elapsed = t - last_swipe
    if elapsed < 0 or elapsed > swipe_duration:
        return 0.0, 0.0, 0.0

    # Swipe profile: quick acceleration then deceleration
    phase = elapsed / swipe_duration
    if phase < 0.3:
        # Acceleration phase
        accel = math.sin(phase / 0.3 * math.pi / 2) * 0.8
    elif phase < 0.7:
        # Coast phase
        accel = 0.3
    else:
        # Deceleration phase
        accel = math.cos((phase - 0.7) / 0.3 * math.pi / 2) * 0.5

    return 0.0, accel, 0.0


def _walking_overlay(t: float) -> tuple[float, float, float]:
    """
    Simulate walking motion — sinusoidal body sway at ~2 Hz stride frequency.
    """
    stride_freq = random.uniform(1.6, 2.2)  # Steps per second
    body_amp = random.uniform(0.15, 0.35)  # g — body bounce amplitude

    # Vertical bounce (dominant during walking)
    z = body_amp * abs(math.sin(2 * math.pi * stride_freq * t))
    # Lateral sway
    x = body_amp * 0.3 * math.sin(2 * math.pi * stride_freq * t * 0.5)
    # Forward component
    y = body_amp * 0.15 * math.sin(2 * math.pi * stride_freq * t + 0.5)

    return x, y, z


def generate_motion(
    mode: str = "active",
    duration_seconds: float = 60.0,
    swipe_interval: float = 8.0,
) -> Generator[SensorSample, None, None]:
    """
    Generate a stream of realistic sensor samples.

    Args:
        mode: 'idle', 'active', or 'walking'
        duration_seconds: Total duration of motion data
        swipe_interval: Average seconds between swipe gestures (active mode)

    Yields:
        SensorSample objects at SAMPLE_RATE_HZ frequency
    """
    num_samples = int(duration_seconds * SAMPLE_RATE_HZ)
    dt = 1.0 / SAMPLE_RATE_HZ

    # Pre-generate swipe event times (for active/walking modes)
    swipe_times = []
    if mode in ("active", "walking"):
        t_swipe = random.uniform(2.0, 5.0)  # First swipe after a few seconds
        while t_swipe < duration_seconds:
            swipe_times.append(t_swipe)
            t_swipe += random.uniform(swipe_interval * 0.5, swipe_interval * 1.5)

    # Generate gravity drift (slow random walk — phone angle changes over time)
    gravity_x = BASE_GRAVITY["x"]
    gravity_y = BASE_GRAVITY["y"]
    gravity_z = BASE_GRAVITY["z"]
    gravity_drift_rate = 0.0003  # Degrees per sample

    tremor_seed = random.randint(0, 10000)
    next_swipe_idx = 0

    for i in range(num_samples):
        t = i * dt

        # 1. Base tremor (always present)
        tx, ty, tz = _tremor_component(t, tremor_seed)

        # 2. Mode-specific overlay
        sx, sy, sz = 0.0, 0.0, 0.0
        wx, wy, wz = 0.0, 0.0, 0.0

        if mode in ("active", "walking"):
            # Find the most recent swipe
            last_swipe = -1.0
            while next_swipe_idx < len(swipe_times) and swipe_times[next_swipe_idx] <= t:
                last_swipe = swipe_times[next_swipe_idx]
                next_swipe_idx += 1
            if next_swipe_idx > 0:
                last_swipe = swipe_times[next_swipe_idx - 1]
            sx, sy, sz = _swipe_gesture(t, last_swipe)

        if mode == "walking":
            wx, wy, wz = _walking_overlay(t)

        # Combine accelerations
        accel_x = tx + sx + wx
        accel_y = ty + sy + wy
        accel_z = tz + sz + wz

        # Gravity drift (slow random walk)
        gravity_x += random.gauss(0, gravity_drift_rate)
        gravity_y += random.gauss(0, gravity_drift_rate * 0.5)
        gravity_z += random.gauss(0, gravity_drift_rate * 0.3)

        # Normalize gravity vector
        grav_mag = math.sqrt(gravity_x**2 + gravity_y**2 + gravity_z**2)
        gx = gravity_x / grav_mag
        gy = gravity_y / grav_mag
        gz = gravity_z / grav_mag

        # Gyroscope: derive from acceleration changes + tremor
        gyro_x = tx * 2.0 + random.gauss(0, 0.01)
        gyro_y = ty * 1.5 + random.gauss(0, 0.01)
        gyro_z = tz * 1.0 + random.gauss(0, 0.005)

        yield SensorSample(
            timestamp=round(t, 4),
            accel_x=round(accel_x, 6),
            accel_y=round(accel_y, 6),
            accel_z=round(accel_z, 6),
            gravity_x=round(gx, 6),
            gravity_y=round(gy, 6),
            gravity_z=round(gz, 6),
            gyro_x=round(gyro_x, 6),
            gyro_y=round(gyro_y, 6),
            gyro_z=round(gyro_z, 6),
        )


# ─── Output ─────────────────────────────────────────────────────────────────────

def output_json(samples: list[SensorSample], filepath: str | None = None):
    """Output CoreMotion-compatible JSON."""
    data = {
        "sampleRate": SAMPLE_RATE_HZ,
        "samples": [asdict(s) for s in samples],
    }
    if filepath:
        Path(filepath).write_text(json.dumps(data, indent=2))
        print(f"✅ Written {len(samples)} samples to {filepath}")
    else:
        json.dump(data, sys.stdout, indent=2)


def output_csv(samples: list[SensorSample], filepath: str | None = None):
    """Output CSV for physical motion rig control."""
    header = "timestamp,accel_x,accel_y,accel_z,gravity_x,gravity_y,gravity_z,gyro_x,gyro_y,gyro_z"
    lines = [header]
    for s in samples:
        lines.append(
            f"{s.timestamp},{s.accel_x},{s.accel_y},{s.accel_z},"
            f"{s.gravity_x},{s.gravity_y},{s.gravity_z},"
            f"{s.gyro_x},{s.gyro_y},{s.gyro_z}"
        )
    text = "\n".join(lines)
    if filepath:
        Path(filepath).write_text(text)
        print(f"✅ Written {len(samples)} samples to {filepath}")
    else:
        print(text)


# ─── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Octragon Sensor Spoof — Motion Data Generator")
    parser.add_argument("--mode", choices=["idle", "active", "walking"], default="active",
                        help="Motion profile: idle (hand tremor only), active (browsing with swipes), walking")
    parser.add_argument("--duration", type=float, default=60.0,
                        help="Duration in seconds (default: 60)")
    parser.add_argument("--swipe-interval", type=float, default=8.0,
                        help="Average seconds between swipe gestures (default: 8)")
    parser.add_argument("--output", choices=["json", "csv"], default="json",
                        help="Output format (default: json)")
    parser.add_argument("--file", type=str, default=None,
                        help="Output file path (default: stdout)")

    args = parser.parse_args()

    print(f"🎛️ Generating {args.mode} motion data for {args.duration}s at {SAMPLE_RATE_HZ}Hz...",
          file=sys.stderr)

    samples = list(generate_motion(
        mode=args.mode,
        duration_seconds=args.duration,
        swipe_interval=args.swipe_interval,
    ))

    print(f"📊 Generated {len(samples)} samples", file=sys.stderr)

    if args.output == "json":
        output_json(samples, args.file)
    else:
        output_csv(samples, args.file)


if __name__ == "__main__":
    main()
