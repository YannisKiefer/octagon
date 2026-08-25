# OCTRAGON OS: Agent Architecture Reference

## Current Agent Inventory

This directory contains the source code for all social media agents. All social media actions
must flow through **physical hardware phones via the ADB bridge** (`infra/farm/farm-brain.js`).
No Playwright, no Instagrapi, no direct API calls for engagement.

---

## `instagram/` — ADB Phone-First Agents (PRODUCTION)

| File | Purpose | Method | Replaces |
|------|---------|--------|---------|
| `ig-adb-dm.py` | Enqueue DM tasks for ADB execution | farm_tasks DB → farm-brain ADB | `ig-instagrapi-dm.py`, `ig-dm-auto.py` |
| `ig-adb-outreach.py` | Enqueue follow/unfollow/like_recent/comment tasks | farm_tasks DB → farm-brain ADB | `ig-playwright-outreach.py` (deleted) |
| `ig-adb-scout.py` | Enqueue scroll/hashtag/profile scout tasks | farm_tasks DB → farm-brain ADB | `ig-big-scout.py`, `ig-small-scout.py`, `ig-instagrapi-scout.py`, `ig-getapis-scout.py` (all deleted) |

### How the ADB Pipeline Works

```
Python Agent           SQLite DB           farm-brain.js         Physical Phone
─────────────          ──────────          ─────────────         ──────────────
ig-adb-dm.py     →  farm_tasks row  →  daemon poll loop  →  adb shell input tap
ig-adb-outreach  →  (type=outreach)  →  runOutreachTask   →  adb shell input text
ig-adb-scout     →  (type=scout)     →  runScoutTask      →  adb exec-out screencap
```

### ADB Task Types

farm-brain.js now supports these task `type` values:

| Type | Runner Function | ADB Commands Used |
|------|----------------|-------------------|
| `warmup` | iOS Voice Control via macOS `say` | iOS-specific |
| `smoke` | `runSmokeTask` | iOS screenshot via devicectl |
| `audit` | `runAudit` | iOS screenshot via devicectl |
| `post` | `runPostTask` (Python subprocess) | None (video upload) |
| `dm` | `runDmTask` | `adb shell input tap/text/keyevent` |
| `outreach` | `runOutreachTask` | `adb shell input tap/text/keyevent` |
| `scout` | `runScoutTask` | `adb shell input swipe`, `adb exec-out screencap` |
| `scroll` | `runScrollTask` | `adb shell input swipe` |

### Retry Logic

ADB tasks (dm, outreach, scout, scroll) support exponential-backoff retries:
- Default: 3 retries, starting at 5s, doubling each attempt
- Configurable per-task via `max_retries` column in `farm_tasks`
- On ADB disconnect: task is rescheduled 30s in the future automatically

### Device Health Columns (farm_device_health)

| Column | Meaning |
|--------|---------|
| `usb_connected` | iOS devicectl USB presence |
| `adb_connected` | Android ADB reachability (`adb devices`) |
| `last_adb_ping_at` | Timestamp of last successful ADB check |

---

## `instagram/` — Legacy Web-Based Agents (ARCHIVED — DO NOT USE)

These files are kept for reference only. Do not run them in production.

| File | Old Method | Status |
|------|-----------|--------|
| `ig-instagrapi-dm.py` | Instagrapi Python API | Archived |
| `ig-instagrapi-scout.py` | Instagrapi API | Archived |
| `ig-playwright-outreach.py` | Playwright browser | Archived |
| `ig-big-scout.py` | API batch calls | Archived |
| `ig-small-scout.py` | API batch calls | Archived |
| `ig-dm-auto.py` | Instagrapi API | Archived |
| `ig-getapis-scout.py` | REST API | Archived |
| `extract-ig-cookies.py` | Playwright | Archived |

---

## `telegram/` — CEO Command Bot

| File | Purpose |
|------|---------|
| `ceo-bot.py` | Telegram bot for executive-level command dispatching and reporting |

---

## `shared/` — Shared Utilities

| File | Purpose |
|------|---------|
| `icp_scoring.py` | Ideal Customer Profile scoring engine — scores leads for relevance/intent |
| `telegram_notify.py` | Shared utility to dispatch alerts to Telegram channels |

---

## Usage Examples

```bash
# Enqueue DMs to leads in ig_small_queue.json
python3 ig-adb-dm.py --device phone1

# Preview eligible DM leads without writing to DB
python3 ig-adb-dm.py --dry-run

# Follow targets in ig_follow_queue.json
python3 ig-adb-outreach.py --action follow --device phone2

# Unfollow aged targets in ig_unfollow_queue.json
python3 ig-adb-outreach.py --action unfollow --device phone2

# Scroll-scout the main feed (10 sessions)
python3 ig-adb-scout.py --mode scroll --count 10 --device phone3

# Hashtag scout specific tag
python3 ig-adb-scout.py --mode hashtag --tag fitness --device phone3

# Check stats for device
python3 ig-adb-dm.py --stats --device phone1
python3 ig-adb-outreach.py --stats --device phone2
python3 ig-adb-scout.py --stats --device phone3
```

---

## Stop Flag

Create the file `engine/data/IG_ADB_STOP.flag` to halt all ADB agents immediately.
Remove it to resume operations.
