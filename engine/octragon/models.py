"""
Octragon System — Core Data Models

All scraped content, video variations, and delivery tracking flows through these models.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SourcePlatform(str, Enum):
    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"
    LINKEDIN = "linkedin"
    TWITTER = "twitter"
    YOUTUBE = "youtube"


class TargetPlatform(str, Enum):
    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"
    LINKEDIN = "linkedin"
    TWITTER = "twitter"
    YOUTUBE = "youtube"


class ScrapeStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    DOWNLOADED = "downloaded"
    FAILED = "failed"


class CleanseStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    POSTED = "posted"


class NicheType(str, Enum):
    ECOM = "ecom"           # E-commerce / DTC
    AI_TECH = "ai_tech"     # AI / Tech
    BUSINESS = "business"   # Business / Founder
    LIFESTYLE = "lifestyle" # Lifestyle / Motivation


class DeviceProfile(str, Enum):
    IPHONE_15_PRO = "iphone_15_pro"
    IPHONE_15_PRO_MAX = "iphone_15_pro_max"
    IPHONE_16_PRO = "iphone_16_pro"


# ---------------------------------------------------------------------------
# Scraped Content — raw video from competitor source
# ---------------------------------------------------------------------------

@dataclass
class ScrapedContent:
    """A viral video scraped from TikTok, Instagram, or LinkedIn."""
    id: str = ""
    source_url: str = ""
    source_platform: SourcePlatform = SourcePlatform.TIKTOK
    source_creator: str = ""          # @handle of original creator

    # Content
    caption: str = ""
    hashtags: list[str] = field(default_factory=list)
    duration_seconds: int = 0
    resolution: str = ""              # e.g. "1080x1920"

    # Local file paths
    video_path: str = ""              # path to downloaded MP4
    audio_path: str = ""              # path to extracted audio track
    video_hash: str = ""              # SHA256 of original file

    # Engagement metrics at time of scraping
    engagement_likes: int = 0
    engagement_comments: int = 0
    engagement_shares: int = 0
    engagement_views: int = 0

    # Routing
    target_niche: NicheType = NicheType.ECOM
    target_phone: int = 1             # 1-4

    # Telegram context
    telegram_group_id: str = ""
    telegram_message_id: int = 0

    # State
    scrape_status: ScrapeStatus = ScrapeStatus.PENDING
    scraped_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Raw metadata from original
    raw_metadata: dict = field(default_factory=dict)

    def generate_id(self) -> str:
        raw = f"scraped:{self.source_url}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id

    @property
    def engagement_total(self) -> int:
        return self.engagement_likes + self.engagement_comments + self.engagement_shares

    @property
    def virality_score(self) -> float:
        """Simple virality estimate: engagement rate × views weight."""
        if self.engagement_views == 0:
            return 0.0
        return min(100.0, (self.engagement_total / self.engagement_views) * 1000)


# ---------------------------------------------------------------------------
# Video Variation — a forgery-processed version of scraped content
# ---------------------------------------------------------------------------

@dataclass
class ForgeParams:
    """Parameters used to forge a unique video variation."""
    # Frame rate alteration
    fps: float = 29.97

    # Sub-pixel crop (pixels from each edge)
    crop_top: int = 2
    crop_bottom: int = 2
    crop_left: int = 2
    crop_right: int = 2

    # Audio pitch shift (multiplier, e.g. 1.02 = +2%)
    audio_pitch_shift: float = 1.02

    # Re-encoding
    video_bitrate: str = "4500k"
    audio_bitrate: str = "192k"
    codec: str = "libx264"
    noise_seed: int = 42

    # GPS for metadata injection
    gps_latitude: float = 47.3769
    gps_longitude: float = 8.5417
    device_profile: DeviceProfile = DeviceProfile.IPHONE_15_PRO

    def to_dict(self) -> dict:
        return {
            "fps": self.fps,
            "crop_top": self.crop_top,
            "crop_bottom": self.crop_bottom,
            "crop_left": self.crop_left,
            "crop_right": self.crop_right,
            "audio_pitch_shift": self.audio_pitch_shift,
            "video_bitrate": self.video_bitrate,
            "audio_bitrate": self.audio_bitrate,
            "codec": self.codec,
            "noise_seed": self.noise_seed,
            "gps_latitude": self.gps_latitude,
            "gps_longitude": self.gps_longitude,
            "device_profile": self.device_profile.value,
        }


@dataclass
class VideoVariation:
    """A cleansed and forged variation of scraped content, ready for posting."""
    id: str = ""
    scraped_content_id: str = ""
    variation_index: int = 0          # 0=A, 1=B, 2=C

    # Output file
    video_path: str = ""
    video_hash: str = ""              # SHA256 of variation (must differ from original)

    # Forge parameters used
    forge_params: ForgeParams = field(default_factory=ForgeParams)

    # State
    cleanse_status: CleanseStatus = CleanseStatus.PENDING
    metadata_injected: bool = False
    cleansed_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Gemini Vision analysis result
    gemini_analysis: Optional[dict] = None

    def generate_id(self) -> str:
        raw = f"variation:{self.scraped_content_id}:{self.variation_index}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id

    @property
    def variation_label(self) -> str:
        return ["A", "B", "C"][self.variation_index] if self.variation_index < 3 else str(self.variation_index)


# ---------------------------------------------------------------------------
# Delivery Log — tracks approval and posting
# ---------------------------------------------------------------------------

@dataclass
class DeliveryLog:
    """Tracks when a variation was approved and posted to a phone/account."""
    id: str = ""
    variation_id: str = ""
    scraped_content_id: str = ""

    # Target
    phone_number: int = 1             # 1-4
    target_platform: TargetPlatform = TargetPlatform.TIKTOK
    target_account: str = ""

    # Telegram
    telegram_group_id: str = ""
    telegram_message_id: int = 0

    # Approval state
    approval_status: ApprovalStatus = ApprovalStatus.PENDING
    approved_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: str = ""

    # Post outcome
    posted_at: Optional[datetime] = None
    post_url: str = ""
    post_engagement: dict = field(default_factory=dict)

    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def generate_id(self) -> str:
        raw = f"delivery:{self.variation_id}:{self.target_platform.value}:{self.created_at.isoformat()}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id


# ---------------------------------------------------------------------------
# Niche Config — per-phone configuration
# ---------------------------------------------------------------------------

@dataclass
class NicheConfig:
    """Configuration for a phone / niche pair."""
    phone_number: int = 1
    niche: NicheType = NicheType.ECOM
    niche_name: str = ""              # Human-readable: "E-commerce / DTC"
    telegram_group_id: str = ""

    # Accounts on this phone
    tiktok_handle: str = ""
    instagram_handle: str = ""
    linkedin_handle: str = ""

    # GPS center for metadata injection
    gps_lat_center: float = 47.3769
    gps_lon_center: float = 8.5417
    gps_radius: float = 0.01           # ±0.01° randomization

    # Device profile for metadata injection
    device_profile: DeviceProfile = DeviceProfile.IPHONE_15_PRO

    # Target platforms for this phone
    platforms: list[TargetPlatform] = field(default_factory=list)

    active: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Account — the atomic unit of the Octragon System (replaces phone-centric view)
# ---------------------------------------------------------------------------

class AccountType(str, Enum):
    PERSONAL = "personal"
    BUSINESS = "business"


@dataclass
class Account:
    """A single social media account on a physical phone."""
    id: str = ""
    phone_number: int = 1             # 1-4
    platform: TargetPlatform = TargetPlatform.TIKTOK
    handle: str = ""                  # @username
    niche: NicheType = NicheType.ECOM
    display_name: str = ""
    account_type: AccountType = AccountType.PERSONAL  # personal or business
    slot_index: int = 0               # 0 or 1 (two accounts per platform per phone)
    bio: str = ""
    avatar_url: str = ""
    follower_count: int = 0

    # State
    active: bool = True
    last_full_sync_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def generate_id(self) -> str:
        raw = f"account:{self.phone_number}:{self.platform.value}:{self.account_type.value}:{self.slot_index}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id


# ---------------------------------------------------------------------------
# Content Analysis — per-video CMO "Why Analysis"
# ---------------------------------------------------------------------------

class CMOVerdict(str, Enum):
    VIRAL_WIN = "viral_win"
    PROMISING = "promising"
    NEUTRAL = "neutral"
    UNDERPERFORMER = "underperformer"
    REJECTED = "rejected"


@dataclass
class ContentAnalysis:
    """CMO's per-content 'Why Analysis' — explains exactly why content worked or failed."""
    id: str = ""
    scraped_content_id: str = ""
    account_id: str = ""

    # CMO verdict
    verdict: CMOVerdict = CMOVerdict.NEUTRAL
    why_worked: str = ""              # "Strong pattern interrupt hook, emotional payoff at 3s"
    why_failed: str = ""              # "Generic opening, no hook, slow pacing"
    cmo_score: int = 0                # 0-100

    # Content classification
    hook_type: str = ""               # "question", "stat_shock", etc.
    content_type: str = ""            # "talking_head", "lifestyle", etc.
    emotional_tone: str = ""          # "urgency", "curiosity", etc.
    ideal_duration_seconds: int = 0
    timing_analysis: str = ""
    clone_priority: str = "medium"    # "high" | "medium" | "low"

    # 10-Axis scoring (0-10 each)
    axis_hook_power: int = 0
    axis_curiosity_gap: int = 0
    axis_emotional_velocity: int = 0
    axis_retention_architecture: int = 0
    axis_social_currency: int = 0
    axis_platform_fitness: int = 0
    axis_niche_authority: int = 0
    axis_caption_amplification: int = 0
    axis_shareability_trigger: int = 0
    axis_algorithm_hygiene: int = 0

    # Strategic insights
    highest_leverage_intervention: str = ""  # The ONE change that would have doubled performance
    viral_atoms_json: Optional[str] = None   # JSON list of {atom, type, replication_instruction}

    # Engagement metrics
    engagement_delta_pct: float = 0.0

    # Multimodal DNA
    embedding_json: Optional[str] = None  # JSON string of high-dimensional vector

    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def generate_id(self) -> str:
        raw = f"analysis:{self.scraped_content_id}:{self.account_id}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id

    @property
    def axis_composite_score(self) -> float:
        """Composite score across all 10 axes (0-100 scale)."""
        total = (
            self.axis_hook_power + self.axis_curiosity_gap + self.axis_emotional_velocity +
            self.axis_retention_architecture + self.axis_social_currency + self.axis_platform_fitness +
            self.axis_niche_authority + self.axis_caption_amplification +
            self.axis_shareability_trigger + self.axis_algorithm_hygiene
        )
        return round(total * 10 / 10, 1)  # Already out of 100


