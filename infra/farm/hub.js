#!/usr/bin/env node
// OCTAGON HUB — spawns one farm-brain per phone, staggers starts, keeps a
// global audio lock (one phone listens at a time), heartbeats, 3 restarts.
'use strict';
const { fork } = require('child_process');
const path = require('path');
let Database;
try { Database = require('better-sqlite3'); } catch { console.error('[hub] better-sqlite3 not found. Run: cd infra/farm && npm install'); process.exit(1); }

const getArg = (n,d)=>{const m=process.argv.slice(2).find(a=>a.startsWith(`--${n}=`)); return m?m.split("=")[1]:d};
const SLOTS = parseInt(getArg('slots','4'),10);
const DUR = parseFloat(getArg('duration','60')); // minutes, fractions allowed
const TEST = process.argv.includes('--test'); // --test = silent dry run: no TTS, no chatter
const DB_PATH = process.env.FARM_DB_PATH || path.join(__dirname, '..', 'db', 'farm.db');
const WORKER = path.join(__dirname, 'farm-brain.js');

// Slots come from the device registry (farm_devices), so phones added through
// the dashboard or MCP are picked up too. Falls back to the four defaults when
// the registry is empty or unreadable.
function slotConfigs(){
  try{
    const db=new Database(DB_PATH, { readonly:true });
    const rows=db.prepare("SELECT id, voice_prefix FROM farm_devices WHERE active=1 ORDER BY phone_number LIMIT ?").all(SLOTS);
    db.close();
    if(rows.length) return rows.map((r,i)=>({slot:String(i+1), prefix:r.voice_prefix, id:r.id}));
  }catch(e){ log(`device registry unreadable (${e.message}); using defaults`); }
  return [
    {slot:'1', prefix:'Alpha',   id:'phone1'},
    {slot:'2', prefix:'Bravo',   id:'phone2'},
    {slot:'3', prefix:'Charlie', id:'phone3'},
    {slot:'4', prefix:'Delta',   id:'phone4'},
  ].slice(0, SLOTS);
}
const workers={};
let locked=false, q=[];
function acquire(slot){ return new Promise(r=>{ const tryA=()=>{ if(!locked){locked=true; r();} else q.push(tryA);}; tryA();});}
function release(){ locked=false; if(q.length) q.shift()(); }
function log(m){ console.log(`[HUB] ${m}`); }
function hubEvent(deviceId, event, level){
  try{
    const db=new Database(DB_PATH);
    db.prepare("INSERT INTO farm_events (id, ts, level, device_id, event, data) VALUES (?,?,?,?,?,?)")
      .run(require('crypto').randomUUID(), new Date().toISOString(), level||'warn', deviceId, event, '{}');
    db.close();
  }catch{}
}

function spawn(cfg){
  const {slot,prefix,id}=cfg;
  log(`S${slot} ${prefix} (${id})${TEST?' — dry run':''}`);
  const workerArgs=[`--slot=${slot}`,`--prefix=${prefix}`,`--id=${id}`,`--duration=${DUR}`,'--hub-worker'];
  if(TEST) workerArgs.push('--dry-run');
  const child=fork(WORKER, workerArgs, {stdio:['pipe','pipe','pipe','ipc'], env:{...process.env, OCTAGON_HUB_MANAGED:'1'}});
  const st={proc:child, cfg, status:'starting', last:Date.now(), restarts:0};
  child.on('message', m=>{
    if(m?.type==='heartbeat'){ st.last=Date.now(); st.status='active'; }
    if(m?.type==='audio-request'){ acquire(slot).then(()=>{ try{ child.send({type:'audio-granted'}); }catch{} setTimeout(release, m.estimatedDuration||2500); });}
  });
  if(!TEST){ child.stdout.on('data', d=>process.stdout.write(`[S${slot}] ${d}`)); child.stderr.on('data', d=>process.stderr.write(`[S${slot} ERR] ${d}`));}
  child.on('exit', (c,s)=>{
    if(st.status==='stopped') return;
    st.status='offline';
    hubEvent(cfg.id, `${cfg.prefix} went offline; restarting (up to 3)`, 'warn');
    if(st.restarts<3){ st.restarts++; log(`S${slot} restart ${st.restarts}/3`); setTimeout(()=>{workers[slot]=spawn(cfg); workers[slot].restarts=st.restarts;}, 3000+Math.random()*1500); }
    else { log(`S${slot} max restarts`); hubEvent(cfg.id, `${cfg.prefix} hit the restart limit and is offline. Restart the hub to bring it back.`, 'error'); }
  });
  workers[slot]=st; return st;
}
function health(){
  setInterval(()=>{
    const now=Date.now();
    for(const [slot,w] of Object.entries(workers)){
      if(w.status==='stopped') continue;
      const miss=Math.floor((now-w.last)/5000);
      if(miss>=10 && w.status!=='offline'){ w.status='offline'; log(`S${slot} OFFLINE`); }
      else if(miss>=3 && w.status!=='degraded'){ w.status='degraded'; log(`S${slot} degraded`); }
    }
    const active=Object.values(workers).filter(w=>w.status==='active').length;
    try{
      const db=new Database(DB_PATH);
      db.pragma("busy_timeout=5000");
      // handle drift from older schemas: drop hub_status and recreate once
      try{ const cols=db.prepare("PRAGMA table_info(hub_status)").all().map(c=>c.name); if(cols.length && !cols.includes("active")) db.exec("DROP TABLE hub_status"); }catch{}
      db.exec(`CREATE TABLE IF NOT EXISTS hub_status(id TEXT PRIMARY KEY, active INTEGER, locked INTEGER, ts TEXT)`);
      db.prepare(`INSERT INTO hub_status(id,active,locked,ts) VALUES('hub',?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active, locked=excluded.locked, ts=excluded.ts`).run(active, locked?1:0, new Date().toISOString()); db.close();
    }catch{}
  },5000);
}
async function main(){
  console.log(`\nOCTAGON HUB — ${SLOTS} slots, ${DUR}m${TEST?', dry run':''}\n`);
  const toSpawn=slotConfigs();
  for(let i=0;i<toSpawn.length;i++){
    spawn(toSpawn[i]);
    if(i<toSpawn.length-1) await new Promise(r=>setTimeout(r, 3000+Math.random()*1500));
  }
  health();
  setInterval(()=>{
    const line=Object.entries(workers).map(([s,w])=>`S${s}:${w.status}`).join(" ");
    console.log(`[HUB] ${line} lock=${locked?'y':'n'} q=${q.length}`);
  }, 30000);
  const shut=()=>{ for(const w of Object.values(workers)){ w.status='stopped'; try{w.proc.send({type:'stop'});}catch{w.proc.kill('SIGTERM');}} setTimeout(()=>process.exit(0),2000);};
  process.on('SIGINT',shut); process.on('SIGTERM',shut);
}
main().catch(e=>{ console.error(e); process.exit(1); });
