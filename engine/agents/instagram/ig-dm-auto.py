#!/usr/bin/env python3
"""
ig-dm-auto.py — Unified Instagram DM sender.

Handles two queues:
  - ig_small_queue.json: approach="direct_dm" — send immediately
  - ig_big_queue.json:   approach="follow_first" — send only after dm_eligible_at

Sends DMs via GeeLark API. Sends Telegram notification before each DM.
Respects IG_STOP.flag for emergency halt.
Respects 25 DM/day cap (buffer below IG's 30 limit).

Usage:
  python3 ig-dm-auto.py               interactive (Telegram approval required)
  python3 ig-dm-auto.py --auto        auto-send without per-DM approval
  python3 ig-dm-auto.py --dry-run     preview only, no sends
  python3 ig-dm-auto.py --stats       show queue stats and exit
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
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

SMALL_QUEUE_FILE = DATA_DIR / "ig_small_queue.json"
BIG_QUEUE_FILE = DATA_DIR / "ig_big_queue.json"
CONTACTED_FILE = DATA_DIR / "ig_contacted.txt"
STOP_FLAG = DATA_DIR / "IG_SMALL_STOP.flag"

CONFIG_FILE = Path.home() / "clawd-workspace" / "config" / "api_keys.json"

GEELARK_BASE = "https://openapi.geelark.com"
IG_BASE = "https://www.instagram.com"

# Rate limits
MAX_DMS_PER_DAY = 25

RATE_LIMITED_FILE = DATA_DIR / "RATE_LIMITED_UNTIL"
SESSION_EXPIRED_FILE = DATA_DIR / "SESSION_EXPIRED.flag"
DAILY_CAP_FILE = DATA_DIR / "ig_small_sent_today.json"
DM_DELAY_MIN = 90   # seconds between sends
DM_DELAY_MAX = 200  # seconds between sends

# Telegram approval timeout (interactive mode)
TELEGRAM_APPROVAL_TIMEOUT = 300  # seconds to wait for /approve or /decline

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


def load_contacted(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def append_contacted(path: Path, username: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(username + "\n")


def load_config() -> dict:
    config = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as exc:
            log.warning("Could not load config: %s", exc)
    return config

# ---------------------------------------------------------------------------
# API clients
# ---------------------------------------------------------------------------

def _http_post(url: str, payload: dict, headers: dict) -> tuple[int, dict]:
    """Simple POST helper, returns (status_code, response_dict)."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            body = {"error": str(exc)}
        return exc.code, body
    except Exception as exc:
        return 0, {"error": str(exc)}


def _http_get(url: str, headers: dict) -> tuple[int, dict]:
    """Simple GET helper, returns (status_code, response_dict)."""
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            body = {"error": str(exc)}
        return exc.code, body
    except Exception as exc:
        return 0, {"error": str(exc)}

# ---------------------------------------------------------------------------
# GeeLark DM sending
# ---------------------------------------------------------------------------

def geelark_send_dm(
    api_key: str,
    username: str,
    message: str,
) -> tuple[bool, str]:
    """
    Send Instagram DM via GeeLark API.
    Returns (success, error_message).
    """
    url = f"{GEELARK_BASE}/v1/social/ig/dm"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    payload = {
        "username": username,
        "message": message,
    }

    status, body = _http_post(url, payload, headers)

    if status in (200, 201):
        return True, ""

    if status == 401:
        return False, "geelark_auth_error"
    if status == 429:
        return False, "rate_limited"
    if status == 400:
        error_detail = body.get("message") or body.get("error") or "bad_request"
        return False, f"bad_request:{error_detail}"

    return False, f"http_{status}"


def geelark_record_follow(
    api_key: str,
    username: str,
) -> tuple[bool, str]:
    """
    Record a follow action via GeeLark API.
    Returns (success, error_message).
    """
    url = f"{GEELARK_BASE}/v1/social/ig/follow"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    payload = {"username": username}

    status, body = _http_post(url, payload, headers)

    if status in (200, 201):
        return True, ""
    return False, f"http_{status}"

# ---------------------------------------------------------------------------
# Telegram notifications
# ---------------------------------------------------------------------------

def _make_slug(username: str) -> str:
    """Create a Telegram command-safe slug from username."""
    return re.sub(r"[^a-zA-Z0-9_]", "_", username)[:30]


