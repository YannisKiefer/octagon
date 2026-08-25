<div align="center">

<img src="assets/banner.svg" alt="phone-farm-os" width="100%"/>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Farm](https://img.shields.io/badge/phone%20farm-iOS%20VoiceControl-blue)
![Stack](https://img.shields.io/badge/stack-Next.js%2015%20%E2%80%A2%20SQLite%20%E2%80%A2%20Node%20Hub-green)
![Version](https://img.shields.io/badge/version-1.0-lightgrey)

**A single Mac mini becomes a 4-phone lab. Voice Control, not hacks. Auditable, not spray.**

Run the dashboard, plug in iPhones, dispatch jobs, watch the pipeline. Built for authorized QA and content ops — not for spam.

</div>

---

## The problem

Cloud automation gets you flagged. Cheap virtualization drifts. And every "bot farm on a VPS" you buy is a black box that burns the account it promised to grow.

You need a farm you can see, measure and pause. Where every swipe has jitter, every TTS has a mutex, and every decision has a receipt.

## The fix

Hub-Provider orchestration, proven on a real 4-node rack:

- **Hub** — one process, global audio mutex, heartbeat, self-healing (max 3 restarts), battery guard, DB-backed status
- **Providers** — one `farm-brain.js` per slot (`--slot`, `--prefix`, `--platform`, `--id`), per-device command queue, voice-action isolation
- **Dashboard** — Editorial Glasshouse UI (light, Material 3): `surface-container-low` → `surface-container-high`, no 1px borders, 12-32px radii, Inter only
- **Engine** — Python pipeline: scrape → 3× variation forgery (H.264 presets + metadata) → Gemini analysis → approval → cross-platform post
- **Intelligence** — embeddings (`gemini-embedding-001`), CRM, viral DNA, watchlist, CMO agent, parity scoring

> **Only one TTS at a time.** The audio mutex is the safety core. Two phones speaking at once = two phones answering the wrong phone.

---

## Live screenshots

Real run on a seeded demo DB (18 scraped items, 4 nodes, 3 active). `http://localhost:3010`.

| Fleet overview | Farm control |
|:--:|:--:|
| ![overview](assets/screenshots/overview.png) | ![farm](assets/screenshots/farm.png) |

| Editorial pipeline | CMO intelligence |
|:--:|:--:|
| ![queue](assets/screenshots/queue.png) | ![cmo](assets/screenshots/cmo.png) |

| Radar & discovery | Agent fleet | Marketing |
|:--:|:--:|:--:|
| ![radar](assets/screenshots/radar.png) | ![agents](assets/screenshots/agents.png) | ![landing](assets/screenshots/landing.png) |

<details><summary>More — calendar & full set</summary>

![calendar](assets/screenshots/calendar.png)

All pages available: `/overview` · `/farm` · `/cmo` · `/accounts` · `/queue` · `/radar` · `/agents` · `/calendar` · `/settings` · `/landing`

</details>

---

## Features

| Area | What it does | How to verify |
|---|---|---|
| **Multi-device Hub** | Spawns N workers, 3-5s stagger, heartbeat every 5s (degraded after 3 misses, offline after 10), jitter variance tracking | `node infra/farm/hub.js --slots=2 --duration=10 --test` |
| **Voice isolation** | Per-slot prefix (`Alpha`/`Bravo`/…) + global TTS mutex (`say`/`afplay` queue) — no cross-phone bleed | see `acquireAudioMutex` in `hub.js` |
| **Parity scoring** | Jitter, timing, like/save/comment ratios, profile-open rate — `parity-scorer.js` | `node infra/farm/audit/parity-scorer.js --id=farm_device_1` |
| **Stealth checks** | Sensor, VPN, device-profiles, metadata injection — `stealth-check.js` | npm run in `infra/farm` |
| **Content pipeline** | `scraped_content` → 3 `video_variations` (A/B/C presets) → `delivery_log` approvals → post watchdog | API `GET /api/health` |
| **CMO Intel** | Gemini analyses, Viral DNA genome map, radar charts, `next_post_queue` prescriptions | `/cmo` |
| **Radar** | Creator watchlist + semantic search (Gemini embeddings, fulltext fallback) | `/radar`, `POST /api/radar` |
| **Glasshouse UI** | No-line rule, `rounded-2xl/3xl`, glass panels `bg-white/80 backdrop-blur-[20px]`, pill nav `bg-[var(--primary)]` | visual — see screenshots |

---

## Architecture

```
apps/dashboard          Next.js 15 App Router (port 3010 in OSS, 5000 in original)
  ├─ app/(dashboard)    overview / farm / cmo / radar / queue / agents / calendar / settings
  ├─ app/api/*          farm/devices, farm/tasks, farm/parity, agents/status, cmo, radar, search, cmo...
  ├─ lib/db.ts          SQLite WAL reader (better-sqlite3, readonly)
  ├─ lib/farmDb.ts      farm health/tasks reader+writer
  └─ components/layout  OperationsSidebar (pill nav), TopNavBar (glass), NodeHeader

engine/octragon         Python execution engine
  ├─ config.py          FarmConfig (paths, GPT/Gemini, niche defaults via env)
  ├─ db.py              OctragonDB — all tables, WAL, migrations, seeding
  ├─ scraper/*          discovery, scheduler, scorer, profile_scraper
  ├─ forgery/*          pipeline.py (3 variations: phone-camera / NLE / social-optimizer)
  ├─ video_editor/*     Gemini analyzer + FFmpeg pipeline
  ├─ cmo/*              CMOAgent (prescriptions from content_analysis + viral_dna_profile)
  ├─ intelligence/*     embeddings, vector_store, ingest_hook, search
  └─ run.py bot         CLI: scraper | forger | uploader | watcher ...

infra/farm              Node.js QA lab — the actual farm
  ├─ hub.js             Hub-Provider orchestrator, audio mutex, health + battery monitors
  ├─ farm-brain.js      Per-device voice action queue (swipeNext, likePost, savePost, … goHome)
  ├─ platform-profiles/ tiktok.js / instagram.js / youtube.js — per-platform timing
  ├─ posting/           voice-post-flow.js, platform-flows.js
  ├─ audit/             parity-scorer.js, sensor-spoof.py
  └─ engagement/        comment-engine.js

infra/db/farm.db        SQLite (WAL) — single source of truth (see tables below)
infra/supabase/         migration.sql + utm-redirect edge function
```

**Key tables** (created on first run, seeded with 4 `farm_devices`):

- `farm_devices`, `farm_device_health`, `farm_tasks`, `farm_events`, `hub_status`
- `scraped_content`, `video_variations`, `delivery_log`, `accounts`, `watchlist`
- `content_analysis`, `viral_dna_profile`, `next_post_queue`, `content_embeddings`
- `user_subscriptions`, `usage_records`, `system_settings`, `session_log`

---

## Quick start

### 1. Clone & env

```bash
git clone https://github.com/YannisKiefer/phone-farm-os.git
cd phone-farm-os
cp .env.example .env
# edit .env — add TELEGRAM_BOT_TOKEN / GEMINI_API_KEY if you want CMO + Telegram
```

### 2. Database — auto-seeds on first import

```bash
# Python engine (needs Python 3.11+)
pip install -r engine/requirements.txt
python -c "from engine.octragon.db import OctragonDB; OctragonDB()"
# → infra/db/farm.db created, 4 devices (Alpha/Bravo/Charlie/Delta) seeded
```

Or use the demo seeder in this repo (creates 18 scraped items, tasks, health):

```bash
python /tmp/seed_farm.py   # included for the screenshots above
```

### 3. Dashboard

```bash
cd apps/dashboard
# Node 20 required (better-sqlite3 11.x native)
npm install
cp .env.example .env.local  # or keep the prefilled .env.local: admin/admin
# Node 20 on macOS:
PATH="/opt/homebrew/opt/node@20/bin:$PATH" ./node_modules/.bin/next dev -p 3010
```

Open:

- Dashboard: http://localhost:3010/overview
- Farm: http://localhost:3010/farm
- CMO: http://localhost:3010/cmo

Default auth (development) — `FARM_DB_PATH=../../infra/db/farm.db`:

| user | password | role |
|---|---|---|
| `admin` | `admin` | admin |
| `viewer` | `viewer` | viewer |

### 4. Farm hub (no phones needed for dry run)

```bash
cd infra/farm
npm install   # better-sqlite3 + chalk
npm test      # smoke-test.js — validates wiring without speaking
node hub.js --slots=2 --duration=10 --test     # 2 providers, 10 min, test = no TTS
node hub.js --slots=4 --duration=60            # full 4-slot production
```

Single brain direct:

```bash
node farm-brain.js --slot=1 --prefix=Alpha --platform=tiktok --id=farm_device_1 --duration=10 --dry-run --log
```

### 5. Engine CLI (headless)

```bash
cd engine
python run.py bot          # interactive Telegram + scheduler
python run.py scraper --once
python run.py forger  --id=scraped_001
python run.py watcher --dry
```

---

## Farm setup — iOS Voice Control (the real part)

This is not ADB or MDM. It uses iOS **Voice Control** (Accessibility) + macOS `say` — each phone listens for its own prefix.

1. On each iPhone: Settings → Accessibility → Voice Control → On → Vocabulary → add custom commands exactly matching `infra/farm/voice-actions/*.plist` (import via Configurator) — e.g. `Alpha Swipe Next`, `Bravo Like Post`.
2. Pair via USB, trust this Mac, note the UDID: `idevice_id -l` or Finder.
3. Export per-phone env:

```bash
FARM_PHONE1_PREFIX=Alpha  FARM_PHONE1_UDID=00008030-001A...
FARM_PHONE2_PREFIX=Bravo  FARM_PHONE2_UDID=00008020-00B1...
```

4. Test one phone in isolation first:

```bash
node farm-brain.js --slot=1 --prefix=Alpha --platform=tiktok --id=farm_device_1
# watch iPhone respond to "Alpha Swipe Next" via Mac speaker
```

5. Then launch the hub — it staggers starts by 3-5s so TTS never collides.

Safety rails: one account per device, cooldown windows, no auto-unlock if the device is locked, battery pause <20%, parity audit after every 30m.

> Use only on accounts you own and with explicit user consent. This repo is for **authorized QA and content-ops labs.**

---

## ENV matrix (the only 8 you need to run)

| var | default | purpose |
|---|---|---|
| `FARM_DB_PATH` | `../../infra/db/farm.db` | SQLite path (dashboard) |
| `NEXTAUTH_URL` | `http://localhost:3010` | NextAuth |
| `NEXTAUTH_SECRET` | `…` | random 32-char, gen with `openssl rand -base64 32` |
| `DASHBOARD_ADMIN_USER` | `admin` | dashboard login |
| `DASHBOARD_ADMIN_PASSWORD` | `admin` | — |
| `TELEGRAM_BOT_TOKEN` | — | optional: inbox → `scraped_content` |
| `GEMINI_API_KEY` | — | optional: CMO, embeddings, captions |
| `STRIPE_*` | — | optional: billing |

Phone slots: `FARM_PHONE{1..4}_PREFIX` / `_UDID` + niche handles `TIKTOK_PHONE{1..4}` etc. All via `engine/octragon/config.py`.

Full template: `.env.example` at repo root and `apps/dashboard/.env.local` stub.

---

## Variation forging — the three presets

| preset | mimics | fps | bitrate | crf | preset | GOP | refs | pitch |
|---|---|---|---|---|---|---|---|---|
| **A — phone camera** | real-time HEVC encoder | 29.97 | 4500k | 22 | fast | 30 (1s) | 3 | +1.8% |
| **B — NLE export** | DaVinci/Premiere | 30.03 | 5500k | 19 | medium | 72 | 5 | −1.8% |
| **C — social editor** | CapCut/TikTok editor | 29.95 | 3800k | 24 | slow | 48 | 4 | +2.5% |

Each varies crop (2px), noise seed, deblock, entropy cabac. Metadata injected per `DeviceProfile` (iPhone 15 Pro / Pro Max / 16 Pro). Unique hash per variation — deduplication proof, not evasion.

---

## Scripts

```bash
# dashboard
npm run dev     # next dev -p 3010
npm run build   # next build
npm run start   # next start -p 3010
npm run lint

# farm
node smoke-test.js          # wiring check (no hardware)
node stealth-check.js       # device fingerprint audit
node video-engine.js        # local FFmpeg pipeline

# engine (python)
pytest engine/octragon/tests/   # forgery unit tests
python audit.py                 # full system audit
```

---

## Security notes (hardening inherited from private Octragon)

- No raw SQL — only `better-sqlite3` prepared statements and Python `sqlite3` param binding
- No `eval`, no `exec`, no template-string shell
- `acquireAudioMutex` prevents acoustic crosstalk — one `say` at a time, IPC-granted
- Health check rejects unsigned uploads
- `OCTRAGON_DB_PATH` fallback + `FARM_DB_PATH` keeps old deploys working without leaking path
- `.gitignore` covers `*.db*`, `*_session.json`, `*cookies.json`, `data/`, `videos/`

Pre-push, local scan:

```bash
grep -rE "(sk-_|ghp_|api_key|SECRET|password)" --include="*.py" --include="*.ts" --include="*.tsx" | grep -v ".git"
```

This public copy ships **zero** credentials. All 6 former private Skool/Whop queues, `skool_session.json`, `whop_session.json`, `octragon.db` WAL, and Telegram group IDs are removed/replaced with placeholders.

---

## Roadmap

- [ ] WebUSB pairing helper (one-click UDID + prefix test)
- [ ] Playwright harness for desktop fallback (when farm is off-site)
- [ ] OpenTelemetry exports from `hub_status` → Grafana
- [ ] Tailwind snapshot tests for every dashboard page
- [ ] Prebuilt Voice Control `.plist` importers per platform profile

PRs welcome. Keep the diff small, the changelog honest, one feature per PR.

---

## License

MIT — see [LICENSE](LICENSE). Fork it, rack it, ship content with it.

<div align="center">

<sub>Built from the private <code>octragon-os</code> editorial system. This open copy is sanitized, resynthesized and documented for public use. Runs on a Mac mini. Needs a human in the loop.</sub>

</div>
