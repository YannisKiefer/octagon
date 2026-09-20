#!/usr/bin/env node
// Octagon demo seeder — resets infra/db/farm.db and fills it with SYNTHETIC demo
// data so you can explore the dashboard without iPhones.
//
//   node scripts/seed-demo.js
//
// Everything this writes is fake. No real devices, accounts or activity.
'use strict';

const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const dbArg = process.env.FARM_DB_PATH;
const DB_PATH = dbArg
  ? (path.isAbsolute(dbArg) ? dbArg : path.join(ROOT, dbArg))
  : path.join(ROOT, 'infra', 'db', 'farm.db');

// Resolve better-sqlite3 from infra/farm (where npm install puts it).
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  try {
    const farmRequire = createRequire(path.join(ROOT, 'infra', 'farm', 'package.json'));
    Database = farmRequire('better-sqlite3');
  } catch (e) {
    console.error('better-sqlite3 is not installed. Run:  cd infra/farm && npm install');
    process.exit(1);
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS farm_devices (
    id TEXT PRIMARY KEY,
    phone_number INTEGER NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    voice_prefix TEXT NOT NULL,
    usb_udid TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS farm_device_health (
    device_id TEXT PRIMARY KEY,
    usb_connected INTEGER DEFAULT 0,
    last_usb_seen_at TEXT,
    session_state TEXT DEFAULT 'idle',
    current_task_id TEXT DEFAULT '',
    swipes INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    profiles INTEGER DEFAULT 0,
    last_action TEXT DEFAULT '',
    last_action_at TEXT,
    jitter_variance REAL DEFAULT 0.0,
    error TEXT DEFAULT '',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (device_id) REFERENCES farm_devices(id)
  );
  CREATE TABLE IF NOT EXISTS farm_tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    device_id TEXT,
    scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    payload TEXT DEFAULT '{}',
    started_at TEXT,
    finished_at TEXT,
    result TEXT DEFAULT '',
    error TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (device_id) REFERENCES farm_devices(id)
  );
  CREATE TABLE IF NOT EXISTS farm_events (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    device_id TEXT,
    task_id TEXT,
    event TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    FOREIGN KEY (device_id) REFERENCES farm_devices(id),
    FOREIGN KEY (task_id) REFERENCES farm_tasks(id)
  );
`;

const DEVICES = [
  { id: 'phone1', n: 1, prefix: 'Alpha', udid: '00008101-DEMOA1B2C3D4' },
  { id: 'phone2', n: 2, prefix: 'Bravo', udid: '00008101-DEMOE5F6G7H8' },
  { id: 'phone3', n: 3, prefix: 'Charlie', udid: '' },
  { id: 'phone4', n: 4, prefix: 'Delta', udid: '00008101-DEMOJ9K0L1M2' },
];

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

// Synthetic demo transcript. Clearly about wiring checks and pacing sessions —
// it must read the same way the real product behaves.
const EVENTS = [
  { device: 'phone1', min: 240, side: 'user', text: 'run 20' },
  { device: 'phone1', min: 240, side: 'agent', text: 'Queued a 20-minute session for Alpha. It starts when the hub is running; progress lands here.' },
  { device: 'phone1', min: 238, side: 'agent', text: 'Session started. Voice Control link looks good — Alpha answered its cue.' },
  { device: 'phone1', min: 219, side: 'agent', text: 'Session finished: 214 swipes in 20 min, average gap 4.9s. No errors.' },
  { device: 'phone2', min: 180, side: 'user', text: 'status' },
  { device: 'phone2', min: 180, side: 'agent', text: 'Bravo: idle, 0 sessions today, no errors. Last USB seen 3 min ago.' },
  { device: 'phone4', min: 95, side: 'user', text: 'run 15' },
  { device: 'phone4', min: 95, side: 'agent', text: 'Queued a 15-minute session for Delta.' },
  { device: 'phone4', min: 80, side: 'agent', text: 'Session finished: 151 swipes in 15 min, average gap 5.2s. No errors.' },
  { device: 'phone1', min: 30, side: 'agent', text: 'Hub heartbeat healthy. 3 devices online, 1 offline (Charlie is unplugged).' },
];

function main() {
  if (!fs.existsSync(DB_PATH)) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* first run: nothing to reset */ }
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const now = new Date().toISOString();
  const insertDevice = db.prepare(
    'INSERT INTO farm_devices (id, phone_number, display_name, voice_prefix, usb_udid, active, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)'
  );
  const insertHealth = db.prepare(
    'INSERT INTO farm_device_health (device_id, usb_connected, session_state, swipes, last_action, last_action_at, jitter_variance, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  );

  const health = {
    phone1: [1, 'idle', 214, 'Swipe Next', minutesAgo(219), 0.35],
    phone2: [1, 'idle', 0, '', null, 0],
    phone3: [0, 'idle', 0, '', null, 0],
    phone4: [1, 'idle', 151, 'Swipe Next', minutesAgo(80), 0.35],
  };

  for (const d of DEVICES) {
    insertDevice.run(d.id, d.n, `${d.prefix} (Phone ${d.n})`, d.prefix, d.udid, now, now);
    const [usb, state, swipes, lastAction, lastActionAt, jitter] = health[d.id];
    insertHealth.run(d.id, usb, state, swipes, lastAction, lastActionAt, jitter, now);
  }

  const insertEvent = db.prepare(
    'INSERT INTO farm_events (id, ts, level, device_id, event, data) VALUES (?,?,?,?,?,?)'
  );
  let i = 0;
  for (const e of EVENTS) {
    insertEvent.run(`demo${String(++i).padStart(2, '0')}`, minutesAgo(e.min), 'info', e.device, e.text, JSON.stringify({ side: e.side }));
  }

  const counts = {
    devices: db.prepare('SELECT COUNT(*) c FROM farm_devices').get().c,
    events: db.prepare('SELECT COUNT(*) c FROM farm_events').get().c,
  };
  db.close();
  console.log(`Seeded demo data at ${DB_PATH}`);
  console.log(`  devices: ${counts.devices}, events: ${counts.events} (all synthetic)`);
  console.log('Start the dashboard: cd apps/dashboard && npm run dev');
}

main();