def telegram_notify(
    bot_token: str,
    chat_id: str,
    lead: dict,
) -> Optional[int]:
    """
    Send a Telegram notification about a pending DM.
    Returns the Telegram message_id for polling, or None on failure.
    """
    username = lead["username"]
    followers = lead.get("followers", 0)
    approach = lead.get("approach", "direct_dm")
    dm_text = lead.get("dm_text", "")
    slug = _make_slug(username)

    followers_k = f"{followers // 1000}k" if followers >= 1000 else str(followers)
    dm_preview = dm_text[:200] + "..." if len(dm_text) > 200 else dm_text

    message = (
        f"[IG DM PENDING]\n"
        f"@{username} ({followers_k} followers)\n"
        f"Approach: {approach}\n\n"
        f"DM text:\n{dm_preview}\n\n"
        f"Reply /approve_{slug} or /decline_{slug}"
    )

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    headers = {"Content-Type": "application/json"}
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
    }

    status, body = _http_post(url, payload, headers)
    if status == 200:
        msg_id = body.get("result", {}).get("message_id")
        log.info("Telegram notification sent (msg_id=%s)", msg_id)
        return msg_id

    log.warning("Telegram notify failed (status=%d): %s", status, body)
    return None


def telegram_wait_approval(
    bot_token: str,
    chat_id: str,
    slug: str,
    timeout_secs: int = TELEGRAM_APPROVAL_TIMEOUT,
) -> Optional[bool]:
    """
    Poll Telegram for /approve_{slug} or /decline_{slug} command.
    Returns True for approve, False for decline, None for timeout.
    """
    approve_cmd = f"/approve_{slug}"
    decline_cmd = f"/decline_{slug}"
    deadline = time.time() + timeout_secs
    last_update_id = None

    log.info("Waiting for Telegram approval (timeout %ds)...", timeout_secs)

    while time.time() < deadline:
        params = {"timeout": 20, "allowed_updates": ["message"]}
        if last_update_id is not None:
            params["offset"] = last_update_id + 1

        url = (
            f"https://api.telegram.org/bot{bot_token}/getUpdates"
            f"?{urllib.parse.urlencode(params)}"
        )
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            log.warning("Telegram poll error: %s", exc)
            time.sleep(5)
            continue

        for update in data.get("result", []):
            update_id = update.get("update_id", 0)
            if last_update_id is None or update_id > last_update_id:
                last_update_id = update_id

            text = (
                update.get("message", {})
                .get("text", "")
                .strip()
                .lower()
            )
            if text.startswith(approve_cmd.lower()):
                log.info("Telegram: APPROVED @%s", slug)
                return True
            if text.startswith(decline_cmd.lower()):
                log.info("Telegram: DECLINED @%s", slug)
                return False

    log.warning("Telegram approval timed out for slug %s", slug)
    return None


def telegram_send_result(
    bot_token: str,
    chat_id: str,
    username: str,
    success: bool,
    error: str = "",
) -> None:
    """Send a result notification after DM attempt."""
    if success:
        text = f"[IG DM SENT] @{username}"
    else:
        text = f"[IG DM FAILED] @{username} — {error}"

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    headers = {"Content-Type": "application/json"}
    payload = {"chat_id": chat_id, "text": text}
    _http_post(url, payload, headers)

# ---------------------------------------------------------------------------
# Hardening helpers + daily cap
# ---------------------------------------------------------------------------

def check_rate_limit() -> bool:
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
    secs = retry_after if retry_after > 0 else 86400
    until = datetime.now(timezone.utc) + timedelta(seconds=secs)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RATE_LIMITED_FILE.write_text(until.isoformat())
    log.warning("Rate limit written: until %s", until.isoformat())


def check_session_expired() -> bool:
    if not SESSION_EXPIRED_FILE.exists():
        return False
    try:
        content = SESSION_EXPIRED_FILE.read_text().strip()
        log.error("Session expired flag set: %s", content)
    except Exception:
        log.error("Session expired flag exists at %s", SESSION_EXPIRED_FILE)
    log.error("Refresh session/API key and remove %s to resume.", SESSION_EXPIRED_FILE)
    return True


