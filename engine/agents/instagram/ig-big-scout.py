#!/usr/bin/env python3
"""
ig-big-scout.py — Scrape big ecom/dropshipping influencers (40k-5M followers).

Strategy: follow first, DM 2 days later.
Uses Apify to scrape seed account followers/following and hashtag posts,
scores leads by ICP criteria, generates DM text, writes to ig_big_queue.json.

Usage:
  python3 ig-big-scout.py
  python3 ig-big-scout.py --dry-run
  python3 ig-big-scout.py --seed-only
  python3 ig-big-scout.py --hashtag-only
  python3 ig-big-scout.py --limit 50
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# CRM — unified lead database (optional, degrades gracefully)
_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType, EntityType
    _crm: Optional[CRM] = CRM()
except ImportError:
    _crm = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
BIG_QUEUE_FILE = DATA_DIR / "ig_big_queue.json"

CONFIG_FILE = Path.home() / "clawd-workspace" / "config" / "api_keys.json"

IG_BASE = "https://www.instagram.com"

SEED_ACCOUNTS = [
    "haydenrichards_",
    "sebastian_ghiorghiu",
    "jordan_welch",
    "hustlersuniversity",
    "peterkosmala",
    "biaheza",
    "arie.scherson",
]

IG_BIG_HASHTAGS = [
    "ecommerceentrepreneur",
    "dropshippingcoach",
    "shopifyexpert",
    "amazonfbaseller",
    "ecommercecoach",
    "onlinebusinesscoach",
    "digitalnomad",
    "entrepreneurmindset",
]

# Follower range for "big" leads
MIN_FOLLOWERS = 40_000
MAX_FOLLOWERS = 5_000_000
MIN_AVG_LIKES = 500
MIN_ICP_SCORE = 5

# Tier thresholds
TIER_MACRO_MIN = 1_000_000
TIER_MID_MIN = 100_000

# Apify actor IDs for Instagram
APIFY_IG_PROFILE_ACTOR = "apify/instagram-profile-scraper"
APIFY_IG_HASHTAG_ACTOR = "apify/instagram-hashtag-scraper"

# ICP scoring keywords
ICP_BIO_KEYWORDS = [
    ("shopify", 2),
    ("ecom", 2),
    ("ecommerce", 2),
    ("dropship", 2),
    ("dropshipping", 2),
    ("amazon fba", 2),
    ("amazon", 1),
    ("fba", 1),
    ("online store", 1),
    ("store", 1),
    ("entrepreneur", 1),
    ("7 figure", 2),
    ("8 figure", 2),
    ("7fig", 2),
    ("8fig", 2),
    ("revenue", 1),
    ("business owner", 1),
    ("founder", 1),
    ("brand", 1),
    ("supplier", 1),
    ("course", 1),
    ("coaching", 1),
    ("mentorship", 1),
    ("mentor", 1),
    ("coach", 1),
    ("youtube", 1),
    ("youtuber", 1),
]

COACH_SIGNALS = ["course", "mentorship", "coaching", "coach", "mentor", "program", "masterclass"]

DM_SENDER = "Yannis"
DM_PRODUCT = "ecombrain.io"

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
# File I/O helpers
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


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def load_config() -> dict:
    """Load API keys from config file or environment."""
    config = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as exc:
            log.warning("Could not load config: %s", exc)
    return config


def get_apify_token(config: dict) -> Optional[str]:
    token = os.environ.get("APIFY_TOKEN") or config.get("apify_token")
    if not token:
        log.warning("APIFY_TOKEN not set — set env var or add to config/api_keys.json")
    return token

# ---------------------------------------------------------------------------
# ICP scoring
# ---------------------------------------------------------------------------

def score_lead(followers: int, avg_likes: int, bio: str) -> int:
    """
    Score a lead on ICP relevance. Returns integer score.
    Min threshold to qualify: MIN_ICP_SCORE (5).
    """
    score = 0
    bio_lower = bio.lower()

    for keyword, points in ICP_BIO_KEYWORDS:
        if keyword in bio_lower:
            score += points

    # Engagement bonus: high likes relative to followers
    if followers > 0:
        engagement_rate = avg_likes / followers
        if engagement_rate >= 0.05:
            score += 2
        elif engagement_rate >= 0.02:
            score += 1

    # Follower tier bonus
    if followers >= 1_000_000:
        score += 1  # reach bonus
    elif followers >= 200_000:
        score += 1

    return score


def detect_channel_type(bio: str) -> str:
    """Returns 'COACH' if bio mentions coaching/courses, else 'CREATOR'."""
    bio_lower = bio.lower()
    for signal in COACH_SIGNALS:
        if signal in bio_lower:
            return "COACH"
    return "CREATOR"


def detect_tier(followers: int) -> str:
    if followers >= TIER_MACRO_MIN:
        return "macro"
    if followers >= TIER_MID_MIN:
        return "mid"
    return "micro"


def extract_youtube_handle(bio: str) -> Optional[str]:
    """Try to extract a YouTube channel handle from bio text."""
    patterns = [
        r"youtube\.com/@([\w\-\.]+)",
        r"youtube\.com/c/([\w\-\.]+)",
        r"youtube\.com/channel/([\w\-\.]+)",
        r"youtu\.be/@([\w\-\.]+)",
        r"@([\w\-\.]+)\s+(?:on\s+)?youtube",
        r"youtube[:\s]+@?([\w\-\.]+)",
    ]
    bio_lower = bio.lower()
    for pattern in patterns:
        match = re.search(pattern, bio_lower)
        if match:
            return match.group(1)
    return None

# ---------------------------------------------------------------------------
# DM generation
# ---------------------------------------------------------------------------

def generate_big_dm(username: str, display: str, lead_type: str) -> str:
    """Generate DM text for big influencer outreach (follow-first approach)."""
    # Determine opener: use display name's first word if it looks like a name
    opener = _safe_opener(display)

    dm = (
        f"hey {opener},\n\n"
        f"love what you're building — your content on the ecom side is genuinely "
        f"one of the best out there.\n\n"
        f"i run {DM_PRODUCT} — real-time profit analytics for shopify stores. "
        f"been thinking your audience would crush it with this.\n\n"
        f"open to chatting about a collab? happy to make it worth your time.\n\n"
        f"{DM_SENDER}"
    )
    return dm.strip()


_NOT_A_NAME = frozenset({
    "ecom", "ecommerce", "shop", "shopify", "store", "online", "digital",
    "easy", "free", "learn", "grow", "scale", "build", "start", "launch",
    "amazon", "fba", "ebay", "etsy", "drop", "dropship", "brand", "elite",
    "pro", "plus", "super", "mega", "ultra", "max", "big", "top", "best",
    "the", "my", "your", "our", "new", "old", "real", "true", "pure",
    "info", "admin", "team", "group", "club", "academy", "school", "hub",
    "community", "network", "course", "program", "system", "method",
    "official", "page", "media", "content", "creator", "coach", "mentor",
    "hey", "hi", "yo", "hello",
})


def _safe_opener(display: str) -> str:
    """Return a human-sounding opener from display name, fallback to 'there'."""
    first_word = display.split()[0].rstrip(".,!").lower() if display else ""
    if (
        first_word
        and len(first_word) >= 2
        and first_word not in _NOT_A_NAME
        and not any(ch.isdigit() for ch in first_word)
    ):
        return first_word
    return "there"

# ---------------------------------------------------------------------------
# Apify scraping
# ---------------------------------------------------------------------------

def _apify_run_actor(token: str, actor_id: str, run_input: dict) -> list:
    """
    Run an Apify actor synchronously and return the dataset items.
    Uses the Apify REST API directly (no SDK dependency required).
    """
    try:
        import urllib.request
        import urllib.error

        start_url = (
            f"https://api.apify.com/v2/acts/{actor_id.replace('/', '~')}/runs"
            f"?token={token}&waitForFinish=120"
        )
        payload = json.dumps(run_input).encode("utf-8")
        req = urllib.request.Request(
            start_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=150) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        run_id = result.get("data", {}).get("id")
        if not run_id:
            log.warning("Apify actor %s: no run ID in response", actor_id)
            return []

        # Poll until finished (waitForFinish may not be enough for slow actors)
        status_url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={token}"
        for _ in range(30):
            with urllib.request.urlopen(status_url, timeout=30) as resp:
                status_data = json.loads(resp.read().decode("utf-8"))
            run_status = status_data.get("data", {}).get("status", "")
            if run_status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
                break
            log.info("  Apify run %s status: %s — waiting...", run_id, run_status)
            time.sleep(10)

        if run_status != "SUCCEEDED":
            log.warning("Apify run %s finished with status: %s", run_id, run_status)
            return []

        # Fetch dataset
        dataset_id = status_data.get("data", {}).get("defaultDatasetId")
        if not dataset_id:
            return []

        items_url = (
            f"https://api.apify.com/v2/datasets/{dataset_id}/items"
            f"?token={token}&format=json&limit=200"
        )
        with urllib.request.urlopen(items_url, timeout=30) as resp:
            items = json.loads(resp.read().decode("utf-8"))

        return items if isinstance(items, list) else []

    except Exception as exc:
        log.error("Apify actor %s failed: %s", actor_id, exc)
        return []


def scrape_seed_accounts(token: str) -> list:
    """
    Scrape followers/following of seed accounts via Apify profile scraper.
    Returns raw profile items.
    """
    log.info("Scraping seed accounts: %d accounts", len(SEED_ACCOUNTS))
    all_items = []

    for username in SEED_ACCOUNTS:
        log.info("  Scraping following of @%s...", username)
        items = _apify_run_actor(
            token=token,
            actor_id=APIFY_IG_PROFILE_ACTOR,
            run_input={
                "usernames": [username],
                "resultsLimit": 100,
            },
        )
        log.info("  Got %d profiles from @%s", len(items), username)
        all_items.extend(items)
        time.sleep(2)

    return all_items


def scrape_hashtags(token: str) -> list:
    """
    Scrape recent posts from ecom hashtags, extract unique author profiles.
    Returns list of profile-like dicts.
    """
    log.info("Scraping hashtags: %d hashtags", len(IG_BIG_HASHTAGS))
    profile_map: dict = {}

    for hashtag in IG_BIG_HASHTAGS:
        log.info("  Scraping #%s...", hashtag)
        items = _apify_run_actor(
            token=token,
            actor_id=APIFY_IG_HASHTAG_ACTOR,
            run_input={
                "hashtags": [hashtag],
                "resultsLimit": 50,
            },
        )
        log.info("  Got %d posts from #%s", len(items), hashtag)

        for post in items:
            owner = post.get("ownerUsername") or post.get("owner", {}).get("username")
            if not owner or owner in profile_map:
                continue

            # Build a minimal profile dict from post author data
            owner_data = post.get("owner") or {}
            profile_map[owner] = {
                "username": owner,
                "fullName": owner_data.get("fullName") or post.get("ownerFullName") or owner,
                "biography": owner_data.get("biography") or "",
                "followersCount": owner_data.get("followersCount") or 0,
                "followsCount": owner_data.get("followsCount") or 0,
                "postsCount": owner_data.get("postsCount") or 0,
                "avgLikes": _estimate_avg_likes(post),
                "verified": owner_data.get("verified") or False,
                "profilePicUrl": owner_data.get("profilePicUrl") or "",
                "source": f"hashtag:{hashtag}",
            }

        time.sleep(2)

    return list(profile_map.values())


def _estimate_avg_likes(post: dict) -> int:
    """Estimate avg likes from a single post (best proxy available)."""
    likes = (
        post.get("likesCount")
        or post.get("likes")
        or post.get("likeCount")
        or 0
    )
    return int(likes)


def enrich_profiles(token: str, usernames: list) -> dict:
    """
    Fetch full profile data for a batch of usernames.
    Returns dict {username: profile_dict}.
    """
    if not usernames:
        return {}

    log.info("Enriching %d profiles via Apify...", len(usernames))
    items = _apify_run_actor(
        token=token,
        actor_id=APIFY_IG_PROFILE_ACTOR,
        run_input={
            "usernames": usernames[:50],  # respect actor limits
            "resultsLimit": len(usernames[:50]),
        },
    )

    enriched = {}
    for item in items:
        username = item.get("username") or item.get("handle")
        if username:
            enriched[username.lower()] = item

    return enriched

# ---------------------------------------------------------------------------
# Profile normalisation
# ---------------------------------------------------------------------------

def normalise_profile(raw: dict) -> Optional[dict]:
    """
    Normalise a raw Apify profile item into our standard shape.
    Returns None if profile doesn't meet follower range.
    """
    username = (
        raw.get("username")
        or raw.get("handle")
        or raw.get("ownerUsername")
        or ""
    ).lower().strip()

    if not username:
        return None

    followers = int(
        raw.get("followersCount")
        or raw.get("followers")
        or raw.get("followerCount")
        or 0
    )
    display = (
        raw.get("fullName")
        or raw.get("full_name")
        or raw.get("name")
        or username
    ).strip()
    bio = (raw.get("biography") or raw.get("bio") or "").strip()
    avg_likes = int(raw.get("avgLikes") or raw.get("averageLikes") or 0)
    verified = bool(raw.get("verified") or raw.get("isVerified"))

    if followers < MIN_FOLLOWERS or followers > MAX_FOLLOWERS:
        return None

    return {
        "username": username,
        "display": display,
        "followers": followers,
        "avg_likes": avg_likes,
        "bio": bio,
        "verified": verified,
        "url": f"{IG_BASE}/{username}",
        "source": raw.get("source", "seed"),
    }

# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def build_lead(profile: dict) -> Optional[dict]:
    """
    Score a normalised profile and build a lead dict if it qualifies.
    Returns None if below ICP threshold.
    """
    username = profile["username"]
    followers = profile["followers"]
    avg_likes = profile["avg_likes"]
    bio = profile["bio"]
    display = profile["display"]

    # Hard filter
    if avg_likes < MIN_AVG_LIKES and followers < 200_000:
        # Waive avg_likes check for large macro accounts (data often missing)
        log.debug("Skip @%s: avg_likes %d < %d", username, avg_likes, MIN_AVG_LIKES)
        return None

    score = score_lead(followers, avg_likes, bio)
    if score < MIN_ICP_SCORE:
        log.debug("Skip @%s: score %d < %d", username, score, MIN_ICP_SCORE)
        return None

    tier = detect_tier(followers)
    lead_type = detect_channel_type(bio)
    youtube_handle = extract_youtube_handle(bio)
    dm_text = generate_big_dm(username, display, lead_type)

    return {
        "username": username,
        "display": display,
        "followers": followers,
        "avg_likes": avg_likes,
        "bio": bio,
        "url": f"{IG_BASE}/{username}",
        "tier": tier,
        "lead_type": lead_type,
        "score": score,
        "youtube_handle": youtube_handle,
        "dm_text": dm_text,
        "dm_status": "pending",
        "approach": "follow_first",
        "follow_at": None,
        "dm_eligible_at": None,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def run_scout(
    dry_run: bool = False,
    seed_only: bool = False,
    hashtag_only: bool = False,
    limit: Optional[int] = None,
) -> None:
    """Main scout pipeline."""
    config = load_config()
    apify_token = get_apify_token(config)

    if not apify_token:
        log.error("Cannot run without APIFY_TOKEN — aborting")
        sys.exit(1)

    # Load existing queue to deduplicate
    existing_queue = load_json(BIG_QUEUE_FILE, default=[])
    existing_usernames: set = {
        entry["username"]
        for entry in existing_queue
        if isinstance(entry, dict) and "username" in entry
    }

    log.info("Existing big queue: %d leads", len(existing_queue))

    # --- Scraping phase ---
    raw_profiles: list = []

    if not hashtag_only:
        seed_profiles = scrape_seed_accounts(apify_token)
        log.info("Seed scrape: %d raw profiles", len(seed_profiles))
        raw_profiles.extend(seed_profiles)

    if not seed_only:
        hashtag_profiles = scrape_hashtags(apify_token)
        log.info("Hashtag scrape: %d raw profiles", len(hashtag_profiles))
        raw_profiles.extend(hashtag_profiles)

    # --- Normalise and deduplicate ---
    candidates: dict = {}
    for raw in raw_profiles:
        profile = normalise_profile(raw)
        if profile and profile["username"] not in candidates:
            candidates[profile["username"]] = profile

    log.info("Unique candidates in follower range: %d", len(candidates))

    # --- Enrich profiles that have no avg_likes data ---
    needs_enrichment = [
        uname for uname, p in candidates.items()
        if p["avg_likes"] == 0 and uname not in existing_usernames
    ]
    if needs_enrichment:
        log.info("Enriching %d profiles with missing engagement data...", len(needs_enrichment))
        enriched = enrich_profiles(apify_token, needs_enrichment[:50])
        for uname, data in enriched.items():
            if uname in candidates:
                candidates[uname]["avg_likes"] = int(
                    data.get("avgLikes") or data.get("averageLikes") or 0
                )

    # --- Score and filter ---
    new_leads = []
    processed = 0

    for username, profile in candidates.items():
        if limit and processed >= limit:
            break

        if username in existing_usernames:
            log.debug("Skip @%s: already in queue", username)
            continue

        # CRM gate
        if _crm:
            check = _crm.check_contact_allowed(Platform.INSTAGRAM, username)
            if not check:
                log.info(
                    "CRM skip @%s: %s (locked by %s)",
                    username, check.reason, check.locked_by,
                )
                continue

        lead = build_lead(profile)
        if lead is None:
            continue

        # Register in CRM as PROSPECT
        if _crm and not dry_run:
            _crm.add_lead(
                platform=Platform.INSTAGRAM,
                handle=username,
                canonical_name=profile["display"],
                entity_type=EntityType.PERSON,
                url=f"{IG_BASE}/{username}",
                profile_data={
                    "followers": profile["followers"],
                    "tier": lead["tier"],
                    "lead_type": lead["lead_type"],
                    "approach": "follow_first",
                },
            )

        new_leads.append(lead)
        processed += 1
        log.info(
            "Qualified: @%s | %s | %dk followers | score %d | %s",
            username,
            lead["tier"],
            lead["followers"] // 1000,
            lead["score"],
            lead["lead_type"],
        )

    log.info("New qualified leads: %d", len(new_leads))

    if dry_run:
        log.info("DRY RUN — no file writes")
        for lead in new_leads[:5]:
            log.info(
                "  @%s | %s | %dk followers | score %d",
                lead["username"], lead["tier"],
                lead["followers"] // 1000, lead["score"],
            )
            log.info("  DM preview:\n%s\n", lead["dm_text"])
        return

    if new_leads:
        existing_queue.extend(new_leads)
        save_json(BIG_QUEUE_FILE, existing_queue)
        log.info("Wrote %d new leads to %s", len(new_leads), BIG_QUEUE_FILE)
    else:
        log.info("No new leads this run — queue unchanged")

    # Summary
    log.info("=" * 50)
    log.info("ig-big-scout Run Complete")
    log.info("  New leads:     %d", len(new_leads))
    log.info("  Queue total:   %d", len(existing_queue))
    log.info("  Output:        %s", BIG_QUEUE_FILE)
    log.info("=" * 50)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="IG big influencer scout (follow-first strategy)")
    parser.add_argument("--dry-run", action="store_true", help="Preview only — no file writes")
    parser.add_argument("--seed-only", action="store_true", help="Only scrape seed accounts")
    parser.add_argument("--hashtag-only", action="store_true", help="Only scrape hashtags")
    parser.add_argument("--limit", type=int, default=None, help="Max leads to qualify")
    args = parser.parse_args()

    if args.seed_only and args.hashtag_only:
        parser.error("--seed-only and --hashtag-only are mutually exclusive")

    run_scout(
        dry_run=args.dry_run,
        seed_only=args.seed_only,
        hashtag_only=args.hashtag_only,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
