# Grok Research — locked 1:1 for Octagon

**Source:** user Ralf screenshot + `https://grok.com` live capture (47K home) + OpenClaw/Hermes mental model

**Ralf screenshot anatomy (the target):**
- Window: macOS traffic lights (red/yellow/green), dark #000, 3 cols
- Left 280px: search "Suchen", list of agents/chats (Ralf X-Marketing, Rufklar PR #9, E-Mail, Finance). Selected = #161b22, border #30363d, dot + preview + time Gestern/Samstag. Bottom: Plugins, Yannis Kiefer.
- Center: header with agent avatar + name Ralf + ID 863180542284 + time Gestern 21:05. Message bubbles: dark #21262d, rounded-2xl, max-w 720, timestamps above (Gestern 21:05), links blue. Bottom input: rounded-full, "+" left, "Nachricht an Ralf" placeholder, mic right. Status line "Aktualisiert: Routinen ... und ... US-ev..."
- Right 360px: "Bildschirm von Ralf" (phone screen placeholder, dark rounded-xl with spinner), "Routinen" list with green clock icons, title + schedule (Jeden Tag um 8:27), "+" to add. 5 routines: X morning trend, X hourly human post, X midday hijack, X US-evening reply wave, X SkillOpt sleep.

**Grok.com home (captured 2026-08-26):** marketing landing, not chat — confirms Grok brand is dark, minimal, monospace accents. Chat itself lives at x.com/i/grok or grok.com/chat (auth-gated, not needed).

**OpenClaw / Hermes model (user description):**
- Agents working for you 24/7, like phone = agent. You chat with agent, it does work in background, reports back.
- SaaS → chat interface: you don't configure dashboards, you talk. "Warm Alpha for 30m" → agent replies "322 swipes, healthy, next post at 20:27"

**Octagon translation — locked:**
- Each phone = agent. Left list = Alpha, Bravo, Charlie, Delta (like Ralf, Rufklar). Click = chat with that phone-agent.
- Center = chat with selected phone-agent. Bubbles are farm_events filtered by device_id. Input "Nachricht an Alpha" sends task (warmup/post/audit) via POST /api/farm/tasks or /api/trigger. Agent replies as bubble when done.
- Right = Bildschirm von Alpha (live health card + jitter) + Routinen for that phone (warmup sweep, auto-post, parity check, nightly learn) — same as Ralf's Routinen but per phone.
- Top bar = agent name + phone ID + Gestern time. No 9-page nav. One screen.
- Data: farm_devices + farm_device_health + farm_events (chat) + farm_tasks (routinen). All 4 tables. No glasshouse, no CMO tables.
- Interaction: select phone → center filters, right routinen filters, input placeholder updates. Press Start farm = warmup task for selected phone.

**Why this is Grok 1:1:**
- 3-panel dark #0d1117, monospace IDs, Gestern timestamps, rounded bubbles, input with +/mic, Routinen with green clocks, Bildschirm placeholder.
- Phone = agent metaphor makes farm feel like hiring 4 workers who work 24/7, you just chat.

**What we cloned smartly:**
- Kept Ralf's search, Plugins/Yannis footer, time language (Gestern/Samstag), "Aktualisiert: Routine" status line
- Swapped X-marketing routines → Warmup sweep / Auto-post / Parity check / Nightly learn
- Swapped "Bildschirm von Ralf" → "Bildschirm von Alpha" (phone preview)

**Next:** implement per-phone client state, new screenshot, update README hero to show Grok chat.
