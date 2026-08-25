"""
Phone Farm OS — Configuration

Loads from environment variables + provides sensible defaults.
Create a .env file in octragon-system/ with your real tokens.
"""

from __future__ import annotations

import os
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from .models import NicheConfig, NicheType, TargetPlatform, DeviceProfile

# Load .env from the project root
_PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


# ---------------------------------------------------------------------------
# Device Profiles
# ---------------------------------------------------------------------------

DEVICE_METADATA: dict[str, dict] = {
    "iphone_15_pro": {
        "Make": "Apple",
        "Model": "iPhone 15 Pro",
        "Software": "18.3.2",
        "CompressorName": "HEVC",
        "ImageWidth": 1080,
        "ImageHeight": 1920,
    },
    "iphone_15_pro_max": {
        "Make": "Apple",
        "Model": "iPhone 15 Pro Max",
        "Software": "18.3.1",
        "CompressorName": "HEVC",
        "ImageWidth": 1290,
        "ImageHeight": 2796,
    },
    "iphone_16_pro": {
        "Make": "Apple",
        "Model": "iPhone 16 Pro",
        "Software": "19.1",
        "CompressorName": "HEVC",
        "ImageWidth": 1206,
        "ImageHeight": 2622,
    },
}


# ---------------------------------------------------------------------------
# Forgery Parameter Presets — 3 variations per video
# ---------------------------------------------------------------------------

