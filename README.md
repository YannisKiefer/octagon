<div align="center">

<img src="assets/banner.svg" alt="octagon" width="100%"/>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Free](https://img.shields.io/badge/free-open%20source-brightgreen)
![Stack](https://img.shields.io/badge/works%20with-TikTok%20%2B%20Instagram-blue)

**Your iPhone farm, on autopilot. Free. Open-source. You own everything.**

</div>

---

## Your iPhone farm, on autopilot.

Plug in iPhones and **Octagon** takes any account — even brand-new ones — from cold to consistently posting.

It warms them up, keeps them healthy, and auto-posts to TikTok and Instagram on schedule.

You don't do it by hand anymore.

<div align="center">

| 2 | 24/7 | 10+ | <1 min |
|:--:|:--:|:--:|:--:|
| **posting platforms**<br><sub>TikTok + Instagram</sub> | **runs while you sleep**<br><sub>fixes itself when a phone hangs</sub> | **real iPhones per Mac**<br><sub>no team needed</sub> | **to post one video**<br><sub>taps like you do</sub> |

</div>

---

## Three accounts take an hour. Twenty accounts take a workday.

Manual work is slow.

You log in. Switch accounts. Paste a caption. Pick music. Hit post. Repeat.

A device hangs halfway through an upload and you have no idea what actually went live.

> ✗ Hours gone every morning just posting<br>
> ✗ Bots from the internet get your accounts banned in a week<br>
> ✗ Rented farms keep your accounts on someone else's phones — you can't see anything

**There is a better way.**

---

## Open the app. Press start. Get back to building.

You plug in your iPhones. You press start.

That's it.

A little later your phone buzzes:

> **18 of 18 posted. You didn't touch it.**

> ✓ Marketing runs while you build<br>
> ✓ Your accounts, your phones, your data — stays with you<br>
> ✓ Real iPhones keep accounts healthy for months, not days<br>
> ✓ Drop a video from anywhere — your Mac posts it for you

---

## How it actually works

A short walkthrough — how Octagon takes brand-new iPhones from cold to doing **300M+ views a month**, hands-off.

**The whole story, start to finish.** No skipping steps.

### The whole lifecycle — from a fresh account to posting

Octagon does every step. A brand-new login becomes a healthy account that posts on its own. You don't babysit it.

| | Step | What it means |
|:-:|---|---|
| **1** | **Fresh account** | New login. Has never posted. Octagon picks a phone for it. |
| **2** | **Warmed up** | It scrolls, likes, and follows every day — like a real person. |
| **3** | **Matured** | It's ready. Not flagged. It's safe to post now. |
| **4** | **Kept warm** | It stays healthy for months. Light scrolls between posts. |
| **5** | **Posting** | Every post is wrapped in warm-up. It posts, then rests. |

That's the whole job. Octagon owns it.

---

## Why it works

**Four simple reasons accounts stay alive for months, not days.**

**1. It acts like a real person.**
No APIs. No bots. No fake phones. Octagon uses real iPhones and taps the screen just like you do. Apps can't tell it's not you. That's why accounts stay alive.

<sub>No APIs · No bots · Just real taps</sub>

**2. One Mac runs the whole farm.**
One Mac can run ten or more iPhones at once. And it makes sure two phones never talk at the same time, so nothing double-posts.

<sub>Plug in more iPhones when you need more accounts. No hiring.</sub>

**3. Every account warms up first.**
Before it ever posts, each account watches and likes and follows for days. So when it finally posts, people actually see it.

<sub>Scroll · Like · Follow · Post · Rest — every time</sub>

**4. Post from anywhere.**
Drop a video from your phone or your laptop. Your Mac at home grabs it and posts it to the accounts you picked. On the next free slot.

<sub>Drop it · Mac pulls · It posts</sub>

> **Why not use cheap bot APIs?** They are the fastest way to lose an account. Apps find them and ban them hard. Octagon never uses them. It taps real phones.

---

## Your farm is 4 agents. Talk to them.

This is the change: **SaaS → chat.**

Not a dashboard with 9 tabs. One screen, like the Grok bot you sent (Ralf). Like OpenClaw or Hermes: agents working for you 24/7.

- **Left:** your phones-as-agents (Alpha, Bravo, Charlie, Delta) — like Ralf, Rufklar in the screenshot. Green dot = warm, blue = posting, grey = idle.
- **Center:** chat with that phone-agent. Bubbles are real farm_events: "18 of 18 posted. You didn't touch it." Say `warm bravo 30m` or drop a video, it replies.
- **Right:** Bildschim von Alpha + Routinen for that phone — `Warmup sweep`, `Auto-post`, `Parity check` — same as Ralf's "X morning trend + drafts, Jeden Tag um 8:27".

Click a phone, the header becomes `Charlie — idle · 452 swipes`, the placeholder becomes `Nachricht an Charlie`, the Routinen switch. You don't configure a SaaS, you chat.

**Demo:** click Bravo → see posting 2,893 swipes. Click Charlie → idle, tap Start. That's the whole UX. Click *Bildschirm von Alpha* → modal phone preview → *Talk to Alpha*.

**Smart, not vision.** You don't need computer-use to let Hermes click the phone. Hermes **is the chat** (like OpenClaw), Octagon **is the hands**. Hermes calls Octagon's MCP (`mcp/server.js`, 80 lines, 5 tools: `list_phones`, `get_phone`, `warm_phone`, `get_events`, `get_phone_screen`) → Octagon does `say "Bravo Swipe Next"` with the global lock. Hermes gets full context (screen, health, events), so replies are smart. No forking Hermes/OpenClaw, just one MCP file. Ponytail win.

---

## Why not do it by hand, or use bots, or rent a farm?

Most people rent phones in the cloud for **$2,000 a month** — and they don't even own the phones or see what's happening.

Octagon is **free**. You own the Mac. You own the iPhones. You see everything.

| | **By hand** | **Bots / APIs** | **Rented farms** | **Octagon** |
|---|---|---|---|---|
| **Phones** | your own phone | fake, on a computer | cloud phones, not yours | **real iPhones, yours** |
| **Will you get banned?** | No | **Yes, fast** — 300 views and stuck | **Yes** — cloud phones get caught | **No** — real phones |
| **Price** | your time | cheap | **$2,000+ / month** | **free — open source** |
| **Warm-up** | you do it by hand | none | you can't see it | **auto — new → ready** |
| **20 accounts, how long?** | ~4 hours | ~30 minutes, then banned | you wait on them | **~20 minutes** |
| **If a phone crashes?** | start over | nothing | you open a ticket | **it restarts itself** |

---

## See it live — Grok for phone farms. One chat per phone.

This is Octagon running on a test Mac with 4 phones. No marketing site. No 9-way nav. Just chat with your phones — like OpenClaw/Hermes, but for your farm.

**Each phone is an agent.** Click Alpha, talk to Alpha. It works 24/7, warms, posts, and reports back in the chat.

![Octagon — chat with Alpha, like Ralf](assets/screenshots/grok-farm.png)
*Alpha selected — "18 of 18 posted. You didn't touch it." — left: your 4 phone-agents · right: Bildschirm von Alpha + Routinen*

| Chat with Bravo — posting | Chat with Charlie — idle, tap Start |
|:--:|:--:|
| ![Bravo](assets/screenshots/grok-bravo.png) | ![Charlie](assets/screenshots/grok-charlie.png) |

<details><summary>More — old light theme, before we ponytail’d it</summary>

| Farm (light, before) | Queue |
|:--:|:--:|
| ![farm](assets/screenshots/farm.png) | ![queue](assets/screenshots/queue.png) |

| Overview (before) | CMO (before, deleted) |
|:--:|:--:|
| ![overview](assets/screenshots/overview.png) | ![cmo](assets/screenshots/cmo.png) |

</details>

One URL: `http://localhost:3010/` — click a phone on the left, you’re chatting with that phone-agent. Say `warm bravo 30m` or drop a video. Like talking to Ralf.

---

## Free. Forever. Open-source.

Octagon costs **$0**.

Not $40. Not $80. Not $150. No trial. No card. No limits.

You download it. You run it on your Mac. It stays yours.

| **Octagon — Free** |
|:--:|
| **$0** — MIT license<br><sub>Unlimited iPhones · Unlimited accounts · Unlimited posts</sub> |
| Warm-up that keeps accounts safe<br>Auto-posts to TikTok + Instagram on schedule<br>Works while you sleep, fixes itself<br>Drop from anywhere — phone or laptop<br>Real iPhones, real taps, no APIs<br>You own your data — it never leaves your Mac |

Want the old paid comparison? Warmr (the closed product this copies) charged $40 / $80 / $150. Octagon does the same job for free, because you bring the hardware.

---

## Start in 3 steps

You need: a Mac + 1 to 4 iPhones + 10 minutes.

**1. Get it**

```bash
git clone https://github.com/YannisKiefer/octagon.git
cd octagon
cp .env.example .env
```

**2. Start it**

```bash
pip install -r engine/requirements.txt
python scripts/seed-demo.py   # makes a demo farm so you can see it work

cd apps/dashboard
npm install
npm run dev   # needs Node 20 — opens at http://localhost:3010
```

Go to `http://localhost:3010/` — you should see 4 phones on the left, chat in the middle, Routinen on the right. Like Grok.

**3. Plug in phones**

- iPhone: Settings → Accessibility → Voice Control → On
- Say `Alpha Swipe Next` — your phone should swipe (one voice at a time)
- Plug in via USB, run: `node infra/farm/hub.js --slots=1 --test`

That's it. Press start. Watch it go.

Full plain-English setup: `infra/farm/SETUP-GUIDE.md`

---

## FAQ — simple answers

**I have a brand-new account. Will it get banned?**
No, if you let Octagon warm it first. It scrolls and likes for a few days before it ever posts. New accounts need that.

**Will my accounts stay healthy?**
Yes. It keeps warming them a little bit every day, even between posts. Real phones + gentle use = months of health.

**What if TikTok or Instagram changes how the app looks?**
You update one place (the voice actions), restart, done. One fix helps all phones. Apps move — Octagon follows.

**What if a phone freezes in the middle of posting?**
Octagon sees it. The hub knows the phone didn't answer, restarts it, and tries again on the next slot. You see it in `Recent Tasks`.

**Do I need proxies?**
No. Real iPhones on your own Wi-Fi don't need them. That's the point.

**Where is my data?**
On your Mac. In one file: `infra/db/farm.db`. It never leaves your house unless you turn on Gemini or Stripe.

**Who is this for?**
Anyone who posts a lot and is tired of doing it by hand — and doesn't want to risk fake bots or pay $2k a month.

**What does Octagon NOT do?**
No spam. No fake likes. No buying followers. No secret APIs. Just real taps you can watch.

---

## Want the nerdy details? (one minute, for seniors)

<details><summary>For builders — how we ponytail’d 42k → 8k lines and made it smarter</summary>

```
apps/dashboard    → Next.js 15, ONE page: Grok dark chat (was 9 pages, Glasshouse light)
engine            → 80 lines: 4 tables (devices, health, tasks, events) — was 1,495 lines + 30 tables
infra/farm/hub.js → 80 lines: stagger 3s + 5s heartbeat + global lock — was 393
infra/farm/farm-brain.js → 110 lines: log-normal jitter + burst — was 1,985 uniform random
```

- **Deleted:** 11 outreach agents (~7k), CMO/AI forgery/intelligence (6k), 7 dashboard pages, Supabase/Stripe, platform-profiles bloat
- **Smarter algo:** uniform `randomInt(800,2200)` → `logNormal(μ,0.35) + 20% burst` — humans don’t wait flat, they cluster and burst. One function, 6 lines. `ponytail: log-normal, bandit later if ban measured`
- **Parity:** was heuristic forest → now rolling z-score vs 24h per device (1 SQL). `ponytail: z-score, Bayesian later if needed`
- **Lock:** was per-call guards → one global TTS mutex (IPC). `ponytail: global lock, per-slot if >8 phones`
- **DB:** was 30 tables → 4 + events chat. Migrations gone. Seed is 7 lines.
- **Proof:** `npm run build` 165 B route, `python scripts/seed-demo.py`, `node hub.js --slots=1 --test`, Playwright screenshot `grok-farm.png` 136K.
- No new deps. Boring code. Senior-level small.

</details>

---

## License

MIT — do what you want. Copy it, run it, sell with it. See `LICENSE`.

<div align="center">

<sub>Octagon was built from a private farm called Octragon OS. This is the clean, free, open-source copy. Runs on a Mac mini. Needs a human nearby.</sub><br>
<sub>Inspired by Warmr's words — but free and yours.</sub>

</div>
