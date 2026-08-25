#!/usr/bin/env python3
"""
ig-small-scout.py — Instagram scraper for small ecom influencers (1k–40k followers).

Targets active dropshipping/shopify/ecommerce creators for direct DM outreach.
No follow-first needed — small accounts accept cold DMs.

Uses Apify actor: apidojo~instagram-scraper

Usage:
  python3 ig-small-scout.py                    # full run, all hashtags
  python3 ig-small-scout.py --test             # dry run, 3 hashtags, 10 per hashtag
  python3 ig-small-scout.py --hashtag shopify  # single hashtag
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import random
import requests

# ---------------------------------------------------------------------------
# Shared ICP scoring (canonical source — eliminates duplication)
# ---------------------------------------------------------------------------

_SHARED_PATH = Path(__file__).parent.parent.parent / "shared"
if _SHARED_PATH.exists():
    sys.path.insert(0, str(_SHARED_PATH))
try:
    from icp_scoring import (
        _HARD_NEGATIVES as SHARED_HARD_NEGATIVES,
        BIO_KEYWORDS as SHARED_BIO_KEYWORDS,
        ECOM_POST_KEYWORDS as SHARED_ECOM_POST_KEYWORDS,
        check_hard_negative,
        score_bio_keywords,
        compute_avg_likes as shared_compute_avg_likes,
        count_ecom_posts_30d as shared_count_ecom_posts_30d,
        MIN_ICP_SCORE_V2,
    )
    _SHARED_ICP_LOADED = True
except ImportError:
    _SHARED_ICP_LOADED = False

# ---------------------------------------------------------------------------
# CRM integration (optional — degrades gracefully if not present)
# ---------------------------------------------------------------------------

_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType, EntityType
    _crm: Optional["CRM"] = CRM()
except ImportError:
    _crm = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
DATA_DIR = HERE.parent / "data"
QUEUE_FILE = DATA_DIR / "ig_small_queue.json"
SCRAPED_FILE = DATA_DIR / "ig_small_scraped.json"

APIFY_BASE_URL = "https://api.apify.com/v2/acts/apidojo~instagram-scraper"

IG_HASHTAGS = [
    "dropshipping",
    "dropshippingbusiness",
    "dropshippingtips",
    "ecommercebusiness",
    "ecommercetips",
    "shopifydropshipping",
    "shopifyseller",
    "shopifystore",
    "onlinebusiness",
    "amazonfba",
    "ecommerceentrepreneur",
    "onlineincome",
    "makemoneyonline",
    "digitalentrepreneur",
    "sidehustle",
]

# Hard-negative keywords — any match returns -999 and skips the profile immediately
_HARD_NEGATIVES = frozenset({
    "crypto", "forex", "nft", "web3", "defi", "trading", "mlm",
    "pyramid", "scheme", "betting", "casino", "gambling", "adult",
    "affiliate marketing",
})

# ICP scoring thresholds
MIN_ICP_SCORE = 4
MIN_FOLLOWERS = 1_000
MAX_FOLLOWERS = 40_000
MIN_AVG_LIKES = 100
MIN_ECOM_POSTS_30D = 2

# Languages accepted for outreach
ALLOWED_LANGUAGES = {"EN"}

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
    "print on demand": 2,
    "product sourcing": 2,
    "wholesale": 2,
    "brand": 2,
    "store owner": 2,
    # Soft signals (+1)
    "entrepreneur": 1,
    "passive income": 1,
    "side hustle": 1,
    "business owner": 1,
    "content creator": 1,
    # Negative signals — automatic disqualification
    "crypto": -10,
    "forex": -10,
    "nft": -10,
    "trading": -10,
    "real estate": -10,
    "fitness": -5,
    "gym": -5,
    "health": -5,
}

# Ecom-related post keywords for activity detection
ECOM_POST_KEYWORDS = [
    "shopify", "dropshipping", "ecommerce", "e-commerce", "store", "product",
    "supplier", "fba", "amazon", "aliexpress", "winning product", "niche",
    "print on demand", "wholesale", "revenue", "profit", "ad spend", "roas",
]

# Words that look like a first name but are generic/brand terms.
_NOT_A_NAME = frozenset({
    "ecom", "ecommerce", "shop", "shopify", "store", "online", "digital",
    "easy", "free", "learn", "grow", "scale", "build", "start", "launch",
    "amazon", "fba", "ebay", "etsy", "drop", "dropship", "brand", "elite",
    "pro", "plus", "super", "mega", "ultra", "max", "big", "top", "best",
    "the", "my", "your", "our", "new", "old", "real", "true", "pure",
    "info", "admin", "team", "group", "club", "academy", "school", "hub",
    "community", "network", "course", "program", "system", "method",
    "wifi", "wifibrands", "hello", "hey", "hi", "yo", "official", "page",
    "creator", "business", "money", "income", "hustle", "daily", "media",
    "life", "world", "global", "success", "profit", "rich", "wealth",
})

DM_TEMPLATE = (
    "yo {opener}\n\n"
    "been following your content for a bit. your stuff on the ecom side "
    "is actually solid and you seem real.\n\n"
    "i'm behind ecombrain. its an autonomous ai for ecommerce. plugs into "
    "your entire store and just runs everything on its own.\n\n"
    "we are opening up a few exclusive partner spots right now. "
    "you seem cool and i think this could really work for your audience.\n\n"
    "math is simple. 30% recurring revenue for every follower you bring in. "
    "5% of your {follower_display} followers would look like {monthly}/mo.\n\n"
    "if this sounds interesting just let me know and i will see if "
    "we can open a spot for you.\n\n"
    "yannis"
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Token loading
# ---------------------------------------------------------------------------

def _load_apify_token() -> Optional[str]:
    """
    Resolve Apify token: env var first, then ~/clawd-workspace/config/api_keys.json.
    Returns None if neither source has a value.
    """
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if token:
        return token

    config_path = Path.home() / "clawd-workspace" / "config" / "api_keys.json"
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            token = (data.get("apify_token") or "").strip()
            if token:
                log.debug("Loaded Apify token from %s", config_path)
                return token
        except Exception as exc:
            log.warning("Could not read api_keys.json: %s", exc)

    return None

# ---------------------------------------------------------------------------
# File I/O — atomic writes
# ---------------------------------------------------------------------------

def load_json(path: Path, default=None):
    if default is None:
        default = []
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        log.warning("Could not load %s: %s", path, exc)
        return default


def save_json(path: Path, data) -> None:
    """Atomic write — write to .tmp then rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)
    except Exception as exc:
        log.error("Failed to save %s: %s", path, exc)
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise

# ---------------------------------------------------------------------------
# Name helpers — same pattern as skool-scout.py
# ---------------------------------------------------------------------------

def _is_human_name(name: Optional[str]) -> bool:
    """
    Returns True only if name looks like a real human first name.
    Rejects: single chars, digits, generic words, hyphenated compound words.
    """
    if not name:
        return False
    name = name.strip()
    if len(name) < 2:
        return False
    if any(ch.isdigit() for ch in name):
        return False
    normalised = name.lower().replace("-", "").replace("_", "").replace(".", "")
    if normalised in _NOT_A_NAME:
        return False
    return True


def _safe_opener(first_name: Optional[str], display: str) -> str:
    """
    Returns a DM opener guaranteed to be a real human-sounding name.
    Falls back to first word of display name, then 'hey'.
    """
    if first_name and " " in first_name:
        first_name = first_name.split()[0]

    if _is_human_name(first_name):
        return first_name.lower()

    first_word = display.split()[0].rstrip(",._@")
    if _is_human_name(first_word):
        return first_word.lower()

    return "hey"


def _extract_first_name_from_username(username: str) -> Optional[str]:
    """
    Try to extract a human first name from an Instagram username like
    'thomas.builds' or 'john_ecom' or 'sarah_dropships'.

    Rules:
    - Split on dots and underscores
    - Take first segment
    - Reject if in _NOT_A_NAME or contains digits
    """
    if not username:
        return None

    parts = username.lower().replace(".", "_").replace("-", "_").split("_")

    # Strip trailing numeric segments
    while parts and parts[-1].isdigit():
        parts = parts[:-1]

    if not parts:
        return None

    candidate = parts[0].strip()

    if not candidate or len(candidate) < 2:
        return None
    if any(ch.isdigit() for ch in candidate):
        return None
    if candidate in _NOT_A_NAME:
        return None

    return candidate