VARIATION_PRESETS = [
    # ═══════════════════════════════════════════════════════════════════════
    # Variation A — "Phone Camera Quality" profile
    # Uses: baseline H.264, faster preset, shorter GOP, fewer ref frames
    # This mimics a phone camera's real-time encoder behavior
    # ═══════════════════════════════════════════════════════════════════════
    {
        "fps": 29.97,
        "crop_top": 2, "crop_bottom": 2, "crop_left": 2, "crop_right": 2,
        "audio_pitch_shift": 1.018,
        "video_bitrate": "4500k",
        "audio_bitrate": "192k",
        "codec": "libx264",
        "noise_seed": 42,
        # Elite encoder params (Layer 6)
        "crf": 22,
        "preset": "fast",
        "profile": "high",
        "gop_size": 30,       # iOS-typical: keyframe every 1 second
        "ref_frames": 3,
        "bframes": 2,
        "deblock_alpha": 0,   # Default deblocking
        "deblock_beta": 0,
        "entropy": "cabac",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # Variation B — "Desktop Editing Software" profile
    # Uses: high profile, medium preset, longer GOP, more ref frames
    # This mimics DaVinci Resolve / Premiere Pro export settings
    # ═══════════════════════════════════════════════════════════════════════
    {
        "fps": 30.03,
        "crop_top": 3, "crop_bottom": 1, "crop_left": 2, "crop_right": 2,
        "audio_pitch_shift": 0.982,
        "video_bitrate": "5500k",
        "audio_bitrate": "256k",
        "codec": "libx264",
        "noise_seed": 137,
        # Elite encoder params (Layer 6)
        "crf": 19,
        "preset": "medium",
        "profile": "high",
        "gop_size": 72,       # 2.4s GOP — common NLE export
        "ref_frames": 5,
        "bframes": 3,
        "deblock_alpha": -1,  # Slightly less deblocking (sharper)
        "deblock_beta": -1,
        "entropy": "cabac",
    },
    # ═══════════════════════════════════════════════════════════════════════
    # Variation C — "Social Media Optimizer" profile
    # Uses: main profile, slower preset, medium GOP, moderate refs
    # This mimics CapCut / TikTok editor export
    # ═══════════════════════════════════════════════════════════════════════
    {
        "fps": 29.95,
        "crop_top": 1, "crop_bottom": 3, "crop_left": 3, "crop_right": 1,
        "audio_pitch_shift": 1.025,
        "video_bitrate": "3800k",
        "audio_bitrate": "160k",
        "codec": "libx264",
        "noise_seed": 256,
        # Elite encoder params (Layer 6)
        "crf": 24,
        "preset": "slow",
        "profile": "main",
        "gop_size": 48,       # 1.6s — social/mobile typical
        "ref_frames": 4,
        "bframes": 1,
        "deblock_alpha": 1,   # More deblocking (smoother)
        "deblock_beta": 1,
        "entropy": "cabac",
    },
]


# ---------------------------------------------------------------------------
# Niche Configurations (defaults — override via DB after setup)
# ---------------------------------------------------------------------------

def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


DEFAULT_NICHE_CONFIGS = [
    NicheConfig(
        phone_number=1,
        niche=NicheType.ECOM,
        niche_name="E-commerce / DTC",
        telegram_group_id=_env("TELEGRAM_GROUP_PHONE1", ""),
        tiktok_handle=_env("TIKTOK_PHONE1", "@your_handle_1"),
        instagram_handle=_env("INSTAGRAM_PHONE1", "@your_handle_1"),
        linkedin_handle=_env("LINKEDIN_PHONE1", ""),
        gps_lat_center=47.3769, gps_lon_center=8.5417, gps_radius=0.01,
        device_profile=DeviceProfile.IPHONE_15_PRO,
        platforms=[TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM, TargetPlatform.YOUTUBE,
                   TargetPlatform.LINKEDIN, TargetPlatform.TWITTER],
    ),
    NicheConfig(
        phone_number=2,
        niche=NicheType.AI_TECH,
        niche_name="AI / Tech",
        telegram_group_id=_env("TELEGRAM_GROUP_PHONE2", ""),
        tiktok_handle=_env("TIKTOK_PHONE2", "@your_handle_2"),
        instagram_handle=_env("INSTAGRAM_PHONE2", "@your_handle_2"),
        linkedin_handle="",
        gps_lat_center=47.3769, gps_lon_center=8.5417, gps_radius=0.01,
        device_profile=DeviceProfile.IPHONE_15_PRO_MAX,
        platforms=[TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM, TargetPlatform.YOUTUBE],
    ),
    NicheConfig(
        phone_number=3,
        niche=NicheType.BUSINESS,
        niche_name="Business / Founder",
        telegram_group_id=_env("TELEGRAM_GROUP_PHONE3", ""),
        tiktok_handle=_env("TIKTOK_PHONE3", "@your_handle_3"),
        instagram_handle=_env("INSTAGRAM_PHONE3", "@your_handle_3"),
        linkedin_handle=_env("LINKEDIN_PHONE3", ""),
        gps_lat_center=52.5200, gps_lon_center=13.4050, gps_radius=0.01,
        device_profile=DeviceProfile.IPHONE_16_PRO,
        platforms=[TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM, TargetPlatform.YOUTUBE],
    ),
    NicheConfig(
        phone_number=4,
        niche=NicheType.LIFESTYLE,
        niche_name="Lifestyle / Motivation",
        telegram_group_id=_env("TELEGRAM_GROUP_PHONE4", ""),
        tiktok_handle=_env("TIKTOK_PHONE4", "@your_handle_4"),
        instagram_handle=_env("INSTAGRAM_PHONE4", "@your_handle_4"),
        linkedin_handle="",
        gps_lat_center=51.5074, gps_lon_center=-0.1278, gps_radius=0.01,
        device_profile=DeviceProfile.IPHONE_15_PRO,
        platforms=[TargetPlatform.TIKTOK, TargetPlatform.INSTAGRAM, TargetPlatform.YOUTUBE],
    ),
]


# ---------------------------------------------------------------------------
# Global Config
# ---------------------------------------------------------------------------

@dataclass
class OctragonConfig:
    """Master configuration object."""
    # Telegram
    telegram_bot_token: str = field(default_factory=lambda: _env("TELEGRAM_BOT_TOKEN"))
    telegram_owner_id: int = field(default_factory=lambda: int(_env("TELEGRAM_OWNER_ID", "0")))

    # APIs
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY", ""))
    telethon_api_id: str = field(default_factory=lambda: _env("TELETHON_API_ID", ""))
    telethon_api_hash: str = field(default_factory=lambda: _env("TELETHON_API_HASH", ""))

    # Paths
    project_root: Path = field(default_factory=lambda: _PROJECT_ROOT)
    data_dir: Path = field(default_factory=lambda: _PROJECT_ROOT / "data")
    videos_dir: Path = field(default_factory=lambda: _PROJECT_ROOT / "data" / "videos")
    db_path: Path = field(default_factory=lambda: _PROJECT_ROOT / "data" / "db" / "farm.db")

    # Forgery settings
    num_variations: int = 3
    variation_presets: list[dict] = field(default_factory=lambda: VARIATION_PRESETS)
    device_metadata: dict = field(default_factory=lambda: DEVICE_METADATA)

    # Niche configs (loaded from DB on first run, falls back to defaults)
    niche_configs: list[NicheConfig] = field(default_factory=lambda: DEFAULT_NICHE_CONFIGS)

    # Scraper
    yt_dlp_cookies_dir: str = field(default_factory=lambda: _env("YT_DLP_COOKIES_DIR", ""))
    openclaw_bin: str = field(default_factory=lambda: _env(
        "OPENCLAW_BIN", "/opt/homebrew/bin/openclaw"
    ))
    download_timeout_seconds: int = 120

    # Video Editor (Agentic Visual Editor)
    video_editor_enabled: bool = True
    ecombrain_logo_path: Path = field(
        default_factory=lambda: _PROJECT_ROOT / "data" / "assets" / "logo.png"
    )

    def ensure_dirs(self):
        for d in [
            self.data_dir,
            self.videos_dir / "originals",
            self.videos_dir / "variations",
            self.videos_dir / "ready",
            self.videos_dir / "edited",
            self.data_dir / "assets",
            self.db_path.parent,
        ]:
            d.mkdir(parents=True, exist_ok=True)

    def get_niche_by_phone(self, phone: int) -> Optional[NicheConfig]:
        for nc in self.niche_configs:
            if nc.phone_number == phone:
                return nc
        return None

    def get_niche_by_group(self, group_id: str) -> Optional[NicheConfig]:
        for nc in self.niche_configs:
            if nc.telegram_group_id == group_id:
                return nc
        return None

    def randomize_gps(self, lat_center: float, lon_center: float,
                       radius: float = 0.01) -> tuple[float, float]:
        """Return randomized GPS coords within radius degrees."""
        lat = lat_center + random.uniform(-radius, radius)
        lon = lon_center + random.uniform(-radius, radius)
        return round(lat, 6), round(lon, 6)


# Singleton
_config: Optional[OctragonConfig] = None


def get_config() -> OctragonConfig:
    global _config
    if _config is None:
        _config = OctragonConfig()
        _config.ensure_dirs()
    return _config