# ---------------------------------------------------------------------------
# Viral DNA Profile — per-account learning profile
# ---------------------------------------------------------------------------

@dataclass
class ViralDNAProfile:
    """The CMO's accumulated knowledge about what works for a specific account."""
    account_id: str = ""

    # Genome identity
    genome_signature: str = ""        # One-sentence irreducible identity of this account's viral style
    competitor_exploitation_gap: str = ""  # The gap competitors miss that we should own

    # Winning patterns (JSON-serializable lists)
    top_hooks: list = field(default_factory=list)               # [{pattern:, win_rate:, clone_instruction:}]
    viral_atoms_library: list = field(default_factory=list)     # [{atom:, source_score:, applicability:}]
    optimal_posting_times: list = field(default_factory=list)   # ["18:00-21:00 CET"]
    winning_formats: list = field(default_factory=list)         # ["talking_head", "product_demo"]
    winning_emotions: list = field(default_factory=list)        # ["urgency", "curiosity"]
    optimal_duration_range: list = field(default_factory=lambda: [15, 30])  # [min_s, max_s]

    # Axis intelligence
    dominant_axis_strengths: list = field(default_factory=list)    # ["hook_power", "curiosity_gap"]
    critical_axis_weaknesses: list = field(default_factory=list)   # ["retention_architecture"]

    # Metrics
    avg_engagement_rate: float = 0.0
    trend_direction: str = "neutral"   # "accelerating" | "growing" | "stable" | "declining" | "collapsing"
    trajectory_note: str = ""          # Newest vs. oldest performance delta

    # Stats
    total_analyzed: int = 0
    viral_win_count: int = 0
    rejection_count: int = 0

    # Creator Genome (multimodal cluster center embedding)
    genome_embedding_json: Optional[str] = None

    # Cluster labels from k-means enrichment.
    # Shape: [{cluster_id: int, label: str, size: int, avg_score: float}]
    cluster_labels: list = field(default_factory=list)

    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Next Post Queue — CMO-prescribed content
# ---------------------------------------------------------------------------

class NextPostStatus(str, Enum):
    QUEUED = "queued"
    APPROVED = "approved"
    REJECTED = "rejected"
    POSTED = "posted"


@dataclass
class NextPostQueue:
    """CMO's 'Next Post' prescription for an account — what to post and why."""
    id: str = ""
    account_id: str = ""

    # Prescription
    script: str = ""                  # Full script / caption text
    hook: str = ""                    # Opening hook line
    reference_content_id: str = ""    # Scraped content that inspired this
    format_type: str = ""             # "talking_head", "product_demo", etc.
    rationale: str = ""               # "Based on your Viral DNA: urgency hooks + 15s format = 85% hit rate"

    # Priority and state
    priority: int = 1                 # 1 = highest
    status: NextPostStatus = NextPostStatus.QUEUED
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def generate_id(self) -> str:
        raw = f"nextpost:{self.account_id}:{self.generated_at.isoformat()}"
        self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self.id
