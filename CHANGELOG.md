# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-21

### Added
- Multi-agent layer: Nova (supervisor), Sentry (monitor), one phone agent per device; create, rename, assign and retire agents from the dashboard; @-address them in the chat; hand tasks between agents (in the queue menu and via MCP `handoff_task`); four new MCP agent tools.
- In-app updater: the desktop app checks GitHub releases and installs updates with one click (menu: Check for Updates).
- First-run onboarding with a one-click synthetic demo.

### Changed
- Login removed: Octagon is a local app - open it and use it.
- Glass website redesign (deployed from the gh-pages branch).

### Added

- The multi-agent layer: a `farm_agents` table with named agents - supervisor "Nova", monitor "Sentry", and one agent per phone. Chat replies are attributed to the agent you address (`@<name>` in the message, otherwise the supervisor), and tasks can be handed off to a phone agent with `POST /api/agents/handoff` or the MCP `handoff_task` tool. Monitor and supervisor agents coordinate but refuse to execute tasks, and say so.
- Four MCP tools for that layer: `list_agents`, `create_agent`, `assign_agent`, `handoff_task` - nine tools in total.
- First-run onboarding in the dashboard: a welcome overlay with a **Load demo data** button (`POST /api/farm/demo`, refused on any database that already has data), alongside the `node scripts/seed-demo.js` seeder.
- In-app updater for the desktop app: it checks GitHub releases and downloads, installs, and relaunches from within the app (a Check for Updates menu item plus an update banner).

### Removed

- Login and accounts. Octagon is a local app: open the dashboard and use it - no NextAuth, no middleware, no auth env vars.

### Changed

- The website got a glass redesign and moved to the `gh-pages` branch, out of the product repo.

## [1.1.0] - 2026-09-20

A security and honesty overhaul: the project no longer contains evasion tooling, fabricated UI elements, or overstated claims, and every part of the runtime now says what it actually does.

### Added

- The macOS desktop app: an Electron shell bundling the dashboard and the farm runtime into an unsigned arm64 DMG (`Octagon-1.1.0-arm64.dmg`).

### Removed

- All evasion tooling: the "stealth check", the "parity scorer", video-forgery presets, and the Python engine. The bundled routine is swipe pacing only, and the project makes no claim about avoiding platform moderation.
- Python from the stack entirely. Requirements are now macOS with `say`, Node 20+, and better-sqlite3 ^12.

### Changed

- The runtime is honest by design: brains execute only `session` tasks, and any unknown task type fails with an explicit "not implemented in this build" error. The chat brain answers honestly about what it can do (`run <minutes>`, `status`, `stop`); asking it to post gets an explicit not-implemented reply.
- MCP tool `warm_phone` renamed to `run_session`, with an honest description: it queues a pacing session that executes only while the hub is running.
- `get_phone_screen` now attempts a real capture via `idevicescreenshot` and returns an explicit unavailable answer with a reason when capture is not possible, instead of a mock.
- The demo seeder is a Node script: `node scripts/seed-demo.js` resets `infra/db/farm.db` with clearly synthetic demo data (the previous Python seeder is gone).
- Dashboard UI text is in English.
- The dashboard now serves on port 3010 in dev and production scripts.

### Fixed

- Hub audio lock: the managed-child environment variable (`OCTAGON_HUB_MANAGED`) matches what the brain checks, so hub-managed brains actually serialize cues through the audio mutex.
- Device ids: hub slots spawn as `phone1`..`phone4`, aligned with the ids in the database.
- `hub_status` is really written every 5 seconds (active count, audio lock flag, timestamp), with a schema-drift guard for older databases.
- SQLite concurrency: `busy_timeout` (5 s) on the hub and brain handles, plus a `(device_id, ts DESC)` index on `farm_events` for chat queries.

### Requirements in this release

- macOS with the built-in `say` command
- Node 20 or newer, better-sqlite3 ^12
- Optional: libimobiledevice for UDIDs and screen capture

[Unreleased]: https://github.com/YannisKiefer/octagon/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/YannisKiefer/octagon/releases/tag/v1.1.0