# ---------------------------------------------------------------------------
# ICP scoring
# ---------------------------------------------------------------------------

def score_bio(bio: str) -> int:
    """
    Score a bio against BIO_KEYWORDS.
    Hard-negative check runs first — any match returns -999 immediately.
    Delegates to shared/icp_scoring.py when available.
    """
    if _SHARED_ICP_LOADED:
        neg = check_hard_negative(bio)
        if neg:
            return -999
        return score_bio_keywords(bio)

    # Fallback: local scoring
    if not bio:
        return 0
    bio_lower = bio.lower()
    for neg in _HARD_NEGATIVES:
        if neg in bio_lower:
            return -999
    total = 0
    for keyword, points in BIO_KEYWORDS.items():
        if keyword in bio_lower:
            total += points
    return total


def count_ecom_posts_30d(recent_posts: list) -> int:
    """Count posts with ecom-related content in the last 30 days."""
    if _SHARED_ICP_LOADED:
        return shared_count_ecom_posts_30d(recent_posts)

    # Fallback: local counting
    if not recent_posts:
        return 0
    now = datetime.now(timezone.utc)
    count = 0
    for post in recent_posts:
        ts_raw = post.get("timestamp") or post.get("taken_at_timestamp") or ""
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
        caption = (post.get("caption") or post.get("caption_text") or "").lower()
        if any(kw in caption for kw in ECOM_POST_KEYWORDS):
            count += 1
    return count


def compute_avg_likes(posts: list) -> float:
    """Compute average likes across a list of posts."""
    if _SHARED_ICP_LOADED:
        return shared_compute_avg_likes(posts)

    # Fallback
    if not posts:
        return 0.0
    likes_list = []
    for post in posts:
        likes = post.get("likesCount") or post.get("likes_count") or post.get("edge_media_preview_like", {}).get("count") or 0
        try:
            likes_list.append(int(likes))
        except (TypeError, ValueError):
            pass
    if not likes_list:
        return 0.0
    return sum(likes_list) / len(likes_list)


def determine_tier(followers: int) -> str:
    """Map follower count to tier label."""
    if followers >= 10_000:
        return "micro"
    if followers >= 3_000:
        return "rising"
    return "nano"


def classify_lead_type(bio: str, username: str) -> str:
    """Classify lead type based on bio/username signals."""
    bio_lower = (bio or "").lower()
    username_lower = (username or "").lower()
    combined = bio_lower + " " + username_lower

    if any(kw in combined for kw in ["coach", "mentor", "teaching", "course", "program"]):
        return "COACH"
    if any(kw in combined for kw in ["community", "group", "members", "tribe"]):
        return "COMMUNITY"
    if any(kw in combined for kw in ["agency", "services", "we help", "our team"]):
        return "AGENCY"
    if any(kw in combined for kw in ["app", "saas", "software", "tool", "platform"]):
        return "APP"
    if any(kw in combined for kw in ["newsletter", "email list", "subscribe"]):
        return "NEWSLETTER"

    return "CREATOR"

# ---------------------------------------------------------------------------
# DM generation
# ---------------------------------------------------------------------------

def _followers_short(followers: int) -> str:
    """Convert follower count to short display string: 11200 -> '11k'."""
    if followers >= 1_000:
        k = followers / 1_000
        if k == int(k):
            return f"{int(k)}k"
        return f"{k:.1f}k"
    return str(followers)


