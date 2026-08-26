# Octagon Crockbot — Locked Architecture

**Vision (user):** Don't talk on Telegram. Reuse Hermes/OpenClaw agent infra. Redesign front end exactly like Crockbot (Ralf screenshot) — left WhatsApp-like crocs/messages, center chat with that agent, right computer/phone preview you can click to see what the agent sees. Hermes/OpenClaw has full access to the phone, so chat is smart.

**Decision — pick Hermes:** 

We will use **Hermes-agent** as the agent runtime, not OpenClaw, not computer-use vision.

Why Hermes, ponytail-style:
- One ladder rung: Does Hermes already have "phone = Bot" ? Yes — **Bot Mode**. You define 4 durable Bots (Alpha, Bravo, Charlie, Delta) that live in one group, you @Alpha. That's croc list for free. OpenClaw has no native Bot Mode, you'd build it.
- Keep Octagon's hands: Hermes Bots are Python (like Octagon engine), they call Octagon's tools via MCP. No need to fork Hermes, just add an MCP server. OpenClaw is TS gateway + 5.7k skills + CVE history — reintroduces the 34k we just deleted.
- Learning loop is bonus, not required: Hermes Curator will later learn per-phone warmup (Alpha likes Tue 8:27) and write a skill. For now it just calls `warm_phone`. Ponytail: add learning when ban rate proves need.
- Self-hosted, MIT, 6 backends (local/Docker/SSH/Daytona/Modal). You run Hermes on your Mac next to Octagon hub — same machine, no SaaS.

OpenClaw stays as documented alternative. Swap is one config line if needed.

**What we reuse vs build:**

Reuse (don't build):
- Hermes gateway + Bot Mode + memory + cron + MCP client — handles chat, @mentions, history, auth.
- Hermes skills hub (agentskills.io) — no custom agent infra.

Build (minimal, connect):
- Octagon MCP server `mcp/server.js` — 5 tools, 80 lines, reuses `lib/farmDb` (same DB). Hermes calls it.
- Front end — exact Crockbot clone (Ralf screenshot) — left phones-as-crocs, center chat per phone, right Bildschirm von Phone + Routinen. Click phone preview → full phone screen modal.
- App upgrade — expose phone screen/state to Hermes via MCP resource `phone_screen` (base64 screenshot from `idevicescreenshot` or mock). Hermes gets full context, so chat is smart: "Alpha is warm, jitter 0.34, last swipe 2s ago, screen shows For You".

**How it connects (smart, not computer-use):**

```
[Your browser] ──HTTP──> [Octagon Next.js Crockbot UI] ──fetch──> [Octagon DB + hub]
      │
      └─(user types "warm bravo 30m")─> [Hermes Gateway] ──MCP stdio──> [mcp/server.js] ──calls──> [farm_tasks INSERT + hub spawn]
                                                        └─reads──> [farm_events + phone_screen + health] ──> reply bubble
```

No vision click. No screenshot → LLM → x,y. Hermes just calls your already-built `warm_phone` tool. One Mac speaks (`say "Bravo Swipe Next"`), phone listens. Hermes has full context because MCP gives it `get_phone`, `get_events`, `get_screen`.

**Front end — 1:1 Crockbot (what we already built, now per-phone):**

- Left 280px: search "Suchen", list of 4 crocs (Alpha/Bravo/Charlie/Delta) like Ralf/Rufklar, dot green/blue/grey, preview "warmed 3421 swipes", time Gestern/Samstag. Click = setSel(phone). Selected = #161b22 border. Bottom Plugins/Yannis → Health/Parity.
- Center: header with phone avatar (A/B/C/D) + phone1 · 863... + state, bubbles (farm_events filtered by device_id), timestamps Gestern 21:05. Bottom input "Nachricht an Alpha" + mic, hint "Chat with Alpha — like OpenClaw agent. Say 'warm alpha 30m' or drop video."
- Right 360px: "Bildschirm von Alpha" card — live health (swipes, jitter) + spinner, click → modal full phone screen (image from `phone_screen` resource). Below "Routinen" with green clock icons: Warmup sweep, Auto-post, Parity check, Nightly learn (per phone). Click + to add routine.

Already implemented in `apps/dashboard/app/page.tsx` (client, useState sel). Needs one upgrade: make Bildschirm card clickable → modal, and wire input to Hermes (for now alert, later fetch to Hermes).

**App upgrades needed (minimal, ponytail):**

1. `mcp/server.js` — implement 5 tools: list_phones, get_phone(id), warm_phone, get_events, get_phone_screen. Reuse `better-sqlite3` + `farm.db`. ~80 lines.
2. Phone screen — for v1, return mock base64 (1px or demo TikTok screenshot) via `idevicescreenshot -u <UDID>` if USB, else placeholder. Hermes reads it as resource.
3. Hub/brain — already ponytail'd (logNormal jitter, 4 tables, global lock). Add one line in `hub.js`: `// ponytail: FARM_BRAIN=hermes → spawn hermes bot instead` — keep default voice.
4. Front end — make Bildschirm clickable (already, just add onClick modal). That's the "few simple minimalistic things in the app where it's just like croc bot".

**What we delete to stay simple:**

- No 9-page dashboard (already deleted). One page at `/`.
- No computer-use vision (no Playwright per tap).
- No forking Hermes/OpenClaw repo — just MCP config.

**For YC wow:**

Show: left 4 crocs, click Charlie (idle) → center "Tap Start to wake Charlie", right "Bildschirm von Charlie — idle, 452 swipes", click screen → full phone view. Say "warm charlie 30m" → bubble "Warmup sweep Charlie: 3421 swipes" appears. That's it. 500 lines + one MCP file, not 42k.

**Next:**
1. Add clickable Bildschirm modal to `app/page.tsx` (10 lines).
2. Ship `mcp/server.js` (80 lines) + `docs/HERMES-SETUP.md` (MCP JSON).
3. New screenshot: click Charlie's Bildschirm → modal.
4. Tag `octagon-v3-crockbot`.
