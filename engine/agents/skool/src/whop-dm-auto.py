#!/usr/bin/env python3
"""
whop-dm-auto.py — Send DMs to Whop community owners via Playwright UI.

Flow per DM:
  1. Navigate to owner profile: whop.com/@{username}
  2. Find "Message" link → /messages/?to_user_id=user_xxx
  3. Navigate to DM conversation
  4. Type message into ProseMirror editor
  5. Press Enter to send

Features:
  - Ramping daily cap: starts at 20, +10 per day from RAMP_START_DATE
  - 50/50 free/paid community split per day
  - Timezone-aware sending (send during recipient's business hours)
  - CRM cross-platform dedup
  - Stop flag, rate limit, session expiry guards

Usage:
  python3 whop-dm-auto.py
  python3 whop-dm-auto.py --dry-run
  python3 whop-dm-auto.py --test     # single DM, show details, ask before send
"""

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

from playwright.sync_api import (
    sync_playwright,
    TimeoutError as PlaywrightTimeoutError,
)

# CRM — unified lead database (optional)
_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType
    _crm = CRM()  # type: Optional[CRM]
except ImportError:
    _crm = None

# Telegram
_SHARED_PATH = Path(__file__).parent.parent.parent / "shared"
if _SHARED_PATH.exists():
    sys.path.insert(0, str(_SHARED_PATH))
try:
    from telegram_notify import send as tg_send
except ImportError:
    def tg_send(msg):
        pass

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_default_base = os.environ.get(
    "WHOP_BASE_DIR",
    str(Path(__file__).parent.parent),
)
BASE_DIR = Path(_default_base).expanduser()
DATA_DIR = BASE_DIR / "data"
SESSION_FILE = DATA_DIR / "whop_session.json"
QUEUE_FILE = DATA_DIR / "whop_queue.json"
CONTACTED_FILE = DATA_DIR / "whop_contacted.txt"
STOP_FLAG = DATA_DIR / "WHOP_STOP.flag"
APPROVAL_FLAG = DATA_DIR / "WHOP_DM_APPROVED.flag"

WHOP_BASE = "https://whop.com"

# Delays — Whop is stricter than Skool
DM_DELAY_MIN = 90       # seconds between DMs
DM_DELAY_MAX = 180      # seconds between DMs

# Ramping cap: start_cap + (days_since_start * ramp_per_day)
RAMP_START_DATE = "2026-03-10"  # today
RAMP_START_CAP = 20
RAMP_PER_DAY = 10
RAMP_MAX_CAP = 100

# Hold period — wait before DMing a newly scouted lead
DM_HOLD_HOURS = 0  # No hold needed on Whop (no join required for DM)

RATE_LIMITED_FILE = DATA_DIR / "RATE_LIMITED_UNTIL"
SESSION_EXPIRED_FILE = DATA_DIR / "SESSION_EXPIRED.flag"
DAILY_CAP_FILE = DATA_DIR / "whop_sent_today.json"

# Timezone mapping for common TLDs / country indicators
TZ_OFFSETS = {
    "us": -5, "usa": -5, "america": -5, "ny": -5, "la": -8, "chicago": -6,
    "uk": 0, "london": 0, "gb": 0,
    "de": 1, "germany": 1, "berlin": 1,
    "au": 10, "australia": 10, "sydney": 10,
    "ca": -5, "canada": -5, "toronto": -5,
    "dubai": 4, "uae": 4,
    "india": 5, "mumbai": 5,
    "sg": 8, "singapore": 8,
    "ph": 8, "philippines": 8,
}

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
# Helpers — file I/O
# ---------------------------------------------------------------------------

def load_json(path, default=None):
    # type: (Path, object) -> object
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


def save_json(path, data):
    # type: (Path, object) -> None
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def load_contacted(path):
    # type: (Path) -> set
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def append_contacted(path, slug):
    # type: (Path, str) -> None
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(slug + "\n")


def load_session_cookies(session_file):
    # type: (Path) -> list
    data = load_json(session_file, default={})
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("cookies", [])
    return []


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

