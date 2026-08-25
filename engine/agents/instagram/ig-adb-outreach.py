#!/usr/bin/env python3
"""
ig-adb-outreach.py — ADB Phone-First Instagram Outreach Agent.

Replaces ig-playwright-outreach.py.

Instead of Playwright, this agent enqueues 'outreach' tasks into farm_tasks.
farm-brain.js executes the actual ADB touch sequence on the physical phone.

Supported actions:
  - follow         → tap Follow button on target profile
  - unfollow       → tap Following → confirm unfollow
  - like_recent    → open profile → tap latest post → double-tap like
  - comment        → open profile → open latest post → type and send comment

Usage:
  python3 ig-adb-outreach.py                             # auto follow queue
  python3 ig-adb-outreach.py --action unfollow           # process unfollow list
  python3 ig-adb-outreach.py --action comment --comment-text "Fire 🔥"
  python3 ig-adb-outreach.py --dry-run                   # preview, no writes
  python3 ig-adb-outreach.py --stats                     # show queue stats
  python3 ig-adb-outreach.py --device phone2             # target specific device
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

HERE = Path(__file__).parent
BASE_DIR = HERE.parent
DATA_DIR = BASE_DIR / "data"

DB_PATH = Path(__file__).parent.parent.parent.parent / "infra" / "db" / "octragon.db"
FOLLOW_QUEUE_FILE = DATA_DIR / "ig_follow_queue.json"
UNFOLLOW_QUEUE_FILE = DATA_DIR / "ig_unfollow_queue.json"
FOLLOWED_FILE = DATA_DIR / "ig_adb_followed.txt"
UNFOLLOWED_FILE = DATA_DIR / "ig_adb_unfollowed.txt"
STOP_FLAG = DATA_DIR / "IG_ADB_STOP.flag"

_DEFAULT_MAX_FOLLOWS = 30
_DEFAULT_MAX_UNFOLLOWS = 25
DEFAULT_DEVICE = "phone1"


def _get_device_cap(device_id: str, action: str, default: int) -> int:
    """Return per-device daily cap from env var or default.

    Env var naming convention (examples):
      FARM_PHONE1_MAX_FOLLOWS=25
      FARM_PHONE2_MAX_UNFOLLOWS=15
    """
    import os
    # Convert "phone1" → "PHONE1"
    tag = device_id.upper().replace("-", "_")
    key = f"FARM_{tag}_MAX_{action.upper()}S"
    raw = os.environ.get(key)
    if raw is not None:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return default

STAGGER_MIN_SECONDS = 120
STAGGER_MAX_SECONDS = 300

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ig-adb-outreach")


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


def load_handled(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def append_handled(path: Path, username: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(username + "\n")


def open_db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"octragon.db not found at {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def count_outreach_today(conn: sqlite3.Connection, device_id: str, action: str) -> int:
    today = datetime.now(timezone.utc).date().isoformat()
    row = conn.execute(
        """
        SELECT COUNT(*) as c FROM farm_tasks
        WHERE type = 'outreach'
          AND device_id = ?
          AND json_extract(payload, '$.action') = ?
          AND created_at >= ?
        """,
        (device_id, action, today),
    ).fetchone()
    return row["c"] if row else 0


def enqueue_outreach_task(
    conn: sqlite3.Connection,
    device_id: str,
    target_handle: str,
    action: str,
    scheduled_for: datetime,
    meta: Optional[dict] = None,
    comment_text: str = "",
) -> str:
    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    payload_dict: dict = {
        "targetHandle": target_handle,
        "action": action,
        "source": "ig-adb-outreach",
        "meta": meta or {},
    }
    if action == "comment" and comment_text:
        payload_dict["commentText"] = comment_text
    payload = json.dumps(payload_dict)
    conn.execute(
        """
        INSERT INTO farm_tasks
          (id, type, device_id, scheduled_for, status, payload, created_at, updated_at)
        VALUES (?, 'outreach', ?, ?, 'scheduled', ?, ?, ?)
        """,
        (task_id, device_id, scheduled_for.isoformat(), payload, now, now),
    )
    conn.commit()
    return task_id


def load_follow_targets(handled: set) -> list[dict]:
    queue = load_json(FOLLOW_QUEUE_FILE, default=[])
    targets = []
    for entry in queue:
        if not isinstance(entry, dict):
            continue
        username = (entry.get("username") or "").strip().lstrip("@")
        if not username or username in handled:
            continue
        if entry.get("follow_status") not in (None, "", "pending"):
            continue
        entry["_action"] = "follow"
        targets.append(entry)
    targets.sort(key=lambda e: e.get("score", 0), reverse=True)
    return targets


def load_unfollow_targets(handled: set) -> list[dict]:
    queue = load_json(UNFOLLOW_QUEUE_FILE, default=[])
    targets = []
    now = datetime.now(timezone.utc)
    for entry in queue:
        if not isinstance(entry, dict):
            continue
        username = (entry.get("username") or "").strip().lstrip("@")
        if not username or username in handled:
            continue
        unfollow_after_str = entry.get("unfollow_after")
        if unfollow_after_str:
            try:
                unfollow_after = datetime.fromisoformat(unfollow_after_str)
                if unfollow_after.tzinfo is None:
                    unfollow_after = unfollow_after.replace(tzinfo=timezone.utc)
                if unfollow_after > now:
                    continue
            except Exception:
                continue
        entry["_action"] = "unfollow"
        targets.append(entry)
    return targets


def show_stats(conn: sqlite3.Connection, device_id: str) -> None:
    handled_follows = load_handled(FOLLOWED_FILE)
    handled_unfollows = load_handled(UNFOLLOWED_FILE)
    follow_count_today = count_outreach_today(conn, device_id, "follow")
    unfollow_count_today = count_outreach_today(conn, device_id, "unfollow")
    max_follows = _get_device_cap(device_id, "follow", _DEFAULT_MAX_FOLLOWS)
    max_unfollows = _get_device_cap(device_id, "unfollow", _DEFAULT_MAX_UNFOLLOWS)

    follow_targets = load_follow_targets(handled_follows)
    unfollow_targets = load_unfollow_targets(handled_unfollows)

    print("\n" + "=" * 55)
    print("IG ADB Outreach Agent — Stats")
    print("=" * 55)
    print(f"Follow targets available:  {len(follow_targets)}")
    print(f"Unfollow targets pending:  {len(unfollow_targets)}")
    print(f"Follows queued today:      {follow_count_today} / {max_follows}")
    print(f"Unfollows queued today:    {unfollow_count_today} / {max_unfollows}")
    print(f"Stop flag:                 {'SET' if STOP_FLAG.exists() else 'clear'}")
    print(f"Device target:             {device_id}")
    print("=" * 55 + "\n")


def run(action: str = "follow", dry_run: bool = False, device_id: str = DEFAULT_DEVICE, comment_text: str = "") -> None:
    if STOP_FLAG.exists():
        log.error("IG_ADB_STOP.flag present. Remove to continue.")
        return

    if action == "comment" and not comment_text:
        log.error("--comment-text is required when action=comment.")
        return

    conn = open_db()

    default_cap = _DEFAULT_MAX_FOLLOWS if action in ("follow", "like_recent", "comment") else _DEFAULT_MAX_UNFOLLOWS
    cap = _get_device_cap(device_id, action, default_cap)
    today_count = count_outreach_today(conn, device_id, action)
    log.info("%s tasks queued today: %d / %d for %s", action, today_count, cap, device_id)

    if today_count >= cap:
        log.info("Daily %s cap reached (%d). Exiting.", action, cap)
        conn.close()
        return

    remaining = cap - today_count

    if action in ("follow", "like_recent", "comment"):
        handled_set = load_handled(FOLLOWED_FILE)
        handled_file = FOLLOWED_FILE
        targets = load_follow_targets(handled_set)
    else:
        handled_set = load_handled(UNFOLLOWED_FILE)
        handled_file = UNFOLLOWED_FILE
        targets = load_unfollow_targets(handled_set)

    log.info("Eligible %s targets: %d (budget: %d)", action, len(targets), remaining)

    if not targets:
        log.info("No eligible targets. Exiting.")
        conn.close()
        return

    if dry_run:
        log.info("DRY RUN — showing eligible targets, no tasks enqueued")
        for i, t in enumerate(targets[:10]):
            log.info("  %d. @%s — score=%s", i + 1, t.get("username"), t.get("score", 0))
        if len(targets) > 10:
            log.info("  ... and %d more", len(targets) - 10)
        conn.close()
        return

    import random
    queued = 0
    now = datetime.now(timezone.utc)

    for entry in targets[:remaining]:
        if STOP_FLAG.exists():
            log.warning("Stop flag detected mid-run. Halting.")
            break

        username = (entry.get("username") or "").strip().lstrip("@")
        stagger_s = random.randint(STAGGER_MIN_SECONDS, STAGGER_MAX_SECONDS) * queued
        scheduled_for = now + timedelta(seconds=stagger_s)

        try:
            task_id = enqueue_outreach_task(
                conn=conn,
                device_id=device_id,
                target_handle=username,
                action=action,
                scheduled_for=scheduled_for,
                meta={"score": entry.get("score"), "tier": entry.get("tier")},
                comment_text=comment_text if action == "comment" else "",
            )
            if action not in ("like_recent", "comment"):
                append_handled(handled_file, username)
            log.info(
                "Enqueued %s task %s → @%s scheduled +%ds",
                action,
                task_id[:8],
                username,
                stagger_s,
            )
            queued += 1
        except Exception as exc:
            log.error("Failed to enqueue %s for @%s: %s", action, username, exc)

    log.info("Done — %d %s tasks enqueued for %s", queued, action, device_id)
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="ig-adb-outreach: ADB phone outreach agent")
    parser.add_argument("--action", default="follow", choices=["follow", "unfollow", "like_recent", "comment"])
    parser.add_argument("--comment-text", default="", dest="comment_text",
                        help="Comment body (required when --action comment)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--device", default=DEFAULT_DEVICE)
    args = parser.parse_args()

    if args.stats:
        conn = open_db()
        show_stats(conn, args.device)
        conn.close()
        return

    run(action=args.action, dry_run=args.dry_run, device_id=args.device, comment_text=args.comment_text)


if __name__ == "__main__":
    main()
