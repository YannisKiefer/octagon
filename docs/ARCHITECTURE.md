# Architecture

One Mac, one SQLite file, real iPhones driven by spoken cues. This document describes the code that exists today.

```
apps/dashboard (Next.js, port 3010)
  app/api/farm/*  -->  lib/farmDb.ts  -->  SQLite: infra/db/farm.db
                                              farm_devices
                                              farm_device_health
                                              farm_tasks
                                              farm_events
                                              hub_status
                                                     ^        ^
infra/farm/hub.js --forks--> infra/farm/farm-brain.js         |
  |                            |  audio-request mutex         |
  |                            v                              |
  |                    macOS TTS: say "<Prefix> Swipe Next"    |
  |                            |                               |
  |                            v                               |
  |                    iPhone Voice Control: swipe up          |
  |                    (events + health land in the DB) -------+
  |
mcp/server.js (stdio) --reads/writes the same DB--> farm_devices, farm_device_health,
                                                    farm_tasks, farm_events

scripts/seed-demo.js -- resets the DB and fills it with synthetic demo data
```

## Dashboard (apps/dashboard)

Next.js App Router on port 3010 (`npm run dev`, `npm run build`, `npm run start`; scripts pin `-p 3010`). All database access goes through `lib/farmDb.ts`, which opens `infra/db/farm.db` (override with `FARM_DB_PATH`) via better-sqlite3, WAL mode.

Routes:

- `/api/farm` and `/api/farm/devices` - devices plus their health rows.
- `/api/farm/events` - `GET` lists recent events (filter by `phoneId`); `POST` is the chat brain (below).
- `/api/farm/tasks` and `/api/farm/tasks/[id]` - scheduled and finished tasks.
- `/api/health` - liveness.
- `/api/auth/[...nextauth]` - NextAuth credentials login.

Auth: in development (`npm run dev`) the middleware lets every request through. A production build enforces NextAuth login with `DASHBOARD_ADMIN_USER` / `DASHBOARD_ADMIN_PASSWORD` (or `DASHBOARD_ADMIN_HASH`) from `.env`; `/api/farm/tasks` additionally requires the admin role. The middleware also rate-limits to 100 requests per minute per IP.

### Chat brain (POST /api/farm/events)

Rule-based, in `app/api/farm/events/route.ts`. It stores the user message as an event, acts on what it recognizes, and stores its reply as another event:

- `run <minutes>` (also "start", "session", "pace") - inserts a `session` row into `farm_tasks`, capped at 180 minutes.
- `status` / `health` / `report` - reads `farm_device_health` for the open phone.
- `stop` / `cancel` - sets all `scheduled`/`running` tasks to `canceled`.
- Wording about posting, uploading, or publishing - an explicit "not implemented" reply. The roadmap is mentioned; nothing is executed.
- Anything else - a reply that the message was only logged, listing what it can act on.

## Data model (infra/db/farm.db)

Schema is created by `lib/farmDb.ts` (dashboard), `scripts/seed-demo.js`, or at runtime by hub and brain as needed.

- `farm_devices` - `id` (`phone1`..`phone4`), `phone_number`, `display_name`, `voice_prefix` (Alpha, Bravo, Charlie, Delta), `usb_udid`, `active`.
- `farm_device_health` - one row per device: `session_state`, `swipes`, `last_action`, `last_action_at`, `error`, `updated_at`, and legacy counters (`likes`, `saves`, `comments`, `profiles`) that the current runtime never writes.
- `farm_tasks` - `type`, `device_id`, `status` (`scheduled`, `running`, `succeeded`, `failed`, `canceled`), `payload` (JSON), `result`, `error`, timestamps.
- `farm_events` - `ts`, `level`, `device_id`, `event` (the chat bubble text), `data` (JSON, for example `{"side":"user"}`). Indexed on `ts` and `(device_id, ts DESC)`.
- `hub_status` - single row `hub` written by the hub every 5 seconds: `active` count, `locked` (audio lock), `ts`. The hub recreates the table if an older schema is found.

