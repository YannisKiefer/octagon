# Architecture

One Mac. Real iPhones. A chat.

```
You  ──chat──>  Octagon UI (Next.js, this repo)
                  │
                  ├── /api/farm/*  ──>  SQLite (infra/db/farm.db, WAL, 4 tables)
                  │                      farm_devices · farm_device_health · farm_tasks · farm_events
                  │
                  └── mcp/server.js (stdio)  ──>  same DB
                        Hermes / OpenClaw / any MCP client talks to your phones:
                        list_phones · get_phone · warm_phone · get_events · get_phone_screen

infra/farm/hub.js       spawns one farm-brain.js per phone, 3-5s stagger,
                        5s heartbeats, global TTS lock, 3 restarts, writes hub_status
infra/farm/farm-brain.js  per-phone warmup loop: say "Alpha Swipe Next" -> iOS Voice Control
                          log-normal jitter + bursts, writes farm_events (your chat bubbles)
```

- The chat is the interface. Every message is stored, the agent replies and does the work (warmup / post / status).
- The screen preview is the agent's context. Click it to see what the phone sees.
- No cloud. No accounts. The DB never leaves the machine.

## Bring your own brain

The chat brain is rule-based by default (see `app/api/farm/events/route.ts`).
Point Hermes or OpenClaw at `mcp/server.js` (see `mcp/README.md`) and the same
phones, tasks and chat bubbles are available to any MCP agent.
