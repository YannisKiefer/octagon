#!/usr/bin/env python3
"""
ig-instagrapi-dm.py — Native Instagram DM sender via instagrapi.

Replaces GeeLark dependency in ig-dm-auto.py with direct instagrapi DM sending.
Uses the same session as ig-instagrapi-scout.py (shared session file).

Reads from ig_small_queue.json (same queue the scout writes to).
Sends DMs via cl.direct_send(text, [user_pk]).

Safeguards:
  - 20 DM/day cap (conservative, below IG's ~30 soft limit)
  - 90-200s delay between sends (human-like pacing)
  - IG_SMALL_STOP.flag kill switch
  - IG_RATE_LIMITED.flag on 429
  - IG_SESSION_EXPIRED.flag on auth failure
  - Preview mode (--dry-run)
  - Failed-send marking (dm_status=error in queue)
  - Contacted dedup (ig_contacted.txt)
  - CRM cross-platform lock check

Session sharing:
  Reads session from ig_instagrapi_session.json (same file scout creates).
  If no session exists, logs in fresh and saves.

Usage:
  python3 ig-instagrapi-dm.py --self-test     # verify login + DM capability
  python3 ig-instagrapi-dm.py --dry-run       # preview eligible leads, no sends
  python3 ig-instagrapi-dm.py --stats         # show queue stats
  python3 ig-instagrapi-dm.py                 # send DMs (auto mode)

NOT in v1: Telegram approval flow, follow-first approach, big queue handling.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# CRM integration (optional)
# ---------------------------------------------------------------------------

_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))

try:
    from crm import CRM, Platform, ActionType
    _crm: Optional["CRM"] = CRM()
except ImportError:
    _crm = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
BASE_DIR = HERE.parent
DATA_DIR = BASE_DIR / "data"

QUEUE_FILE = DATA_DIR / "ig_small_queue.json"
CONTACTED_FILE = DATA_DIR / "ig_contacted.txt"
SESSION_FILE = DATA_DIR / "ig_instagrapi_session.json"
STOP_FLAG = DATA_DIR / "IG_SMALL_STOP.flag"
RATE_LIMIT_FLAG = DATA_DIR / "IG_RATE_LIMITED.flag"
SESSION_EXPIRED_FLAG = DATA_DIR / "IG_SESSION_EXPIRED.flag"
DAILY_CAP_FILE = DATA_DIR / "ig_instagrapi_sent_today.json"

CONFIG_FILE = Path.home() / "clawd-workspace" / "config" / "api_keys.json"

# Sending limits
MAX_DMS_PER_DAY = 20      # conservative cap (IG soft limit ~30)
DM_DELAY_MIN = 90          # seconds between sends
DM_DELAY_MAX = 200         # seconds between sends

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ig-instagrapi-dm")

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


def load_contacted(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def append_contacted(path: Path, username: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(username + "\n")


# ---------------------------------------------------------------------------
# Credential loading
# ---------------------------------------------------------------------------

def _load_credentials() -> tuple[Optional[str], Optional[str]]:
    """Load IG username/password from env vars or config."""
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
# Session management (shared with ig-instagrapi-scout.py)
# ---------------------------------------------------------------------------

def _get_client(username: str, password: str):
    """
    Create instagrapi Client with shared session persistence.
    Reuses session saved by ig-instagrapi-scout.py.
    """
    try:
        from instagrapi import Client
    except ImportError:
        log.error("instagrapi not installed. Run: pip install instagrapi")
        sys.exit(1)

    cl = Client()
    cl.delay_range = [1, 3]

    # Try loading saved session (shared with scout)
    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)
            cl.get_timeline_feed()
            log.info("Resumed session for @%s", username)
            if SESSION_EXPIRED_FLAG.exists():
                SESSION_EXPIRED_FLAG.unlink()
            return cl
        except Exception as exc:
            log.warning("Saved session invalid: %s", exc)

    # Fresh login
    try:
        cl.login(username, password)
        log.info("Fresh login for @%s", username)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cl.dump_settings(SESSION_FILE)
        if SESSION_EXPIRED_FLAG.exists():
            SESSION_EXPIRED_FLAG.unlink()
        return cl
    except Exception as exc:
        log.error("Login failed: %s", exc)
        SESSION_EXPIRED_FLAG.write_text(
            f"Login failed at {datetime.now(timezone.utc).isoformat()}: {exc}\n"
        )
        return None


# ---------------------------------------------------------------------------
# Daily cap
# ---------------------------------------------------------------------------

def load_daily_cap() -> dict:
    today = datetime.now(timezone.utc).date().isoformat()
    if DAILY_CAP_FILE.exists():
        try:
            data = json.loads(DAILY_CAP_FILE.read_text())
            if data.get("date") == today:
                return data
        except Exception:
            pass
    return {"date": today, "count": 0, "cap": MAX_DMS_PER_DAY}


def save_daily_cap(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DAILY_CAP_FILE.write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# Blocker checks
# ---------------------------------------------------------------------------

def check_blockers() -> bool:
    """Check all blocking conditions. Returns True if blocked."""
    if STOP_FLAG.exists():
        log.error("IG_SMALL_STOP.flag present. Remove to continue.")
        return True

    if RATE_LIMIT_FLAG.exists():
        try:
            age = time.time() - RATE_LIMIT_FLAG.stat().st_mtime
            if age < 3600:
                log.error("Rate limit flag is recent (%d min ago). Waiting.", int(age / 60))
                return True
            log.info("Clearing stale rate limit flag (%d min old)", int(age / 60))
            RATE_LIMIT_FLAG.unlink()
        except Exception:
            pass

    if SESSION_EXPIRED_FLAG.exists():
        log.error("Session expired flag present. Re-login needed.")
        return True

    return False


# ---------------------------------------------------------------------------
# Queue loading
# ---------------------------------------------------------------------------

def load_eligible_leads(contacted: set) -> list[dict]:
    """Load pending direct_dm leads from queue, excluding already contacted."""
    queue = load_json(QUEUE_FILE, default=[])
    eligible = []
    for entry in queue:
        if not isinstance(entry, dict):
            continue
        if entry.get("dm_status") != "pending":
            continue
        if entry.get("approach") != "direct_dm":
            continue
        username = entry.get("username", "")
        if not username or username in contacted:
            continue
        if not entry.get("dm_text"):
            continue
        eligible.append(entry)

    # Sort by score descending (highest value leads first)
    eligible.sort(key=lambda e: e.get("score", 0), reverse=True)
    return eligible


# ---------------------------------------------------------------------------
# Queue update
# ---------------------------------------------------------------------------

def update_queue_entry(username: str, updates: dict) -> None:
    """Update a specific entry in the queue file."""
    queue = load_json(QUEUE_FILE, default=[])
    for entry in queue:
        if isinstance(entry, dict) and entry.get("username") == username:
            entry.update(updates)
            break
    save_json(QUEUE_FILE, queue)


# ---------------------------------------------------------------------------
# DM sending via instagrapi
# ---------------------------------------------------------------------------

def resolve_user_pk(cl, username: str) -> Optional[str]:
    """Resolve username to user PK (required for direct_send)."""
    try:
        user_id = cl.user_id_from_username(username)
        return str(user_id)
    except Exception as exc:
        log.warning("Could not resolve @%s to PK: %s", username, exc)
        return None


def send_dm_native(cl, user_pk: str, text: str) -> tuple[bool, str]:
    """
    Send a DM via instagrapi cl.direct_send().
    Returns (success, error_code).
    """
    try:
        result = cl.direct_send(text, [int(user_pk)])
        if result:
            return True, ""
        return False, "empty_response"
    except Exception as exc:
        msg = str(exc).lower()
        if "rate" in msg or "429" in msg or "please wait" in msg:
            return False, "rate_limited"
        if "login_required" in msg or "challenge" in msg:
            return False, "session_expired"
        if "not found" in msg or "user not found" in msg:
            return False, "user_not_found"
        if "feedback_required" in msg:
            return False, "feedback_required"
        return False, f"error:{str(exc)[:100]}"


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def self_test(username: str, password: str) -> bool:
    """Verify login, session, and DM capability."""
    log.info("=== SELF TEST ===")

    try:
        from instagrapi import Client
        log.info("[OK] instagrapi imported")
    except ImportError:
        log.error("[FAIL] instagrapi not installed")
        return False

    if not username or not password:
        log.error("[FAIL] No credentials. Add ig_username + ig_password to config")
        return False
    log.info("[OK] Credentials found for @%s", username)

    cl = _get_client(username, password)
    if cl is None:
        log.error("[FAIL] Login failed")
        return False
    log.info("[OK] Login successful")

    # Verify we can resolve a user PK (our own)
    try:
        own_info = cl.user_info_by_username(username)
        log.info("[OK] API works — @%s (pk=%s)", own_info.username, own_info.pk)
    except Exception as exc:
        log.error("[FAIL] API call failed: %s", exc)
        return False

    # Verify direct_send method exists
    if hasattr(cl, "direct_send"):
        log.info("[OK] direct_send method available")
    else:
        log.error("[FAIL] direct_send method not found in instagrapi")
        return False

    # Check direct threads access (proves DM permission)
    try:
        threads = cl.direct_threads(amount=1)
        log.info("[OK] DM access verified (%d threads visible)", len(threads))
    except Exception as exc:
        log.warning("[WARN] Could not list DM threads: %s", exc)
        log.warning("       DM sending may still work — some accounts have restricted thread listing")

    log.info("=== SELF TEST PASSED ===")
    return True


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def show_stats() -> None:
    """Print queue stats and exit."""
    queue = load_json(QUEUE_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)
    cap_data = load_daily_cap()

    counts: dict[str, int] = {}
    for entry in queue:
        if isinstance(entry, dict):
            status = entry.get("dm_status", "unknown")
            counts[status] = counts.get(status, 0) + 1

    print("\n" + "=" * 55)
    print("IG Instagrapi DM — Queue Stats")
    print("=" * 55)

    print(f"\nQueue file: {QUEUE_FILE}")
    print(f"Total entries: {len(queue)}")
    for status, n in sorted(counts.items()):
        print(f"  {status:20s}: {n}")

    pending = [
        e for e in queue
        if isinstance(e, dict)
        and e.get("dm_status") == "pending"
        and e.get("approach") == "direct_dm"
        and e.get("username") not in contacted
        and e.get("dm_text")
    ]
    print(f"\nEligible to send: {len(pending)}")
    print(f"Already contacted: {len(contacted)}")
    print(f"DMs sent today: {cap_data['count']} / {cap_data['cap']}")
    print(f"Session file: {'EXISTS' if SESSION_FILE.exists() else 'MISSING'}")
    print(f"Stop flag: {'SET' if STOP_FLAG.exists() else 'clear'}")
    print(f"Rate limit flag: {'SET' if RATE_LIMIT_FLAG.exists() else 'clear'}")
    print(f"Session expired: {'SET' if SESSION_EXPIRED_FLAG.exists() else 'clear'}")
    print("=" * 55 + "\n")


# ---------------------------------------------------------------------------
# Main send loop
# ---------------------------------------------------------------------------

def run_send(dry_run: bool = False) -> None:
    """Main DM sending pipeline."""

    if check_blockers():
        return

    # Load credentials
    username, password = _load_credentials()
    if not username or not password:
        log.error("No IG credentials. Add ig_username + ig_password to config.")
        SESSION_EXPIRED_FLAG.write_text(
            f"No credentials at {datetime.now(timezone.utc).isoformat()}\n"
        )
        return

    # Daily cap
    cap_data = load_daily_cap()
    today_sent = cap_data["count"]
    log.info("DMs sent today: %d / %d", today_sent, cap_data["cap"])

    if today_sent >= cap_data["cap"]:
        log.info("Daily DM cap reached (%d). Exiting.", cap_data["cap"])
        return

    remaining = cap_data["cap"] - today_sent

    # Load eligible leads
    contacted = load_contacted(CONTACTED_FILE)
    eligible = load_eligible_leads(contacted)
    log.info("Eligible leads: %d (budget: %d remaining)", len(eligible), remaining)

    if not eligible:
        log.info("No eligible leads. Exiting.")
        return

    if dry_run:
        log.info("DRY RUN — showing eligible leads, no sends")
        for i, e in enumerate(eligible[:10]):
            log.info(
                "  %d. @%s — score=%d, followers=%s, tier=%s",
                i + 1,
                e.get("username"),
                e.get("score", 0),
                e.get("followers", "?"),
                e.get("tier", "?"),
            )
            log.info("     DM preview: %s", (e.get("dm_text") or "")[:120])
        if len(eligible) > 10:
            log.info("  ... and %d more", len(eligible) - 10)
        return

    # Login
    cl = _get_client(username, password)
    if cl is None:
        return

    sent = 0
    errors = 0
    skipped = 0

    for entry in eligible:
        if STOP_FLAG.exists():
            log.warning("Stop flag detected mid-run. Halting.")
            break

        cap_data = load_daily_cap()
        if cap_data["count"] >= cap_data["cap"]:
            log.info("Daily cap reached mid-run.")
            break

        if sent >= remaining:
            log.info("Budget exhausted.")
            break

        uname = entry.get("username", "")
        dm_text = entry.get("dm_text", "")
        followers = entry.get("followers", 0)
        score = entry.get("score", 0)

        log.info("Processing: @%s (score=%d, %d followers)", uname, score, followers)

        # CRM cross-platform check
        if _crm:
            try:
                check = _crm.check_contact_allowed(Platform.INSTAGRAM, uname)
                if not check:
                    log.info("  CRM block @%s: %s", uname, check.reason)
                    update_queue_entry(uname, {
                        "dm_status": f"crm_block:{check.reason}",
                    })
                    skipped += 1
                    continue
            except Exception:
                pass

        # Resolve user PK
        user_pk = resolve_user_pk(cl, uname)
        if not user_pk:
            log.warning("  Could not resolve @%s — skipping", uname)
            update_queue_entry(uname, {
                "dm_status": "error",
                "dm_error_code": "pk_resolve_failed",
            })
            errors += 1
            continue

        # Send DM
        success, error_code = send_dm_native(cl, user_pk, dm_text)

        if success:
            log.info("  DM SENT to @%s", uname)
            now_str = datetime.now(timezone.utc).isoformat()
            update_queue_entry(uname, {
                "dm_status": "sent",
                "dm_sent_at": now_str,
                "dm_sent_via": "instagrapi",
            })
            append_contacted(CONTACTED_FILE, uname)
            cap_data["count"] += 1
            save_daily_cap(cap_data)

            if _crm:
                try:
                    _crm.log_contact(
                        platform=Platform.INSTAGRAM,
                        handle=uname,
                        action=ActionType.DM_SENT,
                        agent_id="ig-instagrapi-dm",
                        message_preview=dm_text[:300],
                        metadata={
                            "followers": followers,
                            "score": score,
                            "tier": entry.get("tier"),
                            "lead_type": entry.get("lead_type"),
                        },
                    )
                except Exception:
                    pass

            sent += 1

        elif error_code == "rate_limited":
            log.error("  RATE LIMITED — stopping for today")
            RATE_LIMIT_FLAG.write_text(
                f"Rate limited at {datetime.now(timezone.utc).isoformat()}\n"
            )
            break

        elif error_code == "session_expired":
            log.error("  SESSION EXPIRED — stopping")
            SESSION_EXPIRED_FLAG.write_text(
                f"Session expired at {datetime.now(timezone.utc).isoformat()}\n"
            )
            break

        elif error_code == "feedback_required":
            log.error("  FEEDBACK REQUIRED — Instagram flagged this account. Stopping.")
            STOP_FLAG.write_text(
                f"feedback_required at {datetime.now(timezone.utc).isoformat()}\n"
            )
            break

        else:
            log.warning("  DM failed for @%s: %s", uname, error_code)
            update_queue_entry(uname, {
                "dm_status": "error",
                "dm_error_code": error_code,
            })
            errors += 1

        # Human-like delay
        if sent < remaining:
            delay = random.uniform(DM_DELAY_MIN, DM_DELAY_MAX)
            log.info("  Waiting %.0fs before next DM...", delay)
            time.sleep(delay)

    # Summary
    log.info("=" * 50)
    log.info("ig-instagrapi-dm Run Complete")
    log.info("  Sent:    %d", sent)
    log.info("  Errors:  %d", errors)
    log.info("  Skipped: %d", skipped)
    log.info("  Budget:  %d / %d used today", today_sent + sent, cap_data["cap"])
    log.info("=" * 50)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Native Instagram DM sender via instagrapi"
    )
    parser.add_argument("--self-test", action="store_true",
                        help="Verify login and DM capability")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview eligible leads, no sends")
    parser.add_argument("--stats", action="store_true",
                        help="Show queue stats and exit")
    args = parser.parse_args()

    if args.stats:
        show_stats()
        return

    if args.self_test:
        username, password = _load_credentials()
        ok = self_test(username, password)
        sys.exit(0 if ok else 1)

    run_send(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
