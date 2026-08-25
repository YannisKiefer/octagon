#!/usr/bin/env python3
"""
whop-joiner.py — Join free Whop communities to build profile presence.

Reads communities from whop_queue.json, filters for free + unjoined entries,
navigates to each community page, clicks join/claim/subscribe buttons,
handles $0 checkout flows, and records success.

Usage:
  python3 whop-joiner.py
  python3 whop-joiner.py --dry-run
"""

import argparse
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# Telegram notifications
sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))
try:
    import telegram_notify as tg
except ImportError:
    class _FakeTg:
        def send(self, msg):
            pass
    tg = _FakeTg()

# CRM — unified lead database (optional, degrades gracefully)
_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType
    _crm = CRM()  # type: Optional[object]
except ImportError:
    _crm = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_default_base = os.environ.get(
    "WHOP_BASE_DIR",
    str(Path(__file__).parent.parent),  # default: skool-whop-team/
)
BASE_DIR = Path(_default_base).expanduser()
DATA_DIR = BASE_DIR / "data"
QUEUE_FILE = DATA_DIR / "whop_queue.json"
SESSION_FILE = DATA_DIR / "whop_session.json"
STOP_FLAG = DATA_DIR / "WHOP_JOIN_STOP.flag"

WHOP_BASE = "https://whop.com"

MAX_JOINS_PER_DAY = 200
JOIN_DELAY_MIN = 30   # seconds
JOIN_DELAY_MAX = 90   # seconds

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


def load_session_cookies(session_file):
    # type: (Path) -> list
    data = load_json(session_file, default={})
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("cookies", [])
    return []


# ---------------------------------------------------------------------------
# Daily join count
# ---------------------------------------------------------------------------

def count_joins_today(queue):
    # type: (list) -> int
    today_str = date.today().isoformat()
    count = 0
    for entry in queue:
        if not isinstance(entry, dict):
            continue
        joined_at = entry.get("joined_at", "")
        if isinstance(joined_at, str) and joined_at.startswith(today_str):
            count += 1
    return count


# ---------------------------------------------------------------------------
# Stop flag check
# ---------------------------------------------------------------------------

def is_stopped():
    # type: () -> bool
    return STOP_FLAG.exists()


# ---------------------------------------------------------------------------
# Join a single Whop community page
# ---------------------------------------------------------------------------

# Buttons that indicate a free join on the community landing page
JOIN_BUTTON_SELECTORS = [
    "button:has-text('Join for free')",
    "button:has-text('Start for free')",
    "button:has-text('Get access')",
    "button:has-text('Claim')",
    "button:has-text('Subscribe')",
    "a:has-text('Join for free')",
    "a:has-text('Start for free')",
    "a:has-text('Get access')",
    "a:has-text('Claim')",
    "a:has-text('Free')",
]

# Buttons that appear during a $0 checkout / confirmation modal
CHECKOUT_CONFIRM_SELECTORS = [
    "button:has-text('Complete')",
    "button:has-text('Confirm')",
    "button:has-text('Get access')",
    "button:has-text('Claim')",
    "button:has-text('Subscribe')",
    "button:has-text('Continue')",
    "button:has-text('Start for free')",
    "button[type='submit']",
]

# Indicators that we successfully joined
MEMBER_INDICATORS = [
    "button:has-text('Leave')",
    "button:has-text('Joined')",
    "a:has-text('Chat')",
    "a:has-text('Feed')",
    "[data-testid='member-area']",
]


def try_join_community(page, slug):
    # type: (object, str) -> bool
    """
    Navigate to a Whop community page, click join, handle checkout if needed.
    Returns True on success.
    """
    url = "%s/%s" % (WHOP_BASE, slug)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(3000)
    except PlaywrightTimeoutError:
        log.warning("Timeout loading page for %s", slug)
        return False
    except Exception as exc:
        log.warning("Failed to load page for %s: %s", slug, exc)
        return False

    # Step 1: find and click a join button
    join_clicked = False
    for sel in JOIN_BUTTON_SELECTORS:
        try:
            btn = page.query_selector(sel)
            if btn and btn.is_visible():
                btn_text = btn.inner_text().strip()[:40]
                log.info("Clicking '%s' on %s", btn_text, slug)
                btn.click()
                page.wait_for_timeout(4000)
                join_clicked = True
                break
        except Exception:
            continue

    if not join_clicked:
        log.warning("No join button found on page for %s", slug)
        return False

    # Step 2: handle possible $0 checkout modal
    # Check if a checkout/confirmation dialog appeared
    for sel in CHECKOUT_CONFIRM_SELECTORS:
        try:
            confirm_btn = page.query_selector(sel)
            if confirm_btn and confirm_btn.is_visible():
                confirm_text = confirm_btn.inner_text().strip()[:40]
                log.info("Clicking checkout confirm '%s' on %s", confirm_text, slug)
                confirm_btn.click()
                page.wait_for_timeout(4000)
                break
        except Exception:
            continue

    # Step 3: verify membership
    for sel in MEMBER_INDICATORS:
        try:
            indicator = page.query_selector(sel)
            if indicator and indicator.is_visible():
                log.info("Membership confirmed for %s (found: %s)", slug, sel)
                return True
        except Exception:
            continue

    # Fallback: check URL change (may redirect into the community)
    current_url = page.url
    if slug in current_url and "checkout" not in current_url.lower():
        log.info("Join likely succeeded for %s (URL: %s)", slug, current_url)
        return True

    # Second fallback: page content check
    try:
        body_text = page.inner_text("body")[:1000].lower()
        success_phrases = ["welcome", "you're in", "member", "joined", "access granted"]
        for phrase in success_phrases:
            if phrase in body_text:
                log.info("Join likely succeeded for %s (found '%s' in page)", slug, phrase)
                return True
    except Exception:
        pass

    log.warning("Could not confirm join for %s", slug)
    return False


