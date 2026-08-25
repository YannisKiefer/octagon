# Architecture — Phone Farm OS

See `README.md` for the full diagram. This file is a quick index for deep dives.

## Packages

- `apps/dashboard` — Next.js 15 App Router, Editorial Glasshouse, SQLite WAL reader
  - `app/(dashboard)/farm/page.tsx` — Hub status, device grid, template dispatches
  - `lib/farmDb.ts` + `lib/db.ts` — the two SQLite layers (farm vs content)
  - `instrumentation.ts` — scheduler registration

- `engine/octragon`
  - `config.py` — `FarmConfig` / `OctragonConfig` (env-driven, no hard-coded group IDs)
  - `db.py` — single `farm.db` truth (WAL, FK, migrations, 4-device seeding)
  - `forgery/pipeline.py` — 3 presets (phone-camera / NLE / social-editor)
  - `scraper/*`, `cmo/agent.py`, `intelligence/*`

- `infra/farm`
  - `hub.js` — spawns N `farm-brain.js`, 3-5s stagger, 5s heartbeat, audio mutex
  - `farm-brain.js` — per-device voice queue, USB self-healing, JSONL events
  - `platform-profiles/*.js` — tiktok / instagram / youtube timings

## DB

`infra/db/farm.db` (gitignored) — `better-sqlite3` WAL. All tables created via `engine/octragon/db.py::_create_tables()`.

Start blank, then `python scripts/seed-demo.py`.

## Security

- No secrets in repo — use `.env.example` → `.env`.
- Dashboard auth via NextAuth + middleware (allow-list in dev).
- Hub audio mutex prevents acoustic bleed.

