#!/usr/bin/env python3
"""
ig-adb-dm.py — ADB Phone-First Instagram DM Agent.

Replaces ig-instagrapi-dm.py and ig-dm-auto.py.

Instead of using Playwright or Instagrapi (web/API), this agent enqueues
DM tasks into the farm_tasks SQLite table. farm-brain.js picks them up and
executes the actual ADB touch commands on the physical phone.

Workflow:
  1. Read eligible leads from ig_small_queue.json or ig_big_queue.json
  2. For each eligible lead, INSERT a 'dm' task row into farm_tasks
  3. farm-brain daemon polls farm_tasks and dispatches the ADB touch sequence

Usage:
  python3 ig-adb-dm.py                # auto mode — enqueue all eligible leads
  python3 ig-adb-dm.py --dry-run      # preview eligible leads, no DB writes
  python3 ig-adb-dm.py --stats        # show queue + farm_tasks stats
  python3 ig-adb-dm.py --device phone2 # target a specific device
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
SMALL_QUEUE_FILE = DATA_DIR / "ig_small_queue.json"
BIG_QUEUE_FILE = DATA_DIR / "ig_big_queue.json"
CONTACTED_FILE = DATA_DIR / "ig_adb_contacted.txt"
STOP_FLAG = DATA_DIR / "IG_ADB_STOP.flag"

MAX_DMS_PER_DAY = 20
DEFAULT_DEVICE = "phone1"

DM_STAGGER_SECONDS_MIN = 90
DM_STAGGER_SECONDS_MAX = 240

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ig-adb-dm")


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


def load_contacted(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def append_contacted(path: Path, username: str) -> None:
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


def count_pending_dm_tasks(conn: sqlite3.Connection, device_id: str) -> int:
    """Count how many DM tasks are still pending/running for a device today."""
    today = datetime.now(timezone.utc).date().isoformat()
    row = conn.execute(
        """
        SELECT COUNT(*) as c FROM farm_tasks
        WHERE type = 'dm'
          AND device_id = ?
          AND status IN ('scheduled', 'running')
          AND scheduled_for >= ?
        """,
        (device_id, today),
    ).fetchone()
    return row["c"] if row else 0


def count_dm_tasks_today(conn: sqlite3.Connection, device_id: str) -> int:
    """Count DM tasks created today (regardless of status) for daily cap."""
    today = datetime.now(timezone.utc).date().isoformat()
    row = conn.execute(
        """
        SELECT COUNT(*) as c FROM farm_tasks
        WHERE type = 'dm'
          AND device_id = ?
          AND created_at >= ?
        """,
        (device_id, today),
    ).fetchone()
    return row["c"] if row else 0


def enqueue_dm_task(
    conn: sqlite3.Connection,
    device_id: str,
    target_handle: str,
    message_text: str,
    scheduled_for: datetime,
    lead_meta: Optional[dict] = None,
) -> str:
    """Insert a dm task row into farm_tasks. Returns the new task id."""
    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    payload = json.dumps({
        "targetHandle": target_handle,
        "messageText": message_text,
        "source": "ig-adb-dm",
        "meta": lead_meta or {},
    })
    conn.execute(
        """
        INSERT INTO farm_tasks
          (id, type, device_id, scheduled_for, status, payload, created_at, updated_at)
        VALUES (?, 'dm', ?, ?, 'scheduled', ?, ?, ?)
        """,
        (task_id, device_id, scheduled_for.isoformat(), payload, now, now),
    )
    conn.commit()
    return task_id


def load_eligible_leads(contacted: set) -> list[dict]:
    """Load pending DM leads from both small and big queue files."""
    now = datetime.now(timezone.utc)
    eligible = []

    small_queue = load_json(SMALL_QUEUE_FILE, default=[])
    for entry in small_queue:
        if not isinstance(entry, dict):
            continue
        if entry.get("dm_status") != "pending":
            continue
        username = (entry.get("username") or "").strip().lstrip("@")
        if not username or username in contacted:
            continue
        if not entry.get("dm_text"):
            continue
        entry["_queue"] = "small"
        eligible.append(entry)

    big_queue = load_json(BIG_QUEUE_FILE, default=[])
    for entry in big_queue:
        if not isinstance(entry, dict):
            continue
        if entry.get("dm_status") != "pending":
            continue
        if entry.get("approach") != "direct_dm":
            continue
        username = (entry.get("username") or "").strip().lstrip("@")
        if not username or username in contacted:
            continue
        dm_eligible_at_str = entry.get("dm_eligible_at")
        if dm_eligible_at_str:
            try:
                dm_eligible_at = datetime.fromisoformat(dm_eligible_at_str)
                if dm_eligible_at.tzinfo is None:
                    dm_eligible_at = dm_eligible_at.replace(tzinfo=timezone.utc)
                if dm_eligible_at > now:
                    continue
            except Exception:
                continue
        if not entry.get("dm_text"):
            continue
        entry["_queue"] = "big"
        eligible.append(entry)

    eligible.sort(key=lambda e: e.get("score", 0), reverse=True)
    return eligible


def show_stats(conn: sqlite3.Connection, device_id: str) -> None:
    small_queue = load_json(SMALL_QUEUE_FILE, default=[])
    big_queue = load_json(BIG_QUEUE_FILE, default=[])
    contacted = load_contacted(CONTACTED_FILE)
    today_count = count_dm_tasks_today(conn, device_id)
    pending_count = count_pending_dm_tasks(conn, device_id)

    print("\n" + "=" * 55)
    print("IG ADB DM Agent — Stats")
    print("=" * 55)
    print(f"Small queue size:  {len(small_queue)}")
    print(f"Big queue size:    {len(big_queue)}")
    print(f"Contacted total:   {len(contacted)}")
    print(f"DMs queued today:  {today_count} / {MAX_DMS_PER_DAY}")
    print(f"Pending in DB:     {pending_count}")
    print(f"Stop flag:         {'SET' if STOP_FLAG.exists() else 'clear'}")
    print(f"Device target:     {device_id}")
    print("=" * 55 + "\n")


def run(dry_run: bool = False, device_id: str = DEFAULT_DEVICE) -> None:
    if STOP_FLAG.exists():
        log.error("IG_ADB_STOP.flag present. Remove to continue.")
        return

    conn = open_db()
    today_count = count_dm_tasks_today(conn, device_id)
    log.info("DMs queued today: %d / %d for %s", today_count, MAX_DMS_PER_DAY, device_id)

    if today_count >= MAX_DMS_PER_DAY:
        log.info("Daily DM cap reached (%d). Exiting.", MAX_DMS_PER_DAY)
        conn.close()
        return

    remaining = MAX_DMS_PER_DAY - today_count
    contacted = load_contacted(CONTACTED_FILE)
    eligible = load_eligible_leads(contacted)

    log.info("Eligible leads: %d (budget: %d remaining)", len(eligible), remaining)
    if not eligible:
        log.info("No eligible leads. Exiting.")
        conn.close()
        return

    if dry_run:
        log.info("DRY RUN — showing eligible leads, no tasks enqueued")
        for i, e in enumerate(eligible[:10]):
            log.info(
                "  %d. @%s — score=%s, queue=%s",
                i + 1,
                e.get("username"),
                e.get("score", 0),
                e.get("_queue", "?"),
            )
            log.info("     DM: %s", str(e.get("dm_text") or "")[:120])
        if len(eligible) > 10:
            log.info("  ... and %d more", len(eligible) - 10)
        conn.close()
        return

    import random
    queued = 0
    now = datetime.now(timezone.utc)

    for entry in eligible[:remaining]:
        if STOP_FLAG.exists():
            log.warning("Stop flag detected mid-run. Halting.")
            break

        username = (entry.get("username") or "").strip().lstrip("@")
        dm_text = (entry.get("dm_text") or "").strip()

        stagger_s = random.randint(DM_STAGGER_SECONDS_MIN, DM_STAGGER_SECONDS_MAX) * queued
        scheduled_for = now + timedelta(seconds=stagger_s)

        try:
            task_id = enqueue_dm_task(
                conn=conn,
                device_id=device_id,
                target_handle=username,
                message_text=dm_text,
                scheduled_for=scheduled_for,
                lead_meta={
                    "score": entry.get("score"),
                    "followers": entry.get("followers"),
                    "tier": entry.get("tier"),
                    "queue": entry.get("_queue"),
                },
            )
            append_contacted(CONTACTED_FILE, username)
            log.info(
                "Enqueued DM task %s → @%s scheduled %s (+%ds)",
                task_id[:8],
                username,
                scheduled_for.strftime("%H:%M"),
                stagger_s,
            )
            queued += 1
        except Exception as exc:
            log.error("Failed to enqueue DM for @%s: %s", username, exc)

    log.info("Done — %d DM tasks enqueued for %s", queued, device_id)
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="ig-adb-dm: ADB phone DM agent")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="Farm device ID (e.g. phone1)")
    args = parser.parse_args()

    if args.stats:
        conn = open_db()
        show_stats(conn, args.device)
        conn.close()
        return

    run(dry_run=args.dry_run, device_id=args.device)


if __name__ == "__main__":
    main()