def check_stop_flag():
    # type: () -> bool
    return STOP_FLAG.exists()


def check_rate_limit():
    # type: () -> bool
    if not RATE_LIMITED_FILE.exists():
        return False
    try:
        until = datetime.fromisoformat(RATE_LIMITED_FILE.read_text().strip())
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) < until:
            log.warning("Rate limited until %s — exiting", until.isoformat())
            return True
        RATE_LIMITED_FILE.unlink(missing_ok=True)
    except Exception:
        pass
    return False


def write_rate_limit(retry_after=0):
    # type: (int) -> None
    secs = retry_after if retry_after > 0 else 86400
    until = datetime.now(timezone.utc) + timedelta(seconds=secs)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RATE_LIMITED_FILE.write_text(until.isoformat())
    log.warning("Rate limit written: until %s", until.isoformat())


def check_session_expired():
    # type: () -> bool
    if not SESSION_EXPIRED_FILE.exists():
        return False
    log.error("Session expired flag exists. Refresh cookies and remove %s", SESSION_EXPIRED_FILE)
    return True


def write_session_expired(url):
    # type: (str) -> None
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    SESSION_EXPIRED_FILE.write_text("{}\n{}".format(ts, url))
    log.error("Session expired at %s (url=%s)", ts, url)


# ---------------------------------------------------------------------------
# Ramping daily cap
# ---------------------------------------------------------------------------

def compute_daily_cap():
    # type: () -> int
    """Start at RAMP_START_CAP, add RAMP_PER_DAY each day."""
    try:
        start = datetime.strptime(RAMP_START_DATE, "%Y-%m-%d").date()
    except Exception:
        return RAMP_START_CAP
    today = datetime.now(timezone.utc).date()
    days = (today - start).days
    if days < 0:
        days = 0
    cap = RAMP_START_CAP + (days * RAMP_PER_DAY)
    return min(cap, RAMP_MAX_CAP)


def load_daily_cap():
    # type: () -> dict
    today = datetime.now(timezone.utc).date().isoformat()
    cap = compute_daily_cap()
    if DAILY_CAP_FILE.exists():
        try:
            data = json.loads(DAILY_CAP_FILE.read_text())
            if data.get("date") == today:
                data["cap"] = cap  # Always use latest computed cap
                return data
        except Exception:
            pass
    return {"date": today, "count": 0, "cap": cap}


def save_daily_cap(data):
    # type: (dict) -> None
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DAILY_CAP_FILE.write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# Timezone-aware send window
# ---------------------------------------------------------------------------

def is_good_send_time(entry):
    # type: (dict) -> bool
    """
    Check if now is a reasonable time to DM this person (9am-8pm their time).
    Uses country/location hints from the entry. Returns True if unknown.
    """
    location = (
        str(entry.get("country", ""))
        + " " + str(entry.get("location", ""))
        + " " + str(entry.get("timezone", ""))
    ).lower().strip()

    if not location.strip():
        return True  # Unknown location = send anyway

    offset = None
    for key, tz_offset in TZ_OFFSETS.items():
        if key in location:
            offset = tz_offset
            break

    if offset is None:
        return True  # Unknown timezone = send anyway

    utc_now = datetime.now(timezone.utc)
    their_hour = (utc_now.hour + offset) % 24

    # Send window: 9am - 8pm their time
    return 9 <= their_hour <= 20


# ---------------------------------------------------------------------------
# Playwright DM sending
# ---------------------------------------------------------------------------

