# Research: Merge OpenClaw / Hermes into Octagon — Should a Hermes Agent Manage Each Phone?

**Date:** 2026-08-26 · **Heads:** CTO + Senior Dev + Designer · **Mode:** ponytail full + grok 1:1

**Question:** Should we fork OpenClaw, fork Hermes-agent, or keep Octagon's native phone-agents? Is "Hermes manages the phone for p phone farms" worth it?

**Sources:** live web 2026-08-26 — openclaw/openclaw (247k★, MIT), NousResearch/hermes-agent (188k★, MIT), explainx.ai 2026-06-24, innFactory 2026-05-17, pickaxe.co, lushbinary.com, hackernews (Hermes self-improving, OpenClaw gateway), our own Grok screenshots (Ralf, Octagon grok-farm.png), Octagon V2 spec + DB slim (4 tables).

---

## 1. What each project actually is (no hype)

**OpenClaw**
- Creator: Peter Steinberger → OpenClaw Foundation. Origin: Moltbot personal project → v4.0 "Agent OS" (Feb 2026, gateway daemon, canvas, 15+ messaging). 247k★.
- Core: **Gateway with agent inside.** Central gateway daemon routes Telegram/Slack/WhatsApp/Discord (24 channels) → workspace sandboxes → skills (claws). Hub-and-spoke, config-first (SOUL.md), TypeScript.
- Strength: breadth. 5,700+ skills, ClawHub marketplace, 177 templates, 5-min setup, SaaS at openclawai.io. Browser automation via Playwright, Whisper STT, ElevenLabs TTS.
- Cost: SaaS ~managed, self-hosted needs Docker + Gateway + Canvas + skill scans. Reactive security (CVEs CVE-2026-25253 9.1, ClawHavoc supply chain).

**Hermes-agent**
- Creator: Nous Research (teknium1 2,549 commits, 300+ contributors). Repo 2025-07-22, launch 2026-03-12 v0.2.0, 188k★.
- Core: **Learning loop around gateway.** Not just gateway — Curator runs every 15 tool calls + after complex tasks, reflects, writes Markdown skill, loads next run. Agent gets better at YOUR workflows over weeks. Bot Mode: durable team of specialist Bots in group chats via @mentions. Delegates to isolated subagents, `execute_code` collapses pipelines.
- Strength: depth + self-improvement. 6 backends (local/Docker/SSH/Daytona/Modal/Singularity), 20+ channels, Camofox anti-detection browser (v0.7), MCP server + OAuth 2.1, can federate mesh. 400+ models via Nous Portal.
- Cost: No SaaS, self-hosted only, Python, PostgreSQL for memory, learn loop burns tokens (4M tokens / 2h reported). Proactive 7-layer security, no CVEs as of May 2026.

**TL;DR architecture split (load-bearing):**
- OpenClaw = gateway-first (connect everything)
- Hermes = learning-loop-first (improve over time)
- Octagon now = **phone-first, chat-first, 4 tables, one page** — neither gateway nor loop, just farm.

---

## 2. How each would plug into Octagon's "phone = agent, chat with it"

**Current Octagon (after ponytail, before merge):**
- `infra/farm/hub.js` (80 lines, stagger 3s, 5s heartbeat, global `say` lock)
- `farm-brain.js` (110 lines, logNormal jitter, warmup loop, writes `farm_events`)
- DB: `farm_devices`, `farm_device_health`, `farm_tasks`, `farm_events` (plus `niche_config`)
- UI: one dark page `/` — left phones-as-agents, center chat (farm_events per phone), right Routinen — click Alpha → `Nachricht an Alpha`, `Bildschirm von Alpha`. Pure Voice Control (`say "Alpha Swipe Next"`), no vision.

**If Hermes manages each phone:**
- Each phone = a Hermes Bot in Bot Mode. You get a Telegram group with Alpha, Bravo, Charlie, Delta bots. You @Alpha "warm 30m", it wakes, uses its tools (shell → `say`, or computer-use → screenshot + click via Camofox) to warm, logs to its own `MEMORY.md`, Curator writes a skill `warmup-alpha.md` that improves next time.
- Hermes learning loop would capture what we currently hardcode: jitter 0.35, burst 20% → after 2 weeks Curator might learn "Alpha likes 28% on Tuesdays, save less" and write it as skill.
- But Hermes expects PostgreSQL + gateway + 15-call Curator cycle. For 4 phones, that's 4 gateways or 1 gateway with 4 Bots. Overhead: Python venv, Docker or local, Nous Portal LLM, token burn for every swipe decision (LLM call per tap vs our cheap `Math.random`).

**If OpenClaw manages each phone:**
- Each phone = an OpenClaw agent (SOUL.md per phone). Gateway routes `/farm` chat to correct agent. Skills: `computer-use` (mouse/keyboard/screenshots via `cua`), `openclaw-computer-use` skill. You'd get 24-channel reach (Telegram, Slack) for free, ClawHub skills, but no learning loop — skills stay static unless you update.
- OpenClaw is TypeScript, matches Octagon dashboard stack, but brings gateway daemon, canvas, skill scanner, 5,700 skills — massive bloat for 4 phones. We just deleted 15k lines to hit 8k; OpenClaw would add back 100k+.

---

## 3. Tradeoffs — ponytail lens (shortest diff that actually works)