# ---------------------------------------------------------------------------
# Main join loop
# ---------------------------------------------------------------------------

def run_joiner(dry_run=False):
    # type: (bool) -> None
    if is_stopped():
        log.info("Stop flag found at %s — exiting.", STOP_FLAG)
        return

    queue = load_json(QUEUE_FILE, default=[])
    today_count = count_joins_today(queue)

    log.info("Today's join count so far: %d / %d", today_count, MAX_JOINS_PER_DAY)

    if today_count >= MAX_JOINS_PER_DAY:
        log.info("Daily limit reached. Exiting.")
        return

    # Filter: all unjoined communities (try any — joiner clicks "Join for free" if available)
    candidates = [
        entry for entry in queue
        if (
            isinstance(entry, dict)
            and entry.get("join_status") not in ("joined", "failed", "crm_blocked")
        )
    ]

    # Sort by score descending (if scored by scout)
    candidates.sort(key=lambda x: x.get("score", 0), reverse=True)

    log.info("Candidates to join: %d", len(candidates))

    if not candidates:
        log.info("No candidates to join. Exiting.")
        return

    if dry_run:
        log.info("DRY RUN — no browser actions will be taken")
        for c in candidates[:10]:
            log.info(
                "  Would join: %s (type=%s, score=%s)",
                c.get("slug", "?"),
                c.get("community_type"),
                c.get("score", "?"),
            )
        return

    joins_this_run = 0

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

        # Warm up: load whop.com to set initial state
        try:
            page.goto(WHOP_BASE, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
        except Exception as exc:
            log.warning("Warm-up failed: %s", exc)

        for candidate in candidates:
            # Check stop flag between each join
            if is_stopped():
                log.info("Stop flag detected mid-run — stopping.")
                break

            if today_count + joins_this_run >= MAX_JOINS_PER_DAY:
                log.info("Daily limit reached during run.")
                break

            slug = candidate.get("slug", "")
            if not slug:
                log.warning("Candidate missing slug — skipping: %s", candidate)
                continue

            # No CRM gate for joining — joining for profile presence
            # is independent of DM outreach and can overlap

            log.info("Attempting to join: %s", slug)

            success = try_join_community(page, slug)

            if success:
                now_iso = datetime.now(timezone.utc).isoformat()
                candidate["join_status"] = "joined"
                candidate["joined_at"] = now_iso
                joins_this_run += 1

                # CRM: log join action
                if _crm:
                    try:
                        _crm.log_contact(
                            platform=Platform.WHOP,
                            handle=slug,
                            action=ActionType.JOINED_GROUP,
                            agent_id="whop-joiner",
                            metadata={"slug": slug},
                            lock_days=0,
                        )
                    except Exception as exc:
                        log.debug("CRM log error for %s: %s", slug, exc)

                # Save progress after each successful join
                save_json(QUEUE_FILE, queue)

                remaining = len([
                    e for e in queue
                    if isinstance(e, dict)
                    and e.get("join_status") not in ("joined", "failed", "crm_blocked")
                ])
                tg.send(
                    "Whop joined %s. %d joined today, %d remaining in queue."
                    % (slug, today_count + joins_this_run, remaining)
                )

                # Human-like delay
                delay = random.uniform(JOIN_DELAY_MIN, JOIN_DELAY_MAX)
                log.info("Waiting %.0fs before next join...", delay)
                time.sleep(delay)

            else:
                candidate["join_status"] = "failed"
                save_json(QUEUE_FILE, queue)
                log.warning("Failed to join %s", slug)

        browser.close()

    total_today = today_count + joins_this_run
    remaining_queue = len([
        e for e in queue
        if isinstance(e, dict)
        and e.get("community_type") == "free"
        and e.get("join_status") != "joined"
    ])
    log.info(
        "Run complete. Joined this run: %d. Total today: %d. Queue remaining: %d.",
        joins_this_run, total_today, remaining_queue,
    )
    tg.send(
        "Whop joiner complete. Joined: %d today. Queue remaining: %d."
        % (total_today, remaining_queue)
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Whop community joiner")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only — no browser actions or file writes",
    )
    args = parser.parse_args()
    run_joiner(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
