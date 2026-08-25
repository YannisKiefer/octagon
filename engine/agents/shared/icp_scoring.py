#!/usr/bin/env python3
"""
icp_scoring.py — Shared ICP (Ideal Customer Profile) scoring logic for all scouts.

ICP v2 scoring model:
  Hard gate 1: Hard-negative keywords -> immediate reject (-999)
  Hard gate 2: Follower/connection range -> out-of-range reject (-1)
  Signal 1:  Bio keyword density (capped at 9 points)
  Signal 2:  Engagement rate (avg_likes / followers ratio)
  Signal 3:  Post recency (how recently the account posted)
  Signal 4:  Ecom post density (ecom-topic posts in last 30 days)
  Signal 5:  Cross-platform presence bonus (+2 if any signals provided)
  Signal 6:  Community/education keyword bonus (+1)

Minimum passing score: MIN_ICP_SCORE_V2 = 5
"""

from datetime import datetime, timezone
from typing import Optional

# ---------------------------------------------------------------------------
# Module constant
# ---------------------------------------------------------------------------

MIN_ICP_SCORE_V2: int = 5

# ---------------------------------------------------------------------------
# Ecom post keywords — canonical set used by all scouts for activity detection
# ---------------------------------------------------------------------------

ECOM_POST_KEYWORDS: list = [
    "shopify", "dropshipping", "ecommerce", "e-commerce", "store", "product",
    "supplier", "fba", "amazon", "aliexpress", "winning product", "niche",
    "print on demand", "wholesale", "revenue", "profit", "ad spend", "roas",
]

# ---------------------------------------------------------------------------
# Hard-negative keyword set
# Any profile whose bio contains one of these words is immediately rejected.
# Shared across all scouts — 13 keywords.
# ---------------------------------------------------------------------------

_HARD_NEGATIVES: frozenset = frozenset({
    "crypto",
    "forex",
    "nft",
    "web3",
    "defi",
    "trading",
    "mlm",
    "pyramid",
    "scheme",
    "betting",
    "casino",
    "gambling",
    "adult",
})

# ---------------------------------------------------------------------------
# Bio keyword scoring map
# Each keyword maps to a point value (positive = signal, negative = penalty).
# The sum is capped at 9 to prevent single-bio overfitting.
# ---------------------------------------------------------------------------

BIO_KEYWORDS: dict = {
    # Strong ecom signals (+3)
    "dropshipping": 3,
    "shopify": 3,
    "ecommerce": 3,
    "e-commerce": 3,
    "fba": 3,
    "amazon fba": 3,
    "online store": 3,
    # Medium signals (+2)
    "online business": 2,
    "digital product": 2,
    "digital products": 2,
    "print on demand": 2,
    "product sourcing": 2,
    "wholesale": 2,
    "brand": 2,
    "store owner": 2,
    "founder": 2,
    # Soft signals (+1)
    "entrepreneur": 1,
    "passive income": 1,
    "side hustle": 1,
    "business owner": 1,
    "content creator": 1,
    "consultant": 1,
    "coach": 1,
    "creator": 1,
    # Negative signals
    "crypto": -10,
    "forex": -10,
    "nft": -10,
    "trading": -10,
    "real estate": -10,
    "fitness": -5,
    "gym": -5,
    "health": -5,
    "mortgage": -5,
    "insurance": -5,
}

# ---------------------------------------------------------------------------
# Community/education keyword signals (Signal 6 +1 bonus)
# ---------------------------------------------------------------------------

COMMUNITY_SIGNALS: frozenset = frozenset({
    "community",
    "group",
    "members",
    "tribe",
    "academy",
    "school",
    "course",
    "program",
    "cohort",
    "mentorship",
    "coaching",
    "newsletter",
    "email list",
})


# ---------------------------------------------------------------------------
# Core scoring function
# ---------------------------------------------------------------------------

