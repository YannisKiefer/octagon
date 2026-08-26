#!/usr/bin/env node
// PHONE FARM HUB — ponytail: one lock, 5s heartbeat, 3 restarts, stagger
'use strict';
const { fork } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const getArg = (n,d)=>{const m=process.argv.slice(2).find(a=>a.startsWith(`--${n}=`)); return m?m.split("=")[1]:d};
const SLOTS = parseInt(getArg('slots','4'),10);
const DUR = parseInt(getArg('duration','60'),10);
const TEST = process.argv.includes('--test');
const DB_PATH = path.join(__dirname, '..', 'db', 'farm.db'); // ponytail: 4 tables, no supabase
const WORKER = path.join(__dirname, 'farm-brain.js');
const SLOTS_CFG=[
  {slot:'1', prefix:'Alpha',   platform:'tiktok',    accountId:'farm_device_1'},
  {slot:'2', prefix:'Bravo',   platform:'tiktok',    accountId:'farm_device_2'},
  {slot:'3', prefix:'Charlie', platform:'instagram', accountId:'farm_device_3'},
  {slot:'4', prefix:'Delta',   platform:'youtube',   accountId:'farm_device_4'},
];
const workers={};
let locked=false, q=[];
function acquire(slot){ return new Promise(r=>{ const tryA=()=>{ if(!locked){locked=true; r();} else q.push(tryA);}; tryA();});}
function release(){ locked=false; if(q.length) q.shift()(); }
function log(m){ console.log(`[HUB] ${m}`); }

function spawn(cfg){
  const {slot,prefix,platform,accountId}=cfg;
  log(`S${slot} ${prefix} → ${platform}`);
  const child=fork(WORKER, [`--slot=${slot}`,`--prefix=${prefix}`,`--platform=${platform}`,`--id=${accountId}`,`--duration=${DUR}`,'--hub-worker'], {stdio:['pipe','pipe','pipe','ipc'], env:{...process.env, FARM_HUB_MANAGED:'1'}});
  const st={proc:child, cfg, status:'starting', last:Date.now(), restarts:0};
  child.on('message', m=>{
    if(m?.type==='heartbeat'){ st.last=Date.now(); st.status='active'; }
    if(m?.type==='audio-request'){ acquire(slot).then(()=>{ child.send({type:'audio-granted'}); setTimeout(release, m.estimatedDuration||1200); });}
  });
  if(!TEST){ child.stdout.on('data', d=>process.stdout.write(`[S${slot}] ${d}`)); child.stderr.on('data', d=>process.stderr.write(`[S${slot} ERR] ${d}`));}
  child.on('exit', (c,s)=>{
    if(st.status==='stopped') return;
    st.status='offline';
    if(st.restarts<3){ st.restarts++; log(`S${slot} restart ${st.restarts}/3`); setTimeout(()=>{workers[slot]=spawn(cfg); workers[slot].restarts=st.restarts;}, 3000+Math.random()*1500); }
    else log(`S${slot} max restarts`);
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
    try{
      const db=new Database(DB_PATH); db.exec(`CREATE TABLE IF NOT EXISTS hub_status(id TEXT PRIMARY KEY, active INTEGER, locked INTEGER, ts TEXT)`);
      const active=Object.values(workers).filter(w=>w.status==='active').length;
      db.prepare(`INSERT INTO hub_status(id,active,locked,ts) VALUES('hub',?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active, locked=excluded.locked, ts=excluded.ts`).run(active, locked?1:0, new Date().toISOString()); db.close();
    }catch{}
  },5000);
}
async function main(){
  console.log(`\nOCTAGON HUB — ${SLOTS} slots, ${DUR}m, test=${TEST}\n`);
  const toSpawn=SLOTS_CFG.slice(0, SLOTS);
  for(let i=0;i<toSpawn.length;i++){
    spawn(toSpawn[i]);
    if(i<toSpawn.length-1) await new Promise(r=>setTimeout(r, 3000+Math.random()*1500));
  }
  health();
  setInterval(()=>{
    const line=Object.entries(workers).map(([s,w])=>`S${s}:${w.status}`).join(" ");
    console.log(`[HUB] ${line} lock=${locked?'🔒':'🔓'} q=${q.length}`);
  }, 30000);
  const shut=()=>{ for(const w of Object.values(workers)){ w.status='stopped'; try{w.proc.send({type:'stop'});}catch{w.proc.kill('SIGTERM');}} setTimeout(()=>process.exit(0),2000);};
  process.on('SIGINT',shut); process.on('SIGTERM',shut);
}
main().catch(e=>{ console.error(e); process.exit(1); });
