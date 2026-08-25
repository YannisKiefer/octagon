#!/usr/bin/env python3
"""
skool-dm-auto.py — Send DMs to communities joined 24h+ ago.

Reads joined.json, checks membership unlock, sends DM to community owner.
Respects DM_STOP.flag for emergency halt.

Usage:
  python3 skool-dm-auto.py
  python3 skool-dm-auto.py --dry-run
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

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# Telegram notifications
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "shared"))
try:
    import telegram_notify as tg
except ImportError:
    class _FakeTg:
        def send(self, msg):
            pass
    tg = _FakeTg()

# CRM — unified lead database
_CRM_PATH = Path(__file__).parent.parent.parent / "crm"
if _CRM_PATH.exists():
    sys.path.insert(0, str(_CRM_PATH))
try:
    from crm import CRM, Platform, ActionType
    _crm: CRM | None = CRM()
except ImportError:
    _crm = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_default_base = os.environ.get(
    "SKOOL_BASE_DIR",
    str(Path(__file__).parent.parent),  # default: workspace dir (skool-whop-team/)
)
BASE_DIR = Path(_default_base).expanduser()
DATA_DIR = BASE_DIR / "data"
SESSION_FILE = DATA_DIR / "skool_session.json"
JOINED_FILE = DATA_DIR / "joined.json"
CONTACTED_FILE = DATA_DIR / "contacted.txt"
STOP_FLAG = DATA_DIR / "DM_STOP.flag"

SKOOL_BASE = "https://www.skool.com"
API_BASE = "https://api2.skool.com"

DM_HOLD_HOURS = 48       # Must be a member for this long before DMing (Skool unlock)
DM_DELAY_MIN = 60        # seconds between DMs
DM_DELAY_MAX = 120       # seconds between DMs
DAILY_CAP = 200

RATE_LIMITED_FILE = DATA_DIR / "RATE_LIMITED_UNTIL"
SESSION_EXPIRED_FILE = DATA_DIR / "SESSION_EXPIRED.flag"
DAILY_CAP_FILE = DATA_DIR / "skool_sent_today.json"

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
# Hardening helpers
# ---------------------------------------------------------------------------

def check_rate_limit() -> bool:
    """Return True (and exit) if still rate-limited. Call at startup."""
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
    except Exception as exc:
        log.warning("Could not read RATE_LIMITED_UNTIL: %s", exc)
    return False


def write_rate_limit(retry_after: int = 0) -> None:
    """Write RATE_LIMITED_UNTIL file. retry_after=0 means 24h default."""
    secs = retry_after if retry_after > 0 else 86400
    until = datetime.now(timezone.utc) + timedelta(seconds=secs)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RATE_LIMITED_FILE.write_text(until.isoformat())
    log.warning("Rate limit written: until %s", until.isoformat())


def check_session_expired() -> bool:
    """Return True (and log) if SESSION_EXPIRED.flag exists. Call at startup."""
    if not SESSION_EXPIRED_FILE.exists():
        return False
    try:
        content = SESSION_EXPIRED_FILE.read_text().strip()
        log.error("Session expired flag set: %s", content)
    except Exception:
        log.error("Session expired flag exists at %s", SESSION_EXPIRED_FILE)
    log.error("Refresh session cookies and remove %s to resume.", SESSION_EXPIRED_FILE)
    return True


def write_session_expired(url: str) -> None:
    """Write SESSION_EXPIRED.flag with timestamp and failing URL."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    SESSION_EXPIRED_FILE.write_text(f"{ts}\n{url}")
    log.error("Session expired at %s (url=%s). Wrote %s", ts, url, SESSION_EXPIRED_FILE)


def load_daily_cap() -> dict:
    """Load daily cap sentinel; reset if date has changed."""
    today = datetime.now(timezone.utc).date().isoformat()
    if DAILY_CAP_FILE.exists():
        try:
            data = json.loads(DAILY_CAP_FILE.read_text())
            if data.get("date") == today:
                return data
        except Exception:
            pass
    return {"date": today, "count": 0, "cap": DAILY_CAP}


