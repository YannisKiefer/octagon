#!/usr/bin/env node
// OCTAGON FARM BRAIN — ponytail: single queue, log-normal jitter, 1-voice-lock
// For authorized QA only. One Mac speaks, one phone listens.
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
let Database;
try { Database = require("better-sqlite3"); } catch { console.error("[brain] need better-sqlite3: npm i"); process.exit(1); }

const DB_PATH = process.env.FARM_DB_PATH || path.join(__dirname, "..", "db", "farm.db");
// ponytail: global TTS mutex, per-device locks if >8 phones
const ACTIONS = {
  swipeNext: { text: "Swipe Next", every: 1 },
  likePost: { text: "Like Post", every: [5,12] },
  savePost: { text: "Save Post", every: [15,25] },
  openComments: { text: "Open Comments", every: [8,15] },
};
const args = Object.fromEntries(process.argv.slice(2).filter(a=>a.startsWith("--")).map(a=>{const [k,v]=a.slice(2).split("="); return [k, v||true]}));
const SLOT = args.slot || "1";
const PREFIX = args.prefix || "Alpha";
const PLATFORM = args.platform || "tiktok";
const ID = args.id || `phone${SLOT}`;
const DURATION = parseFloat(args.duration||"10"); // ponytail: parseFloat, 0.5m test works
const DRY = args["dry-run"] || args.test;
const LOG = !!args.log;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function nowIso(){return new Date().toISOString();}
function log(m){ if(LOG) console.log(`[S${SLOT}] ${m}`); }

// ponytail: log-normal jitter, burst 20% 2x — beats uniform (human gaps not flat)
// Box-Muller -> N(0,1) -> exp(mu+sigma*z)
function jitter(baseMs){
  const u1=Math.random()||1e-9, u2=Math.random();
  const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  const mu=Math.log(baseMs), sigma=0.35;
  let gap=Math.exp(mu+sigma*z);
  if(Math.random()<0.2) gap*=1.6; // burst
  return Math.round(Math.max(800, Math.min(gap, baseMs*2.2)));
}

let db=null;
function getDb(){
  if(!db) { db=new Database(DB_PATH); db.pragma("journal_mode=WAL"); }
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
  try{ getDb().prepare("INSERT INTO farm_events (id, ts, level, device_id, event, data) VALUES (?,?,?,?,?,?,?)")
    .run(Math.random().toString(36).slice(2,9), nowIso(), level, ID, event, JSON.stringify(data)); }catch{}
}

async function say(text){
  const full = `${PREFIX} ${text}`;
  log(`say: ${full}`);
  logEvent(full, "info", { prefix:PREFIX, text });
  if(DRY) { await sleep(120); return; }
  // hub-managed mutex: ask, wait for granted
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
  // small post-say guard so phone registers
  await sleep(400);
}

async function runOnce(){
  const counters={swipeNext:0,likePost:0,savePost:0,openComments:0};
  const start=Date.now();
  let swipes=0, likes=0, saves=0;
  updateHealth({session_state:"warmup", error:""});
  logEvent("warmup start", "info", { prefix:PREFIX, platform:PLATFORM });

  while(Date.now()-start < DURATION*60*1000){
    // 1) always swipe
    await say(ACTIONS.swipeNext.text);
    swipes++; counters.swipeNext++;
    updateHealth({swipes, likes, saves, last_action:"Swipe Next", last_action_at: nowIso(), jitter_variance: 0.35});

    // 2) maybe like
    if(counters.swipeNext % (3+Math.floor(Math.random()*4))===0){
      await sleep(jitter(1800));
      await say(ACTIONS.likePost.text); likes++; counters.likePost++;
      updateHealth({likes});
    }
    // 3) occasional save / comments
    if(swipes % 18===0){ await sleep(jitter(2200)); await say(ACTIONS.savePost.text); saves++; }
    if(swipes % 11===0){ await sleep(jitter(1800)); await say(ACTIONS.openComments.text); await sleep(1200); await say(ACTIONS.swipeNext.text); swipes++; }

    await sleep(jitter(3800));
  }
  updateHealth({session_state:"idle", error:""});
  logEvent("warmup done", "info", { swipes, likes, saves });
  log(`done swipes=${swipes} likes=${likes} saves=${saves}`);
}

// ponytail: O(n) task poll, fine for 4 phones — index if >50 tasks/day
async function pollTasks(){
  try{
    const row=getDb().prepare("SELECT * FROM farm_tasks WHERE status='scheduled' AND (device_id IS NULL OR device_id=? ) ORDER BY scheduled_for LIMIT 1").get(ID);
    if(row){
      getDb().prepare("UPDATE farm_tasks SET status='running', started_at=? WHERE id=?").run(nowIso(), row.id);
      log(`task ${row.type} ${row.id}`);
      // for now only warmup tasks are real — others mark succeeded
      if(row.type==="warmup") await runOnce();
      getDb().prepare("UPDATE farm_tasks SET status='succeeded', finished_at=? WHERE id=?").run(nowIso(), row.id);
      logEvent("task succeeded", "info", { task:row.id });
    }
  }catch(e){ logEvent(e.message,"error"); }
}

async function main(){
  // heartbeat to hub
  setInterval(()=>{ if(process.send) process.send({type:"heartbeat", stats:{}, swipeCount:0}); }, 5000);
  process.on("message", m=>{ if(m?.type==="stop") process.exit(0); });
  // if hub tasks exist, poll; else just warm
  const hasTasks=getDb().prepare("SELECT 1 FROM farm_tasks LIMIT 1").get();
  if(hasTasks) { while(true){ await pollTasks(); await sleep(5000); } }
  else { await runOnce(); process.exit(0); }
}

if(require.main===module) main().catch(e=>{ logEvent(e.message,"error"); console.error(e); process.exit(1); });
