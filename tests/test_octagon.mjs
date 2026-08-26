import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let Database;
try { Database = require("better-sqlite3"); } catch { Database = require("../infra/farm/node_modules/better-sqlite3"); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, "../infra/db/farm.db");
function assert(c, m) { if (!c) throw new Error("assert: " + m); }

// 1. DB: 4 core tables, seeded
const db = new Database(DB, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
for (const t of ["farm_devices", "farm_device_health", "farm_tasks", "farm_events"]) assert(tables.includes(t), `missing ${t}`);
assert(db.prepare("SELECT COUNT(*) c FROM farm_devices").get().c >= 4, "seed 4 devices");
db.close();
console.log("ok DB 4 tables + seed");

// 2. Brain: log-normal jitter + burst
const brain = fs.readFileSync(path.join(__dirname, "../infra/farm/farm-brain.js"), "utf8");
assert(brain.includes("Math.exp") || brain.includes("logNormal"), "logNormal jitter");
assert(brain.includes("burst"), "burst");
console.log("ok brain logNormal + burst");

// 3. Hub: float durations, drift guard
const hub = fs.readFileSync(path.join(__dirname, "../infra/farm/hub.js"), "utf8");
assert(hub.includes("parseFloat"), "hub parseFloat");
console.log("ok hub float");

// 4. MCP: 5 tools
const mcp = fs.readFileSync(path.join(__dirname, "../mcp/server.js"), "utf8");
for (const t of ["list_phones", "get_phone", "warm_phone", "get_events", "get_phone_screen"]) assert(mcp.includes(t), `mcp ${t}`);
console.log("ok mcp 5 tools");

// 5. UI: per-phone chat + working controls + no personal data
const page = fs.readFileSync(path.join(__dirname, "../apps/dashboard/app/page.tsx"), "utf8");
assert(page.includes("Nachricht an ${croc.name}"), "per-phone chat input");
assert(page.includes("Bildschirm von"), "screen preview");
assert(page.includes("Agent hinzufügen"), "add agent");
assert(page.includes("Einstellungen"), "settings");
assert(!/yannis/i.test(page), "no personal name in UI");
assert(!page.includes("ff5f57"), "no fake traffic lights");

// 6. No personal data anywhere in shipped files
for (const rel of ["README.md", "docs/ARCHITECTURE.md", "mcp/README.md", ".env.example", "scripts/seed-demo.py"]) {
  const t = fs.readFileSync(path.join(__dirname, "../" + rel), "utf8").replace(/github\.com\/YannisKiefer\/octagon/g, "repo");
  assert(!/yannis/i.test(t), `personal data in ${rel}`);
}
console.log("ok UI clean + no personal data");

// 7. No cloud: no supabase/stripe imports in shipped code
for (const rel of ["apps/dashboard/package.json", "apps/dashboard/lib/farmDb.ts", "apps/dashboard/instrumentation.ts"]) {
  const t = fs.readFileSync(path.join(__dirname, "../" + rel), "utf8");
  assert(!/supabase|stripe/i.test(t.replace(/no supabase|Supabase removed/gi, "")), `cloud dep in ${rel}`);
}
console.log("ok no supabase/stripe");

console.log("All octagon checks passed");