def write_session_expired(url: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    SESSION_EXPIRED_FILE.write_text(f"{ts}\n{url}")
    log.error("Session expired at %s (url=%s). Wrote %s", ts, url, SESSION_EXPIRED_FILE)


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


def count_today_dms() -> int:
    """Count DMs sent today (reads sentinel file for speed)."""
    return load_daily_cap()["count"]

# ---------------------------------------------------------------------------
# Queue loading and filtering
# ---------------------------------------------------------------------------

def load_eligible_leads(contacted: set, now: datetime) -> list:
    """
    Load and filter eligible leads from both queues.
    Returns combined list sorted by score desc.
    """
    eligible = []

    # Small queue — direct_dm, send immediately
    small_queue = load_json(SMALL_QUEUE_FILE, default=[])
    for entry in small_queue:
        if not isinstance(entry, dict):
            continue
        if entry.get("dm_status") != "pending":
            continue
        if entry.get("approach") != "direct_dm":
            continue
        if entry.get("username") in contacted:
            continue
        entry["_source"] = "small"
        eligible.append(entry)

    # Big queue — follow_first, dm_eligible_at must be past
    big_queue = load_json(BIG_QUEUE_FILE, default=[])
    for entry in big_queue:
        if not isinstance(entry, dict):
            continue
        if entry.get("dm_status") != "pending":
            continue
        if entry.get("approach") != "follow_first":
            continue
        if entry.get("username") in contacted:
            continue

        dm_eligible_at_str = entry.get("dm_eligible_at")
        if not dm_eligible_at_str:
            # Follow hasn't been recorded yet — skip
            continue

        try:
            dm_eligible_at = datetime.fromisoformat(dm_eligible_at_str)
            if dm_eligible_at.tzinfo is None:
                dm_eligible_at = dm_eligible_at.replace(tzinfo=timezone.utc)
            if dm_eligible_at > now:
                log.debug(
                    "Skip @%s: dm_eligible_at %s not yet reached",
                    entry.get("username"), dm_eligible_at_str,
                )
                continue
        except Exception as exc:
            log.warning(
                "Could not parse dm_eligible_at for @%s: %s",
                entry.get("username"), exc,
            )
            continue

        entry["_source"] = "big"
        eligible.append(entry)

    # Sort by score desc (highest value leads first)
    eligible.sort(key=lambda e: e.get("score", 0), reverse=True)
    return eligible

# ---------------------------------------------------------------------------
# Queue persistence helpers
# ---------------------------------------------------------------------------

def update_queue_entry(queue_file: Path, username: str, updates: dict) -> None:
    """Apply updates to a specific entry in a queue file atomically."""
    queue = load_json(queue_file, default=[])
    for entry in queue:
        if isinstance(entry, dict) and entry.get("username") == username:
            entry.update(updates)
            break
    save_json(queue_file, queue)


def resolve_queue_file(entry: dict) -> Path:
    source = entry.get("_source", "small")
    return BIG_QUEUE_FILE if source == "big" else SMALL_QUEUE_FILE

# ---------------------------------------------------------------------------
# Follow tracking
# ---------------------------------------------------------------------------

def record_follow(
    queue_file: Path,
    username: str,
    geelark_key: Optional[str],
    dry_run: bool,
) -> bool:
    """
    Record a follow action and set follow_at + dm_eligible_at on the lead.
    Returns True if successful.
    """
    if dry_run:
        log.info("  [DRY RUN] Would follow @%s", username)
        return True

    if geelark_key:
        success, error = geelark_record_follow(geelark_key, username)
        if not success:
            log.warning("  GeeLark follow failed for @%s: %s", username, error)
    else:
        log.info("  No GeeLark key — logging follow locally only")

    now = datetime.now(timezone.utc)
    dm_eligible_at = (now + timedelta(hours=48)).isoformat()
    update_queue_entry(queue_file, username, {
        "follow_at": now.isoformat(),
        "dm_eligible_at": dm_eligible_at,
    })
    log.info("  Followed @%s — DM eligible at %s", username, dm_eligible_at)
    return True

# ---------------------------------------------------------------------------
# Main DM loop
# ---------------------------------------------------------------------------

def run_dm_auto(
    dry_run: bool = False,
    auto_mode: bool = False,
) -> None:
    """Main DM sending pipeline."""

    # Startup guards
    if STOP_FLAG.exists():
        log.warning("IG_SMALL_STOP.flag found — exiting immediately")
        return
    if check_rate_limit():
        return
    if check_session_expired():
        return

    config = load_config()
    geelark_key = os.environ.get("GEELARK_API_KEY") or config.get("geelark_api_key")
    telegram_token = config.get("telegram_bot_token")
    telegram_chat = config.get("telegram_chat_id")

    if not geelark_key:
        log.warning(
            "GEELARK_API_KEY not set — running in preview-only mode. "
            "Set env var or add 'geelark_api_key' to config/api_keys.json"
        )

    if not telegram_token or not telegram_chat:
        log.warning(
            "Telegram not configured — skipping notifications. "
            "Add 'telegram_bot_token' and 'telegram_chat_id' to config/api_keys.json"
        )

    # Daily cap check
    cap_data = load_daily_cap()
    today_sent = cap_data["count"]
    log.info("DMs sent today: %d / %d cap", today_sent, cap_data["cap"])

    if today_sent >= cap_data["cap"]:
        log.info("Daily DM cap reached (%d) — exiting", cap_data["cap"])
        return

    remaining_budget = cap_data["cap"] - today_sent
    contacted = load_contacted(CONTACTED_FILE)
    now = datetime.now(timezone.utc)

    eligible = load_eligible_leads(contacted, now)
    log.info(
        "Eligible leads: %d (budget: %d remaining today)",
        len(eligible), remaining_budget,
    )

    if not eligible:
        log.info("No eligible leads — exiting")
        return

    sent_count = 0
    skip_count = 0
    error_count = 0
    decline_count = 0

    for entry in eligible:
        # Re-check stop flag each iteration
        if STOP_FLAG.exists():
            log.warning("IG_SMALL_STOP.flag detected mid-run — stopping")
            break

        cap_data = load_daily_cap()
        if cap_data["count"] >= cap_data["cap"]:
            log.info("Daily cap reached (%d/%d) — stopping", cap_data["count"], cap_data["cap"])
            break

        if sent_count >= remaining_budget:
            log.info("Daily budget exhausted — stopping")
            break

        username = entry.get("username", "")
        display = entry.get("display", username)
        followers = entry.get("followers", 0)
        dm_text = entry.get("dm_text", "")
        approach = entry.get("approach", "direct_dm")
        queue_file = resolve_queue_file(entry)

        if not username:
            log.warning("Entry missing username — skipping")
            skip_count += 1
            continue

        if not dm_text:
            log.warning("No dm_text for @%s — skipping", username)
            skip_count += 1
            continue

        # CRM gate — final cross-platform check
        if _crm:
            check = _crm.check_contact_allowed(Platform.INSTAGRAM, username)
            if not check:
                log.info(
                    "CRM block @%s: %s (locked by %s until %s)",
                    username, check.reason, check.locked_by,
                    check.locked_until.strftime("%Y-%m-%d") if check.locked_until else "N/A",
                )
                update_queue_entry(queue_file, username, {
                    "dm_status": f"crm_block:{check.reason}",
                })
                skip_count += 1
                continue

        log.info(
            "Processing: @%s | %dk followers | %s",
            username, followers // 1000, approach,
        )

        # Telegram notification
        approved = True  # default for auto mode
        if telegram_token and telegram_chat and not dry_run:
            msg_id = telegram_notify(telegram_token, telegram_chat, entry)

            if not auto_mode and msg_id:
                # Interactive: wait for human approval
                slug = _make_slug(username)
                decision = telegram_wait_approval(
                    telegram_token, telegram_chat, slug,
                )
                if decision is None:
                    log.warning("  @%s: Telegram approval timed out — skipping", username)
                    skip_count += 1
                    continue
                if not decision:
                    log.info("  @%s: declined via Telegram", username)
                    update_queue_entry(queue_file, username, {
                        "dm_status": "declined",
                        "dm_declined_at": now.isoformat(),
                    })
                    decline_count += 1
                    continue
                approved = True

        if dry_run:
            log.info("  [DRY RUN] Would send DM to @%s", username)
            log.info("  DM preview:\n%s\n", dm_text)
            sent_count += 1
            continue

        # Send DM via GeeLark
        if not geelark_key:
            log.info("  [PREVIEW] DM to @%s (no GeeLark key):\n%s\n", username, dm_text)
            sent_count += 1
            continue

        success, error_code = geelark_send_dm(geelark_key, username, dm_text)

        if success:
            log.info("  DM sent to @%s", username)
            now_str = datetime.now(timezone.utc).isoformat()
            update_queue_entry(queue_file, username, {
                "dm_status": "sent",
                "dm_sent_at": now_str,
            })
            append_contacted(CONTACTED_FILE, username)
            cap_data["count"] += 1
            save_daily_cap(cap_data)

            # CRM: record send + set 14-day cross-platform lock
            if _crm:
                _crm.log_contact(
                    platform=Platform.INSTAGRAM,
                    handle=username,
                    action=ActionType.DM_SENT,
                    agent_id="ig-dm-auto",
                    message_preview=dm_text[:300],
                    metadata={
                        "followers": followers,
                        "approach": approach,
                        "tier": entry.get("tier"),
                        "lead_type": entry.get("lead_type"),
                    },
                )

            if telegram_token and telegram_chat:
                telegram_send_result(telegram_token, telegram_chat, username, True)

            sent_count += 1

        elif error_code == "rate_limited":
            log.warning("  Rate limited — stopping for today")
            write_rate_limit()
            if telegram_token and telegram_chat:
                _http_post(
                    f"https://api.telegram.org/bot{telegram_token}/sendMessage",
                    {"chat_id": telegram_chat, "text": "[IG DM AUTO] Rate limited — stopping"},
                    {"Content-Type": "application/json"},
                )
            break

        elif error_code == "geelark_auth_error":
            log.error("  GeeLark auth error — check GEELARK_API_KEY. Stopping.")
            write_session_expired(f"{GEELARK_BASE}/v1/social/ig/dm")
            break

        else:
            log.warning("  DM failed for @%s: %s", username, error_code)
            update_queue_entry(queue_file, username, {
                "dm_status": "error",
                "dm_error_code": error_code,
            })
            if telegram_token and telegram_chat:
                telegram_send_result(telegram_token, telegram_chat, username, False, error_code)
            error_count += 1

        # Human-like delay between sends
        if sent_count < remaining_budget and not dry_run:
            import random
            delay = random.uniform(DM_DELAY_MIN, DM_DELAY_MAX)
            log.info("  Waiting %.0fs before next DM...", delay)
            time.sleep(delay)

    # Summary
    log.info("=" * 50)
    log.info("ig-dm-auto Run Complete")
    log.info("  Sent:     %d", sent_count)
    log.info("  Declined: %d (via Telegram)", decline_count)
    log.info("  Error:    %d", error_count)
    log.info("  Skipped:  %d", skip_count)
    log.info("  Budget:   %d / %d used today", today_sent + sent_count, cap_data["cap"])
    log.info("=" * 50)


def show_stats() -> None:
    """Print queue stats and exit."""
    small_queue = load_json(SMALL_QUEUE_FILE, default=[])
    big_queue = load_json(BIG_QUEUE_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)
    now = datetime.now(timezone.utc)

    def _count_by_status(queue: list) -> dict:
        counts: dict = {}
        for entry in queue:
            if not isinstance(entry, dict):
                continue
            status = entry.get("dm_status", "unknown")
            counts[status] = counts.get(status, 0) + 1
        return counts

    today_sent = count_today_dms()

    print("\n" + "=" * 55)
    print("IG DM Auto — Queue Stats")
    print("=" * 55)

    print(f"\nSmall queue ({SMALL_QUEUE_FILE.name}):")
    for status, n in sorted(_count_by_status(small_queue).items()):
        print(f"  {status:20s}: {n}")

    print(f"\nBig queue ({BIG_QUEUE_FILE.name}):")
    big_status = _count_by_status(big_queue)
    for status, n in sorted(big_status.items()):
        print(f"  {status:20s}: {n}")

    # Count big queue entries awaiting 48h window
    awaiting_follow = sum(
        1 for e in big_queue
        if isinstance(e, dict)
        and e.get("dm_status") == "pending"
        and e.get("follow_at")
        and not e.get("dm_eligible_at")
    )
    eligible_now = sum(
        1 for e in big_queue
        if isinstance(e, dict)
        and e.get("dm_status") == "pending"
        and e.get("dm_eligible_at")
        and _parse_dt(e["dm_eligible_at"]) <= now
    )

    print(f"\n  Awaiting follow: {awaiting_follow}")
    print(f"  DM eligible now: {eligible_now}")

    print(f"\nContacted total:  {len(contacted)}")
    print(f"DMs sent today:   {today_sent} / {MAX_DMS_PER_DAY}")
    print(f"Stop flag:        {'SET' if STOP_FLAG.exists() else 'clear'}")
    print("=" * 55 + "\n")


def _parse_dt(s: str) -> datetime:
    """Parse ISO datetime string, ensuring timezone awareness."""
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Unified Instagram DM sender (small + big queues)"
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Auto-send without per-DM Telegram approval",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only — no DMs sent, no file writes",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show queue stats and exit",
    )
    args = parser.parse_args()

    if args.stats:
        show_stats()
        return

    if args.dry_run and args.auto:
        parser.error("--dry-run and --auto are mutually exclusive")

    run_dm_auto(
        dry_run=args.dry_run,
        auto_mode=args.auto,
    )


if __name__ == "__main__":
    main()