def send_dm_via_profile(page, owner_username, dm_text):
    # type: (object, str, str) -> tuple
    """
    Send a DM by navigating to the owner's profile, clicking Message,
    then typing into the ProseMirror editor and pressing Enter.

    Returns (status, detail):
      ("sent", feed_url)
      ("no_message_link", None)
      ("dm_blocked", error_text)
      ("send_failed", error_text)
      ("nav_failed", error_text)
    """
    profile_url = "{}/{}".format(WHOP_BASE, owner_username)

    # Step 1: Navigate to owner profile
    try:
        page.goto(profile_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(random.randint(2000, 4000))
    except PlaywrightTimeoutError:
        return ("nav_failed", "timeout on " + profile_url)
    except Exception as exc:
        return ("nav_failed", str(exc)[:200])

    # Step 2: Find the Message link
    msg_links = page.evaluate("""() => {
        const links = document.querySelectorAll('a[href*="/messages/?to_user_id="]');
        return Array.from(links).map(a => a.getAttribute('href'));
    }""")

    if not msg_links:
        # Maybe the profile uses a different format or doesn't have a Message button
        return ("no_message_link", "no /messages/?to_user_id= link on " + profile_url)

    dm_url = WHOP_BASE + msg_links[0]

    # Step 3: Navigate to DM conversation
    try:
        page.goto(dm_url, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(random.randint(3000, 5000))
    except PlaywrightTimeoutError:
        return ("nav_failed", "timeout on " + dm_url)
    except Exception as exc:
        return ("nav_failed", str(exc)[:200])

    # Step 4: Check for error ("cannot DM")
    has_error = page.evaluate('() => document.body.innerText.includes("cannot DM")')
    if has_error:
        return ("dm_blocked", "cannot DM this user")

    # Step 5: Find message editor (try multiple selectors -- Whop updates UI)
    editor = None
    editor_selectors = [
        ".tiptap.ProseMirror",
        ".ProseMirror",
        "[contenteditable='true']",
        "div[role='textbox']",
        "textarea[placeholder*='message' i]",
        "div[data-placeholder*='message' i]",
        "[class*='editor'][contenteditable]",
        "[class*='chat'] [contenteditable]",
    ]
    for sel in editor_selectors:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=3000):
                editor = loc
                break
        except Exception:
            continue
    if editor is None:
        return ("send_failed", "No message editor found (tried %d selectors)" % len(editor_selectors))

    # Step 6: Type the message
    try:
        editor.click()
        page.wait_for_timeout(500)

        # Type line by line (Enter creates newlines in ProseMirror)
        lines = dm_text.split("\n")
        for i, line in enumerate(lines):
            if line.strip():
                page.keyboard.type(line, delay=random.randint(20, 50))
            if i < len(lines) - 1:
                page.keyboard.press("Shift+Enter")

        page.wait_for_timeout(random.randint(500, 1000))
    except Exception as exc:
        return ("send_failed", "typing failed: " + str(exc)[:200])

    # Step 7: Send — press Enter
    try:
        page.keyboard.press("Enter")
        page.wait_for_timeout(random.randint(2000, 3000))
    except Exception as exc:
        return ("send_failed", "enter key failed: " + str(exc)[:200])

    # Step 8: Verify sent — check if the message appears in conversation
    sent_ok = page.evaluate("""(text) => {
        const msgs = document.querySelectorAll('[class*="message"], [class*="content"], p');
        for (const m of msgs) {
            if (m.textContent.includes(text.substring(0, 40))) return true;
        }
        return false;
    }""", dm_text[:60])

    feed_url = page.url
    if sent_ok:
        return ("sent", feed_url)

    # Check if editor is now empty (message was consumed = sent)
    editor_empty = page.evaluate("""() => {
        const ed = document.querySelector('.tiptap.ProseMirror');
        return ed ? ed.textContent.trim().length === 0 : true;
    }""")

    if editor_empty:
        return ("sent", feed_url)

    return ("send_failed", "message not confirmed in conversation")


# ---------------------------------------------------------------------------
# Main DM loop
# ---------------------------------------------------------------------------

def run_dm_auto(dry_run=False, test_mode=False):
    # type: (bool, bool) -> None
    # Startup guards
    if check_stop_flag():
        log.warning("WHOP_STOP.flag found — exiting immediately")
        return
    if check_rate_limit():
        return
    if check_session_expired():
        return

    if not dry_run and not test_mode and not APPROVAL_FLAG.exists():
        log.warning("WHOP_DM_APPROVED.flag not found — DMs not activated yet. Exiting.")
        log.warning("Create %s to enable automatic DM sending.", APPROVAL_FLAG)
        return

    cap_data = load_daily_cap()
    log.info("Daily cap: %d/%d (ramp day %s)", cap_data["count"], cap_data["cap"], cap_data["date"])
    if cap_data["count"] >= cap_data["cap"]:
        log.info("Daily cap reached — exiting")
        return

    queue = load_json(QUEUE_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)

    # Find eligible entries
    eligible = [
        entry for entry in queue
        if (
            isinstance(entry, dict)
            and entry.get("dm_status") == "pending"
            and entry.get("slug") not in contacted
            and entry.get("slug")
            and entry.get("owner_username")
            and entry.get("dm_text")
        )
    ]

    # Sort: alternate free/paid for 50/50 split
    free_entries = [e for e in eligible if e.get("community_type") != "paid"]
    paid_entries = [e for e in eligible if e.get("community_type") == "paid"]

    balanced = []
    fi, pi = 0, 0
    while fi < len(free_entries) or pi < len(paid_entries):
        if fi < len(free_entries):
            balanced.append(free_entries[fi])
            fi += 1
        if pi < len(paid_entries):
            balanced.append(paid_entries[pi])
            pi += 1
    eligible = balanced

    log.info("Queue total: %d | Eligible: %d (free=%d, paid=%d)",
             len(queue), len(eligible), len(free_entries), len(paid_entries))

    if not eligible:
        log.info("Nothing to send. Exiting.")
        return

    if dry_run:
        log.info("DRY RUN — showing first 5 eligible:")
        for e in eligible[:5]:
            log.info("  %s | owner=@%s | type=%s | members=%s",
                     e["slug"], e.get("owner_username"), e.get("community_type", "free"),
                     e.get("members", "?"))
            log.info("  DM: %s...", e.get("dm_text", "")[:120])
        return

    sent_count = 0
    error_count = 0
    skip_count = 0

    # Mutable index for status updates
    queue_by_slug = {
        entry["slug"]: entry
        for entry in queue
        if isinstance(entry, dict) and "slug" in entry
    }

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        cookies = load_session_cookies(SESSION_FILE)
        if cookies:
            try:
                context.add_cookies(cookies)
                log.info("Loaded %d session cookies", len(cookies))
            except Exception as exc:
                log.warning("Cookie load error: %s", exc)
        else:
            log.warning("No session cookies — running unauthenticated")

        page = context.new_page()

        # Warm up
        try:
            page.goto(WHOP_BASE + "/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(random.randint(2000, 4000))
            log.info("Browser warmed up")
        except Exception as exc:
            log.warning("Warm-up failed: %s", exc)

        for entry in eligible:
            if check_stop_flag():
                log.warning("WHOP_STOP.flag detected — stopping")
                break

            cap_data = load_daily_cap()
            if cap_data["count"] >= cap_data["cap"]:
                log.info("Daily cap reached (%d/%d) — stopping", cap_data["count"], cap_data["cap"])
                break

            slug = entry["slug"]
            owner_username = entry.get("owner_username", "")
            dm_text = entry.get("dm_text", "")
            display = entry.get("display", slug)
            community_type = entry.get("community_type", "free")

            if not owner_username or not dm_text:
                log.warning("Missing owner_username or dm_text for %s — skip", slug)
                skip_count += 1
                continue

            # Timezone check
            if not is_good_send_time(entry):
                log.info("  %s: not in send window for their timezone — skip for now", slug)
                skip_count += 1
                continue

            # CRM gate
            if _crm:
                check = _crm.check_contact_allowed(Platform.WHOP, slug)
                if not check:
                    reason = getattr(check, "reason", "locked")
                    log.info("CRM block %s: %s", slug, reason)
                    if slug in queue_by_slug:
                        queue_by_slug[slug]["dm_status"] = "crm_block:{}".format(reason)
                    skip_count += 1
                    continue

            log.info("Processing DM: %s (owner=@%s, type=%s)", display, owner_username, community_type)

            if test_mode:
                log.info("  TEST MODE — showing DM details:")
                log.info("  Community: %s (%s)", display, slug)
                log.info("  Owner: @%s", owner_username)
                log.info("  URL: %s/%s", WHOP_BASE, slug)
                log.info("  Profile: %s/@%s", WHOP_BASE, owner_username)
                log.info("  Type: %s | Members: %s", community_type, entry.get("members", "?"))
                log.info("  DM text:\n%s", dm_text)
                log.info("  --- end test mode (no send) ---")
                break

            # Send DM
            status, detail = send_dm_via_profile(page, "@" + owner_username, dm_text)
            log.info("  Result: %s — %s", status, str(detail)[:120])

            if status == "sent":
                _record_success(queue_by_slug, slug, dm_text, detail, contacted)
                sent_count += 1
                cap_data["count"] += 1
                save_daily_cap(cap_data)

                # Delay only after successful send
                delay = random.uniform(DM_DELAY_MIN, DM_DELAY_MAX)
                log.info("  Waiting %.0fs before next DM...", delay)
                time.sleep(delay)

            elif status == "dm_blocked":
                log.info("  %s: DM blocked — marking skip", slug)
                if slug in queue_by_slug:
                    queue_by_slug[slug]["dm_status"] = "dm_blocked"
                skip_count += 1
                time.sleep(3)

            elif status == "no_message_link":
                log.info("  %s: no Message link on profile — skip", slug)
                if slug in queue_by_slug:
                    queue_by_slug[slug]["dm_status"] = "no_message_link"
                skip_count += 1
                time.sleep(3)

            elif status == "nav_failed":
                log.warning("  %s: navigation failed — %s", slug, detail)
                if slug in queue_by_slug:
                    queue_by_slug[slug]["dm_status"] = "error"
                    queue_by_slug[slug]["dm_error"] = detail
                error_count += 1
                time.sleep(5)

            else:
                log.warning("  %s: send failed — %s", slug, detail)
                if slug in queue_by_slug:
                    queue_by_slug[slug]["dm_status"] = "error"
                    queue_by_slug[slug]["dm_error"] = detail
                error_count += 1
                time.sleep(5)

        browser.close()

    # Persist
    save_json(QUEUE_FILE, list(queue_by_slug.values()))

    # Summary
    log.info("=" * 50)
    log.info("Whop DM Auto Run Complete")
    log.info("  Sent:    %d", sent_count)
    log.info("  Error:   %d", error_count)
    log.info("  Skipped: %d", skip_count)
    log.info("  Cap:     %d/%d", cap_data.get("count", 0), cap_data.get("cap", 0))
    log.info("=" * 50)

    tg_send("Whop DM complete. Sent: {} | Errors: {} | Skipped: {} | Cap: {}/{}".format(
        sent_count, error_count, skip_count,
        cap_data.get("count", 0), cap_data.get("cap", 0),
    ))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _record_success(queue_by_slug, slug, dm_text, feed_url, contacted):
    # type: (dict, str, str, str, set) -> None
    log.info("  DM sent successfully to %s", slug)

    if slug in queue_by_slug:
        queue_by_slug[slug]["dm_status"] = "sent"
        queue_by_slug[slug]["dm_sent_at"] = datetime.now(timezone.utc).isoformat()
        if feed_url:
            queue_by_slug[slug]["feed_url"] = feed_url

    contacted.add(slug)
    append_contacted(CONTACTED_FILE, slug)

    if _crm:
        try:
            _crm.log_contact(
                platform=Platform.WHOP,
                handle=slug,
                action=ActionType.DM_SENT,
                agent_id="whop-dm-auto",
                message_preview=dm_text[:300],
            )
        except Exception as exc:
            log.debug("CRM log_contact failed: %s", exc)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Whop DM auto-sender")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only — no API calls or file writes",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Show first eligible DM details without sending",
    )
    args = parser.parse_args()
    run_dm_auto(dry_run=args.dry_run, test_mode=args.test)


if __name__ == "__main__":
    main()