def _abbreviate_money(amount: float) -> str:
    """1678.5 -> '$1.7k', 500 -> '$500'"""
    if amount >= 1000:
        k = amount / 1000
        if k == int(k):
            return f"${int(k)}k"
        return f"${k:.1f}k"
    return f"${int(amount)}"


def compute_monthly_followers(followers: int) -> str:
    raw = followers * 0.05 * 194
    return _abbreviate_money(raw)


def generate_dm(
    username: str,
    display: str,
    first_name: Optional[str],
    followers: int = 0,
) -> tuple:
    """
    Generate personalised DM for small IG influencer.
    Returns (dm_text, dm_variant) where variant is always 'A'.
    """
    opener = _safe_opener(first_name, display or username)
    follower_display = _followers_short(followers) if followers else "your"
    monthly = compute_monthly_followers(followers) if followers else "$X"

    dm_text = DM_TEMPLATE.format(
        opener=opener,
        follower_display=follower_display,
        monthly=monthly,
    )

    return dm_text, "A"

# ---------------------------------------------------------------------------
# Apify integration
# ---------------------------------------------------------------------------

def run_apify_actor(token: str, hashtag: str, limit: int = 50) -> list:
    """
    Run the apidojo~instagram-scraper actor for a hashtag.
    Polls dataset after run completes (waitForFinish=120).
    Returns list of raw post/profile items.
    """
    run_url = f"{APIFY_BASE_URL}/runs?token={token}&waitForFinish=120"
    payload = {
        "hashtags": [hashtag],
        "resultsLimit": limit,
        "proxy": {"useApifyProxy": True},
    }

    log.info("Apify: scraping #%s (limit=%d)", hashtag, limit)

    try:
        resp = requests.post(run_url, json=payload, timeout=150)
        resp.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        log.error("Apify run failed for #%s: %s — %s", hashtag, exc, resp.text[:300])
        return []
    except requests.exceptions.RequestException as exc:
        log.error("Apify request error for #%s: %s", hashtag, exc)
        return []

    run_data = resp.json().get("data", {})
    run_id = run_data.get("id")
    if not run_id:
        log.error("No run ID returned for #%s: %s", hashtag, resp.json())
        return []

    log.debug("Apify run %s for #%s — fetching dataset", run_id, hashtag)

    dataset_url = (
        f"{APIFY_BASE_URL}/runs/{run_id}/dataset/items"
        f"?token={token}&clean=true"
    )

    try:
        items_resp = requests.get(dataset_url, timeout=30)
        items_resp.raise_for_status()
        items = items_resp.json()
    except requests.exceptions.RequestException as exc:
        log.error("Dataset fetch failed for run %s: %s", run_id, exc)
        return []

    if not isinstance(items, list):
        log.warning("Unexpected dataset shape for #%s: %s", hashtag, type(items))
        return []

    log.info("Apify: #%s returned %d items", hashtag, len(items))
    return items

# ---------------------------------------------------------------------------
# Item normalisation
# ---------------------------------------------------------------------------

def _extract_profile_from_item(item: dict) -> Optional[dict]:
    """
    Extract a normalised profile dict from an Apify item.
    The apidojo actor returns post objects; owner info is nested.
    Returns None if item cannot be parsed into a usable profile.
    """
    # Try top-level profile fields first (some actors return profile objects)
    username = (
        item.get("username")
        or item.get("ownerUsername")
        or item.get("owner", {}).get("username")
        or ""
    ).strip().lstrip("@")

    if not username:
        return None

    followers = (
        item.get("followersCount")
        or item.get("followersCount")
        or item.get("owner", {}).get("followersCount")
        or item.get("owner", {}).get("followers_count")
        or 0
    )
    try:
        followers = int(followers)
    except (TypeError, ValueError):
        followers = 0

    display = (
        item.get("fullName")
        or item.get("full_name")
        or item.get("owner", {}).get("fullName")
        or item.get("owner", {}).get("full_name")
        or username
    ).strip()

    bio = (
        item.get("biography")
        or item.get("bio")
        or item.get("owner", {}).get("biography")
        or ""
    ).strip()

    # Recent posts — may be embedded in the item or need separate lookup
    # apidojo actor typically returns per-post items, collect them elsewhere
    recent_posts = item.get("latestPosts") or item.get("posts") or []

    return {
        "username": username,
        "display": display,
        "followers": followers,
        "bio": bio,
        "recent_posts": recent_posts,
        "raw": item,
    }


