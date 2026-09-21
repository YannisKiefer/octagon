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
//   list_agents                      → active agents of the multi-agent layer
//   create_agent {name, role, device_id?} → add an agent (phone needs a device)
//   assign_agent {agentId, deviceId} → move an agent to another device
//   handoff_task {taskId, toAgentId, note?} → hand a task to a phone agent
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
  {name:"run_session", description:"Queue a pacing session (swipe pacing over iOS Voice Control) for a phone. Executes only while the hub is running. The session appears in the group chat and can be handed off to another agent via handoff_task.", inputSchema:{type:"object", properties:{slot:{type:"number", minimum:1, maximum:8}, minutes:{type:"number", default:10, minimum:1, maximum:180}}, required:["slot"]}},
  {name:"get_events", description:"Recent events (chat bubbles) for a phone", inputSchema:{type:"object", properties:{phoneId:{type:"string"}, limit:{type:"number", default:20}}, required:["phoneId"]}},
  {name:"get_phone_screen", description:"Capture the phone screen via idevicescreenshot (needs libimobiledevice and the device usb_udid). Returns an explicit unavailable message when capture is not possible - never a placeholder image.", inputSchema:{type:"object", properties:{phoneId:{type:"string"}}, required:["phoneId"]}},
  {name:"list_agents", description:"List the active agents of the multi-agent layer (supervisor, monitor, phone), shared with the dashboard", inputSchema:{type:"object", properties:{}}},
  {name:"create_agent", description:"Create an agent. Role is one of phone, monitor, supervisor, custom. Phone agents must reference an existing device, and a device can hold only one phone agent.", inputSchema:{type:"object", properties:{name:{type:"string", minLength:2, maxLength:24}, role:{type:"string", enum:["phone","monitor","supervisor","custom"]}, device_id:{type:"string"}}, required:["name","role"]}},
  {name:"assign_agent", description:"Move an active agent to another registered device", inputSchema:{type:"object", properties:{agentId:{type:"string"}, deviceId:{type:"string"}}, required:["agentId","deviceId"]}},
  {name:"handoff_task", description:"Hand a task to a phone agent: the task moves to that agent's device and a handoff event lands in the group chat. Monitor and supervisor agents do not execute tasks, so handing off to them is refused.", inputSchema:{type:"object", properties:{taskId:{type:"string"}, toAgentId:{type:"string"}, note:{type:"string"}}, required:["taskId","toAgentId"]}},
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

