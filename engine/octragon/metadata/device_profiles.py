"""
Octragon System — Elite iPhone Device Profiles

Full Apple EXIF + MakerNote field templates for each supported device.
These profiles mimic authentic iPhone video metadata at the forensic level,
including Apple MakerNote sub-fields that forensic detectors specifically
check for when identifying manipulated or synthetic files.

Key principle: Every field must be internally consistent:
  - GPS coordinates → timezone offset → CreateDate timezone suffix
  - iOS version → matches device model release date window
  - Software version → matches iOS version
  - ContentIdentifier & MediaGroupUUID → valid UUID4 format
  - HandlerDescription → "Core Media Data Handler" (not FFmpeg)

Niche-to-city mapping (GPS center ↔ timezone):
  Phone 1 (E-com):     Zurich, CH      (47.3769, 8.5417)  UTC+1/+2
  Phone 2 (AI/Tech):   Berlin, DE      (52.5200, 13.4050) UTC+1/+2
  Phone 3 (Business):  London, UK      (51.5074, -0.1278) UTC+0/+1
  Phone 4 (Lifestyle): Barcelona, ES   (41.3851, 2.1734)  UTC+1/+2
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional


# ---------------------------------------------------------------------------
# iOS & Device Version Tables
# ---------------------------------------------------------------------------

# Maps device model → plausible iOS version ranges (major.minor.patch)
DEVICE_IOS_MAP: dict[str, list[str]] = {
    "iphone_15_pro": [
        "17.0", "17.0.1", "17.0.2", "17.0.3",
        "17.1", "17.1.1", "17.1.2",
        "17.2", "17.2.1",
        "17.3", "17.3.1",
        "17.4", "17.4.1",
        "17.5", "17.5.1",
        "17.6", "17.6.1",
    ],
    "iphone_15_pro_max": [
        "17.0", "17.0.1", "17.0.2", "17.0.3",
        "17.1", "17.1.1", "17.1.2",
        "17.2", "17.2.1",
        "17.3", "17.3.1",
        "17.4", "17.4.1",
        "17.5", "17.5.1",
        "17.6", "17.6.1",
    ],
    "iphone_16_pro": [
        "18.0", "18.0.1",
        "18.1", "18.1.1",
        "18.2", "18.2.1",
        "18.3", "18.3.1", "18.3.2",
    ],
}

# Apple device model string → EXIF Make+Model values
DEVICE_EXIF_MODEL: dict[str, dict] = {
    "iphone_15_pro": {
        "Make": "Apple",
        "Model": "iPhone 15 Pro",
        "LensModel": "iPhone 15 Pro back triple camera 6.765mm f/1.78",
        "XResolution": 72,
        "YResolution": 72,
    },
    "iphone_15_pro_max": {
        "Make": "Apple",
        "Model": "iPhone 15 Pro Max",
        "LensModel": "iPhone 15 Pro Max back triple camera 6.765mm f/1.78",
        "XResolution": 72,
        "YResolution": 72,
    },
    "iphone_16_pro": {
        "Make": "Apple",
        "Model": "iPhone 16 Pro",
        "LensModel": "iPhone 16 Pro back triple camera 6.765mm f/1.78",
        "XResolution": 72,
        "YResolution": 72,
    },
}

# Niche phone → geographic center
PHONE_GEO: dict[int, dict] = {
    1: {"city": "Zurich",    "tz_offset": "+01:00", "country": "CH"},
    2: {"city": "Berlin",    "tz_offset": "+01:00", "country": "DE"},
    3: {"city": "London",    "tz_offset": "+00:00", "country": "GB"},
    4: {"city": "Barcelona", "tz_offset": "+01:00", "country": "ES"},
}


# ---------------------------------------------------------------------------
# Profile Generator
# ---------------------------------------------------------------------------

@dataclass
class AppleExifProfile:
    """Complete Apple EXIF + MakerNote field profile for a video variation."""
    # Core device
    make: str = "Apple"
    model: str = "iPhone 15 Pro"
    lens_model: str = ""
    software: str = "17.4"

    # Timestamps (all consistent with each other)
    create_date: str = ""        # YYYY:MM:DD HH:MM:SS+TZ
    media_create_date: str = ""  # same
    modify_date: str = ""        # same (minor second offset)

    # GPS
    gps_latitude: float = 47.3769
    gps_longitude: float = 8.5417
    gps_altitude: float = 430.0
    gps_speed: float = 0.0
    gps_date_stamp: str = ""     # YYYY:MM:DD (must match create_date date)
    gps_time_stamp: str = ""     # HH:MM:SS (must match create_date time, UTC)

    # Apple MakerNote UUIDs
    content_identifier: str = ""   # UUID4
    media_group_uuid: str = ""     # UUID4

    # Video properties
    handler_description: str = "Core Media Data Handler"
    encoder: str = ""  # cleared — no FFmpeg trace

    # Camera settings (realistic iPhone video values)
    exposure_time: str = "1/60"
    f_number: float = 1.78
    iso: int = field(default_factory=lambda: random.choice([64, 100, 160, 200, 320, 400]))
    focal_length: str = "6.8 mm"
    white_balance: str = "Auto"


def generate_profile(
    device_key: str,
    phone_number: int,
    gps_lat: float,
    gps_lon: float,
    capture_time: Optional[datetime] = None,
) -> AppleExifProfile:
    """
    Generate a complete, internally consistent Apple EXIF profile.

    Args:
        device_key: one of 'iphone_15_pro', 'iphone_15_pro_max', 'iphone_16_pro'
        phone_number: 1-4 (determines timezone and city)
        gps_lat: GPS latitude for this variation
        gps_lon: GPS longitude for this variation
        capture_time: UTC datetime for the footage; defaults to "now minus 2-12 hours"

    Returns:
        AppleExifProfile with all fields filled consistently
    """
    geo = PHONE_GEO.get(phone_number, PHONE_GEO[1])
    device_exif = DEVICE_EXIF_MODEL.get(device_key, DEVICE_EXIF_MODEL["iphone_15_pro"])

    # iOS version consistent with device
    ios_versions = DEVICE_IOS_MAP.get(device_key, DEVICE_IOS_MAP["iphone_15_pro"])
    ios_version = random.choice(ios_versions)

    # Capture time: simulate a realistic past capture
    if capture_time is None:
        hours_ago = random.randint(2, 12)
        capture_time = datetime.now(timezone.utc) - timedelta(hours=hours_ago)

    # Compute local time using tz_offset
    tz_str = geo["tz_offset"]
    tz_hours = int(tz_str.replace("+", "").replace("-", "").split(":")[0])
    tz_sign = 1 if "+" in tz_str else -1
    local_time = capture_time + timedelta(hours=tz_hours * tz_sign)

    # Format timestamps
    local_ts = local_time.strftime("%Y:%m:%d %H:%M:%S") + tz_str
    # Modify date: 1-3 seconds later (realistic)
    modify_offset = random.randint(1, 3)
    modify_time = local_time + timedelta(seconds=modify_offset)
    modify_ts = modify_time.strftime("%Y:%m:%d %H:%M:%S") + tz_str

    # GPS date/time must be in UTC
    gps_date = capture_time.strftime("%Y:%m:%d")
    gps_time = capture_time.strftime("%H:%M:%S")

    # Random GPS altitude (plausible for the city)
    altitude_map = {1: 430.0, 2: 34.0, 3: 11.0, 4: 12.0}
    base_alt = altitude_map.get(phone_number, 50.0)
    gps_altitude = round(base_alt + random.uniform(-20, 20), 1)

    # Generate unique Apple MakerNote UUIDs
    content_id = str(uuid.uuid4()).upper()
    group_uuid = str(uuid.uuid4()).upper()

    return AppleExifProfile(
        make=device_exif["Make"],
        model=device_exif["Model"],
        lens_model=device_exif.get("LensModel", ""),
        software=ios_version,
        create_date=local_ts,
        media_create_date=local_ts,
        modify_date=modify_ts,
        gps_latitude=round(gps_lat, 6),
        gps_longitude=round(gps_lon, 6),
        gps_altitude=gps_altitude,
        gps_speed=round(random.uniform(0, 0.5), 2),  # near-zero, not exactly 0
        gps_date_stamp=gps_date,
        gps_time_stamp=gps_time,
        content_identifier=content_id,
        media_group_uuid=group_uuid,
        handler_description="Core Media Data Handler",
        encoder="",
        iso=random.choice([64, 100, 160, 200, 320, 400]),
    )


def profile_to_exiftool_args(profile: AppleExifProfile) -> list[str]:
    """
    Convert an AppleExifProfile to a list of exiftool CLI arguments.
    All tags are write-safe and cross-field consistent.
    """
    args = [
        # Core device fields
        f"-Make={profile.make}",
        f"-Model={profile.model}",
        f"-Software={profile.software}",

        # Timestamps (consistent across all date tags)
        f"-CreateDate={profile.create_date}",
        f"-DateTimeOriginal={profile.create_date}",
        f"-MediaCreateDate={profile.media_create_date}",
        f"-MediaModifyDate={profile.modify_date}",
        f"-TrackCreateDate={profile.create_date}",
        f"-TrackModifyDate={profile.modify_date}",
        f"-ModifyDate={profile.modify_date}",

        # GPS fields — all consistent
        f"-GPSLatitude={abs(profile.gps_latitude)}",
        f"-GPSLatitudeRef={'N' if profile.gps_latitude >= 0 else 'S'}",
        f"-GPSLongitude={abs(profile.gps_longitude)}",
        f"-GPSLongitudeRef={'E' if profile.gps_longitude >= 0 else 'W'}",
        f"-GPSAltitude={profile.gps_altitude}",
        f"-GPSAltitudeRef=Above Sea Level",
        f"-GPSSpeed={profile.gps_speed}",
        f"-GPSSpeedRef=K",
        f"-GPSDateStamp={profile.gps_date_stamp}",
        f"-GPSTimeStamp={profile.gps_time_stamp}",

        # Apple MakerNote fields
        f"-Apple:ContentIdentifier={profile.content_identifier}",
        f"-Apple:MediaGroupUUID={profile.media_group_uuid}",
        f"-Apple:RunTime=",  # clear — variable
        f"-Apple:MediaType=0",  # 0 = video

        # Handler metadata — erase FFmpeg traces
        f"-HandlerDescription={profile.handler_description}",
        f"-Encoder=",
        f"-EncodingTool=",
        f"-EncodedBy=",
        f"-Comment=",

        # Camera settings
        f"-ExposureTime={profile.exposure_time}",
        f"-FNumber={profile.f_number}",
        f"-ISO={profile.iso}",
        f"-FocalLength={profile.focal_length}",
        f"-WhiteBalance={profile.white_balance}",
    ]

    if profile.lens_model:
        args.append(f"-LensModel={profile.lens_model}")

    return args