def normalise_items(items: list) -> dict:
    """
    Normalise a list of raw Apify items into a dict keyed by username.
    Aggregates posts per profile when actor returns per-post items.
    Deduplicates by username, merging data.
    """
    profiles: dict = {}

    for item in items:
        profile = _extract_profile_from_item(item)
        if not profile:
            continue

        username = profile["username"]

        if username not in profiles:
            profiles[username] = profile
        else:
            # Merge: prefer richer follower count, accumulate posts
            existing = profiles[username]
            if profile["followers"] > existing["followers"]:
                existing["followers"] = profile["followers"]
            if profile["bio"] and not existing["bio"]:
                existing["bio"] = profile["bio"]
            if profile["display"] and existing["display"] == username:
                existing["display"] = profile["display"]
            # Accumulate post data if item looks like a post
            if _item_looks_like_post(item):
                existing["recent_posts"].append(item)

    return profiles


def _item_looks_like_post(item: dict) -> bool:
    """Returns True if item represents an individual post (not a profile)."""
    return bool(
        item.get("caption") or item.get("caption_text")
        or item.get("likesCount") or item.get("timestamp")
        or item.get("shortCode")
    )

# ---------------------------------------------------------------------------
# Filtering & qualification
# ---------------------------------------------------------------------------

def qualify_profile(profile: dict) -> Optional[dict]:
    """
    Run all ICP filters on a normalised profile.
    Returns a qualified lead dict or None if profile does not qualify.
    """
    username = profile["username"]
    followers = profile["followers"]
    bio = profile["bio"]
    recent_posts = profile.get("recent_posts", [])

    # Language gate — only outreach to ALLOWED_LANGUAGES
    lang = profile.get("language", "EN")
    if lang not in ALLOWED_LANGUAGES:
        log.debug("Skip @%s: language %s not in %s", username, lang, ALLOWED_LANGUAGES)
        return None

    # Follower range gate
    if followers < MIN_FOLLOWERS or followers > MAX_FOLLOWERS:
        log.debug("Skip @%s: followers %d out of range [%d, %d]",
                  username, followers, MIN_FOLLOWERS, MAX_FOLLOWERS)
        return None

    # Bio ICP score (includes hard-negative check inside score_bio)
    icp_score = score_bio(bio)
    if icp_score < MIN_ICP_SCORE:
        log.debug("Skip @%s: ICP score %d < %d", username, icp_score, MIN_ICP_SCORE)
        return None

    # Engagement floor
    avg_likes = compute_avg_likes(recent_posts)
    if recent_posts and avg_likes < MIN_AVG_LIKES:
        log.debug("Skip @%s: avg_likes %.1f < %d", username, avg_likes, MIN_AVG_LIKES)
        return None

    # Active ecom content check (only if we have post data)
    ecom_posts = count_ecom_posts_30d(recent_posts)
    if recent_posts and ecom_posts < MIN_ECOM_POSTS_30D:
        log.debug("Skip @%s: ecom_posts_30d %d < %d", username, ecom_posts, MIN_ECOM_POSTS_30D)
        return None

    return {
        "icp_score": icp_score,
        "avg_likes": round(avg_likes, 1),
        "ecom_posts_30d": ecom_posts,
    }

# ---------------------------------------------------------------------------
# Lead construction
# ---------------------------------------------------------------------------