def compute_icp_score(
    bio: str,
    followers: int,
    avg_likes: float,
    last_post_days: int,
    ecom_posts_30d: int,
    min_followers: int,
    max_followers: int,
    cross_platform_signals: Optional[list] = None,
) -> tuple:
    """
    Compute ICP score for a social media profile.

    Parameters
    ----------
    bio : str
        Combined bio/headline/description text. Case-insensitive matching is
        applied internally.
    followers : int
        Follower or connection count for the profile.
    avg_likes : float
        Average likes per post over recent posts. Use 0.0 if unknown.
    last_post_days : int
        Days since the most recent post. Use 999 if no post data available.
    ecom_posts_30d : int
        Count of ecom-topic posts in the last 30 days. Use 0 if unknown.
    min_followers : int
        Minimum acceptable follower count for this platform/scout.
    max_followers : int
        Maximum acceptable follower count for this platform/scout.
    cross_platform_signals : list or None
        Non-empty list means the entity was found on another platform too.
        Adds +2 bonus. Pass None or [] if no cross-platform data.

    Returns
    -------
    tuple[int, str]
        (score, reason)
        - score=-999, reason="hard_negative:{kw}" if hard-negative matched
        - score=-1,   reason="out_of_range:followers={n}" if outside range
        - score>=5,   reason="" if profile qualifies
        - score<5,    reason="low_score:{score}" if below threshold

    Scoring signals
    ---------------
    Signal 1: Bio keyword density
        Sum of BIO_KEYWORDS matches, hard capped at 9. Prevents single-bio
        overfitting and normalises across platform-specific bio lengths.

    Signal 2: Engagement rate
        Ratio of avg_likes to followers. Thresholds: >=5% = +3, >=2% = +2,
        >=1% = +1. Rewards genuinely engaged audiences over follower-bought
        vanity accounts. Returns 0 if followers=0 or avg_likes=0.

    Signal 3: Post recency
        <=7 days = +2, <=30 days = +1, >90 days = -2, else 0.
        Active accounts are more responsive to cold outreach.

    Signal 4: Ecom post density
        min(ecom_posts_30d, 3). Caps at 3 to prevent gaming. Rewards accounts
        consistently producing ecom content in the last month.

    Signal 5: Cross-platform presence
        +2 if cross_platform_signals is a non-empty list. Accounts visible
        across multiple platforms have a larger, more engaged reach.

    Signal 6: Community/education keyword
        +1 if any COMMUNITY_SIGNALS keyword found in bio. Community owners
        have built-in distribution for EcomBrain partnership pitches.
    """
    if not bio:
        bio = ""

    bio_lower = bio.lower()

    # Hard gate 1: Hard-negative keyword check
    for kw in _HARD_NEGATIVES:
        if kw in bio_lower:
            return (-999, f"hard_negative:{kw}")

    # Hard gate 2: Follower range check
    if followers < min_followers or followers > max_followers:
        return (-1, f"out_of_range:followers={followers}")

    score = 0

    # Signal 1: Bio keyword density (capped at 9)
    bio_score = 0
    for keyword, points in BIO_KEYWORDS.items():
        if keyword in bio_lower:
            bio_score += points
    bio_score = min(bio_score, 9)
    score += bio_score

    # Signal 2: Engagement rate
    if followers > 0 and avg_likes > 0:
        engagement_rate = avg_likes / followers
        if engagement_rate >= 0.05:
            score += 3
        elif engagement_rate >= 0.02:
            score += 2
        elif engagement_rate >= 0.01:
            score += 1

    # Signal 3: Post recency
    if last_post_days <= 7:
        score += 2
    elif last_post_days <= 30:
        score += 1
    elif last_post_days > 90:
        score -= 2

    # Signal 4: Ecom post density (capped at 3)
    score += min(ecom_posts_30d, 3)

    # Signal 5: Cross-platform presence
    if cross_platform_signals:
        score += 2

    # Signal 6: Community/education keyword
    if any(kw in bio_lower for kw in COMMUNITY_SIGNALS):
        score += 1

    if score >= MIN_ICP_SCORE_V2:
        return (score, "")

    return (score, f"low_score:{score}")


