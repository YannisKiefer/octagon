#!/usr/bin/env python3
"""
ig-adb-scout.py — ADB Phone-First Instagram Scout Agent.

Replaces ig-big-scout.py, ig-small-scout.py, ig-instagrapi-scout.py.

Enqueues 'scout' tasks into farm_tasks. farm-brain executes the ADB
swipe sequence on the physical phone and saves raw screenshots.
A separate analysis step processes screenshots for engagement signals.

Modes:
  scroll    — pure scroll scouting (build up screenshot archive)
  hashtag   — navigate to a hashtag feed, then scroll-scout
  profile   — visit a specific profile, screenshot the grid

Usage:
  python3 ig-adb-scout.py                           # default scroll scout
  python3 ig-adb-scout.py --mode hashtag --tag yoga # hashtag scout
  python3 ig-adb-scout.py --mode profile --handle techinfluencer1
  python3 ig-adb-scout.py --dry-run                 # preview, no writes
  python3 ig-adb-scout.py --stats                   # queue stats
  python3 ig-adb-scout.py --device phone3           # specific device
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
NICHE_FILE = DATA_DIR / "niches.json"
HASHTAG_QUEUE_FILE = DATA_DIR / "ig_hashtag_queue.json"
PROFILE_QUEUE_FILE = DATA_DIR / "ig_profile_scout_queue.json"
STOP_FLAG = DATA_DIR / "IG_ADB_STOP.flag"

MAX_SCOUT_TASKS_PER_RUN = 5
DEFAULT_DEVICE = "phone1"
DEFAULT_SCROLL_COUNT = 15
STAGGER_MIN_SECONDS = 60
STAGGER_MAX_SECONDS = 180

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ig-adb-scout")


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


def open_db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"octragon.db not found at {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def count_scout_tasks_today(conn: sqlite3.Connection, device_id: str) -> int:
    today = datetime.now(timezone.utc).date().isoformat()
    row = conn.execute(
        """
        SELECT COUNT(*) as c FROM farm_tasks
        WHERE type = 'scout' AND device_id = ? AND created_at >= ?
        """,
        (device_id, today),
    ).fetchone()
    return row["c"] if row else 0


def enqueue_scout_task(
    conn: sqlite3.Connection,
    device_id: str,
    mode: str,
    scroll_count: int,
    scheduled_for: datetime,
    extra_payload: Optional[dict] = None,
) -> str:
    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    payload_data = {
        "mode": mode,
        "scrollCount": scroll_count,
        "screenshotEvery": 3,
        "source": "ig-adb-scout",
    }
    if extra_payload:
        payload_data.update(extra_payload)
    payload = json.dumps(payload_data)

    conn.execute(
        """
        INSERT INTO farm_tasks
          (id, type, device_id, scheduled_for, status, payload, created_at, updated_at)
        VALUES (?, 'scout', ?, ?, 'scheduled', ?, ?, ?)
        """,
        (task_id, device_id, scheduled_for.isoformat(), payload, now, now),
    )
    conn.commit()
    return task_id


def enqueue_scroll_scout(
    conn: sqlite3.Connection,
    device_id: str,
    count: int = DEFAULT_SCROLL_COUNT,
    dry_run: bool = False,
) -> int:
    import random
    now = datetime.now(timezone.utc)
    queued = 0

    for i in range(min(count, MAX_SCOUT_TASKS_PER_RUN)):
        stagger_s = random.randint(STAGGER_MIN_SECONDS, STAGGER_MAX_SECONDS) * i
        scheduled_for = now + timedelta(seconds=stagger_s)

        if dry_run:
            log.info(
                "DRY RUN: scroll scout %d, device=%s, scheduled +%ds",
                i + 1, device_id, stagger_s,
            )
            queued += 1
            continue

        try:
            task_id = enqueue_scout_task(
                conn=conn,
                device_id=device_id,
                mode="scroll",
                scroll_count=DEFAULT_SCROLL_COUNT,
                scheduled_for=scheduled_for,
            )
            log.info("Enqueued scroll scout %s +%ds", task_id[:8], stagger_s)
            queued += 1
        except Exception as exc:
            log.error("Failed to enqueue scroll scout: %s", exc)

    return queued


def enqueue_hashtag_scouts(
    conn: sqlite3.Connection,
    device_id: str,
    tags: list,
    dry_run: bool = False,
) -> int:
    import random
    now = datetime.now(timezone.utc)
    queued = 0

    for i, tag in enumerate(tags[:MAX_SCOUT_TASKS_PER_RUN]):
        tag_clean = str(tag).lstrip("#").strip()
        if not tag_clean:
            continue
        stagger_s = random.randint(STAGGER_MIN_SECONDS, STAGGER_MAX_SECONDS) * i
        scheduled_for = now + timedelta(seconds=stagger_s)

        if dry_run:
            log.info("DRY RUN: hashtag scout #%s, device=%s", tag_clean, device_id)
            queued += 1
            continue

        try:
            task_id = enqueue_scout_task(
                conn=conn,
                device_id=device_id,
                mode="hashtag",
                scroll_count=12,
                scheduled_for=scheduled_for,
                extra_payload={"hashtag": tag_clean},
            )
            log.info("Enqueued hashtag scout #%s → %s +%ds", tag_clean, task_id[:8], stagger_s)
            queued += 1
        except Exception as exc:
            log.error("Failed to enqueue hashtag scout for #%s: %s", tag_clean, exc)

    return queued


def enqueue_profile_scouts(
    conn: sqlite3.Connection,
    device_id: str,
    handles: list,
    dry_run: bool = False,
) -> int:
    import random
    now = datetime.now(timezone.utc)
    queued = 0

    for i, handle in enumerate(handles[:MAX_SCOUT_TASKS_PER_RUN]):
        handle_clean = str(handle).lstrip("@").strip()
        if not handle_clean:
            continue
        stagger_s = random.randint(STAGGER_MIN_SECONDS, STAGGER_MAX_SECONDS) * i
        scheduled_for = now + timedelta(seconds=stagger_s)

        if dry_run:
            log.info("DRY RUN: profile scout @%s, device=%s", handle_clean, device_id)
            queued += 1
            continue

        try:
            task_id = enqueue_scout_task(
                conn=conn,
                device_id=device_id,
                mode="profile",
                scroll_count=8,
                scheduled_for=scheduled_for,
                extra_payload={"targetHandle": handle_clean},
            )
            log.info("Enqueued profile scout @%s → %s +%ds", handle_clean, task_id[:8], stagger_s)
            queued += 1
        except Exception as exc:
            log.error("Failed to enqueue profile scout for @%s: %s", handle_clean, exc)

    return queued


def load_hashtag_targets() -> list:
    queue = load_json(HASHTAG_QUEUE_FILE, default=[])
    if queue and isinstance(queue, list):
        tags = [str(t.get("tag") or t) for t in queue if t]
        return [t for t in tags if t and t != "None"]

    niches = load_json(NICHE_FILE, default=[])
    tags = []
    for niche in niches:
        if isinstance(niche, dict):
            for tag in niche.get("hashtags", []):
                if tag and tag not in tags:
                    tags.append(tag)
    return tags[:20]


def load_profile_targets() -> list:
    queue = load_json(PROFILE_QUEUE_FILE, default=[])
    return [
        (e.get("username") or "").strip().lstrip("@")
        for e in queue
        if isinstance(e, dict) and e.get("username")
    ]


def show_stats(conn: sqlite3.Connection, device_id: str) -> None:
    today_count = count_scout_tasks_today(conn, device_id)
    hashtags = load_hashtag_targets()
    profiles = load_profile_targets()

    print("\n" + "=" * 55)
    print("IG ADB Scout Agent — Stats")
    print("=" * 55)
    print(f"Scout tasks today:     {today_count}")
    print(f"Hashtag queue size:    {len(hashtags)}")
    print(f"Profile queue size:    {len(profiles)}")
    print(f"Stop flag:             {'SET' if STOP_FLAG.exists() else 'clear'}")
    print(f"Device target:         {device_id}")
    print("=" * 55 + "\n")


def run(
    mode: str = "scroll",
    tag: Optional[str] = None,
    handle: Optional[str] = None,
    dry_run: bool = False,
    device_id: str = DEFAULT_DEVICE,
    scroll_count: int = 1,
) -> None:
    if STOP_FLAG.exists():
        log.error("IG_ADB_STOP.flag present. Remove to continue.")
        return

    conn = open_db()
    today_count = count_scout_tasks_today(conn, device_id)
    log.info("Scout tasks today: %d for %s", today_count, device_id)

    if mode == "scroll":
        queued = enqueue_scroll_scout(conn, device_id, count=scroll_count, dry_run=dry_run)
    elif mode == "hashtag":
        tags = [tag] if tag else load_hashtag_targets()
        queued = enqueue_hashtag_scouts(conn, device_id, tags, dry_run=dry_run)
    elif mode == "profile":
        handles = [handle] if handle else load_profile_targets()
        queued = enqueue_profile_scouts(conn, device_id, handles, dry_run=dry_run)
    else:
        log.error("Unknown mode: %s", mode)
        queued = 0

    log.info(
        "Done — %d scout task(s) %s for %s",
        queued,
        "previewed" if dry_run else "enqueued",
        device_id,
    )
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="ig-adb-scout: ADB phone scout agent")
    parser.add_argument("--mode", default="scroll", choices=["scroll", "hashtag", "profile"])
    parser.add_argument("--tag", default=None, help="Specific hashtag (for hashtag mode)")
    parser.add_argument("--handle", default=None, help="Specific profile handle (for profile mode)")
    parser.add_argument("--count", type=int, default=1, help="Number of scroll sessions to enqueue")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--device", default=DEFAULT_DEVICE)
    args = parser.parse_args()

    if args.stats:
        conn = open_db()
        show_stats(conn, args.device)
        conn.close()
        return

    run(
        mode=args.mode,
        tag=args.tag,
        handle=args.handle,
        dry_run=args.dry_run,
        device_id=args.device,
        scroll_count=args.count,
    )


if __name__ == "__main__":
    main()
