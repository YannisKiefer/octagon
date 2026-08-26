# Octagon MCP — 5 tools, Hermes talks to your phones

**Hermes is the chat, Octagon is the hands.** No vision, no bloat.

```json
// Hermes: ~/.hermes/mcp.json  —  OpenClaw: openclaw.json
{
  "mcpServers": {
    "octagon": {
      "command": "node",
      "args": ["/absolute/path/to/octagon/mcp/server.js"]
    }
  }
}
```

Then in Telegram/Discord with Hermes Bots: `@Alpha warm 30m` → Hermes calls `warm_phone` → Octagon does `say "Alpha Swipe Next"` with global lock.

**Tools:**
- `list_phones` → 4 phone-agents
- `get_phone` → health + screen
- `warm_phone {slot, minutes}` → queues `farm_tasks`, hub warms
- `get_events {phoneId}` → chat bubbles
- `get_phone_screen {phoneId}` → base64 (mock now, `idevicescreenshot` later)

**Node:** requires Node 20 (better-sqlite3 115). Use `PATH="/opt/homebrew/opt/node@20/bin:$PATH" node mcp/server.js` or `nvm use 20`.

**Security:** stdio local, no auth. If you expose via HTTP, set `OCTAGON_MCP_TOKEN` and check `params._token` — `// ponytail: no auth, add token if HTTP`.

Test:
```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' | node mcp/server.js
printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_phones","arguments":{}}}\n' | PATH="/opt/homebrew/opt/node@20/bin:$PATH" node mcp/server.js
```
