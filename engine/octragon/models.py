"""Octagon — Minimal core models. Ponytail: keep only farm warmth."""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

class DeviceProfile(str, Enum):
    IPHONE_15_PRO = "iphone_15_pro"
    IPHONE_15_PRO_MAX = "iphone_15_pro_max"
    IPHONE_16_PRO = "iphone_16_pro"

class NicheType(str, Enum):
    ECOM = "ecom"
    AI_TECH = "ai_tech"
    BUSINESS = "business"
    LIFESTYLE = "lifestyle"

class TargetPlatform(str, Enum):
    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"
    YOUTUBE = "youtube"

@dataclass
class NicheConfig:
    phone_number: int = 1
    niche: NicheType = NicheType.ECOM
    niche_name: str = ""
    telegram_group_id: str = ""
    tiktok_handle: str = ""
    instagram_handle: str = ""
    linkedin_handle: str = ""
    gps_lat_center: float = 47.3769
    gps_lon_center: float = 8.5417
    gps_radius: float = 0.01
    device_profile: DeviceProfile = DeviceProfile.IPHONE_15_PRO
    platforms: list[TargetPlatform] = field(default_factory=list)
    active: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