// Mirrors the dashboard's humanizeTaskTitle so handoff event text reads the
// same in the group chat ("Pacing session - 10 min").
function taskTitle(task){
  if(task.type!=="session") return String(task.type);
  try{
    const p=JSON.parse(task.payload||"{}");
    const m=Number(p&&p.duration_minutes);
    if(Number.isFinite(m)&&m>0) return `Pacing session - ${Math.round(m)} min`;
  }catch{ /* fall through to the generic title */ }
  return "Pacing session";
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
  if(method==="initialize") return reply(id, {protocolVersion:"2024-11-05", capabilities:{tools:{}, resources:{}}, serverInfo:{name:"octagon", version:"1.2.0"}});
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
      else if(name==="list_agents"){
        const d=db();
        let rows;
        try{ rows=d.prepare("SELECT id, name, role, device_id, status FROM farm_agents WHERE active=1 ORDER BY created_at").all(); }
        catch(e){
          d.close();
          if(/no such table/i.test(String(e.message))) return reply(id, {content:[{type:"text", text:"farm_agents table not found. Start the dashboard once so it creates the multi-agent schema, or point FARM_DB_PATH at a seeded database."}], isError:true});
          throw e;
        }
        d.close();
        text=JSON.stringify(rows, null, 2);
      }
      else if(name==="create_agent"){
        const aname=String(args.name||"").trim();
        const role=String(args.role||"").trim();
        const deviceId=args.device_id?String(args.device_id).trim():"";
        if(aname.length<2||aname.length>24) return reply(id, {content:[{type:"text", text:"name must be 2-24 characters"}], isError:true});
        if(!["phone","monitor","supervisor","custom"].includes(role)) return reply(id, {content:[{type:"text", text:"role must be one of phone, monitor, supervisor, custom"}], isError:true});
        if(role==="phone"&&!deviceId) return reply(id, {content:[{type:"text", text:"phone agents require a device_id (see list_phones)"}], isError:true});
        const d=new Database(DB);
        try{
          if(deviceId){
            const dev=d.prepare("SELECT id FROM farm_devices WHERE id=? AND active=1").get(deviceId);
            if(!dev) return reply(id, {content:[{type:"text", text:"Unknown device_id"}], isError:true});
            if(role==="phone"){
              const holder=d.prepare("SELECT name FROM farm_agents WHERE device_id=? AND active=1").get(deviceId);
              if(holder) return reply(id, {content:[{type:"text", text:`device ${deviceId} already has an agent (${holder.name})`}], isError:true});
            }
          }
          const dup=d.prepare("SELECT id FROM farm_agents WHERE lower(name)=lower(?)").get(aname);
          if(dup) return reply(id, {content:[{type:"text", text:"an agent with this name already exists"}], isError:true});
          const now=new Date().toISOString();
          const aid=require("crypto").randomUUID();
          d.prepare("INSERT INTO farm_agents (id, name, role, device_id, color, status, active, created_at, updated_at) VALUES (?, ?, ?, ?, '#529BFF', 'idle', 1, ?, ?)").run(aid, aname, role, deviceId||null, now, now);
          text=JSON.stringify(d.prepare("SELECT id, name, role, device_id, color, status, active, created_at, updated_at FROM farm_agents WHERE id=?").get(aid), null, 2);
        } finally { d.close(); }
      }
      else if(name==="assign_agent"){
        const d=new Database(DB);
        try{
          const ag=d.prepare("SELECT id FROM farm_agents WHERE id=? AND active=1").get(args.agentId);
          if(!ag) return reply(id, {content:[{type:"text", text:"Unknown agent"}], isError:true});
          const dev=d.prepare("SELECT id FROM farm_devices WHERE id=? AND active=1").get(args.deviceId);
          if(!dev) return reply(id, {content:[{type:"text", text:"Unknown device_id"}], isError:true});
          d.prepare("UPDATE farm_agents SET device_id=?, updated_at=? WHERE id=? AND active=1").run(args.deviceId, new Date().toISOString(), args.agentId);
          text=JSON.stringify(d.prepare("SELECT id, name, role, device_id, status FROM farm_agents WHERE id=?").get(args.agentId), null, 2);
        } finally { d.close(); }
      }
      else if(name==="handoff_task"){
        const d=new Database(DB);
        try{
          const target=d.prepare("SELECT id, name, role, device_id FROM farm_agents WHERE id=? AND active=1").get(args.toAgentId);
          if(!target) return reply(id, {content:[{type:"text", text:"Unknown agent"}], isError:true});
          if(target.role!=="phone") return reply(id, {content:[{type:"text", text:`Handoff refused: ${target.name} is a ${target.role} agent. Monitor and supervisor agents observe and coordinate but do not execute tasks on devices, so nothing was moved.`}], isError:true});
          if(!target.device_id) return reply(id, {content:[{type:"text", text:`Handoff refused: ${target.name} has no device assigned (use assign_agent first), so nothing was moved.`}], isError:true});
          const task=d.prepare("SELECT id, type, device_id, payload FROM farm_tasks WHERE id=?").get(args.taskId);
          if(!task) return reply(id, {content:[{type:"text", text:"Unknown task"}], isError:true});
          const owner=task.device_id?d.prepare("SELECT name FROM farm_agents WHERE device_id=? AND active=1").get(task.device_id):null;
          const fromName=owner?owner.name:(task.device_id||"unassigned");
          const now=new Date().toISOString();
          const title=taskTitle(task);
          d.prepare("UPDATE farm_tasks SET device_id=?, updated_at=? WHERE id=?").run(target.device_id, now, args.taskId);
          const note=args.note?String(args.note).trim():"";
          const eventText=`Handoff: ${fromName} handed '${title}' to ${target.name}`+(note?` - ${note}`:"");
          d.prepare("INSERT INTO farm_events (id, ts, level, device_id, task_id, event, data) VALUES (?, ?, 'info', ?, ?, ?, ?)").run(require("crypto").randomUUID(), now, target.device_id, args.taskId, eventText, JSON.stringify({agentId:target.id, kind:"handoff"}));
          text=`Handed '${title}' from ${fromName} to ${target.name}. The task now runs on ${target.device_id} while the hub is up; see get_events.`;
        } finally { d.close(); }
      }
      else { text=`unknown tool ${name}`; return reply(id, {content:[{type:"text", text}], isError:true}); }
      return reply(id, {content:[{type:"text", text}]});
    }catch(e){ return reply(id, {content:[{type:"text", text:`error: ${e.message}`}], isError:true}); }
  }
  if(id) reply(id, {});
}
