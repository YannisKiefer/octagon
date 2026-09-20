#!/usr/bin/env node
// OCTAGON FARM BRAIN — per-phone session runner.
// Speaks one cue ("Alpha Swipe Next") through macOS TTS; the iPhone answers
// through its Voice Control custom command. One Mac speaks, one phone listens.
//
// The bundled routine paces swipes only. It performs no likes, comments,
// follows, or DMs, and it does not claim to make any account "safe" from
// moderation. Automating accounts can violate platform terms - use devices
// and accounts you own, and know the rules you operate under.
'use strict';
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
let Database;
try { Database = require("better-sqlite3"); } catch { console.error("[brain] better-sqlite3 not found. Run: cd infra/farm && npm install"); process.exit(1); }

const DB_PATH = process.env.FARM_DB_PATH || path.join(__dirname, "..", "db", "farm.db");
const CUE = "Swipe Next";

const args = Object.fromEntries(process.argv.slice(2).filter(a=>a.startsWith("--")).map(a=>{const [k,v]=a.slice(2).split("="); return [k, v||true]}));
const SLOT = args.slot || "1";
const PREFIX = args.prefix || "Alpha";
const ID = args.id || `phone${SLOT}`;
const DURATION = Math.min(Math.max(parseFloat(args.duration||"10") || 10, 0.1), 180); // minutes
const DRY = !!args["dry-run"];
const LOG = !!args.log;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function nowIso(){return new Date().toISOString();}
function log(m){ if(LOG) console.log(`[S${SLOT}] ${m}`); }

// Pacing: log-normal gaps with occasional longer pauses. The point is steady,
// non-metronomic timing for the device exercise - nothing more is claimed.
// Box-Muller -> N(0,1) -> exp(mu+sigma*z)
function jitter(baseMs){
  const u1=Math.random()||1e-9, u2=Math.random();
  const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  const mu=Math.log(baseMs), sigma=0.35;
  let gap=Math.exp(mu+sigma*z);
  if(Math.random()<0.2) gap*=1.6; // occasional longer pause
  return Math.round(Math.max(800, Math.min(gap, baseMs*2.2)));
}

let db=null;
function getDb(){
  if(!db) { db=new Database(DB_PATH); db.pragma("journal_mode=WAL"); db.pragma("busy_timeout=5000"); }
  return db;
}
function updateHealth(patch){
  try{
    const sets=Object.entries(patch).map(([k])=>`${k}=?`).join(", ");
    const vals=Object.values(patch);
    getDb().prepare(`UPDATE farm_device_health SET ${sets}, updated_at=? WHERE device_id=?`).run(...vals, nowIso(), ID);
  }catch{}
}
function logEvent(event, level="info", data={}){
  try{ getDb().prepare("INSERT INTO farm_events (id, ts, level, device_id, event, data) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), nowIso(), level, ID, event, JSON.stringify(data)); }catch{}
}

async function say(text){
  const full = `${PREFIX} ${text}`;
  log(`say: ${full}`);
  logEvent(`${PREFIX}: ${text}`, "info", { prefix:PREFIX, cue:text });
  if(DRY) { await sleep(120); return; }
  // hub-managed audio mutex: only one phone should listen at a time
  if(process.env.OCTAGON_HUB_MANAGED){
    await new Promise(res=>{
      const to=setTimeout(res, 4000);
      process.once("message", m=>{ if(m?.type==="audio-granted"){ clearTimeout(to); res(); }});
      if(process.send) process.send({type:"audio-request", estimatedDuration: 900});
    });
  }
  await new Promise((res,rej)=>{
    execFile("say", ["-v","Samantha", full], (e)=> e?rej(e):res());
  });
  // small post-say guard so the phone registers the command
  await sleep(400);
}

async function runSession(minutes){
  const start=Date.now();
  let swipes=0;
  updateHealth({session_state:"session", error:""});
  logEvent(`session start (${minutes}m${DRY?", dry-run":""})`, "info", { prefix:PREFIX, durationMinutes:minutes, dryRun:DRY });

  while(Date.now()-start < minutes*60*1000){
    await say(CUE);
    swipes++;
    updateHealth({swipes, last_action:CUE, last_action_at: nowIso(), jitter_variance: 0.35});
    await sleep(jitter(3800));
  }
  updateHealth({session_state:"idle", error:""});
  logEvent(`session done: ${swipes} swipes in ${minutes}m`, "info", { swipes });
  log(`done swipes=${swipes}`);
  return swipes;
}

// Task poll: only "session" tasks execute here. Anything else fails honestly.
async function pollTasks(){
  try{
    const row=getDb().prepare("SELECT * FROM farm_tasks WHERE status='scheduled' AND (device_id IS NULL OR device_id=?) ORDER BY scheduled_for LIMIT 1").get(ID);
    if(!row) return;
    getDb().prepare("UPDATE farm_tasks SET status='running', started_at=? WHERE id=?").run(nowIso(), row.id);
    log(`task ${row.type} ${row.id}`);
    if(row.type==="session"){
      try{
        const payload=JSON.parse(row.payload||"{}");
        const minutes=Math.min(Math.max(parseFloat(payload.duration_minutes)||10, 0.1), 180);
        await runSession(minutes);
        getDb().prepare("UPDATE farm_tasks SET status='succeeded', finished_at=?, result=? WHERE id=?").run(nowIso(), "session completed", row.id);
        logEvent("task succeeded", "info", { task:row.id });
      }catch(e){
        getDb().prepare("UPDATE farm_tasks SET status='failed', finished_at=?, error=? WHERE id=?").run(nowIso(), e.message, row.id);
        logEvent(`task failed: ${e.message}`, "error", { task:row.id });
      }
    } else {
      const msg=`task type "${row.type}" is not implemented in this build - nothing was executed`;
      getDb().prepare("UPDATE farm_tasks SET status='failed', finished_at=?, error=? WHERE id=?").run(nowIso(), msg, row.id);
      logEvent(msg, "error", { task:row.id });
    }
  }catch(e){ logEvent(e.message,"error"); }
}

async function main(){
  // heartbeat to hub
  setInterval(()=>{ if(process.send) process.send({type:"heartbeat", stats:{}, swipeCount:0}); }, 5000);
  process.on("message", m=>{ if(m?.type==="stop") process.exit(0); });
  // if tasks exist, poll; otherwise run one standalone session
  const hasTasks=getDb().prepare("SELECT 1 FROM farm_tasks LIMIT 1").get();
  if(hasTasks) { while(true){ await pollTasks(); await sleep(5000); } }
  else { await runSession(DURATION); process.exit(0); }
}

if(require.main===module) main().catch(e=>{ logEvent(e.message,"error"); console.error(e); process.exit(1); });
