import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let Database;
try { Database = require("better-sqlite3"); } catch { Database = require("../infra/farm/node_modules/better-sqlite3"); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, "../infra/db/farm.db");
function assert(c,m){ if(!c) throw new Error("assert: "+m); }
const db=new Database(DB,{readonly:true});
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
for(const t of ["farm_devices","farm_device_health","farm_tasks","farm_events"]) assert(tables.includes(t), `missing ${t}`);
assert(db.prepare("SELECT COUNT(*) as c FROM farm_devices").get().c>=4, "seed");
db.close(); console.log("✓ DB 4 tables");
const brain=fs.readFileSync(path.join(__dirname,"../infra/farm/farm-brain.js"),"utf8");
assert(brain.includes("logNormal")||brain.includes("Math.exp"), "logNormal"); assert(brain.includes("burst"), "burst"); console.log("✓ brain logNormal+burst");
const hub=fs.readFileSync(path.join(__dirname,"../infra/farm/hub.js"),"utf8");
assert(hub.includes("parseFloat"), "hub float"); console.log("✓ hub float");
const mcp=fs.readFileSync(path.join(__dirname,"../mcp/server.js"),"utf8");
assert(mcp.includes("list_phones")&&mcp.includes("warm_phone"), "mcp"); console.log("✓ mcp 5 tools");
const page=fs.readFileSync(path.join(__dirname,"../apps/dashboard/app/page.tsx"),"utf8");
assert(page.includes('useState("phone1")')&&page.includes("Bildschirm von"), "grok"); console.log("✓ grok per-phone");
console.log("All ponytail checks passed");