## Hub (infra/farm/hub.js)

`node infra/farm/hub.js --slots=4 --duration=60` (`--duration` in minutes, fractions allowed). `--test` means silent dry run: children get `--dry-run` and no TTS happens.

- Spawns one `farm-brain.js` per slot, staggered 3 to 4.5 seconds, with `OCTAGON_HUB_MANAGED=1` in the child environment and `--id=phoneN` matching the DB device ids.
- Slots come from the farm_devices registry (defaults Alpha/Bravo/Charlie/Delta only when the registry is empty) (`phone1`..`phone4`).
- Audio mutex: a child sends `audio-request`; the hub grants `audio-granted` and releases the lock after the child's estimated duration (default 2500 ms). Only one brain speaks at a time.
- Restart budget: if a child exits, the hub restarts it after 3 to 4.5 seconds, at most 3 times per slot.
- Health loop every 5 seconds: a child whose last heartbeat is 3 or more intervals old (15 s) is marked `degraded`; 10 or more (50 s) marks it `offline`. The same tick writes `hub_status`.
- SIGINT/SIGTERM: sends `stop` to all children, then exits.
- The hub's own SQLite handle sets `busy_timeout=5000`.

## Brain (infra/farm/farm-brain.js)

`node infra/farm/farm-brain.js --slot=1 --prefix=Alpha --dry-run --log [--duration=<minutes>]` (`--duration` clamped to 0.1..180, default 10).

- Sends a heartbeat to the hub every 5 seconds (standalone runs without a hub just never deliver it).
- If `farm_tasks` has any rows, the brain loops: poll for a `scheduled` task, execute it, sleep 5 seconds. Otherwise it runs one standalone session of `--duration` and exits.
- A session speaks `"<Prefix> Swipe Next"` (for example "Alpha Swipe Next") through `say -v Samantha`, waits 400 ms, updates `farm_device_health` and `farm_events`, then sleeps with log-normal jitter (base 3800 ms, sigma 0.35, occasional 1.6x pause, clamped to 800 ms..2.2x base). The bundled routine paces swipes only.
- Under the hub, each cue first requests the audio lock (`OCTAGON_HUB_MANAGED=1`). In `--dry-run` nothing is spoken; the cue is only logged.

## MCP server (mcp/server.js)

JSON-RPC over stdio, no network listener. Opens the same SQLite file read-only, except `run_session`, which inserts a `scheduled` `session` task. Tools: `list_phones`, `get_phone`, `run_session`, `get_events`, `get_phone_screen`. `get_phone_screen` looks up `usb_udid`, checks for `idevicescreenshot`, and returns an explicit `available: false` with a reason when capture is not possible. Details and client config: [mcp/README.md](../mcp/README.md).

## Behavior contract

- **Task types.** Only `type = "session"` executes. The payload field `duration_minutes` is clamped to 0.1..180.
- **Honest failure of unknown types.** Any other task type is marked `failed` with the message that the type is not implemented in this build and nothing was executed. The chat brain answers the same way about posting.
- **Restart budget.** The hub restarts an exited brain at most 3 times per slot, then leaves it offline.
- **Heartbeat thresholds.** Heartbeats every 5 s. 3 missed intervals (15 s) mark a phone `degraded`; 10 (50 s) mark it `offline`.
- **Audio lock.** Exactly one brain may speak at a time. The hub holds a mutex across all slots; a brain waits up to 4 s for the grant, then speaks anyway rather than hanging.

## Demo seeder (scripts/seed-demo.js)

`node scripts/seed-demo.js` deletes `farm.db` (plus `-wal`/`-shm`), recreates the schema, and inserts 4 devices with clearly synthetic health data and a synthetic chat transcript. Run it from the repo root; it resolves better-sqlite3 from `infra/farm/node_modules`.
