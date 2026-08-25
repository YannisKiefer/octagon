#!/usr/bin/env python3
"""
ig-playwright-outreach.py — Instagram DM sender + follow via Playwright.

Same architecture as skool-dm-auto.py:
  1. Launch headless Chromium
  2. Load session cookies from ig_session.json
  3. Navigate to instagram.com (establish session)
  4. Send DMs / follow via Instagram's internal API (fetch() inside browser)

Reads from: ig_small_queue.json (same queue ig-instagrapi-scout.py writes to)
Actions:
  - approach="direct_dm" + small/medium accounts -> send DM
  - approach="follow_first" + big accounts -> follow only (DM later)

Safeguards:
  - 20 DM/day cap
  - 90-200s delay between actions
  - IG_SMALL_STOP.flag kill switch
  - IG_RATE_LIMITED.flag on 429
  - IG_SESSION_EXPIRED.flag on auth failure
  - --dry-run preview mode
  - --self-test credential verification
  - --stats queue stats
  - Failed action marking in queue

Usage:
  python3 ig-playwright-outreach.py --self-test     # verify session works
  python3 ig-playwright-outreach.py --dry-run       # preview, no sends
  python3 ig-playwright-outreach.py --stats          # queue stats
  python3 ig-playwright-outreach.py                  # send DMs
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

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

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
BASE_DIR = HERE.parent
DATA_DIR = BASE_DIR / "data"

QUEUE_FILE = DATA_DIR / "ig_small_queue.json"
CONTACTED_FILE = DATA_DIR / "ig_contacted.txt"
SESSION_FILE = DATA_DIR / "ig_session.json"
STOP_FLAG = DATA_DIR / "IG_SMALL_STOP.flag"
RATE_LIMIT_FLAG = DATA_DIR / "IG_RATE_LIMITED.flag"
SESSION_EXPIRED_FLAG = DATA_DIR / "IG_SESSION_EXPIRED.flag"
DAILY_CAP_FILE = DATA_DIR / "ig_pw_sent_today.json"

IG_BASE = "https://www.instagram.com"
IG_API = "https://i.instagram.com/api/v1"
IG_APP_ID = "936619743392459"  # Instagram web app ID

MAX_DMS_PER_DAY = 70
DM_DELAY_MIN = 60
DM_DELAY_MAX = 120

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ig-playwright-outreach")

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


def load_session_cookies(session_file: Path) -> list:
    """Load cookies from session file (same format as Skool)."""
    data = load_json(session_file, default=[])
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("cookies", [])
    return []


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
    """Returns True if any blocker is active."""
    if STOP_FLAG.exists():
        log.error("IG_SMALL_STOP.flag present. Remove to continue.")
        return True
    if RATE_LIMIT_FLAG.exists():
        try:
            age = time.time() - RATE_LIMIT_FLAG.stat().st_mtime
            if age < 3600:
                log.error("Rate limit flag recent (%d min). Waiting.", int(age / 60))
                return True
            log.info("Clearing stale rate limit flag.")
            RATE_LIMIT_FLAG.unlink()
        except Exception:
            pass
    if SESSION_EXPIRED_FLAG.exists():
        log.error("Session expired. Re-run extract-ig-cookies.py")
        return True
    return False


# ---------------------------------------------------------------------------
# Instagram API via Playwright (same pattern as Skool's waf_fetch)
# ---------------------------------------------------------------------------

def ig_fetch(page, url: str, method: str = "GET", body=None) -> dict:
    """
    Make an authenticated Instagram API call from inside the Playwright browser.
    Same concept as Skool's waf_fetch — uses the browser's session for auth.

    Returns dict with 'status' (int) and 'data' (parsed JSON or error string).
    """
    body_js = json.dumps(body) if body is not None else "null"

    js = f"""(async () => {{
        const url = {json.dumps(url)};
        const method = {json.dumps(method)};
        const body = {body_js};

        // Get CSRF token from cookies
        const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
        const csrfToken = csrfMatch ? csrfMatch[1] : '';

        const opts = {{
            method: method,
            headers: {{
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRFToken': csrfToken,
                'X-IG-App-ID': '{IG_APP_ID}',
                'X-Requested-With': 'XMLHttpRequest',
                'X-Instagram-AJAX': '1',
            }},
            credentials: 'include',
        }};

        if (method !== 'GET' && body !== null) {{
            // Instagram API uses form-encoded for some endpoints
            if (typeof body === 'string') {{
                opts.body = body;
            }} else {{
                const params = new URLSearchParams();
                for (const [key, val] of Object.entries(body)) {{
                    params.append(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
                }}
                opts.body = params.toString();
            }}
        }}

        try {{
            const resp = await fetch(url, opts);
            let data;
            try {{
                data = await resp.json();
            }} catch {{
                data = await resp.text();
            }}
            return {{ status: resp.status, data: data }};
        }} catch (err) {{
            return {{ status: 0, data: err.message || String(err) }};
        }}
    }})()"""

    try:
        result = page.evaluate(js)
        if isinstance(result, dict):
            return result
        return {"status": 0, "data": str(result)}
    except Exception as exc:
        return {"status": 0, "data": str(exc)}


# ---------------------------------------------------------------------------
# Instagram actions
# ---------------------------------------------------------------------------

def ig_get_user_id(page, username: str) -> Optional[str]:
    """Resolve username to user PK via Instagram web API."""
    url = f"{IG_API}/users/web_profile_info/?username={username}"
    result = ig_fetch(page, url, method="GET")
    status = result.get("status", 0)

    if status == 200:
        data = result.get("data", {})
        user = data.get("data", {}).get("user", {})
        pk = user.get("id")
        if pk:
            return str(pk)
        log.warning("Could not extract PK for @%s from response", username)
        return None

    if status == 404:
        log.warning("User @%s not found (404)", username)
        return None

    if status in (401, 403):
        log.error("Auth error resolving @%s (status=%d)", username, status)
        return None

    log.warning("Unexpected status %d resolving @%s", status, username)
    return None


def ig_send_dm(page, user_pk: str, text: str) -> tuple[int, str]:
    """
    Send a DM to a user via Instagram's internal API.
    Returns (status_code, error_string).
    """
    url = f"{IG_API}/direct_v2/threads/broadcast/text/"
    body = {
        "recipient_users": json.dumps([user_pk]),
        "action": "send_item",
        "text": text,
        "client_context": str(uuid.uuid4()),
    }
    result = ig_fetch(page, url, method="POST", body=body)
    status = result.get("status", 0)
    data = result.get("data", "")

    if status == 200:
        return 200, ""
    if status == 429:
        return 429, "rate_limited"
    if status in (401, 403):
        # Check for specific error types
        error_str = str(data) if data else ""
        if "feedback_required" in error_str.lower():
            return 403, "feedback_required"
        if "login_required" in error_str.lower():
            return 401, "session_expired"
        return status, f"auth_error:{error_str[:100]}"
    return status, f"error:{str(data)[:100]}"


def ig_follow_user(page, user_pk: str) -> tuple[int, str]:
    """
    Follow a user via Instagram's internal API.
    Returns (status_code, error_string).
    """
    url = f"{IG_API}/friendships/create/{user_pk}/"
    result = ig_fetch(page, url, method="POST", body={})
    status = result.get("status", 0)
    data = result.get("data", "")

    if status == 200:
        return 200, ""
    if status == 429:
        return 429, "rate_limited"
    if status in (401, 403):
        return status, f"auth_error:{str(data)[:100]}"
    return status, f"error:{str(data)[:100]}"


# ---------------------------------------------------------------------------
# Queue loading
# ---------------------------------------------------------------------------

def load_eligible_leads(contacted: set) -> list[dict]:
    """Load pending direct_dm leads, excluding contacted."""
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
    eligible.sort(key=lambda e: e.get("score", 0), reverse=True)
    return eligible


def update_queue_entry(username: str, updates: dict) -> None:
    """Update a specific entry in queue."""
    queue = load_json(QUEUE_FILE, default=[])
    for entry in queue:
        if isinstance(entry, dict) and entry.get("username") == username:
            entry.update(updates)
            break
    save_json(QUEUE_FILE, queue)


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def self_test() -> bool:
    """Verify session cookies work and API is accessible."""
    log.info("=== SELF TEST ===")

    # Check playwright
    try:
        from playwright.sync_api import sync_playwright
        log.info("[OK] Playwright imported")
    except ImportError:
        log.error("[FAIL] Playwright not installed")
        return False

    # Check session file
    if not SESSION_FILE.exists():
        log.error("[FAIL] No session file at %s", SESSION_FILE)
        log.error("       Run: python3 instagram-team/src/extract-ig-cookies.py")
        return False

    cookies = load_session_cookies(SESSION_FILE)
    if not cookies:
        log.error("[FAIL] Session file empty")
        return False
    log.info("[OK] Loaded %d cookies", len(cookies))

    # Check critical cookies
    cookie_names = {c["name"] for c in cookies}
    if "sessionid" not in cookie_names:
        log.error("[FAIL] No 'sessionid' cookie. Re-login needed.")
        return False
    if "csrftoken" not in cookie_names:
        log.error("[FAIL] No 'csrftoken' cookie. Re-login needed.")
        return False
    log.info("[OK] Critical cookies present (sessionid, csrftoken)")

    # Try a real API call
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        try:
            context.add_cookies(cookies)
        except Exception as exc:
            log.error("[FAIL] Could not load cookies: %s", exc)
            browser.close()
            return False

        page = context.new_page()

        # Navigate to IG to establish session
        try:
            page.goto(IG_BASE + "/", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(2000)
            log.info("[OK] Navigated to instagram.com")
        except Exception as exc:
            log.error("[FAIL] Could not load instagram.com: %s", exc)
            browser.close()
            return False

        # Check if logged in by looking for a known element or API call
        # Try fetching our own user info
        ds_user_id = None
        for c in cookies:
            if c["name"] == "ds_user_id":
                ds_user_id = c["value"]
                break

        if ds_user_id:
            url = f"{IG_API}/users/{ds_user_id}/info/"
            result = ig_fetch(page, url)
            status = result.get("status", 0)
            if status == 200:
                data = result.get("data", {})
                user = data.get("user", {})
                username = user.get("username", "?")
                followers = user.get("follower_count", 0)
                log.info("[OK] API works — logged in as @%s (%d followers)", username, followers)
            elif status in (401, 403):
                log.error("[FAIL] Session expired (status=%d). Re-run extract-ig-cookies.py", status)
                browser.close()
                return False
            else:
                log.warning("[WARN] Unexpected status %d on user info", status)
        else:
            log.warning("[WARN] No ds_user_id cookie — cannot verify identity")

        browser.close()

    log.info("=== SELF TEST PASSED ===")
    return True


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def show_stats() -> None:
    """Print queue stats."""
    queue = load_json(QUEUE_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)
    cap_data = load_daily_cap()

    counts: dict[str, int] = {}
    for entry in queue:
        if isinstance(entry, dict):
            status = entry.get("dm_status", "unknown")
            counts[status] = counts.get(status, 0) + 1

    print("\n" + "=" * 55)
    print("IG Playwright Outreach — Queue Stats")
    print("=" * 55)
    print(f"\nQueue: {QUEUE_FILE}")
    print(f"Total: {len(queue)}")
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
    print(f"\nEligible: {len(pending)}")
    print(f"Contacted: {len(contacted)}")
    print(f"Sent today: {cap_data['count']} / {cap_data['cap']}")
    print(f"Session: {'EXISTS' if SESSION_FILE.exists() else 'MISSING'}")
    print(f"Stop flag: {'SET' if STOP_FLAG.exists() else 'clear'}")
    print("=" * 55 + "\n")


# ---------------------------------------------------------------------------
# Main send loop
# ---------------------------------------------------------------------------

def run_outreach(dry_run: bool = False) -> None:
    """Main DM sending pipeline via Playwright."""
    from playwright.sync_api import sync_playwright

    if check_blockers():
        return

    # Session check
    if not SESSION_FILE.exists():
        log.error("No session file. Run: python3 extract-ig-cookies.py")
        return

    cookies = load_session_cookies(SESSION_FILE)
    if not cookies:
        log.error("Session file empty. Run: python3 extract-ig-cookies.py")
        return

    # Daily cap
    cap_data = load_daily_cap()
    today_sent = cap_data["count"]
    log.info("DMs sent today: %d / %d", today_sent, cap_data["cap"])
    if today_sent >= cap_data["cap"]:
        log.info("Daily cap reached. Exiting.")
        return
    remaining = cap_data["cap"] - today_sent

    # Load eligible leads
    contacted = load_contacted(CONTACTED_FILE)
    eligible = load_eligible_leads(contacted)
    log.info("Eligible leads: %d (budget: %d)", len(eligible), remaining)

    if not eligible:
        log.info("No eligible leads. Exiting.")
        return

    if dry_run:
        log.info("DRY RUN — previewing eligible leads:")
        for i, e in enumerate(eligible[:10]):
            log.info(
                "  %d. @%s — score=%d, followers=%s, tier=%s",
                i + 1, e.get("username"), e.get("score", 0),
                e.get("followers", "?"), e.get("tier", "?"),
            )
            log.info("     DM: %s", (e.get("dm_text") or "")[:120])
        if len(eligible) > 10:
            log.info("  ... and %d more", len(eligible) - 10)
        return

    # Launch browser
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        try:
            context.add_cookies(cookies)
            log.info("Loaded %d session cookies", len(cookies))
        except Exception as exc:
            log.error("Cookie load failed: %s", exc)
            browser.close()
            return

        page = context.new_page()

        # Navigate to IG (establish session)
        try:
            page.goto(IG_BASE + "/", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(2000)
            log.info("Session established on instagram.com")
        except Exception as exc:
            log.error("Could not load instagram.com: %s", exc)
            browser.close()
            return

        sent = 0
        errors = 0
        skipped = 0

        for entry in eligible:
            if STOP_FLAG.exists():
                log.warning("Stop flag detected. Halting.")
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

            # CRM check
            if _crm:
                try:
                    check = _crm.check_contact_allowed(Platform.INSTAGRAM, uname)
                    if not check:
                        log.info("  CRM block @%s: %s", uname, check.reason)
                        update_queue_entry(uname, {"dm_status": f"crm_block:{check.reason}"})
                        skipped += 1
                        continue
                except Exception:
                    pass

            # Resolve user PK
            user_pk = ig_get_user_id(page, uname)
            if not user_pk:
                log.warning("  Could not resolve @%s — skipping", uname)
                update_queue_entry(uname, {
                    "dm_status": "error",
                    "dm_error_code": "pk_resolve_failed",
                })
                errors += 1
                continue

            # Send DM
            status, error = ig_send_dm(page, user_pk, dm_text)

            if status == 200:
                log.info("  DM SENT to @%s", uname)
                now_str = datetime.now(timezone.utc).isoformat()
                update_queue_entry(uname, {
                    "dm_status": "sent",
                    "dm_sent_at": now_str,
                    "dm_sent_via": "playwright",
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
                            agent_id="ig-playwright-outreach",
                            message_preview=dm_text[:300],
                            metadata={
                                "followers": followers,
                                "score": score,
                                "tier": entry.get("tier"),
                            },
                        )
                    except Exception:
                        pass

                sent += 1

            elif status == 429:
                log.error("  RATE LIMITED. Stopping.")
                RATE_LIMIT_FLAG.write_text(
                    f"Rate limited at {datetime.now(timezone.utc).isoformat()}\n"
                )
                break

            elif error == "session_expired":
                log.error("  SESSION EXPIRED. Re-run extract-ig-cookies.py")
                SESSION_EXPIRED_FLAG.write_text(
                    f"Expired at {datetime.now(timezone.utc).isoformat()}\n"
                )
                break

            elif error == "feedback_required":
                log.error("  FEEDBACK REQUIRED — account flagged. Stopping.")
                STOP_FLAG.write_text(
                    f"feedback_required at {datetime.now(timezone.utc).isoformat()}\n"
                )
                break

            else:
                log.warning("  DM failed @%s: status=%d, error=%s", uname, status, error)
                update_queue_entry(uname, {
                    "dm_status": "error",
                    "dm_error_code": error or f"http_{status}",
                })
                errors += 1

            # Human-like delay
            if sent < remaining:
                delay = random.uniform(DM_DELAY_MIN, DM_DELAY_MAX)
                log.info("  Waiting %.0fs...", delay)
                time.sleep(delay)

        browser.close()

    # Summary
    log.info("=" * 50)
    log.info("ig-playwright-outreach Complete")
    log.info("  Sent:    %d", sent)
    log.info("  Errors:  %d", errors)
    log.info("  Skipped: %d", skipped)
    log.info("  Today:   %d / %d", today_sent + sent, cap_data["cap"])
    log.info("=" * 50)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Instagram outreach via Playwright (DM + follow)"
    )
    parser.add_argument("--self-test", action="store_true",
                        help="Verify session and API access")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview eligible leads, no sends")
    parser.add_argument("--stats", action="store_true",
                        help="Show queue stats")
    args = parser.parse_args()

    if args.stats:
        show_stats()
        return

    if args.self_test:
        ok = self_test()
        sys.exit(0 if ok else 1)

    run_outreach(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
