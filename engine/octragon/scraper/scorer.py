"""
Viral Video Scorer

Scores VideoCandidate objects on a 0–100 virality scale using:
  1. Engagement Rate  (likes + comments + shares) / views
  2. View Velocity    views / duration (proxy for re-watch + sharing)
  3. Comment Ratio    comments / views (high = controversy or advice-seeking)
  4. Duration score   sweet spot 15–60s for TikTok/Reels
  5. Niche boost      extra weight for content type matching niche strategy

Returns ranked candidates with scores, ready for Telegram alert delivery.
"""

import math
from dataclasses import dataclass

from octragon.models import NicheType, SourcePlatform
from octragon.scraper.discovery import VideoCandidate


@dataclass
class ScoredCandidate:
    candidate: VideoCandidate
    virality_score: float       # 0.0 – 100.0
    engagement_rate: float      # (likes+cmts+shares)/views
    view_velocity: float        # views/duration
    duration_score: float       # 0.0 – 1.0
    breakdown: dict             # detailed component scores for debug


# Per-niche optimal duration windows (seconds)
NICHE_DURATION_SWEET_SPOT: dict[NicheType, tuple[int, int]] = {
    NicheType.ECOM:      (15, 45),
    NicheType.AI_TECH:   (30, 90),
    NicheType.BUSINESS:  (45, 120),
    NicheType.LIFESTYLE: (20, 60),
}

# Per-niche minimum engagement rate threshold (below = filtered out)
NICHE_MIN_ENGAGEMENT: dict[NicheType, float] = {
    NicheType.ECOM:      0.03,  # 3%
    NicheType.AI_TECH:   0.04,  # 4%
    NicheType.BUSINESS:  0.03,  # 3%
    NicheType.LIFESTYLE: 0.05,  # 5% (motivation content competes hard)
}

# Platform weights — TikTok is king for pure virality signals
PLATFORM_WEIGHT: dict[SourcePlatform, float] = {
    SourcePlatform.TIKTOK:    1.00,
    SourcePlatform.INSTAGRAM: 0.85,
    SourcePlatform.LINKEDIN:  0.70,
}


def _duration_score(duration_sec: int, sweet_spot: tuple[int, int]) -> float:
    """Score 0–1 based on how close the video is to the niche sweet spot."""
    lo, hi = sweet_spot
    if lo <= duration_sec <= hi:
        return 1.0
    if duration_sec < lo:
        return max(0.0, 1.0 - (lo - duration_sec) / lo)
    return max(0.0, 1.0 - (duration_sec - hi) / hi)


def _engagement_rate(candidate: VideoCandidate) -> float:
    if candidate.view_count == 0:
        return 0.0
    interactions = candidate.like_count + candidate.comment_count + candidate.share_count
    return interactions / candidate.view_count


def _view_velocity(candidate: VideoCandidate) -> float:
    """Views per second of video (proxy for loop-rate / shareability)."""
    if candidate.duration <= 0:
        return 0.0
    return candidate.view_count / candidate.duration


def score_candidate(candidate: VideoCandidate) -> ScoredCandidate:
    """Compute full virality score for a single candidate."""
    er = _engagement_rate(candidate)
    vv = _view_velocity(candidate)
    dur_score = _duration_score(
        candidate.duration,
        NICHE_DURATION_SWEET_SPOT.get(candidate.niche, (20, 60)),
    )
    plat_weight = PLATFORM_WEIGHT.get(candidate.platform, 0.8)

    # --- Engagement Rate score (0-40 points) --------------------------------
    # sigmoid-like: er=0.05 → ~30pts, er=0.10 → ~38pts, er=0.20 → ~40pts
    er_score = 40.0 * (1 - math.exp(-30 * er))

    # --- View Count score (0-25 points) -------------------------------------
    # log scale: 100k → ~15, 1M → ~20, 10M → ~25
    views = max(candidate.view_count, 1)
    vc_score = min(25.0, 8.0 * math.log10(views / 1000))

    # --- Duration score (0-15 points) ---------------------------------------
    dur_pts = 15.0 * dur_score

    # --- Comment Ratio bonus (0-10 points) ----------------------------------
    # High comment ratio = content that provokes response (valuable)
    cr = candidate.comment_count / max(candidate.view_count, 1)
    cr_score = min(10.0, 10.0 * (1 - math.exp(-50 * cr)))

    # --- View Velocity bonus (0-10 points) ----------------------------------
    # vv=1000 v/s → ~7pts, vv=5000 → ~10pts
    vv_score = min(10.0, 10.0 * (1 - math.exp(-vv / 2000)))

    base = er_score + vc_score + dur_pts + cr_score + vv_score
    final = min(100.0, base * plat_weight)

    return ScoredCandidate(
        candidate=candidate,
        virality_score=round(final, 1),
        engagement_rate=round(er * 100, 2),
        view_velocity=round(vv, 1),
        duration_score=round(dur_score, 2),
        breakdown={
            "engagement_rate_pts": round(er_score, 1),
            "view_count_pts": round(vc_score, 1),
            "duration_pts": round(dur_pts, 1),
            "comment_ratio_pts": round(cr_score, 1),
            "view_velocity_pts": round(vv_score, 1),
            "platform_weight": plat_weight,
        },
    )


def rank_candidates(
    candidates: list[VideoCandidate],
    niche: NicheType,
    top_n: int = 5,
    deduplicate: bool = True,
) -> list[ScoredCandidate]:
    """
    Score and rank candidates, filtering low-engagement ones.
    Returns top_n by virality score.
    """
    min_er = NICHE_MIN_ENGAGEMENT.get(niche, 0.03)
    seen_urls: set[str] = set()
    scored = []

    for c in candidates:
        if deduplicate:
            if c.url in seen_urls:
                continue
            seen_urls.add(c.url)
        er = _engagement_rate(c)
        if er < min_er:
            continue
        scored.append(score_candidate(c))

    scored.sort(key=lambda s: s.virality_score, reverse=True)
    return scored[:top_n]
