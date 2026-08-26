#!/usr/bin/env node
// Octagon MCP — ponytail: 5 tools, 80 lines, reuses farmDb. Hermes/OpenClaw calls this, we move the phones.
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let Database;
try { Database = require("better-sqlite3"); } catch { Database = require("../infra/farm/node_modules/better-sqlite3"); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, "../infra/db/farm.db");

function db(){ const d=new Database(DB, {readonly:true}); d.pragma("journal_mode=WAL"); return d; }

// MCP stdio JSON-RPC minimal
const TOOLS = [
  {name:"list_phones", description:"List 4 phone-agents (Alpha/Bravo/Charlie/Delta)", inputSchema:{type:"object", properties:{}}},
  {name:"get_phone", description:"Get one phone + health + last screen", inputSchema:{type:"object", properties:{phoneId:{type:"string"}}, required:["phoneId"]}},
  {name:"warm_phone", description:"Warm a phone like a human (logNormal jitter)", inputSchema:{type:"object", properties:{slot:{type:"number", minimum:1, maximum:4}, minutes:{type:"number", default:30}}, required:["slot"]}},
  {name:"get_events", description:"Last chat bubbles for a phone", inputSchema:{type:"object", properties:{phoneId:{type:"string"}, limit:{type:"number", default:20}}, required:["phoneId"]}},
  {name:"get_phone_screen", description:"What the phone sees right now (base64 or mock)", inputSchema:{type:"object", properties:{phoneId:{type:"string"}}, required:["phoneId"]}},
];

let buffer="";
process.stdin.on("data", chunk=>{ buffer+=chunk; let idx;
  while((idx=buffer.indexOf("\n"))>=0){
    const line=buffer.slice(0,idx).trim(); buffer=buffer.slice(idx+1);
    if(!line) continue;
    try{ const msg=JSON.parse(line); handle(msg); }catch(e){ /*ignore*/ }
  }
});
function reply(id, result){ process.stdout.write(JSON.stringify({jsonrpc:"2.0", id, result})+"\n"); }
function handle(msg){
  const {id, method, params} = msg;
  if(method==="initialize") return reply(id, {protocolVersion:"2024-11-05", capabilities:{tools:{}, resources:{}}, serverInfo:{name:"octagon", version:"1.0"}});
  if(method==="notifications/initialized") return;
  if(method==="tools/list") return reply(id, {tools:TOOLS});
  if(method==="tools/call"){
    const {name, arguments:args} = params;
    try{
      let text="";
      if(name==="list_phones"){ const d=db(); const r=d.prepare("SELECT * FROM farm_devices").all(); d.close(); text=JSON.stringify(r, null, 2); }
      else if(name==="get_phone"){ const d=db(); const p=d.prepare("SELECT * FROM farm_devices WHERE id=?").get(args.phoneId); const h=d.prepare("SELECT * FROM farm_device_health WHERE device_id=?").get(args.phoneId); d.close(); text=JSON.stringify({phone:p, health:h}, null, 2); }
      else if(name==="warm_phone"){ const {slot, minutes=30}=args; const id=`phone${slot}`; const d=new Database(DB); d.prepare("INSERT OR REPLACE INTO farm_tasks (id,type,device_id,scheduled_for,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(`task_${Date.now()}`, "warmup", id, new Date().toISOString(), "scheduled", JSON.stringify({duration:minutes}), new Date().toISOString(), new Date().toISOString()); d.close(); text=`Queued warmup for ${id} ${minutes}m — hub will warm. Check get_events.`; }
      else if(name==="get_events"){ const d=db(); const r=d.prepare("SELECT ts,event FROM farm_events WHERE device_id=? ORDER BY ts DESC LIMIT ?").all(args.phoneId, args.limit||20); d.close(); text=JSON.stringify(r, null, 2); }
      else if(name==="get_phone_screen"){ text=JSON.stringify({phoneId:args.phoneId, screen:"mock base64 — in prod use idevicescreenshot -u $UDID | base64, Hermes sees it", jitter:0.34}, null, 2); }
      else text=`unknown tool ${name}`;
      return reply(id, {content:[{type:"text", text}]});
    }catch(e){ return reply(id, {content:[{type:"text", text:`error: ${e.message}`}], isError:true}); }
  }
  if(id) reply(id, {});
}