| Dimension | Keep native Octagon agents (now) | Fork Hermes for each phone | Fork OpenClaw for each phone |
|---|---|---|---|
| **Lines to own** | hub 80 + brain 110 + DB 80 + page 200 = ~500 | + hermes-agent clone (~50k+ Python, 6 backends, Curator) | + openclaw clone (TS gateway + canvas + 5k skills) |
| **Phone control** | `say` + Voice Control (1 lock, proven) | `say` OR Camofox click (2 paths, more fragile) | Playwright/CUA click (needs vision model per tap) |
| **Smarts** | logNormal + z-score (3 lines, good enough) | Curator learns per-phone patterns over weeks (real smart, but needs 2 weeks data) | No learning, static skills |
| **Chat UX** | already Grok 1:1, per-phone — matches Hermes Bot Mode visually | would get @mentions in Telegram for free | would get 24 channels for free |
| **Cost/run** | ~$0 (Math.random) | $0.02–0.10 per LLM decision × 4 phones × 60 min = $5–20/day if LLM per tap | similar, plus ClawHub scan |
| **Security** | 7 lines, global lock, .env only | Hermes 7 layers, but needs PG + gateway perms, DM pairing | OpenClaw CVE history, ClawHavoc |
| **Time to wow** | 10 min clone + `npm run dev` | `setup-hermes.sh` + Bot Mode + skill writing — 2h first, then learning | gateway + SOUL.md + skill install — 30min |
| **Who it wows** | YC / senior dev: "oh, 500 lines, I get it" | YC / researcher: "oh, it learns, but show me proof" | YC / integrator: "oh, it connects to everything, but why phones?" |

**Ponytail verdict:** The core outcome is "plug in phones, it posts, stays healthy." That outcome does NOT require a learning loop (Hermes) or a gateway (OpenClaw) to prove. Those are speculative need until a farm runs 30 days and proves uniform jitter fails.

We just deleted 34k lines to go from 42k → 8k and made it *more* believable to YC. Merging a 50k framework now would undo that in one PR.

---

## 4. What WOULD make sense (elite, not bloat)

**Keep Octagon native as default.** Ship it as is: grok chat, 4 tables, voice control. That's the YC wow.

**Make it pluggable, not merged.** One interface:

```ts
// lib/farmBrain.ts — ponytail: one interface, one call site
export type Brain = { warm(slot: number, minutes: number): Promise<void> }
export const voiceBrain: Brain = { warm: (n,m)=> fork(`farm-brain.js --slot=${n}`) }
export const hermesBrain: Brain = { warm: (n,m)=> spawn(`hermes --bot phone${n} "warm ${m}m"`) } // optional
```

- Default = `voiceBrain` (free, no LLM).
- If user sets `FARM_BRAIN=hermes` and has `hermes` installed, hub spawns Hermes Bot instead. Same DB, same chat UI, same Routinen.
- Same for OpenClaw: `FARM_BRAIN=openclaw` → `openclaw skill run computer-use --slot`.

No fork, no merge, no owning their repo. Just a 10-line adapter. Power users who already run Hermes/OpenClaw can swap; everyone else gets the simple path.

**Why not fork?**
- Forking Hermes means owning its release cadence (6 releases in 50 days), its PostgreSQL, its 300+ contributors, its token burn. You become a Hermes maintainer, not a farm maintainer.
- Forking OpenClaw means owning gateway CVEs, ClawHub scans, TypeScript gateway upgrades. You become gateway ops.
- Octagon's moat is *not* being a generic agent framework. It's being the dumbest phone farm that actually posts. Forking a generic framework dilutes that.

**When WOULD we fork?**
- If after 1k farms we measure: warmup vs human parity fails with logNormal alone (ban rate >5%), and Curator-learned skills cut bans by 50% with p<0.05, then fork Hermes' Curator as a standalone `curator.js` (200 lines, not 50k). Add when measured.
- If we need vision fallback for Android (Voice Control is iOS only), then borrow OpenClaw's `computer-use` *skill* (one file, not whole gateway). Add when a user proves they need Android.

---

## 5. Recommendation — lock it in

**Don't merge, don't fork full repos. Keep Octagon native, make it chat-first, keep the door open.**

**Lock:**
- Octagon stays Grok 1:1, per-phone agents (what we just built: left Alpha/Bravo, center chat, right Routinen, Bildschirm von Alpha) — that's the Hermes/OpenClaw mental model but without their bloat.
- Ship with `voiceBrain` default. Document `FARM_BRAIN=hermes` as "bring your own Hermes Bot" in `docs/ARCHITECTURE.md` (10 lines, not a fork).
- Show YC the before/after: 42k → 8k, 9 pages → 1 chat, uniform → logNormal, guide the story: "We deleted 34k lines, kept one lock, made each phone an agent you talk to."

**If you still want a demo of Hermes managing a phone:** spin up one Hermes Bot in a worktree (`/Volumes/EcomBrain/EcomBrain-Worktrees/…/hermes-phone1`), point it at `farm-brain.js` as a tool, run for 3 days parallel to native, compare ban rate. Don't block the Octagon release on it.

**Next moves (checklist):**
- [ ] Push Grok per-phone page + 3 screenshots (grok-farm/brav0/charlie) — already done, needs commit
- [ ] Add 10-line adapter comment in `hub.js`: `// ponytail: swap brain here if FARM_BRAIN=hermes`
- [ ] Keep `docs/GROK-RESEARCH.md` (research) + this doc as lock
- [ ] No fork. Tag `octagon-v2-grok` and ship.

**Heads sign-off:** CTO (simplicity wins), Dev (less code to own), Designer (Grok 1:1 already wow).