def save_daily_cap(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DAILY_CAP_FILE.write_text(json.dumps(data, indent=2))


def check_stop_flag() -> bool:
    """Return True if stop flag exists."""
    return STOP_FLAG.exists()


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


def load_contacted(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def append_contacted(path: Path, slug: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(slug + "\n")


def load_session_cookies(session_file: Path) -> list:
    data = load_json(session_file, default={})
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("cookies", [])
    return []


# ---------------------------------------------------------------------------
# WAF-aware fetch
# ---------------------------------------------------------------------------

def waf_fetch(page, url: str, method: str = "GET", body=None):
    body_js = json.dumps(body) if body is not None else "null"
    js = f"""(async () => {{
        const url = {json.dumps(url)};
        const method = {json.dumps(method)};
        const body = {body_js};
        const waf = (window.AwsWafIntegration && window.AwsWafIntegration.fetch)
            ? window.AwsWafIntegration.fetch.bind(window.AwsWafIntegration) : fetch;
        const opts = {{
            method: method,
            headers: {{'Content-Type': 'application/json', 'Accept': 'application/json'}},
            credentials: 'include'
        }};
        if (method !== 'GET' && body !== null) {{
            opts.body = JSON.stringify(body);
        }}
        try {{
            const resp = await waf(url, opts);
            const text = await resp.text();
            let data;
            try {{ data = JSON.parse(text); }} catch(e) {{ data = text; }}
            return {{ status: resp.status, data: data }};
        }} catch(e) {{
            return {{ status: 0, data: e.toString() }};
        }}
    }})()"""
    return page.evaluate(js)


# ---------------------------------------------------------------------------
# 24h eligibility check
# ---------------------------------------------------------------------------

def is_eligible_for_dm(entry: dict) -> bool:
    """Returns True if the community was joined 24+ hours ago."""
    joined_at_str = entry.get("joined_at")
    if not joined_at_str:
        return False
    try:
        joined_at = datetime.fromisoformat(joined_at_str)
        if joined_at.tzinfo is None:
            joined_at = joined_at.replace(tzinfo=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=DM_HOLD_HOURS)
        return joined_at < cutoff
    except Exception as exc:
        log.warning("Could not parse joined_at '%s': %s", joined_at_str, exc)
        return False


# ---------------------------------------------------------------------------
# DM sending
# ---------------------------------------------------------------------------

def send_chat_request(page, owner_id: str, group_id: str) -> tuple:
    """
    Send chat request to unlock DM capability.
    Returns (status_code, response_data).
    On 200 the response contains the channel object with an 'id' field.
    """
    url = f"{API_BASE}/users/{owner_id}/chat-request?g={group_id}"
    result = waf_fetch(page, url, method="POST", body={})
    return result.get("status", 0), result.get("data", {})


def send_dm(page, channel_id: str, message: str) -> int:
    """
    Send a direct message via channel.
    Returns HTTP status code.
    """
    url = f"{API_BASE}/channels/{channel_id}/messages?ct=web"
    body = {"content": message}
    result = waf_fetch(page, url, method="POST", body=body)
    return result.get("status", 0)


# ---------------------------------------------------------------------------
# Main DM loop
# ---------------------------------------------------------------------------

def run_dm_auto(dry_run: bool = False):
    # Startup guards
    if check_stop_flag():
        log.warning("DM_STOP.flag found — exiting immediately")
        return
    if check_rate_limit():
        return
    if check_session_expired():
        return

    cap_data = load_daily_cap()
    if cap_data["count"] >= cap_data["cap"]:
        log.info("Daily cap reached (%d/%d) — exiting", cap_data["count"], cap_data["cap"])
        return

    joined = load_json(JOINED_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)

    now = datetime.now(timezone.utc)

    # Find eligible entries
    eligible = [
        entry for entry in joined
        if (
            isinstance(entry, dict)
            and entry.get("dm_status") == "pending"
            and entry.get("slug") not in contacted
            and entry.get("owner_id")
            and is_eligible_for_dm(entry)
        )
    ]

    log.info("Joined entries total: %d", len(joined))
    log.info("Eligible for DM (24h+ ago, pending, not contacted): %d", len(eligible))

    if not eligible:
        log.info("Nothing to send. Exiting.")
        return

    if dry_run:
        log.info("DRY RUN — no API calls or file writes")
        for e in eligible[:5]:
            log.info(
                "  Would DM: %s (owner_id=%s, joined_at=%s)",
                e["slug"], e.get("owner_id"), e.get("joined_at"),
            )
            log.info("  DM text preview:\n%s\n", e.get("dm_text", "NO DM TEXT")[:200])
        return

    sent_count = 0
    error_count = 0
    skip_count = 0
    retry_count = 0

    # Create a mutable index of joined entries for status updates
    joined_by_slug = {
        entry["slug"]: entry
        for entry in joined
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
            page.goto(f"{SKOOL_BASE}/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
        except Exception as exc:
            log.warning("Warm-up failed: %s", exc)

        for entry in eligible:
            # Re-check stop flag on each iteration
            if check_stop_flag():
                log.warning("DM_STOP.flag detected mid-run — stopping")
                break

            cap_data = load_daily_cap()
            if cap_data["count"] >= cap_data["cap"]:
                log.info("Daily cap reached (%d/%d) — stopping", cap_data["count"], cap_data["cap"])
                break

            slug = entry["slug"]
            owner_id = entry.get("owner_id")
            group_id = entry.get("group_id") or slug
            dm_text = entry.get("dm_text", "")
            display = entry.get("display", slug)

            if not owner_id:
                log.warning("No owner_id for %s — skipping", slug)
                skip_count += 1
                continue

            if not dm_text:
                log.warning("No dm_text for %s — skipping", slug)
                skip_count += 1
                continue

            # Cross-platform CRM gate — final check before every send
            if _crm:
                check = _crm.check_contact_allowed(Platform.SKOOL, slug)
                if not check:
                    log.info(
                        "CRM block %s: %s (locked by %s until %s)",
                        slug, check.reason, check.locked_by,
                        check.locked_until.strftime("%Y-%m-%d") if check.locked_until else "—",
                    )
                    if slug in joined_by_slug:
                        joined_by_slug[slug]["dm_status"] = f"crm_block:{check.reason}"
                    skip_count += 1
                    continue

            log.info("Processing DM for: %s (owner_id=%s)", display, owner_id)

            # Step 1: Send chat request to unlock messaging + get channel_id
            chat_status, chat_data = send_chat_request(page, owner_id, group_id)
            log.info("  Chat request status: %d", chat_status)

            if chat_status == 200:
                # Extract channel_id from response
                channel_id = None
                if isinstance(chat_data, dict):
                    channel_id = (
                        chat_data.get("id")
                        or chat_data.get("channel_id")
                        or (chat_data.get("channel") or {}).get("id")
                    )

                if not channel_id:
                    log.warning("  No channel_id in chat-request response for %s: %s", slug, str(chat_data)[:200])
                    if slug in joined_by_slug:
                        joined_by_slug[slug]["dm_status"] = "error"
                        joined_by_slug[slug]["dm_error_code"] = "no_channel_id"
                    error_count += 1
                    continue

                # Chat request accepted — now send the DM via channel
                time.sleep(random.uniform(3, 8))  # Brief pause after chat request

                dm_status_code = send_dm(page, channel_id, dm_text)
                log.info("  DM send status: %d (channel_id=%s)", dm_status_code, channel_id)

                if dm_status_code in (200, 201):
                    log.info("  DM sent successfully to %s", display)
                    # Update status
                    if slug in joined_by_slug:
                        joined_by_slug[slug]["dm_status"] = "sent"
                        joined_by_slug[slug]["dm_sent_at"] = datetime.now(timezone.utc).isoformat()
                    append_contacted(CONTACTED_FILE, slug)
                    # CRM: record send + set 14-day cross-platform lock
                    if _crm:
                        _crm.log_contact(
                            platform=Platform.SKOOL,
                            handle=slug,
                            action=ActionType.DM_SENT,
                            agent_id="skool-dm-auto",
                            message_preview=dm_text[:300],
                            metadata={"owner_id": owner_id, "channel_id": channel_id},
                        )
                    sent_count += 1
                    cap_data["count"] += 1
                    save_daily_cap(cap_data)

                    remaining = len(eligible) - (sent_count + error_count + retry_count + skip_count)
                    first_name = entry.get("first_name")
                    members = entry.get("members", "?")
                    tg.send(
                        "DM sent to %s (%s, %s members).\n%d sent today, %d remaining."
                        % (first_name or display, slug, members, cap_data["count"], remaining)
                    )

                elif dm_status_code == 429:
                    log.warning("  Rate limited on DM to %s — stopping", slug)
                    write_rate_limit()
                    break

                else:
                    log.warning("  DM send failed for %s: status %d", slug, dm_status_code)
                    if slug in joined_by_slug:
                        joined_by_slug[slug]["dm_status"] = "error"
                        joined_by_slug[slug]["dm_error_code"] = dm_status_code
                    error_count += 1

            elif chat_status == 423:
                # 423 = Locked (not yet a member / membership not unlocked)
                log.info("  %s: membership not yet unlocked (423) — will retry tomorrow", slug)
                # Keep dm_status as "pending" so it gets retried
                retry_count += 1
                # If 5+ consecutive 423s, bail early — all memberships locked
                if retry_count >= 5 and sent_count == 0 and error_count == 0:
                    log.info("5+ consecutive 423s with no sends — all memberships locked. Stopping.")
                    break

            elif chat_status == 400:
                log.warning("  Bad request (400) for %s", slug)
                if slug in joined_by_slug:
                    joined_by_slug[slug]["dm_status"] = "error"
                    joined_by_slug[slug]["dm_error_code"] = 400
                error_count += 1

            elif chat_status == 429:
                log.warning("  Rate limited on chat request for %s — stopping", slug)
                write_rate_limit()
                break

            elif chat_status in (401, 403):
                url_failed = f"{API_BASE}/users/{owner_id}/chat-request?g={group_id}"
                write_session_expired(url_failed)
                break

            else:
                log.warning("  Unexpected chat request status %d for %s", chat_status, slug)
                if slug in joined_by_slug:
                    joined_by_slug[slug]["dm_status"] = "error"
                    joined_by_slug[slug]["dm_error_code"] = chat_status
                error_count += 1

            # Human-like delay only after actual API interactions (chat request + DM)
            if chat_status == 200:
                delay = random.uniform(DM_DELAY_MIN, DM_DELAY_MAX)
                log.info("  Waiting %.0fs before next DM...", delay)
                time.sleep(delay)
            elif chat_status == 423:
                # Quick skip for locked memberships
                pass
            else:
                time.sleep(3)

        browser.close()

    # Persist updated joined.json
    save_json(JOINED_FILE, list(joined_by_slug.values()))

    # Summary
    sent_today_total = load_daily_cap().get("count", sent_count)
    log.info("=" * 50)
    log.info("DM Auto Run Complete")
    log.info("  Sent:    %d", sent_count)
    log.info("  Retry:   %d (membership not unlocked yet)", retry_count)
    log.info("  Error:   %d", error_count)
    log.info("  Skipped: %d (no owner_id or no dm_text)", skip_count)
    log.info("=" * 50)

    tg.send(
        "Skool DM run complete.\nSent: %d\nRetry: %d (membership locked)\nErrors: %d\nDaily cap: %d/%d"
        % (sent_count, retry_count, error_count, sent_today_total, DAILY_CAP)
    )


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def show_stats():
    """Print queue stats and cap status."""
    joined = load_json(JOINED_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)
    cap_data = load_daily_cap()

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=DM_HOLD_HOURS)

    counts = {}
    dm_eligible = 0
    for entry in joined:
        if not isinstance(entry, dict):
            continue
        status = entry.get("dm_status", "unknown")
        counts[status] = counts.get(status, 0) + 1
        if status == "pending" and entry.get("owner_id"):
            ja = entry.get("joined_at", "")
            if ja:
                try:
                    jdt = datetime.fromisoformat(ja)
                    if jdt.tzinfo is None:
                        jdt = jdt.replace(tzinfo=timezone.utc)
                    if jdt < cutoff:
                        dm_eligible += 1
                except Exception:
                    pass

    print("\n" + "=" * 55)
    print("Skool DM Auto -- Queue Stats")
    print("=" * 55)
    print(f"\nJoined file: {JOINED_FILE}")
    print(f"Total joined: {len(joined)}")
    for status, n in sorted(counts.items()):
        print(f"  {status:20s}: {n}")
    print(f"\nDM eligible now: {dm_eligible} (24h+ since join, pending, has owner_id)")
    print(f"Contacted: {len(contacted)}")
    print(f"Sent today: {cap_data['count']} / {cap_data['cap']}")
    print(f"Daily cap: {DAILY_CAP}")
    print(f"DM delay: {DM_DELAY_MIN}-{DM_DELAY_MAX}s")
    print(f"Session: {'EXISTS' if SESSION_FILE.exists() else 'MISSING'}")
    print(f"Stop flag: {'SET' if check_stop_flag() else 'CLEAR'}")
    print(f"Rate limited: {'YES' if check_rate_limit() else 'NO'}")
    print(f"Session expired: {'YES' if check_session_expired() else 'NO'}")
    print("=" * 55 + "\n")


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def self_test():
    """Verify session cookies work and Skool API is accessible."""
    log.info("=== SELF TEST ===")

    try:
        from playwright.sync_api import sync_playwright as _sp
        log.info("[OK] Playwright imported")
    except ImportError:
        log.error("[FAIL] Playwright not installed")
        return False

    if not SESSION_FILE.exists():
        log.error("[FAIL] No session file at %s", SESSION_FILE)
        log.error("       Run: python3 extract-cookies.py")
        return False

    cookies = load_session_cookies(SESSION_FILE)
    if not cookies:
        log.error("[FAIL] Session file empty or invalid")
        return False
    log.info("[OK] Loaded %d cookies", len(cookies))

    cookie_names = {c.get("name") for c in cookies if isinstance(c, dict)}
    log.info("[INFO] Cookie names: %s", ", ".join(sorted(cookie_names)))

    joined = load_json(JOINED_FILE, default=[])
    log.info("[OK] joined.json: %d entries", len(joined))

    if check_stop_flag():
        log.warning("[WARN] DM_STOP.flag is SET")
    if RATE_LIMITED_FILE.exists():
        log.warning("[WARN] RATE_LIMITED_UNTIL file exists")
    if SESSION_EXPIRED_FILE.exists():
        log.warning("[WARN] SESSION_EXPIRED.flag is SET")

    from playwright.sync_api import sync_playwright
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

        try:
            context.add_cookies(cookies)
        except Exception as exc:
            log.error("[FAIL] Could not load cookies: %s", exc)
            browser.close()
            return False

        page = context.new_page()

        try:
            page.goto(f"{SKOOL_BASE}/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)
            log.info("[OK] Navigated to skool.com")
        except Exception as exc:
            log.error("[FAIL] Could not load skool.com: %s", exc)
            browser.close()
            return False

        result = waf_fetch(page, f"{API_BASE}/user")
        status_code = result.get("status", 0)
        data = result.get("data", {})

        if status_code == 200:
            name = data.get("name", "?") if isinstance(data, dict) else "?"
            log.info("[OK] API authenticated as: %s", name)
        elif status_code in (401, 403):
            log.error("[FAIL] Session expired (status=%d). Refresh cookies.", status_code)
            browser.close()
            return False
        else:
            log.warning("[WARN] Unexpected API status %d (may still work)", status_code)

        browser.close()

    log.info("=== SELF TEST PASSED ===")
    return True


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Skool DM auto-sender")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only — no API calls or file writes",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Verify session and API access",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show queue stats",
    )
    args = parser.parse_args()

    if args.stats:
        show_stats()
        return

    if args.self_test:
        ok = self_test()
        sys.exit(0 if ok else 1)

    run_dm_auto(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
