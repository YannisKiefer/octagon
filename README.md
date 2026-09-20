<div align="center">

<img src="assets/banner.png" alt="Octagon" width="100%"/>

# Your iPhone fleet, on your Mac.

Chat-driven Voice Control automation for iPhones you own: schedule pacing sessions, watch device health, wire any MCP agent in. Everything local.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Local-first](https://img.shields.io/badge/data-local--first-blue)
![Cloud](https://img.shields.io/badge/cloud-none-blue)

[Documentation](#documentation) | [Quick start](#quick-start) | [How it works](#how-it-works) | [FAQ](#faq)

<img src="assets/screenshots/dashboard-main.png" alt="Octagon dashboard" width="100%"/>
<p><sub>Dashboard with synthetic demo data</sub></p>

</div>

---

## What it is

- **Chat console.** Open a phone in the sidebar, type `run 20`, and a 20-minute pacing session is queued. Ask for `status`, or `stop`.
- **Session scheduler and hub.** The hub runs one "brain" per phone, keeps a global audio lock so only one phone listens at a time, and restarts a crashed brain up to 3 times.
- **Device health and event log.** Heartbeats every 5 seconds. Missed heartbeats mark a phone degraded, then offline. Everything a phone does lands in the chat.
- **MCP server.** Five tools over local stdio, so Claude Desktop, Claude Code, or your own agent can list phones, queue sessions, and read events.

**Direction:** one conversation, many agents, many phones - an open-source agent layer for the phones you own. See [VISION.md](VISION.md).

## What it does NOT do

- **No posting.** Posting your own content is on the roadmap. It is not implemented.
- **No likes, comments, follows, or DM automation.** The bundled routine is swipe pacing only.
- **No cloud.** No accounts, no telemetry, no external services.
- **No unofficial APIs.** Control goes through iOS Voice Control, a built-in accessibility feature.

> **Important:** automating social media accounts can violate the terms of those platforms, and no one can promise how enforcement will turn out. Octagon automates only what you configure on devices and accounts you own, and it contains no evasion features. You are responsible for how you use it.

## How it works

```
you (chat or any MCP client)
        |
        v
  dashboard :3010   or   mcp/server.js (stdio)
        |
        v
  SQLite file: infra/db/farm.db  (devices, health, tasks, events)
        ^  tasks and events
        |
  hub.js: forks one brain per phone, audio lock, restarts
        |
        v
  brain: macOS says "Alpha Swipe Next"
        |
        v
  iPhone Voice Control: runs the swipe you configured
```

- The dashboard and the MCP server read and write the same local SQLite file. All state lives there.
- The hub spawns one brain per phone and holds a mutex so only one cue is spoken at a time.
- A brain speaks one cue, for example "Alpha Swipe Next", through macOS TTS. The iPhone's Voice Control custom command performs the swipe you configured.
- Heartbeats every 5 seconds; 3 missed means degraded, 10 means offline. A brain that exits is restarted up to 3 times.

## Requirements

- macOS with the built-in `say` command
- Node 20 or newer (better-sqlite3 12 requires it)
- One or more iPhones you own (optional: the demo mode runs without any)
- Optional: [libimobiledevice](https://libimobiledevice.org) (`brew install libimobiledevice`) for UDIDs and screen capture

Python is not needed.

## Quick start

**macOS (Apple Silicon):** download the [latest DMG](https://github.com/YannisKiefer/octagon/releases/latest/download/Octagon-1.1.0-arm64.dmg), drag Octagon to Applications. Unsigned build: first launch needs System Settings - Privacy and Security - Open Anyway (once).

Prefer running from source?

```bash
git clone https://github.com/YannisKiefer/octagon.git
cd octagon
```

```bash
cd infra/farm && npm install
cd ../../apps/dashboard && npm install
cd ../..

# optional: reset the database with clearly synthetic demo data
node scripts/seed-demo.js

cd apps/dashboard
npm run dev
```

Open **http://localhost:3010**. That is the whole setup: development mode needs no configuration and no login (local sessions use a built-in development secret).

For a production build, create `apps/dashboard/.env.local` (use `apps/dashboard/.env.example` as the template), set `NEXTAUTH_SECRET` (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) plus your `DASHBOARD_ADMIN_USER` / `DASHBOARD_ADMIN_PASSWORD`, then `npm run build && npm run start`. Login is enforced with those credentials.

<details>
<summary><strong>Connect real iPhones</strong></summary>

1. On each iPhone: Settings > Accessibility > Voice Control > On. The language must be English.
2. Still under Voice Control, open Customize Commands and create one command per phone. The phrase must be exactly `<Prefix> Swipe Next` (for example `Alpha Swipe Next`), and the action is a custom gesture: one swipe up.
3. Plug the iPhone into the Mac via USB and trust the Mac.
4. Dry run first (nothing is spoken aloud):

   ```bash
   node infra/farm/farm-brain.js --slot=1 --prefix=Alpha --dry-run --log --duration=0.2
   ```

5. Then a spoken test. The Mac says "Alpha Swipe Next" and the iPhone should swipe:

   ```bash
   node infra/farm/farm-brain.js --slot=1 --prefix=Alpha --duration=0.2 --log
   ```

6. Run the fleet: `node infra/farm/hub.js --slots=4` (add `--test` for a silent dry run). The hub itself does not create sessions - queue one from the dashboard chat (`run 20`) or the MCP `run_session` tool, and the brain executes it, with progress landing in the chat.

Full guide: [infra/farm/SETUP-GUIDE.md](infra/farm/SETUP-GUIDE.md)

</details>

## MCP setup

Octagon speaks the [Model Context Protocol](https://modelcontextprotocol.io). Point any MCP client at it:

```json
{
  "mcpServers": {
    "octagon": {
      "command": "node",
      "args": ["/absolute/path/to/octagon/mcp/server.js"]
    }
  }
}
```

Five tools, same local database: `list_phones`, `get_phone`, `run_session {slot, minutes}`, `get_events {phoneId}`, `get_phone_screen {phoneId}`. Details: [mcp/README.md](mcp/README.md)

## Privacy

- All data lives in one local SQLite file: `infra/db/farm.db`.
- Nothing leaves the Mac. No telemetry, no cloud calls, no third-party services.
- Delete that file and everything is gone.

## Limitations

- Posting is not implemented. It is roadmap only.
- Screen capture needs libimobiledevice plus a configured UDID. Without them the MCP tool answers "unavailable" instead of showing a placeholder.
- One Mac speaks at a time, so phones must be within speaker range of it. The hub's audio lock enforces one cue at a time.
- Voice Control command matching depends on the iPhone's language being set to English.
- The chat brain is rule-based. It acts on `run`, `status`, and `stop`, and only logs anything else.

## FAQ

**Will this keep my account safe from bans?**
No one can promise that. Automation can violate platform terms, and how a platform enforces them is outside this project's control. Octagon automates only what you configure on devices you own, and it contains no evasion features.

**Do I need proxies?**
No, and none are supported. The iPhones run on your own network.

**Where is my data?**
In one SQLite file, `infra/db/farm.db`. It stays on your Mac. Delete it to erase everything.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - how the pieces fit together
- [infra/farm/SETUP-GUIDE.md](infra/farm/SETUP-GUIDE.md) - real iPhone setup, step by step
- [mcp/README.md](mcp/README.md) - MCP tools and client configuration
- [CHANGELOG.md](CHANGELOG.md) - what changed and when
- [BRAND.md](BRAND.md) - logo, colors, typography, voice

## Contributing

Small PRs, one feature at a time. See [CONTRIBUTING.md](CONTRIBUTING.md). Run the checks with `node tests/test_octagon.mjs`.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
