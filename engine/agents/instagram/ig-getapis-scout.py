#!/usr/bin/env python3
"""
ig-getapis-scout.py — Instagram lead discovery via getapis.io (FREE API).

Discovers ecom influencers by crawling followers/following of seed accounts.
Scores with shared ICP scoring, writes to ig_small_queue.json.

API: https://api.getapis.io/instagram/instagramapi/
Auth: X-APIHUB-KEY header

Usage:
  python3 ig-getapis-scout.py                  # discover leads
  python3 ig-getapis-scout.py --dry-run        # preview only
  python3 ig-getapis-scout.py --self-test      # verify API key works
  python3 ig-getapis-scout.py --stats          # show queue stats
  python3 ig-getapis-scout.py --max-profiles 30
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

import urllib.request
import urllib.error
import urllib.parse

# ---------------------------------------------------------------------------
# CRM (optional)
# ---------------------------------------------------------------------------

_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))

try:
    from crm import CRM, Platform, ActionType
    _crm: Optional["CRM"] = CRM()
except ImportError:
    _crm = None

# ICP scoring (shared)
_SHARED_PATH = Path(__file__).parent.parent.parent / "shared"
if _SHARED_PATH.exists():
    sys.path.insert(0, str(_SHARED_PATH))

try:
    from icp_scoring import score_profile_v2, MIN_ICP_SCORE_V2
except ImportError:
    MIN_ICP_SCORE_V2 = 5

    def score_profile_v2(**kwargs) -> dict:
        return {"total": 0, "signals": {}, "reject_reason": "icp_scoring not found"}

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
BASE_DIR = HERE.parent
DATA_DIR = BASE_DIR / "data"
QUEUE_FILE = DATA_DIR / "ig_small_queue.json"
CONTACTED_FILE = DATA_DIR / "ig_contacted.txt"
SEEDS_FILE = Path(__file__).parent.parent.parent / "shared" / "data" / "seeds.json"
API_KEYS_FILE = Path(__file__).parent.parent.parent / "config" / "api_keys.json"

GETAPIS_BASE = "https://api.getapis.io/instagram/instagramapi"

MAX_PROFILES_DEFAULT = 50
FOLLOWERS_PER_SEED = 50       # fetch this many followers per seed
DELAY_BETWEEN_API_CALLS = 2   # seconds between API calls (be polite)

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
# Helpers
# ---------------------------------------------------------------------------


def load_api_key() -> str:
    """Load getapis.io API key from config."""
    if API_KEYS_FILE.exists():
        try:
            data = json.loads(API_KEYS_FILE.read_text())
            key = data.get("getapis_ig_api_key", "").strip()
            if key:
                return key
        except Exception:
            pass
    env_key = os.environ.get("GETAPIS_IG_API_KEY", "").strip()
    return env_key


def api_get(path: str, api_key: str) -> Optional[Dict[str, Any]]:
    """GET request to getapis.io."""
    url = f"{GETAPIS_BASE}/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": api_key,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        log.warning("API HTTP %d for %s", e.code, path)
        return None
    except Exception as e:
        log.warning("API error for %s: %s", path, e)
        return None


def api_post(path: str, api_key: str, body: dict) -> Optional[Dict[str, Any]]:
    """POST request to getapis.io."""
    url = f"{GETAPIS_BASE}/{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "apikey": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        log.warning("API HTTP %d for %s", e.code, path)
        return None
    except Exception as e:
        log.warning("API error for %s: %s", path, e)
        return None


def load_json(path: Path, default=None):
    if default is None:
        default = []
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


def load_contacted(path: Path) -> set:
    if not path.exists():
        return set()
    try:
        return {line.strip() for line in path.read_text().splitlines() if line.strip()}
    except Exception:
        return set()


def load_seeds() -> List[Dict[str, Any]]:
    """Load IG seeds from shared/data/seeds.json."""
    seeds = load_json(SEEDS_FILE, default=[])
    return [s for s in seeds if isinstance(s, dict) and s.get("platform") == "instagram"]


# ---------------------------------------------------------------------------
# Discovery via getapis.io
# ---------------------------------------------------------------------------


def get_account_details(username: str, api_key: str) -> Optional[Dict[str, Any]]:
    """Fetch full account details."""
    result = api_get(f"account-details/{username}/web", api_key)
    time.sleep(DELAY_BETWEEN_API_CALLS)
    return result


def get_account_followers(user_id: str, username: str, api_key: str,
                          offset: int = 0, amount: int = 50) -> Optional[List[Dict]]:
    """Fetch followers list."""
    result = api_get(f"account-followers/{user_id}/{offset}/{amount}", api_key)
    time.sleep(DELAY_BETWEEN_API_CALLS)
    if result and isinstance(result, list):
        return result
    if result and isinstance(result, dict):
        return result.get("users", result.get("followers", []))
    return None


def get_account_following(user_id: str, username: str, api_key: str,
                          offset: int = 0, amount: int = 50) -> Optional[List[Dict]]:
    """Fetch following list."""
    result = api_get(f"account-following/{user_id}/{offset}/{amount}", api_key)
    time.sleep(DELAY_BETWEEN_API_CALLS)
    if result and isinstance(result, list):
        return result
    if result and isinstance(result, dict):
        return result.get("users", result.get("following", []))
    return None


def search_users(query: str, api_key: str) -> Optional[List[Dict]]:
    """Search for users by name."""
    result = api_post("user-search", api_key, {"name": query})
    time.sleep(DELAY_BETWEEN_API_CALLS)
    if result and isinstance(result, list):
        return result
    if result and isinstance(result, dict):
        return result.get("users", [])
    return None


def profile_to_lead(profile: dict, source: str) -> Optional[Dict[str, Any]]:
    """Convert a getapis.io profile to queue entry."""
    username = profile.get("username", "")
    if not username:
        return None

    full_name = profile.get("full_name", "")
    bio = profile.get("biography", profile.get("bio", ""))
    followers = profile.get("follower_count", profile.get("followers", 0))
    following = profile.get("following_count", profile.get("following", 0))
    is_private = profile.get("is_private", False)

    if is_private:
        return None
    if not isinstance(followers, (int, float)):
        followers = 0
    if followers < 1000:
        return None

    # ICP scoring
    icp = score_profile_v2(
        bio=bio or "",
        followers=int(followers),
        following=int(following) if isinstance(following, (int, float)) else 0,
        avg_likes=0,
        last_post_days_ago=15,
        ecom_posts_30d=2,
        has_cross_platform=False,
        platform="instagram",
    )

    total_score = icp.get("total", 0)
    reject = icp.get("reject_reason")
    if reject or total_score < MIN_ICP_SCORE_V2:
        return None

    # Determine tier
    tier = "nano"
    if followers >= 500000:
        tier = "macro"
    elif followers >= 100000:
        tier = "mid"
    elif followers >= 10000:
        tier = "micro"

    opener = full_name.split()[0] if full_name and full_name.strip() else username

    return {
        "username": username,
        "display": full_name,
        "full_name": full_name,
        "bio": bio or "",
        "followers": int(followers),
        "following": int(following) if isinstance(following, (int, float)) else 0,
        "url": f"https://instagram.com/{username}",
        "tier": tier,
        "lead_type": "CREATOR",
        "score": total_score,
        "icp_score": total_score,
        "signals": icp.get("signals", {}),
        "opener": opener,
        "dm_text": "",
        "dm_status": "pending",
        "approach": "direct_dm" if followers < 40000 else "follow_first",
        "source": f"getapis:{source}",
        "discovered_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Main discovery loop
# ---------------------------------------------------------------------------


def discover_leads(api_key: str, max_profiles: int = MAX_PROFILES_DEFAULT,
                   dry_run: bool = False) -> List[Dict]:
    """Discover leads from seed account followers/following."""
    seeds = load_seeds()
    if not seeds:
        log.warning("No IG seeds found in %s", SEEDS_FILE)
        return []

    existing_queue = load_json(QUEUE_FILE, default=[])
    existing_usernames = {
        e.get("username", "").lower()
        for e in existing_queue
        if isinstance(e, dict)
    }
    contacted = load_contacted(CONTACTED_FILE)

    new_leads = []
    total_checked = 0

    random.shuffle(seeds)

    for seed in seeds:
        if total_checked >= max_profiles:
            break

        handle = seed.get("handle", "")
        modes = seed.get("discovery_modes", ["followers"])
        log.info("Crawling seed: %s (modes: %s)", handle, modes)

        # Get seed account details to find user_id
        details = get_account_details(handle, api_key)
        if not details:
            log.warning("  Could not fetch details for %s", handle)
            continue

        user_id = str(details.get("id", details.get("pk", "")))
        if not user_id:
            log.warning("  No user_id found for %s", handle)
            continue

        log.info("  %s: user_id=%s, followers=%s",
                 handle, user_id, details.get("follower_count", "?"))

        # Crawl followers
        if "followers" in modes and total_checked < max_profiles:
            followers = get_account_followers(user_id, handle, api_key,
                                             offset=0, amount=FOLLOWERS_PER_SEED)
            if followers:
                log.info("  Got %d followers for %s", len(followers), handle)
                for profile in followers:
                    if total_checked >= max_profiles:
                        break
                    total_checked += 1
                    uname = profile.get("username", "").lower()
                    if uname in existing_usernames or uname in contacted:
                        continue
                    lead = profile_to_lead(profile, f"followers:{handle}")
                    if lead:
                        if _crm:
                            allowed = _crm.check_contact_allowed(
                                platform="instagram",
                                handle=lead["username"],
                            )
                            if not allowed:
                                continue
                        new_leads.append(lead)
                        existing_usernames.add(uname)
                        log.info("    + %s (score=%d, followers=%d, tier=%s)",
                                 lead["username"], lead["score"],
                                 lead["followers"], lead["tier"])
            else:
                log.info("  No followers returned for %s", handle)

        # Crawl following
        if "following" in modes and total_checked < max_profiles:
            following = get_account_following(user_id, handle, api_key,
                                             offset=0, amount=FOLLOWERS_PER_SEED)
            if following:
                log.info("  Got %d following for %s", len(following), handle)
                for profile in following:
                    if total_checked >= max_profiles:
                        break
                    total_checked += 1
                    uname = profile.get("username", "").lower()
                    if uname in existing_usernames or uname in contacted:
                        continue
                    lead = profile_to_lead(profile, f"following:{handle}")
                    if lead:
                        if _crm:
                            allowed = _crm.check_contact_allowed(
                                platform="instagram",
                                handle=lead["username"],
                            )
                            if not allowed:
                                continue
                        new_leads.append(lead)
                        existing_usernames.add(uname)
                        log.info("    + %s (score=%d, followers=%d, tier=%s)",
                                 lead["username"], lead["score"],
                                 lead["followers"], lead["tier"])
            else:
                log.info("  No following returned for %s", handle)

    log.info("Discovery complete: %d profiles checked, %d new leads found",
             total_checked, len(new_leads))

    if not dry_run and new_leads:
        merged = existing_queue + new_leads
        save_json(QUEUE_FILE, merged)
        log.info("Queue updated: %d total entries in %s", len(merged), QUEUE_FILE)

    return new_leads


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


def show_stats():
    """Print queue stats."""
    queue = load_json(QUEUE_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)

    counts = {}
    for entry in queue:
        if not isinstance(entry, dict):
            continue
        status = entry.get("dm_status", "unknown")
        counts[status] = counts.get(status, 0) + 1

    print("\n" + "=" * 55)
    print("IG getapis Scout -- Queue Stats")
    print("=" * 55)
    print(f"\nQueue file: {QUEUE_FILE}")
    print(f"Total leads: {len(queue)}")
    for status, n in sorted(counts.items()):
        print(f"  {status:20s}: {n}")
    print(f"\nContacted: {len(contacted)}")
    print(f"API key: {'SET' if load_api_key() else 'MISSING'}")

    # Source breakdown
    sources = {}
    for entry in queue:
        if isinstance(entry, dict):
            src = entry.get("source", "unknown")
            sources[src] = sources.get(src, 0) + 1
    if sources:
        print("\nSources:")
        for src, n in sorted(sources.items(), key=lambda x: -x[1]):
            print(f"  {src:40s}: {n}")

    print("=" * 55 + "\n")


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------


def self_test() -> bool:
    """Verify API key works."""
    log.info("=== SELF TEST ===")

    api_key = load_api_key()
    if not api_key:
        log.error("[FAIL] No API key. Set getapis_ig_api_key in config/api_keys.json")
        return False
    log.info("[OK] API key loaded (%d chars)", len(api_key))

    # Test API call
    result = api_get("account-details/instagram/web", api_key)
    if result:
        followers = result.get("follower_count", "?")
        log.info("[OK] API works. Test account @instagram has %s followers", followers)
    else:
        log.error("[FAIL] API call failed. Check key validity.")
        return False

    # Check seeds
    seeds = load_seeds()
    log.info("[OK] %d IG seeds loaded", len(seeds))

    # Check queue file writable
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log.info("[OK] Data directory exists: %s", DATA_DIR)

    log.info("=== SELF TEST PASSED ===")
    return True


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Instagram lead discovery via getapis.io")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--self-test", action="store_true", help="Verify API key")
    parser.add_argument("--stats", action="store_true", help="Show queue stats")
    parser.add_argument("--max-profiles", type=int, default=MAX_PROFILES_DEFAULT,
                        help=f"Max profiles to check (default: {MAX_PROFILES_DEFAULT})")
    args = parser.parse_args()

    if args.stats:
        show_stats()
        return

    if args.self_test:
        ok = self_test()
        sys.exit(0 if ok else 1)

    api_key = load_api_key()
    if not api_key:
        log.error("No API key. Set getapis_ig_api_key in config/api_keys.json or GETAPIS_IG_API_KEY env var")
        sys.exit(1)

    leads = discover_leads(api_key, max_profiles=args.max_profiles, dry_run=args.dry_run)
    log.info("Done. %d new leads discovered.", len(leads))


if __name__ == "__main__":
    main()