def build_lead(profile: dict, qualification: dict, hashtag: str) -> dict:
    """Construct the final lead dict from a qualified profile."""
    username = profile["username"]
    display = profile["display"]
    followers = profile["followers"]
    bio = profile["bio"]

    first_name = _extract_first_name_from_username(username)
    if first_name and not _is_human_name(first_name):
        first_name = None

    dm_text, dm_variant = generate_dm(username, display, first_name, followers)

    return {
        "username": username,
        "display": display,
        "followers": followers,
        "avg_likes": qualification["avg_likes"],
        "bio": bio,
        "url": f"https://instagram.com/{username}",
        "tier": determine_tier(followers),
        "lead_type": classify_lead_type(bio, username),
        "score": qualification["icp_score"],
        "ecom_posts_30d": qualification["ecom_posts_30d"],
        "source_hashtag": hashtag,
        "dm_text": dm_text,
        "dm_variant": dm_variant,
        "dm_status": "pending",
        "approach": "direct_dm",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }

# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_scout(
    test_mode: bool = False,
    single_hashtag: Optional[str] = None,
) -> None:
    token = _load_apify_token()
    if not token:
        log.warning(
            "APIFY_TOKEN not found in environment or config/api_keys.json. "
            "Set the APIFY_TOKEN env var or add 'apify_token' to "
            "~/clawd-workspace/config/api_keys.json. Exiting."
        )
        sys.exit(1)

    # Determine hashtag list
    if single_hashtag:
        hashtags = [single_hashtag.lstrip("#")]
    elif test_mode:
        hashtags = IG_HASHTAGS[:3]
    else:
        hashtags = IG_HASHTAGS

    per_hashtag_limit = 10 if test_mode else 50

    # Load existing data to avoid duplication
    existing_queue: list = load_json(QUEUE_FILE, default=[])
    existing_scraped: list = load_json(SCRAPED_FILE, default=[])

    queued_usernames: set = {
        lead["username"] for lead in existing_queue
        if isinstance(lead, dict) and lead.get("username")
    }
    scraped_usernames: set = {
        lead["username"] for lead in existing_scraped
        if isinstance(lead, dict) and lead.get("username")
    }

    if _crm:
        log.info("CRM connected")

    all_scraped: list = []   # every profile seen (pre-filter)
    new_leads: list = []     # qualified leads for queue
    seen_this_run: set = set()

    for hashtag in hashtags:
        items = run_apify_actor(token, hashtag, limit=per_hashtag_limit)
        if not items:
            log.warning("No items returned for #%s", hashtag)
            continue

        profiles = normalise_items(items)
        log.info("#%s: %d unique profiles parsed", hashtag, len(profiles))

        for username, profile in profiles.items():
            # Track raw scrape (before filter)
            if username not in scraped_usernames and username not in seen_this_run:
                raw_entry = {
                    "username": username,
                    "display": profile["display"],
                    "followers": profile["followers"],
                    "bio": profile["bio"],
                    "source_hashtag": hashtag,
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                }
                all_scraped.append(raw_entry)
                scraped_usernames.add(username)

            if username in seen_this_run or username in queued_usernames:
                log.debug("Skip @%s: already seen this run or queued", username)
                continue

            # CRM cross-platform gate
            if _crm:
                try:
                    check = _crm.check_contact_allowed(Platform.INSTAGRAM, username)
                    if not check:
                        log.info("CRM skip @%s: %s", username, check.reason)
                        continue
                except Exception as exc:
                    log.debug("CRM check error for @%s: %s", username, exc)

            qualification = qualify_profile(profile)
            seen_this_run.add(username)

            if qualification is None:
                continue

            lead = build_lead(profile, qualification, hashtag)

            log.info(
                "Qualified: @%s | %d followers | score=%d | tier=%s | type=%s",
                username,
                lead["followers"],
                lead["score"],
                lead["tier"],
                lead["lead_type"],
            )

            # Register in CRM (prospect, no lock)
            if _crm and not test_mode:
                try:
                    _crm.add_lead(
                        platform=Platform.INSTAGRAM,
                        handle=username,
                        canonical_name=lead.get("display") or username,
                        url=lead["url"],
                        profile_data={
                            "followers": lead["followers"],
                            "tier": lead["tier"],
                            "score": lead["score"],
                        },
                    )
                except Exception as exc:
                    log.debug("CRM add_lead error for @%s: %s", username, exc)

            new_leads.append(lead)
            queued_usernames.add(username)

        # Throttle between hashtag runs
        if not test_mode and hashtag != hashtags[-1]:
            log.debug("Sleeping 2s between hashtags")
            time.sleep(2)

    # --- Output ---
    if test_mode:
        _print_test_report(hashtags, new_leads, all_scraped)
        return

    # Persist scraped (all, pre-filter) — append
    if all_scraped:
        existing_scraped.extend(all_scraped)
        save_json(SCRAPED_FILE, existing_scraped)
        log.info("Saved %d total scraped profiles to %s", len(existing_scraped), SCRAPED_FILE)

    # Persist qualified leads — append
    if new_leads:
        existing_queue.extend(new_leads)
        save_json(QUEUE_FILE, existing_queue)
        log.info(
            "Appended %d new leads to %s (queue total: %d)",
            len(new_leads), QUEUE_FILE, len(existing_queue),
        )
    else:
        log.info("No new qualified leads found this run")

    log.info(
        "Run complete: %d hashtags | %d profiles scraped | %d leads queued",
        len(hashtags), len(all_scraped), len(new_leads),
    )