# ---------------------------------------------------------------------------
# Standalone helpers — for scouts that need individual checks without the
# full compute_icp_score() pipeline (e.g. early-exit fast paths).
# ---------------------------------------------------------------------------

def check_hard_negative(bio: str) -> Optional[str]:
    """
    Check if bio contains any hard-negative keyword.
    Returns the matched keyword, or None if clean.
    """
    if not bio:
        return None
    bio_lower = bio.lower()
    for kw in _HARD_NEGATIVES:
        if kw in bio_lower:
            return kw
    return None


def score_bio_keywords(bio: str) -> int:
    """
    Score a bio against BIO_KEYWORDS only (no hard-negative gate, no cap).
    Returns the raw sum. Call check_hard_negative() separately first if needed.
    """
    if not bio:
        return 0
    bio_lower = bio.lower()
    total = 0
    for keyword, points in BIO_KEYWORDS.items():
        if keyword in bio_lower:
            total += points
    return total


def compute_avg_likes(posts: list) -> float:
    """
    Compute average likes from a list of post dicts.
    Tries multiple key names to handle different platform schemas.
    """
    if not posts:
        return 0.0
    likes_list = []
    for post in posts:
        likes = (
            post.get("likeCount")
            or post.get("likesCount")
            or post.get("likes_count")
            or post.get("favorite_count")
            or post.get("likes")
            or post.get("favoriteCount")
            or 0
        )
        # Handle nested IG structure
        if not likes and isinstance(post.get("edge_media_preview_like"), dict):
            likes = post["edge_media_preview_like"].get("count", 0)
        try:
            likes_list.append(int(likes))
        except (TypeError, ValueError):
            pass
    if not likes_list:
        return 0.0
    return sum(likes_list) / len(likes_list)


def count_ecom_posts_30d(recent_posts: list) -> int:
    """
    Count posts with ecom-related content in the last 30 days.
    Handles multiple timestamp key names and formats.
    """
    if not recent_posts:
        return 0
    now = datetime.now(timezone.utc)
    count = 0
    for post in recent_posts:
        ts_raw = (
            post.get("created_at")
            or post.get("createdAt")
            or post.get("timestamp")
            or post.get("taken_at_timestamp")
            or post.get("publishedAt")
            or post.get("published_at")
            or ""
        )
        try:
            if isinstance(ts_raw, (int, float)):
                ts = datetime.fromtimestamp(ts_raw, tz=timezone.utc)
            elif isinstance(ts_raw, str) and ts_raw:
                ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            else:
                continue
        except Exception:
            continue
        if (now - ts).days > 30:
            continue
        text = (
            post.get("text")
            or post.get("full_text")
            or post.get("content")
            or post.get("caption")
            or post.get("caption_text")
            or ""
        ).lower()
        if any(kw in text for kw in ECOM_POST_KEYWORDS):
            count += 1
    return count


def compute_last_post_days(recent_posts: list) -> int:
    """
    Compute days since the most recent post.
    Returns 999 if no parseable timestamps found.
    """
    if not recent_posts:
        return 999
    now = datetime.now(timezone.utc)
    min_days = 999
    for post in recent_posts:
        ts_raw = (
            post.get("created_at")
            or post.get("createdAt")
            or post.get("timestamp")
            or post.get("taken_at_timestamp")
            or post.get("publishedAt")
            or post.get("published_at")
            or ""
        )
        try:
            if isinstance(ts_raw, (int, float)):
                ts = datetime.fromtimestamp(ts_raw, tz=timezone.utc)
            elif isinstance(ts_raw, str) and ts_raw:
                ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            else:
                continue
        except Exception:
            continue
        days = (now - ts).days
        if days < min_days:
            min_days = days
    return min_days
