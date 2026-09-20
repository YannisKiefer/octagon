# Contributing to Octagon

Octagon is a local-first console for automating iPhones you own over iOS Voice Control. Your Mac speaks cues like "Alpha Swipe Next" and the phone executes them. Today that means pacing sessions, device health, and an honest event log. The direction is bigger: see [VISION.md](VISION.md) - one conversation, many agents, many phones. The product deliberately has no features that fake engagement. Helping improve that is welcome. Breaking it is not.

## Dev setup

You need Node 20 or newer. Hardware features need macOS, but the dry-run path works anywhere.

1. Clone and enter the repo:

   ```bash
   git clone https://github.com/YannisKiefer/octagon.git && cd octagon
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Install dependencies. There are two packages, both need it (`better-sqlite3` is a native module, so the first install compiles):

   ```bash
   npm install --prefix infra/farm
   npm install --prefix apps/dashboard
   ```

4. Seed the database with synthetic demo data (this resets `infra/db/farm.db`; everything it writes is fake):

   ```bash
   node scripts/seed-demo.js
   ```

5. Start the dashboard:

   ```bash
   npm run dev --prefix apps/dashboard
   ```

   Open http://localhost:3010. The dashboard also ships `apps/dashboard/.env.example` if you want to change the default login credentials.

6. Run the checks:

   ```bash
   node tests/test_octagon.mjs
   ```

## What PRs should serve

Good directions for this project:

- **Honest automation.** Make pacing sessions more accurate, safer, and better reported. The product should never pretend a phone did something it did not do.
- **Health and observability.** Device health, session metrics, event history, clearer views of what the farm is doing.
- **MCP depth.** The tools in `mcp/server.js` are the surface other agents use. More of that, done well, is valuable.
- **Docs.** Setup guides, architecture notes, troubleshooting. If a step confused you, the next reader will be confused too.

## Non-negotiable rules

These are product rules, not preferences. They follow principles 2 and 6 of [VISION.md](VISION.md). A PR that adds any of the following will be declined:

- No features that fake engagement: no auto likes, comments, follows, or DMs.
- No functionality designed to evade platform moderation.
- No cloud calls. Everything runs on your Mac and nothing leaves it.
- No unofficial APIs. The product talks to iPhones over Voice Control, not private endpoints.
- Nothing that presents simulated behavior as real. Demo data stays clearly labeled as synthetic.

## PR expectations

- Keep PRs small. One feature per PR.
- `npm run build` in `apps/dashboard` and `node tests/test_octagon.mjs` from the repo root must pass. Include the output in the PR description.
- Update the docs (README, `docs/ARCHITECTURE.md`, or the setup guides) when a change affects behavior.
- UI strings are English only.
- New dependencies need a justification in the PR description.

## Where to discuss

GitHub Issues is the channel: https://github.com/YannisKiefer/octagon/issues. Use it for questions, proposals, and bug reports. Security issues go through the process in [SECURITY.md](SECURITY.md) instead of a public issue. There is no chat server; if you see one mentioned somewhere, it is not ours.

## macOS and CI

The hardware path (spoken cues, USB device access, screen capture) is macOS only. CI runs the logic on Linux, where the dry-run path works without iPhones and without macOS:

```bash
node infra/farm/farm-brain.js --slot=1 --prefix=Alpha --dry-run --log
node infra/farm/hub.js --slots=4 --duration=60 --test   # silent dry run
```

If your change touches farm logic, keep it testable in dry-run mode so CI can exercise it.