# ---------------------------------------------------------------------------
# Test report
# ---------------------------------------------------------------------------

def _print_test_report(hashtags: list, leads: list, scraped: list) -> None:
    print("\n" + "=" * 68)
    print(f"TEST MODE | hashtags={hashtags} | scraped={len(scraped)} | qualified={len(leads)}")
    print("=" * 68)

    if not leads:
        print("\nNo leads qualified in test run.")
        print("=" * 68 + "\n")
        return

    for i, lead in enumerate(leads, 1):
        print(f"\n--- Lead {i}: @{lead['username']} ---")
        print(f"  display:       {lead['display']}")
        print(f"  followers:     {lead['followers']:,}")
        print(f"  avg_likes:     {lead['avg_likes']}")
        print(f"  ecom_posts_30d:{lead['ecom_posts_30d']}")
        print(f"  tier:          {lead['tier']}")
        print(f"  lead_type:     {lead['lead_type']}")
        print(f"  score:         {lead['score']}")
        print(f"  source_tag:    #{lead['source_hashtag']}")
        print(f"  url:           {lead['url']}")
        print(f"  bio:           {lead['bio'][:120]}{'...' if len(lead['bio']) > 120 else ''}")
        print(f"\n  DM text:\n{lead['dm_text']}\n")

    # Qualification funnel
    qual_rate = round(len(leads) / len(scraped) * 100, 1) if scraped else 0
    print(f"\nFunnel: {len(scraped)} scraped → {len(leads)} qualified ({qual_rate}%)")

    tier_counts: dict = {}
    type_counts: dict = {}
    for lead in leads:
        tier_counts[lead["tier"]] = tier_counts.get(lead["tier"], 0) + 1
        type_counts[lead["lead_type"]] = type_counts.get(lead["lead_type"], 0) + 1

    print(f"Tiers:  {tier_counts}")
    print(f"Types:  {type_counts}")
    print("=" * 68 + "\n")

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Instagram small influencer scout (1k–40k followers, ecom ICP)"
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Dry run — 3 hashtags, 10 results each, no file writes",
    )
    parser.add_argument(
        "--hashtag",
        type=str,
        default=None,
        help="Scrape a single hashtag only (e.g. --hashtag shopify)",
    )
    args = parser.parse_args()

    if args.test and args.hashtag:
        parser.error("--test and --hashtag are mutually exclusive. Use one at a time.")

    run_scout(
        test_mode=args.test,
        single_hashtag=args.hashtag,
    )


if __name__ == "__main__":
    main()
