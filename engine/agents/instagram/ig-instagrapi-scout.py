#!/usr/bin/env python3
"""
ig-instagrapi-scout.py — Instagram lead discovery via instagrapi (v1 foundation).

Replaces the Apify-based ig-small-scout.py with a self-contained, session-based
Instagram client. Discovers leads through:
  1. Hashtag recent media -> profile extraction
  2. Follower/following lists of seed accounts (for seed engine)

v1 scope (this file):
  - Login with session persistence (no re-login on every run)
  - Hashtag-based discovery (same flow as Apify scout, native)
  - Follower/following discovery for seed accounts
  - ICP scoring via shared module
  - Rate limiting with jitter
  - Queue output to ig_small_queue.json
  - Blocker visibility (clear error messages, flag files)
  - --self-test mode for credential verification
  - --dry-run mode for preview without writes

NOT in v1: DM sending (stays in ig-dm-auto.py for now), story viewers,
           comment scraping, proxy rotation.

Requirements:
  pip install instagrapi

Usage:
  python3 ig-instagrapi-scout.py --self-test          # verify login works
  python3 ig-instagrapi-scout.py --dry-run             # discover without writing
  python3 ig-instagrapi-scout.py                       # full run
  python3 ig-instagrapi-scout.py --seed @handle        # discover via seed account
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Shared ICP scoring
# ---------------------------------------------------------------------------

_SHARED_PATH = Path(__file__).parent.parent.parent / "shared"
if _SHARED_PATH.exists():
    sys.path.insert(0, str(_SHARED_PATH))

try:
    from icp_scoring import (
        check_hard_negative,
        score_bio_keywords,
        compute_avg_likes as shared_compute_avg_likes,
        count_ecom_posts_30d as shared_count_ecom_posts_30d,
        compute_last_post_days,
        MIN_ICP_SCORE_V2,
    )
    _SHARED_ICP = True
except ImportError:
    _SHARED_ICP = False
    MIN_ICP_SCORE_V2 = 5

# ---------------------------------------------------------------------------
# CRM integration (optional)
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
SCRAPED_FILE = DATA_DIR / "ig_instagrapi_scraped.json"
SESSION_FILE = DATA_DIR / "ig_instagrapi_session.json"
STOP_FLAG = DATA_DIR / "IG_INSTAGRAPI_STOP.flag"
RATE_LIMIT_FLAG = DATA_DIR / "IG_RATE_LIMITED.flag"
SESSION_EXPIRED_FLAG = DATA_DIR / "IG_SESSION_EXPIRED.flag"

CONFIG_FILE = Path.home() / "clawd-workspace" / "config" / "api_keys.json"

# Discovery hashtags (same as Apify scout)
IG_HASHTAGS = [
    "dropshipping", "dropshippingbusiness", "dropshippingtips",
    "ecommercebusiness", "ecommercetips", "shopifydropshipping",
    "shopifyseller", "shopifystore", "onlinebusiness", "amazonfba",
    "ecommerceentrepreneur", "onlineincome", "digitalentrepreneur",
]

# Follower range for small influencer targeting
MIN_FOLLOWERS = 1_000
MAX_FOLLOWERS = 40_000

# Rate limiting
DELAY_BETWEEN_PROFILES_MIN = 3.0   # seconds
DELAY_BETWEEN_PROFILES_MAX = 8.0
DELAY_BETWEEN_HASHTAGS_MIN = 30.0
DELAY_BETWEEN_HASHTAGS_MAX = 60.0
MAX_PROFILES_PER_HASHTAG = 30
MAX_PROFILES_PER_RUN = 150
MAX_SEED_FOLLOWERS = 200  # cap per seed account

# Not-a-name filter
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

# DM template (unicorn energy / status flip voice)
DM_TEMPLATE_A = (
    "yo {opener}\n\n"
    "been following your content for a bit. your stuff on the ecom side "
    "is actually solid and you seem real.\n\n"
    "i'm behind ecombrain. its an autonomous ai for ecommerce. plugs into "
    "your entire store and just runs everything on its own.\n\n"
    "we are opening up a few exclusive partner spots right now. "
    "you seem cool and i think this could really work for your audience.\n\n"
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
log = logging.getLogger("ig-instagrapi-scout")

# ---------------------------------------------------------------------------
# Credential loading
# ---------------------------------------------------------------------------

def _load_credentials() -> tuple[Optional[str], Optional[str]]:
    """
    Load Instagram username/password from env vars or config.
    Returns (username, password) or (None, None).
    """
    username = os.environ.get("IG_USERNAME", "").strip()
    password = os.environ.get("IG_PASSWORD", "").strip()
    if username and password:
        return username, password

    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            username = (data.get("ig_username") or "").strip()
            password = (data.get("ig_password") or "").strip()
            if username and password:
                return username, password
        except Exception as exc:
            log.warning("Could not read config: %s", exc)

    return None, None


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

def _get_client(username: str, password: str):
    """
    Create an instagrapi Client with session persistence.
    Loads existing session if available, falls back to fresh login.
    """
    try:
        from instagrapi import Client
    except ImportError:
        log.error(
            "instagrapi not installed. Run: pip install instagrapi"
        )
        sys.exit(1)

    cl = Client()
    cl.delay_range = [1, 3]  # built-in request delay

    # Try loading saved session first
    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)
            # Verify session is valid
            cl.get_timeline_feed()
            log.info("Resumed existing session for @%s", username)
            # Clear any stale expired flag
            if SESSION_EXPIRED_FLAG.exists():
                SESSION_EXPIRED_FLAG.unlink()
            return cl
        except Exception as exc:
            log.warning("Saved session invalid, doing fresh login: %s", exc)

    # Fresh login
    try:
        cl.login(username, password)
        log.info("Fresh login successful for @%s", username)
        # Save session for reuse
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cl.dump_settings(SESSION_FILE)
        log.info("Session saved to %s", SESSION_FILE)
        # Clear flags
        if SESSION_EXPIRED_FLAG.exists():
            SESSION_EXPIRED_FLAG.unlink()
        return cl
    except Exception as exc:
        log.error("Login failed for @%s: %s", username, exc)
        SESSION_EXPIRED_FLAG.write_text(
            f"Login failed at {datetime.now(timezone.utc).isoformat()}: {exc}\n"
        )
        return None


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------

def load_json(path: Path, default=None):
    if default is None:
        default = []
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("Could not read %s: %s", path, exc)
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
    tmp.replace(path)


# ---------------------------------------------------------------------------
# ICP scoring (delegates to shared when available)
# ---------------------------------------------------------------------------

def score_profile(user_info: dict, recent_posts: list) -> dict:
    """
    Score an Instagram profile against ICP criteria.
    Returns dict with score breakdown and total.
    """
    bio = user_info.get("biography", "") or ""
    followers = user_info.get("follower_count", 0)
    following = user_info.get("following_count", 0)
    username = user_info.get("username", "")
    full_name = user_info.get("full_name", "")

    result = {
        "username": username,
        "full_name": full_name,
        "bio": bio,
        "followers": followers,
        "following": following,
        "signals": {},
        "total_score": 0,
        "rejected": False,
        "reject_reason": None,
    }

    # Hard negative check
    if _SHARED_ICP:
        neg = check_hard_negative(bio)
        if neg:
            result["rejected"] = True
            result["reject_reason"] = f"hard_negative: {neg}"
            result["total_score"] = -999
            return result
    else:
        bio_lower = bio.lower()
        for kw in ["crypto", "forex", "nft", "web3", "mlm", "casino", "gambling"]:
            if kw in bio_lower:
                result["rejected"] = True
                result["reject_reason"] = f"hard_negative: {kw}"
                result["total_score"] = -999
                return result

    # Follower range check
    if followers < MIN_FOLLOWERS:
        result["rejected"] = True
        result["reject_reason"] = f"too_few_followers: {followers}"
        return result
    if followers > MAX_FOLLOWERS:
        result["rejected"] = True
        result["reject_reason"] = f"too_many_followers: {followers}"
        return result

    score = 0

    # Signal 1: Bio keywords
    if _SHARED_ICP:
        bio_score = score_bio_keywords(bio)
    else:
        bio_score = 0
        bio_lower = bio.lower()
        kw_map = {
            "dropshipping": 3, "shopify": 3, "ecommerce": 3, "e-commerce": 3,
            "fba": 3, "online store": 3, "online business": 2,
            "digital product": 2, "print on demand": 2, "wholesale": 2,
            "entrepreneur": 1, "side hustle": 1, "business owner": 1,
        }
        for kw, pts in kw_map.items():
            if kw in bio_lower:
                bio_score += pts
    result["signals"]["bio_keywords"] = min(bio_score, 3)
    score += min(bio_score, 3)

    # Signal 2: Engagement rate
    if recent_posts:
        if _SHARED_ICP:
            avg_likes = shared_compute_avg_likes(recent_posts)
        else:
            likes = [p.get("like_count", 0) for p in recent_posts[:12]]
            avg_likes = sum(likes) / len(likes) if likes else 0
        engagement = avg_likes / followers if followers > 0 else 0
        if engagement >= 0.03:
            result["signals"]["engagement"] = 2
            score += 2
        elif engagement >= 0.01:
            result["signals"]["engagement"] = 1
            score += 1
        else:
            result["signals"]["engagement"] = 0
    else:
        result["signals"]["engagement"] = 0

    # Signal 3: Post recency
    if recent_posts:
        if _SHARED_ICP:
            days = compute_last_post_days(recent_posts)
        else:
            try:
                latest = max(
                    p.get("taken_at", datetime.min) for p in recent_posts
                )
                if isinstance(latest, datetime):
                    days = (datetime.now(timezone.utc) - latest.replace(
                        tzinfo=timezone.utc
                    )).days
                else:
                    days = 999
            except Exception:
                days = 999
        if days <= 7:
            result["signals"]["recency"] = 2
            score += 2
        elif days <= 30:
            result["signals"]["recency"] = 1
            score += 1
        else:
            result["signals"]["recency"] = 0
    else:
        result["signals"]["recency"] = 0

    # Signal 4: Ecom post density
    if recent_posts:
        if _SHARED_ICP:
            ecom_count = shared_count_ecom_posts_30d(recent_posts)
        else:
            ecom_kw = [
                "shopify", "dropshipping", "ecommerce", "store", "product",
                "supplier", "fba", "amazon", "winning product",
            ]
            ecom_count = 0
            for p in recent_posts[:12]:
                caption = (p.get("caption_text", "") or "").lower()
                if any(kw in caption for kw in ecom_kw):
                    ecom_count += 1
        if ecom_count >= 3:
            result["signals"]["ecom_density"] = 2
            score += 2
        elif ecom_count >= 1:
            result["signals"]["ecom_density"] = 1
            score += 1
        else:
            result["signals"]["ecom_density"] = 0
    else:
        result["signals"]["ecom_density"] = 0

    result["total_score"] = score
    return result


# ---------------------------------------------------------------------------
# Name extraction (for DM opener)
# ---------------------------------------------------------------------------

def extract_first_name(full_name: str, username: str) -> str:
    """Best-effort first name from full_name or username."""
    if full_name:
        parts = full_name.strip().split()
        for part in parts:
            cleaned = part.strip(".,!@#").lower()
            if len(cleaned) >= 2 and cleaned not in _NOT_A_NAME:
                return part.strip(".,!@#").capitalize()
    # Fallback: username
    clean_user = username.replace("_", " ").replace(".", " ").split()
    for part in clean_user:
        if len(part) >= 2 and part.lower() not in _NOT_A_NAME:
            return part.capitalize()
    return "there"


# ---------------------------------------------------------------------------
# Tier + lead type classification (matches ig-small-scout.py / ig-dm-auto.py)
# ---------------------------------------------------------------------------

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
# Discovery: hashtag-based
# ---------------------------------------------------------------------------

def discover_via_hashtags(
    cl, hashtags: list[str], dry_run: bool = False,
    max_profiles: int = MAX_PROFILES_PER_RUN,
) -> list[dict]:
    """
    Discover leads by searching hashtag recent media.
    Returns list of queue-ready lead dicts.
    """
    leads = []
    seen_usernames: set[str] = set()

    # Load existing queue to avoid re-adding
    existing = load_json(QUEUE_FILE)
    for entry in existing:
        seen_usernames.add(entry.get("username", "").lower())

    # Load previously scraped
    scraped = load_json(SCRAPED_FILE)
    for entry in scraped:
        seen_usernames.add(entry.get("username", "").lower())

    total_checked = 0

    for tag in hashtags:
        if total_checked >= max_profiles:
            log.info("Hit per-run profile cap (%d). Stopping.", MAX_PROFILES_PER_RUN)
            break

        if STOP_FLAG.exists():
            log.warning("Stop flag detected. Halting discovery.")
            break

        log.info("Searching hashtag: #%s", tag)
        try:
            medias = cl.hashtag_medias_recent(tag, amount=MAX_PROFILES_PER_HASHTAG)
        except Exception as exc:
            _handle_api_error(exc, f"hashtag #{tag}")
            continue

        profiles_this_tag = 0
        for media in medias:
            if total_checked >= max_profiles:
                break

            user = media.user
            if not user or not user.username:
                continue
            uname = user.username.lower()
            if uname in seen_usernames:
                continue
            seen_usernames.add(uname)

            # Fetch full profile
            _rate_delay(DELAY_BETWEEN_PROFILES_MIN, DELAY_BETWEEN_PROFILES_MAX)
            try:
                user_info = cl.user_info(user.pk)
            except Exception as exc:
                _handle_api_error(exc, f"profile @{uname}")
                continue

            total_checked += 1
            profiles_this_tag += 1

            # Build profile dict from instagrapi UserShort/User object
            profile = {
                "username": user_info.username,
                "full_name": user_info.full_name or "",
                "biography": user_info.biography or "",
                "follower_count": user_info.follower_count,
                "following_count": user_info.following_count,
                "media_count": user_info.media_count,
                "pk": str(user_info.pk),
                "is_private": user_info.is_private,
            }

            # Skip private accounts
            if profile["is_private"]:
                log.debug("Skipping private account @%s", uname)
                continue

            # Fetch recent posts for scoring
            try:
                recent_medias = cl.user_medias(user_info.pk, amount=12)
                recent_posts = [
                    {
                        "caption_text": (m.caption_text or "") if hasattr(m, "caption_text") else "",
                        "like_count": m.like_count if hasattr(m, "like_count") else 0,
                        "taken_at": m.taken_at if hasattr(m, "taken_at") else None,
                    }
                    for m in recent_medias
                ]
            except Exception:
                recent_posts = []

            # Score
            scored = score_profile(profile, recent_posts)

            # Record scraped
            scraped.append({
                "username": uname,
                "score": scored["total_score"],
                "rejected": scored["rejected"],
                "reject_reason": scored.get("reject_reason"),
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "source": f"hashtag:#{tag}",
            })

            if scored["rejected"]:
                log.debug(
                    "Rejected @%s: %s", uname, scored.get("reject_reason")
                )
                continue

            if scored["total_score"] < MIN_ICP_SCORE_V2:
                log.debug(
                    "Low ICP @%s: score=%d (min=%d)",
                    uname, scored["total_score"], MIN_ICP_SCORE_V2,
                )
                continue

            # Build queue entry (schema must match ig-dm-auto.py consumer)
            first_name = extract_first_name(
                profile["full_name"], profile["username"]
            )
            lead = {
                "username": uname,
                "display": profile["full_name"] or uname,
                "full_name": profile["full_name"],
                "bio": profile["biography"],
                "followers": profile["follower_count"],
                "following": profile["following_count"],
                "url": f"https://instagram.com/{uname}",
                "tier": determine_tier(profile["follower_count"]),
                "lead_type": classify_lead_type(
                    profile["biography"], uname
                ),
                "score": scored["total_score"],
                "icp_score": scored["total_score"],
                "signals": scored["signals"],
                "opener": first_name,
                "dm_text": DM_TEMPLATE_A.format(opener=first_name),
                "dm_status": "pending",
                "approach": "direct_dm",
                "source": f"instagrapi:hashtag:#{tag}",
                "source_hashtag": tag,
                "discovered_at": datetime.now(timezone.utc).isoformat(),
            }
            leads.append(lead)
            log.info(
                "QUEUED @%s — score=%d, followers=%d, source=#%s",
                uname, scored["total_score"], profile["follower_count"], tag,
            )

            # CRM upsert
            if _crm:
                try:
                    _crm.upsert_entity(
                        platform="instagram",
                        platform_id=uname,
                        canonical_name=profile["full_name"] or uname,
                        entity_type="influencer",
                        meta={"bio": profile["biography"][:200]},
                    )
                except Exception:
                    pass

        log.info(
            "Hashtag #%s: checked %d profiles", tag, profiles_this_tag
        )

        # Delay between hashtags
        if tag != hashtags[-1]:
            _rate_delay(DELAY_BETWEEN_HASHTAGS_MIN, DELAY_BETWEEN_HASHTAGS_MAX)

    # Save scraped log
    if not dry_run:
        save_json(SCRAPED_FILE, scraped)

    return leads


# ---------------------------------------------------------------------------
# Discovery: seed account followers/following
# ---------------------------------------------------------------------------

def discover_via_seed(
    cl, seed_handle: str, dry_run: bool = False,
    max_profiles: int = MAX_PROFILES_PER_RUN,
) -> list[dict]:
    """
    Discover leads from a seed account's followers and following.
    Used by the seed engine for authority-based discovery.
    """
    seed_handle = seed_handle.lstrip("@").lower()
    log.info("Seed discovery: @%s", seed_handle)

    leads = []
    seen_usernames: set[str] = set()

    existing = load_json(QUEUE_FILE)
    for entry in existing:
        seen_usernames.add(entry.get("username", "").lower())

    try:
        user_id = cl.user_id_from_username(seed_handle)
    except Exception as exc:
        log.error("Could not resolve seed @%s: %s", seed_handle, exc)
        return leads

    # Get followers
    try:
        followers = cl.user_followers(user_id, amount=MAX_SEED_FOLLOWERS)
    except Exception as exc:
        _handle_api_error(exc, f"followers of @{seed_handle}")
        followers = {}

    # Get following
    try:
        following = cl.user_following(user_id, amount=MAX_SEED_FOLLOWERS)
    except Exception as exc:
        _handle_api_error(exc, f"following of @{seed_handle}")
        following = {}

    # Merge unique user PKs
    candidate_pks = set()
    for pk in list(followers.keys())[:MAX_SEED_FOLLOWERS]:
        candidate_pks.add(pk)
    for pk in list(following.keys())[:MAX_SEED_FOLLOWERS]:
        candidate_pks.add(pk)

    log.info(
        "Seed @%s: %d followers, %d following, %d unique candidates",
        seed_handle, len(followers), len(following), len(candidate_pks),
    )

    checked = 0
    for pk in candidate_pks:
        if checked >= max_profiles:
            break
        if STOP_FLAG.exists():
            log.warning("Stop flag detected.")
            break

        _rate_delay(DELAY_BETWEEN_PROFILES_MIN, DELAY_BETWEEN_PROFILES_MAX)

        try:
            user_info = cl.user_info(pk)
        except Exception as exc:
            _handle_api_error(exc, f"profile pk={pk}")
            continue

        checked += 1
        uname = user_info.username.lower()
        if uname in seen_usernames or uname == seed_handle:
            continue
        seen_usernames.add(uname)

        if user_info.is_private:
            continue

        profile = {
            "username": user_info.username,
            "full_name": user_info.full_name or "",
            "biography": user_info.biography or "",
            "follower_count": user_info.follower_count,
            "following_count": user_info.following_count,
            "media_count": user_info.media_count,
            "pk": str(user_info.pk),
            "is_private": False,
        }

        # Lightweight scoring (no post fetch for seed — too many API calls)
        scored = score_profile(profile, [])

        if scored["rejected"]:
            continue
        # Relaxed threshold for seed-adjacent leads
        seed_min_score = max(MIN_ICP_SCORE_V2 - 2, 2)
        if scored["total_score"] < seed_min_score:
            continue

        first_name = extract_first_name(
            profile["full_name"], profile["username"]
        )
        lead = {
            "username": uname,
            "display": profile["full_name"] or uname,
            "full_name": profile["full_name"],
            "bio": profile["biography"],
            "followers": profile["follower_count"],
            "following": profile["following_count"],
            "url": f"https://instagram.com/{uname}",
            "tier": determine_tier(profile["follower_count"]),
            "lead_type": classify_lead_type(
                profile["biography"], uname
            ),
            "score": scored["total_score"],
            "icp_score": scored["total_score"],
            "signals": scored["signals"],
            "opener": first_name,
            "dm_text": DM_TEMPLATE_A.format(opener=first_name),
            "dm_status": "pending",
            "approach": "direct_dm",
            "source": f"instagrapi:seed:@{seed_handle}",
            "discovered_at": datetime.now(timezone.utc).isoformat(),
        }
        leads.append(lead)
        log.info(
            "QUEUED (seed) @%s — score=%d, followers=%d",
            uname, scored["total_score"], profile["follower_count"],
        )

    return leads


# ---------------------------------------------------------------------------
# Rate limiting helpers
# ---------------------------------------------------------------------------

def _rate_delay(min_s: float, max_s: float) -> None:
    """Sleep with jitter."""
    delay = random.uniform(min_s, max_s)
    time.sleep(delay)


def _handle_api_error(exc: Exception, context: str) -> None:
    """Classify Instagram API errors and set flags if needed."""
    msg = str(exc).lower()
    if "rate" in msg or "429" in msg or "please wait" in msg:
        log.error("RATE LIMITED during %s: %s", context, exc)
        RATE_LIMIT_FLAG.write_text(
            f"Rate limited at {datetime.now(timezone.utc).isoformat()}: {exc}\n"
        )
    elif "login_required" in msg or "challenge" in msg:
        log.error("SESSION EXPIRED during %s: %s", context, exc)
        SESSION_EXPIRED_FLAG.write_text(
            f"Session expired at {datetime.now(timezone.utc).isoformat()}: {exc}\n"
        )
    elif "not found" in msg or "user not found" in msg:
        log.warning("Not found during %s: %s", context, exc)
    else:
        log.warning("API error during %s: %s", context, exc)


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def self_test(username: str, password: str) -> bool:
    """
    Verify credentials and session work. Returns True if login succeeds.
    """
    log.info("=== SELF TEST ===")

    # Check instagrapi import
    try:
        from instagrapi import Client
        log.info("[OK] instagrapi imported")
    except ImportError:
        log.error("[FAIL] instagrapi not installed. Run: pip install instagrapi")
        return False

    # Check credentials
    if not username or not password:
        log.error("[FAIL] No IG credentials. Set IG_USERNAME + IG_PASSWORD env vars")
        log.error("       or add ig_username + ig_password to config/api_keys.json")
        return False
    log.info("[OK] Credentials found for @%s", username)

    # Try login
    cl = _get_client(username, password)
    if cl is None:
        log.error("[FAIL] Login failed")
        return False
    log.info("[OK] Login successful")

    # Try a lightweight API call
    try:
        user_info = cl.user_info_by_username(username)
        log.info(
            "[OK] API works — @%s has %d followers",
            user_info.username, user_info.follower_count,
        )
    except Exception as exc:
        log.error("[FAIL] API call failed: %s", exc)
        return False

    log.info("=== SELF TEST PASSED ===")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Instagram lead discovery via instagrapi"
    )
    parser.add_argument("--self-test", action="store_true",
                        help="Verify credentials and exit")
    parser.add_argument("--dry-run", action="store_true",
                        help="Discover without writing to queue")
    parser.add_argument("--seed", type=str, default=None,
                        help="Discover via seed account (e.g. @handle)")
    parser.add_argument("--hashtags", type=str, nargs="*", default=None,
                        help="Override hashtag list")
    parser.add_argument("--max-profiles", type=int, default=MAX_PROFILES_PER_RUN,
                        help="Max profiles to check per run")
    args = parser.parse_args()

    # Check stop flag
    if STOP_FLAG.exists():
        log.error("Stop flag present (%s). Remove to continue.", STOP_FLAG)
        sys.exit(1)

    # Clear stale rate limit flag (older than 1 hour)
    if RATE_LIMIT_FLAG.exists():
        try:
            age = time.time() - RATE_LIMIT_FLAG.stat().st_mtime
            if age < 3600:
                log.error(
                    "Rate limit flag is recent (%d min ago). Waiting.",
                    int(age / 60),
                )
                sys.exit(1)
            else:
                log.info("Clearing stale rate limit flag (%d min old)", int(age / 60))
                RATE_LIMIT_FLAG.unlink()
        except Exception:
            pass

    # Load credentials
    username, password = _load_credentials()

    # Self-test mode
    if args.self_test:
        ok = self_test(username, password)
        sys.exit(0 if ok else 1)

    # Validate credentials
    if not username or not password:
        log.error("No Instagram credentials configured.")
        log.error("Set IG_USERNAME + IG_PASSWORD env vars")
        log.error("  or add ig_username + ig_password to config/api_keys.json")
        SESSION_EXPIRED_FLAG.write_text(
            f"No credentials at {datetime.now(timezone.utc).isoformat()}\n"
        )
        sys.exit(1)

    # Login
    cl = _get_client(username, password)
    if cl is None:
        sys.exit(1)

    # Update max profiles if overridden
    max_profiles = args.max_profiles

    # Discover
    if args.seed:
        leads = discover_via_seed(
            cl, args.seed, dry_run=args.dry_run, max_profiles=max_profiles
        )
    else:
        hashtags = args.hashtags if args.hashtags else IG_HASHTAGS
        leads = discover_via_hashtags(
            cl, hashtags, dry_run=args.dry_run, max_profiles=max_profiles
        )

    # Write to queue
    if leads and not args.dry_run:
        queue = load_json(QUEUE_FILE)
        existing_usernames = {e.get("username", "").lower() for e in queue}
        new_leads = [
            l for l in leads
            if l["username"].lower() not in existing_usernames
        ]
        queue.extend(new_leads)
        save_json(QUEUE_FILE, queue)
        log.info(
            "Added %d new leads to queue (total: %d)", len(new_leads), len(queue)
        )
    elif leads and args.dry_run:
        log.info("DRY RUN: would add %d leads to queue", len(leads))
        for l in leads[:5]:
            log.info(
                "  @%s — score=%d, followers=%d",
                l["username"], l["icp_score"], l["followers"],
            )
    else:
        log.info("No new leads discovered this run.")

    # Summary
    log.info(
        "=== DONE: %d leads discovered, dry_run=%s ===",
        len(leads), args.dry_run,
    )


if __name__ == "__main__":
    main()
