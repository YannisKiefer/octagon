# OCTAGON V2 — Spec

**Goal:** One Mac mini becomes a Grok-simple phone farm. Plug in iPhones, press Start, it posts. Senior dev / YC looks and thinks "wow, that's it? It just works."

**Non-goals:** No outreach DM spam, no Skool/Whop scrapers, no Stripe billing, no Supabase, no "editorial OS" maze. No marketing website. Free, single binary-ish vibe.

**Core merchant outcome (from Warmr copy):**
- Plug in iPhones -> Octagon warms any account (even brand new) from cold to healthy, keeps it healthy, and auto-posts to TikTok + Instagram on schedule. No hand work.
- Proof: last run "18 of 18 posted. You didn't touch it." Visible in one chat log. No guessing.

**Current audit (ponytail reading, 42k LOC source, 221 files):**

```
KEEP (serves core outcome):
- infra/farm/hub.js (393), farm-brain.js (1985) — farm brain is real value but 5x too big
- infra/farm/platform-profiles/* (tiktok 338, instagram 458) — keep but standardize
- infra/farm/stealth-check.js (348), parity-scorer.js (415) — keep idea, simplify algo
- apps/dashboard core: globals.css, layout, lib/db.ts, lib/farmDb.ts, farm page (but not 9 pages)
- engine/octragon/config.py, db.py (1495), models.py — but DB schema 10x bloated
- scripts/seed-demo.py

CUT (YAGNI for core outcome, 70% of code):
- engine/agents/* — 11 scout/DM/outreach files (~7k lines) — Skool/IG/Whop outreach not posting
- engine/octragon/cmo/* (1203+493), caption/engine, video_editor/gemini_analyzer, intelligence/embeddings/viewtrack/crm
- engine/octragon/scraper/* (engine 414, radar 361, discovery, scheduler, scorer, profile_scraper)
- engine/octragon/telegram/bot.py (1031), uploader/*, posting/* cross_platform
- apps/dashboard/pages: cmo (117), queue (140), radar (86+183+64), agents (243), calendar (656), accounts (168+153), analytics (138), billing (245), stripe APIs (4 files)
- lib/scheduler.ts (485), cmo-data, agents-data, supabase, tiers, subscriptions
- infra/supabase/*, infra/farm/engagement/*, posting/* duplicate
- docs/* industrial brutalism docs
Reason: None needed for "warm + keep healthy + post." Speculative need = skip. Say so: skipped.

GAPS (bugs / naive algo / friction):
- Audio mutex: global lock, correct for 4 phones but starves if one hangs (ponytail: global lock, per-slot queue if throughput matters)
- Jitter: randomInt(min,max) uniform, easy to fingerprint. Human gaps are not uniform — should be log-normal + burst
- Parity scorer: ad-hoc ratios, no baseline learning, flags wrong
- Warmup: fixed 30/60m templates, no per-account adaptive schedule based on age/flag
- Error handling: hub restarts 3x then gives up, no log to chat
- DB: 30+ tables, migrations 300+ lines, WAL but no foreign_key repair test, seed creates 28 accounts even for farm-only use
- UI: 9 nav items, pill nav, glass panels — heavy, not Grok-simple. No single truth view.
- Onboarding: voice-action .plist import manual, no one-click check
```

**Ponytail decisions (ladder after tracing flow end-to-end):**

1. **Does DM outreach need to exist?** No. Delete `engine/agents/*`. Keep only `infra/farm/*`. Skipped, add when a paying user proves DM > posting.
2. **CMO intelligence already in codebase?** No reuse — delete, replace with one-line rule: "post = warmup-wrapped + jitter + mutex". AI caption optional via single `GEMINI_API_KEY` flag.
3. **Stdlib for DB?** Keep `better-sqlite3` (already installed) + `sqlite3` (python). No Supabase SDK, no Stripe SDK.
4. **Native for UI?** One page, native CSS grid + `<dialog>`, no new libs. Reuse `globals.css` vars but drop glasshouse bloat.
5. **One line for hub?** Keep `child_process.fork` — already minimal. No Docker, no PM2.
6. **Shortest diff:** 4-table DB `devices, device_health, tasks, events` + single chat page + hub/brain slimmed to ~500 lines total.

**Deliberate simplifications (mark with ponytail:):**
- `# ponytail: global TTS mutex, per-device locks if >8 phones`
- `# ponytail: 4-table DB, split out analytics tables when CMO proves value`
- `# ponytail: log-normal jitter, Bayesian bandit later if ban rate measured`
- `# ponytail: single chat UX, add filters when 50+ tasks/day`

**UX redesign — Grok-for-phone-farms (see reference screenshot):**

Layout: dark #0d1117, 3 panels, monospace + Inter.

```
┌────────────┬──────────────────────────┬──────────────────┐
│  OCTAGON   │  Farm chat (center)      │  Health + Queue  │
│  • Alpha   │  Ralf-style bubbles      │  Routinen        │
│    warmup  │  21:05 US evening: 0 rep │  X morning 08:27 │
│  • Bravo   │  23:02 Last hourly...    │  X hourly 9-20   │
│    idle    │  ...                     │  X midday 13:14  │
│  • Charlie │  [Press Start]           │  ...             │
│  • Delta   │  [Drop video]            │  [+ routine]     │
└────────────┴──────────────────────────┴──────────────────┘
```

Left: phone slots (not Ralf/Rufklar). Center: append-only event log (farm_events) rendered as chat bubbles, plus two CTAs. Right: routines = cron tasks (warmup, posting, parity check) + live health meters. No 9-way nav. One view = whole farm.

Interaction: type "warm alpha for 30m" or press Start — same API `POST /api/farm/tasks`.

Design tokens (reuse): bg #0d1117, surface #161b22, border #30363d, accent #f85149 (red dot as in banner), mono for data, Inter for body. No glass, no pills.

**Algo upgrades (smarter, but simpler code):**

- **Jitter:** `gap = logNormal(μ=1.2s, σ=0.4) + burst(20% chance 2x)`, clamp 0.8–4s. 3 lines, beats uniform.
- **Parity:** score = weighted z-scores vs rolling 24h per device (swipes, like rate, save rate). One query, not heuristic forest.
- **Warmup adaptive:** `duration = base(20m) + age_penalty(new=15m) + health_bonus`. No fixed templates.
- **Self-heal:** hub logs to `farm_events` (level=error) which renders in chat, so operator sees it.

**Tech stack (keep):**
- Next.js 15 (already installed), better-sqlite3 11.x on Node 20, Tailwind 3, Python 3.11, FFmpeg optional.

**Verification (what must still pass):**

- `python scripts/seed-demo.py` → DB with 4 devices, 4 health rows
- `npm run lint` + `npm run build` (dashboard)
- `node infra/farm/hub.js --slots=1 --test` → heartbeat + mutex
- Playwright screenshot `http://localhost:3010/` → new Grok-style page renders in <3s
- `grep -rE "ghp_|sk-|API_KEY" --include="*.ts" --include="*.py" | grep -v ".env.example"` → empty

**Milestones:**

1. Spec + checklist (this doc)
2. Delete YAGNI (one commit, verify build still passes)
3. Shrink DB to 4 tables + migration test
4. Slim farm-brain + hub
5. Replace dashboard with single Grok page
6. New screenshots + polish + autoresearch pass

