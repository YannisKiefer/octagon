#!/usr/bin/env node
// Octagon MCP server — exposes the local farm over stdio to any MCP client
// (Claude Desktop, Claude Code, or your own agent).
//
// Tools:
//   list_phones                      → devices + health
//   get_phone {phoneId}              → one device + health
//   run_session {slot, minutes}      → queue a pacing session (hub/brain executes)
//   get_events {phoneId, limit}      → recent chat/event bubbles
//   get_phone_screen {phoneId}       → real screenshot via idevicescreenshot,
//                                      or an explicit "unavailable" answer
//
// Local stdio server: no network listener, no auth by design. Do not expose it
// over HTTP. Read access is limited to the local SQLite file.
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let Database;
try { Database = require("better-sqlite3"); } catch { Database = require("../infra/farm/node_modules/better-sqlite3"); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.FARM_DB_PATH || path.join(__dirname, "../infra/db/farm.db");

function db(){ return new Database(DB, {readonly:true}); }

const TOOLS = [
  {name:"list_phones", description:"List phones registered in the local Octagon farm", inputSchema:{type:"object", properties:{}}},
  {name:"get_phone", description:"Get one phone with its health record", inputSchema:{type:"object", properties:{phoneId:{type:"string"}}, required:["phoneId"]}},
  {name:"run_session", description:"Queue a pacing session (swipe pacing over iOS Voice Control) for a phone. Executes only while the hub is running.", inputSchema:{type:"object", properties:{slot:{type:"number", minimum:1, maximum:8}, minutes:{type:"number", default:10, minimum:1, maximum:180}}, required:["slot"]}},
  {name:"get_events", description:"Recent events (chat bubbles) for a phone", inputSchema:{type:"object", properties:{phoneId:{type:"string"}, limit:{type:"number", default:20}}, required:["phoneId"]}},
  {name:"get_phone_screen", description:"Capture the phone screen via idevicescreenshot (needs libimobiledevice and the device usb_udid). Returns an explicit unavailable message when capture is not possible - never a placeholder image.", inputSchema:{type:"object", properties:{phoneId:{type:"string"}}, required:["phoneId"]}},
];

async function captureScreen(phoneId){
  let device, udid;
  try{
    const d=db();
    try{
      device=d.prepare("SELECT id, usb_udid FROM farm_devices WHERE id=?").get(phoneId);
    } finally { d.close(); }
  }catch(e){
    return {available:false, reason:`local database unavailable: ${e.message}`};
  }
  if(!device) return {available:false, reason:`unknown phone ${phoneId}`};
  udid=device.usb_udid;
  if(!udid) return {available:false, reason:`no usb_udid configured for ${phoneId} (set FARM_PHONEn_UDID in .env)`};
  const have = await new Promise(res=>execFile("which",["idevicescreenshot"],e=>res(!e)));
  if(!have) return {available:false, reason:"idevicescreenshot not installed (brew install libimobiledevice)"};
  try{
    const out = await new Promise((res,rej)=>execFile("idevicescreenshot",["-u",udid],(e,stdout)=>e?rej(e):res(stdout)));
    return {available:true, note:"screenshot written to current directory by idevicescreenshot", output:String(out||"").trim()};
  }catch(e){
    return {available:false, reason:`capture failed: ${e.message}`};
  }
}

let buffer="";
process.stdin.on("data", chunk=>{ buffer+=chunk; let idx;
  while((idx=buffer.indexOf("\n"))>=0){
    const line=buffer.slice(0,idx).trim(); buffer=buffer.slice(idx+1);
    if(!line) continue;
    try{ const msg=JSON.parse(line); handle(msg); }catch(e){ /* ignore malformed lines */ }
  }
});
function reply(id, result){ process.stdout.write(JSON.stringify({jsonrpc:"2.0", id, result})+"\n"); }
function handle(msg){
  const {id, method, params} = msg;
  if(method==="initialize") return reply(id, {protocolVersion:"2024-11-05", capabilities:{tools:{}, resources:{}}, serverInfo:{name:"octagon", version:"1.1.0"}});
  if(method==="notifications/initialized") return;
  if(method==="tools/list") return reply(id, {tools:TOOLS});
  if(method==="tools/call"){
    const {name, arguments:args} = params;
    try{
      let text="";
      if(name==="list_phones"){ const d=db(); const r=d.prepare("SELECT * FROM farm_devices").all(); d.close(); text=JSON.stringify(r, null, 2); }
      else if(name==="get_phone"){ const d=db(); const p=d.prepare("SELECT * FROM farm_devices WHERE id=?").get(args.phoneId); const h=d.prepare("SELECT * FROM farm_device_health WHERE device_id=?").get(args.phoneId); d.close(); text=JSON.stringify({phone:p, health:h}, null, 2); }
      else if(name==="run_session"){
        const {slot, minutes=10}=args;
        const minutesN=Math.min(Math.max(Number(minutes)||10,1),180);
        const id2=`phone${slot}`;
        const d=new Database(DB);
        try{
          const exists=d.prepare("SELECT id FROM farm_devices WHERE id=?").get(id2);
          if(!exists){ text=`No device ${id2} in the local farm. Call list_phones first.`; }
          else{
            d.prepare("INSERT INTO farm_tasks (id,type,device_id,scheduled_for,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(require("crypto").randomUUID(), "session", id2, new Date().toISOString(), "scheduled", JSON.stringify({duration_minutes:minutesN, source:"mcp"}), new Date().toISOString(), new Date().toISOString());
            text=`Queued a ${minutesN}-minute session for ${id2}. It runs while the hub is up; check get_events.`;
          }
        } finally { d.close(); }
      }
      else if(name==="get_events"){ const d=db(); const r=d.prepare("SELECT ts,level,event FROM farm_events WHERE device_id=? ORDER BY ts DESC LIMIT ?").all(args.phoneId, Math.min(Math.max(parseInt(args.limit)||20, 1), 200)); d.close(); text=JSON.stringify(r, null, 2); }
      else if(name==="get_phone_screen"){ captureScreen(args.phoneId).then(r=>reply(id, {content:[{type:"text", text:JSON.stringify(r, null, 2)}]})).catch(e=>reply(id, {content:[{type:"text", text:`error: ${e.message}`}], isError:true})); return; }
      else { text=`unknown tool ${name}`; return reply(id, {content:[{type:"text", text}], isError:true}); }
      return reply(id, {content:[{type:"text", text}]});
    }catch(e){ return reply(id, {content:[{type:"text", text:`error: ${e.message}`}], isError:true}); }
  }
  if(id) reply(id, {});
}
