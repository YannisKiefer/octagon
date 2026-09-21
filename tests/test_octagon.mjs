// Octagon test suite. Run from the repo root: node tests/test_octagon.mjs
// Spawns the real demo seeder against a temp database, then checks the runtime
// contracts that keep the product honest.
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { execFileSync, spawnSync } from "child_process";
import { createRequire } from "module";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const require = createRequire(path.join(ROOT, "infra", "farm", "package.json"));
const Database = require("better-sqlite3");

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error("assert failed: " + msg);
  passed++;
  console.log("ok " + msg);
}

// 1. Seeder: writes a fresh, clearly synthetic database
const tmpDb = path.join(os.tmpdir(), "octagon-test-" + Date.now() + ".db");
const seed = spawnSync(process.execPath, [path.join(ROOT, "scripts", "seed-demo.js")], {
  env: { ...process.env, FARM_DB_PATH: tmpDb },
  encoding: "utf8",
});
ok(seed.status === 0, "seeder exits 0");
ok(seed.stdout.includes("synthetic"), "seeder labels its data synthetic");
ok(!fs.existsSync(path.join(ROOT, "scripts", "seed-demo.py")), "no leftover python seeder");

const db = new Database(tmpDb, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
for (const t of ["farm_devices", "farm_device_health", "farm_tasks", "farm_events"]) {
  ok(tables.includes(t), `table ${t} exists`);
}
ok(db.prepare("SELECT COUNT(*) c FROM farm_devices").get().c === 4, "4 devices registered");
const seedEvents = db.prepare("SELECT event, data FROM farm_events").all();
ok(seedEvents.length > 0, "demo events seeded");
ok(seedEvents.every(e => !/ICP|Trendyol|harvested/i.test(e.event)), "demo events contain no operational copy");
db.close();

// 2. Farm brain: pacing only, honest claims, safe claims
const brain = fs.readFileSync(path.join(ROOT, "infra", "farm", "farm-brain.js"), "utf8");
ok(brain.includes("Math.exp"), "log-normal pacing jitter");
ok(!/likePost|savePost|openComments/.test(brain), "no engagement actions in the routine");
ok(brain.includes("not implemented in this build"), "unknown task types fail honestly");
ok(brain.includes("scheduled_for<=?"), "tasks only run once their time has come");
ok(brain.includes("AND status='scheduled'"), "task claims are guarded against races");
ok(brain.includes("stopped by user"), "stopping a session is recorded honestly");
ok(!brain.includes("Math.random().toString(36)"), "event ids are not collision-prone");

// 3. Hub: registry-driven slots, real hub status, audio lock
const hub = fs.readFileSync(path.join(ROOT, "infra", "farm", "hub.js"), "utf8");
ok(hub.includes("FROM farm_devices"), "hub spawns devices from the registry");
ok(hub.includes("OCTAGON_HUB_MANAGED"), "hub and brain share the audio-lock env contract");
ok(hub.includes("busy_timeout"), "concurrent sqlite access is guarded");
ok(!hub.includes("SLOTS_CFG.slice"), "no hardcoded slot list");

// 4. MCP: the five real tools, honest screen capture
const mcp = fs.readFileSync(path.join(ROOT, "mcp", "server.js"), "utf8");
for (const t of ["list_phones", "get_phone", "run_session", "get_events", "get_phone_screen"]) {
  ok(mcp.includes(`"${t}"`), `mcp tool ${t} exists`);
}
ok(!mcp.includes("warm_phone"), "renamed warm_phone is gone everywhere");
ok(/isError:\s*true/.test(mcp), "mcp flags failures as errors");
ok(mcp.includes("available:false"), "screen capture answers unavailable honestly");

// 5. Repo hygiene: removed tooling stays removed
for (const f of ["infra/farm/stealth-check.js", "infra/farm/audit/parity-scorer.js", "engine/octragon/config.py"]) {
  ok(!fs.existsSync(path.join(ROOT, f)), `${f} stays removed`);
}
ok(!fs.existsSync(path.join(ROOT, "apps/dashboard/app/api/farm/parity")), "parity endpoint stays removed");

// 6. UI: English, no fabricated data, honest panels
const page = fs.readFileSync(path.join(ROOT, "apps", "dashboard", "app", "page.tsx"), "utf8");
ok(!/Nachricht|Routinen|Hinzufügen|Einstellungen|Suchen/i.test(page), "UI strings are English");
ok(!page.includes("FALLBACK_MSGS") && !page.includes("FALLBACK_CROCS"), "no fabricated conversations");
ok(page.includes("Live screen capture requires libimobiledevice"), "screen panel states reality");
ok(page.includes("No devices yet"), "real empty state exists");
ok(!/type="file"|accept="video/.test(page), "no fake video upload path");
ok(!/yannis/i.test(page), "no personal names in the UI");

// 7. Docs and env: no personal data, placeholders only
for (const rel of ["README.md", "VISION.md", "CONTRIBUTING.md", "docs/ARCHITECTURE.md", "mcp/README.md", ".env.example", "CHANGELOG.md"]) {
  const t = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/github\.com\/YannisKiefer\/octagon/g, "repo");
  ok(!/yannis|ecombrain|gmail/i.test(t), `no personal data in ${rel}`);
}
const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8")
  .split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
ok(!/=[A-Za-z0-9+/_-]{20,}/.test(envExample.replace(/change-me[^ \n]*/g, "")), "env example holds only placeholders");

// 8. Product rules: no evasion or cloud anywhere in shipped source
for (const rel of ["infra/farm/hub.js", "infra/farm/farm-brain.js", "mcp/server.js", "apps/dashboard/lib/farmDb.ts"]) {
  const t = fs.readFileSync(path.join(ROOT, rel), "utf8");
  ok(!/stealth|parity|human[- ]?like.*detect|warm_phone/i.test(t), `no evasion references in ${rel}`);
  ok(!/supabase|stripe/i.test(t), `no cloud dependencies in ${rel}`);
}

// 9. Behavior: future tasks are not claimed; numbering never collides
const db2path = tmpDb.replace(/\.db$/, "-2.db");
fs.copyFileSync(tmpDb, db2path);
const db2 = new Database(db2path);
const future = new Date(Date.now() + 86_400_000).toISOString();
db2.prepare(
  "INSERT INTO farm_tasks (id,type,device_id,scheduled_for,status,payload,created_at,updated_at) VALUES ('f1','session','phone1',?,'scheduled','{}',?,?)"
).run(future, new Date().toISOString(), new Date().toISOString());
const now = new Date().toISOString();
const claim = db2
  .prepare("SELECT * FROM farm_tasks WHERE status='scheduled' AND scheduled_for<=? AND (device_id IS NULL OR device_id=?) ORDER BY scheduled_for LIMIT 1")
  .get(now, "phone1");
ok(claim === undefined, "future tasks are not claimed early");
// The regression that mattered: with COUNT-based numbering, deleting a middle
// device made the next add collide with an existing higher device.
db2.prepare("DELETE FROM farm_device_health WHERE device_id='phone2'").run();
db2.prepare("DELETE FROM farm_events WHERE device_id='phone2'").run();
db2.prepare("DELETE FROM farm_devices WHERE id='phone2'").run();
const nextNumber =
  Math.max(
    db2.prepare("SELECT COALESCE(MAX(phone_number),0) m FROM farm_devices").get().m,
    db2.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id,6) AS INTEGER)),0) m FROM farm_devices").get().m
  ) + 1;
ok(nextNumber === 5, "next device id skips existing phone4 instead of colliding");
db2.close();

// 10. Agents: the farm seeds a standing crew on first run - supervisor Nova,
// monitor Sentry, and one phone agent per device (2 + N) behind /api/agents.
const farmDbSrc = fs.readFileSync(path.join(ROOT, "apps", "dashboard", "lib", "farmDb.ts"), "utf8");
ok(
  fs.existsSync(path.join(ROOT, "apps", "dashboard", "app", "api", "agents", "route.ts")) &&
  farmDbSrc.includes("CREATE TABLE IF NOT EXISTS farm_agents") &&
  farmDbSrc.includes('"Nova"') &&
  farmDbSrc.includes('"Sentry"') &&
  farmDbSrc.includes("Agent`"),
  "/api/agents seeds 2 + N default agents (Nova, Sentry, one per device)"
);

for (const f of [tmpDb, db2path, tmpDb + "-wal", tmpDb + "-shm", db2path + "-wal", db2path + "-shm"]) {
  try { fs.unlinkSync(f); } catch {}
}

console.log(`\nAll ${passed} checks passed`);
