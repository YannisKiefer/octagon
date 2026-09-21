# Octagon MCP server

`mcp/server.js` exposes the local farm to any MCP client (Claude Desktop, Claude Code, or your own agent) over stdio. It reads and writes the same local SQLite file the dashboard uses: `infra/db/farm.db`, or `FARM_DB_PATH` if set.

## Requirements

- Node 20 or newer.
- better-sqlite3 must be resolvable. If it is not installed globally, run `cd infra/farm && npm install` once; the server falls back to `infra/farm/node_modules/better-sqlite3`.

## Client configuration

Claude Desktop (`claude_desktop_config.json`) or any generic client with the standard `mcpServers` shape:

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

Claude Code:

```bash
claude mcp add octagon -- node /absolute/path/to/octagon/mcp/server.js
```

Replace `/absolute/path/to/octagon` with your checkout location.

## Tools

### list_phones

All phones registered in the local farm.

```json
{ "type": "object", "properties": {} }
```

### get_phone

One phone with its health record.

```json
{ "type": "object", "properties": { "phoneId": { "type": "string" } }, "required": ["phoneId"] }
```

### run_session

Queues a pacing session (swipe pacing over iOS Voice Control). This only inserts a scheduled task: it executes while the hub is running, not otherwise. The session appears in the group chat and can be handed off to another agent via `handoff_task`. Check progress with `get_events`.

```json
{ "type": "object", "properties": { "slot": { "type": "number", "minimum": 1, "maximum": 8 }, "minutes": { "type": "number", "default": 10, "minimum": 1, "maximum": 180 } }, "required": ["slot"] }
```

### get_events

Recent events (chat bubbles) for a phone, newest first.

```json
{ "type": "object", "properties": { "phoneId": { "type": "string" }, "limit": { "type": "number", "default": 20 } }, "required": ["phoneId"] }
```

### get_phone_screen

Captures the phone screen. Requirements: libimobiledevice installed (`brew install libimobiledevice`), the iPhone connected and trusted, and the device's UDID configured as `FARM_PHONEn_UDID` in `.env`. On success, `idevicescreenshot` writes the screenshot file to the server's current working directory. When capture is not possible, the tool returns an explicit unavailable answer with the reason. It never returns a placeholder image.

```json
{ "type": "object", "properties": { "phoneId": { "type": "string" } }, "required": ["phoneId"] }
```

### list_agents

All active agents of the multi-agent layer, with their id, name, role, device and status.

```json
{ "type": "object", "properties": {} }
```

### create_agent

Creates an agent. `role` is one of `phone`, `monitor`, `supervisor`, `custom`. A phone agent must reference an existing device, and a device can hold only one phone agent. Names are 2-24 characters and unique case-insensitively.

```json
{ "type": "object", "properties": { "name": { "type": "string", "minLength": 2, "maxLength": 24 }, "role": { "type": "string", "enum": ["phone", "monitor", "supervisor", "custom"] }, "device_id": { "type": "string" } }, "required": ["name", "role"] }
```

### assign_agent

Moves an active agent to another registered device.

```json
{ "type": "object", "properties": { "agentId": { "type": "string" }, "deviceId": { "type": "string" } }, "required": ["agentId", "deviceId"] }
```

### handoff_task

Hands a task to a phone agent: the task moves to that agent's device and a handoff event lands in the group chat. Monitor and supervisor agents observe and coordinate but do not execute tasks, so handing off to them returns an explicit refusal and moves nothing.

```json
{ "type": "object", "properties": { "taskId": { "type": "string" }, "toAgentId": { "type": "string" }, "note": { "type": "string" } }, "required": ["taskId", "toAgentId"] }
```

## Scope and security

- Local stdio only. The server has no network listener and no auth, by design. Do not expose it over HTTP or run it on a shared machine without understanding that every local process can talk to it.
- The server opens the database read-only, except `run_session`, `create_agent`, `assign_agent` and `handoff_task`, which write scheduled tasks, agents and events.
- Agents are the multi-agent layer (supervisor, monitor, phone) shared with the dashboard: the same `farm_agents` rows and group-chat events, whatever tool edits them.
- Automating social accounts can violate platform terms. Octagon automates only what you configure on devices you own; you are responsible for how you use it.

## Smoke test

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' | node mcp/server.js
printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_phones","arguments":{}}}\n' | node mcp/server.js
```

Each command prints one JSON-RPC response line.
