# Octagon V2 — Checklist

**Heads worn:** CTO (outcome + tradeoffs), Senior Dev (elite code), Designer (Grok-simple), QA (proof), Security (secrets)

## Phase 1 — Delete (ponytail: YAGNI)
- [ ] `engine/agents/**` — 11 files, ~7k lines (ig/*, skool/*, telegram/*)
- [ ] `engine/octragon/cmo/**`, `caption/**`, `video_editor/**`, `intelligence/**`, `scraper/**`, `posting/cross_platform`, `telegram/bot.py`, `uploader/**`
- [ ] `apps/dashboard/app/(dashboard)/cmo`, `queue`, `radar`, `agents`, `calendar`, `accounts`, `analytics`, `settings/billing` + their `app/api/cmo`, `radar`, `agents/*`, `schedule`, `scheduler`, `stripe/*`, `search`, `sessions`, `cmo`
- [ ] `apps/dashboard/lib/scheduler.ts` (485), `cmo-data`, `agents-data`, `supabase*`, `tiers`, `subscriptions`
- [ ] `infra/supabase/**`, `infra/farm/engagement/**`, `docs/*` except ARCHITECTURE/V2 spec
- [ ] Keep: `config.py`, `db.py` (trimmed), `models.py` (trimmed), `infra/farm/hub.js` + `farm-brain.js` + `platform-profiles/*` + `audit/*` + `posting/voice-post-flow.js`
- [ ] Verify: `npm run build` + `python -m py_compile engine/octragon/*.py` + `grep secrets` empty

## Phase 2 — DB slim (4 tables)
- [ ] New schema: `farm_devices`, `farm_device_health`, `farm_tasks`, `farm_events` (drop rest)
- [ ] `engine/octragon/db.py`: delete `_create_tables` 300 lines, replace with 4 `CREATE TABLE`, drop migrations, keep `farm.db` WAL, `_seed_farm_devices`
- [ ] `engine/octragon/models.py`: keep `DeviceProfile`, `NicheConfig` minimal, drop ViralDNA, ledger etc.
- [ ] `scripts/seed-demo.py`: update to new 4-table seed
- [ ] `apps/dashboard/lib/db.ts` + `farmDb.ts`: point only to 4 tables, delete Cmo/Radar queries
- [ ] Test: `python scripts/seed-demo.py && sqlite3 infra/db/farm.db "SELECT name FROM sqlite_master WHERE type='table';"` → 4 rows

## Phase 3 — Farm brain elite rewrite
- [ ] `farm-brain.js` 1985 → ~400 lines
  - [ ] Delete duplicate engagement queues, keep single action queue
  - [ ] New jitter: `logNormal` 3 lines (ponytail: global mutex, burst)
  - [ ] Parity: rolling z-score 1 query, delete heuristic forest
  - [ ] TTS: keep `say` + mutex, delete afplay branching
  - [ ] Self-heal: log to `farm_events` so chat shows it
  - [ ] `smoke-test.js` + `stealth-check.js` simplified, keep parity scorer slim
- [ ] `hub.js` 393 → ~200 lines
  - [ ] Keep: fork N, 3-5s stagger, 5s heartbeat, 3 restarts, audio mutex
  - [ ] Delete: battery monitor 30s query (keep simple idle check), chalk rainbow, extra stats
  - [ ] Verify: `node infra/farm/hub.js --slots=1 --test` passes
- [ ] `platform-profiles/*`: dedupe tiktok/instagram into single `profiles.js` with timing map

## Phase 4 — Grok UX (extremely simple)
- [ ] Delete 9-page layout `app/(dashboard)/**` except `layout.tsx` + new `app/(dashboard)/page.tsx` (single)
- [ ] New single page: 3 panels (left phones, center chat log, right routines) dark #0d1117, mono, as spec wireframe
- [ ] Wire to `farm_events` + `farm_tasks` + `farm_device_health` (read-only + POST task)
- [ ] Components: delete `OperationsSidebar`, `TopNavBar`, `cmo/*`, keep 1 `ChatBubble.tsx` + 1 `PhoneSlot.tsx`
- [ ] `app/globals.css`: keep tokens, delete glasshouse 80 rules, add chat bubble styles
- [ ] Verify: `npm run build`, Playwright screenshot <3s, senior dev wow check

## Phase 5 — Polish + proof
- [ ] Banner already `octagon` hand design — keep
- [ ] New screenshots: `groq-farm.png` full chat, `health.png` right panel detail (Playwright on localhost:3010)
- [ ] Update `README.md` already dumbed down — ensure it mentions single-page Grok concept + algo upgrades (ponytail: logNormal)
- [ ] `infra/farm/SETUP-GUIDE.md`: shrink to 10 lines (plug, trust, say test, hub start)
- [ ] `npm run lint`, `git log --oneline`, `grep secrets` empty, push to `YannisKiefer/octagon`

## Phase 6 — Autoresearch (Andrej Karpathy ratchet)
- [ ] `autoresearch` skill: broad + narrow runs, find gaps/bugs, delete duplicate guards, simplify again
- [ ] On each run: record bias_correction, update playbook, open questions for next run
- [ ] Re-render design image from updated code (Figma or SVG) for YC wow
- [ ] Final gate: `python3 scripts/check-overnight-goal.py` equivalent + browse proof

## Gates
- Gate A: delete commit must still `npm run build` + `python py_compile`
- Gate B: DB 4-table must seed and serve dashboard
- Gate C: hub test must heartbeat
- Gate D: single page must screenshot without 9 nav items
- Gate E: YC wow — 5-second rule: stranger sees banner + first 3 lines and gets "plug in phones, it posts"

