#!/usr/bin/env node
/**
 * 🏗️ PHONE FARM HUB — Multi-Device Orchestrator
 *
 * Architecture stolen from GADS (Hub-Provider model):
 * Hub = this process (central command)
 * Provider = each farm-brain.js worker (one per phone slot)
 *
 * Features:
 *   - Spawns N child processes (one per phone slot)
 *   - Global audio mutex (prevents TTS collision)
 *   - Per-device command queue isolation
 *   - Health heartbeat monitoring (5s interval)
 *   - Self-healing: auto-restart, battery management, TTS watchdog
 *   - IPC communication with workers
 *
 * Usage:
 *   node farm/hub.js --slots=4 --duration=60
 *   node farm/hub.js --slots=2 --duration=10 --test
 */

'use strict';

const { fork } = require('child_process');
const path = require('path');
const chalk = require('chalk');
const Database = require('better-sqlite3');

// ─── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : def;
};

const TOTAL_SLOTS = parseInt(getArg('slots', '4'));
const DURATION = parseInt(getArg('duration', '60'));
const TEST_MODE = args.includes('--test');
const DB_PATH = path.join(__dirname, '..', 'data', 'db', 'farm.db');
const WORKER_SCRIPT = path.join(__dirname, 'farm-brain.js');

// Slot configuration: maps slot number → phone prefix and platform
const SLOT_CONFIG = [
  { slot: '1', prefix: 'Alpha',   platform: 'tiktok',    accountId: 'farm_device_1' },
  { slot: '2', prefix: 'Bravo',   platform: 'tiktok',    accountId: 'farm_device_2' },
  { slot: '3', prefix: 'Charlie', platform: 'instagram', accountId: 'farm_device_3' },
  { slot: '4', prefix: 'Delta',   platform: 'youtube',   accountId: 'farm_device_4' },
];

// ─── State ─────────────────────────────────────────────────────────────────────

const workers = {};           // slot → { process, config, state }
const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TIMEOUT = 3;  // missed heartbeats before degraded
const HEARTBEAT_DEAD = 10;    // missed heartbeats before offline
const MAX_RESTARTS = 3;       // max auto-restarts per worker

// Global audio mutex — only one TTS command at a time
let audioMutexLocked = false;
const audioQueue = [];

// ─── Audio Mutex ───────────────────────────────────────────────────────────────

/**
 * Ensures only one TTS/afplay command executes at a time across all workers.
 * This prevents audio collision when multiple phones are listening.
 */
function acquireAudioMutex(slotId) {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (!audioMutexLocked) {
        audioMutexLocked = true;
        resolve();
      } else {
        audioQueue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function releaseAudioMutex() {
  audioMutexLocked = false;
  if (audioQueue.length > 0) {
    const next = audioQueue.shift();
    next();
  }
}

// ─── Worker Management ─────────────────────────────────────────────────────────

function spawnWorker(config) {
  const { slot, prefix, platform, accountId } = config;

  log(`Spawning worker S${slot}: ${prefix} → ${platform} (${accountId})`);

  const child = fork(WORKER_SCRIPT, [
    `--slot=${slot}`,
    `--prefix=${prefix}`,
    `--platform=${platform}`,
    `--id=${accountId}`,
    `--duration=${DURATION}`,
    '--hub-worker',
  ], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, FARM_HUB_MANAGED: '1' },
  });

  const workerState = {
    process: child,
    config,
    status: 'starting',       // starting | active | degraded | offline | stopped
    lastHeartbeat: Date.now(),
    missedHeartbeats: 0,
    restartCount: 0,
    stats: {},
    swipeCount: 0,
    sessionMinutes: 0,
    pid: child.pid,
  };

  // Handle worker messages
  child.on('message', (msg) => {
    if (msg.type === 'heartbeat') {
      workerState.lastHeartbeat = Date.now();
      workerState.missedHeartbeats = 0;
      workerState.status = 'active';
      workerState.stats = msg.stats || {};
      workerState.swipeCount = msg.swipeCount || 0;
      workerState.sessionMinutes = msg.sessionMinutes || 0;
    }
    if (msg.type === 'audio-request') {
      // Worker wants to play audio — acquire mutex
      acquireAudioMutex(slot).then(() => {
        child.send({ type: 'audio-granted' });
        // Release after a safety timeout
        setTimeout(releaseAudioMutex, msg.estimatedDuration || 3000);
      });
    }
    if (msg.type === 'status-reply') {
      log(`S${slot} status: ${JSON.stringify(msg.stats)}`);
    }
  });

  // Handle worker stdout/stderr
  child.stdout.on('data', (data) => {
    if (!TEST_MODE) {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        process.stdout.write(chalk.gray(`[S${slot}] `) + line + '\n');
      }
    }
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(chalk.red(`[S${slot} ERR] `) + data.toString());
  });

  // Handle worker exit
  child.on('exit', (code, signal) => {
    if (workerState.status === 'stopped') {
      log(`S${slot} stopped gracefully`);
      return;
    }

    logWarn(`S${slot} exited unexpectedly (code=${code}, signal=${signal})`);
    workerState.status = 'offline';

    // Self-healing: auto-restart
    if (workerState.restartCount < MAX_RESTARTS) {
      workerState.restartCount++;
      logWarn(`S${slot} auto-restarting (attempt ${workerState.restartCount}/${MAX_RESTARTS})...`);
      setTimeout(() => {
        const newWorker = spawnWorker(config);
        newWorker.restartCount = workerState.restartCount;
        workers[slot] = newWorker;
      }, 3000 + Math.random() * 2000); // Stagger restarts
    } else {
      logError(`S${slot} exceeded max restarts (${MAX_RESTARTS}). Manual intervention required.`);
    }
  });

  workers[slot] = workerState;
  return workerState;
}

// ─── Health Monitor ────────────────────────────────────────────────────────────

function startHealthMonitor() {
  setInterval(() => {
    const now = Date.now();

    for (const [slot, worker] of Object.entries(workers)) {
      if (worker.status === 'stopped') continue;

      const elapsed = now - worker.lastHeartbeat;
      const missedBeats = Math.floor(elapsed / HEARTBEAT_INTERVAL);

      if (missedBeats >= HEARTBEAT_DEAD) {
        if (worker.status !== 'offline') {
          worker.status = 'offline';
          logError(`S${slot} OFFLINE — ${missedBeats} missed heartbeats`);
        }
      } else if (missedBeats >= HEARTBEAT_TIMEOUT) {
        if (worker.status !== 'degraded') {
          worker.status = 'degraded';
          logWarn(`S${slot} DEGRADED — ${missedBeats} missed heartbeats`);
        }
      }

      worker.missedHeartbeats = missedBeats;
    }

    // Update hub status in DB
    updateHubStatusInDB();
  }, HEARTBEAT_INTERVAL);
}

// ─── Battery Monitor ───────────────────────────────────────────────────────────
// Future: reads battery level from connected iOS devices via libimobiledevice
// For now, placeholder that checks DB for manually-set battery levels

function startBatteryMonitor() {
  setInterval(() => {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rows = db.prepare(
        'SELECT id, battery_level FROM account_health WHERE battery_level >= 0'
      ).all();

      for (const row of rows) {
        const slot = Object.entries(workers).find(
          ([, w]) => w.config.accountId === row.id
        );
        if (!slot) continue;

        const [slotId, worker] = slot;
        if (row.battery_level < 20 && worker.status === 'active') {
          logWarn(`S${slotId} battery LOW (${row.battery_level}%) — pausing warmup`);
          worker.process.send({ type: 'stop' });
          worker.status = 'stopped';
          // Will auto-resume when battery > 50% (checked next cycle)
        }
        if (row.battery_level > 50 && worker.status === 'stopped' && worker.restartCount < MAX_RESTARTS) {
          log(`S${slotId} battery OK (${row.battery_level}%) — resuming`);
          const newWorker = spawnWorker(worker.config);
          workers[slotId] = newWorker;
        }
      }
    } catch (e) { /* graceful */ }
    db.close();
  }, 30000); // Check every 30s
}

// ─── DB Status ─────────────────────────────────────────────────────────────────

function updateHubStatusInDB() {
  try {
    const db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS hub_status (
        id TEXT PRIMARY KEY DEFAULT 'hub',
        total_slots INTEGER,
        active_slots INTEGER,
        degraded_slots INTEGER,
        offline_slots INTEGER,
        audio_mutex_locked INTEGER,
        audio_queue_depth INTEGER,
        uptime_seconds INTEGER,
        updated_at TEXT
      )
    `);

    const active = Object.values(workers).filter(w => w.status === 'active').length;
    const degraded = Object.values(workers).filter(w => w.status === 'degraded').length;
    const offline = Object.values(workers).filter(w => w.status === 'offline' || w.status === 'stopped').length;
    const uptimeSeconds = Math.round((Date.now() - hubStartTime) / 1000);

    db.prepare(`
      INSERT INTO hub_status (id, total_slots, active_slots, degraded_slots, offline_slots,
                              audio_mutex_locked, audio_queue_depth, uptime_seconds, updated_at)
      VALUES ('hub', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        total_slots = excluded.total_slots,
        active_slots = excluded.active_slots,
        degraded_slots = excluded.degraded_slots,
        offline_slots = excluded.offline_slots,
        audio_mutex_locked = excluded.audio_mutex_locked,
        audio_queue_depth = excluded.audio_queue_depth,
        uptime_seconds = excluded.uptime_seconds,
        updated_at = excluded.updated_at
    `).run(
      TOTAL_SLOTS, active, degraded, offline,
      audioMutexLocked ? 1 : 0, audioQueue.length,
      uptimeSeconds, new Date().toISOString()
    );
    db.close();
  } catch (e) { /* non-critical */ }
}

// ─── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`${chalk.gray(`[${new Date().toLocaleTimeString()}]`)} ${chalk.cyan('[HUB]')} ${msg}`);
}
function logWarn(msg) {
  console.log(`${chalk.gray(`[${new Date().toLocaleTimeString()}]`)} ${chalk.yellow('[HUB ⚠]')} ${msg}`);
}
function logError(msg) {
  console.log(`${chalk.gray(`[${new Date().toLocaleTimeString()}]`)} ${chalk.red('[HUB ❌]')} ${msg}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const hubStartTime = Date.now();

async function main() {
  console.clear();
  console.log(chalk.magenta.bold('\n🏗️ PHONE FARM HUB — Multi-Device Orchestrator'));
  console.log(chalk.gray('════════════════════════════════════════════════════\n'));
  console.log(chalk.cyan(`Slots: ${TOTAL_SLOTS} | Duration: ${DURATION}m | Test: ${TEST_MODE}`));
  console.log(chalk.gray('Architecture: GADS Hub-Provider (command queue isolation)\n'));

  // Spawn workers with staggered start (prevents audio collision at boot)
  const slotsToSpawn = SLOT_CONFIG.slice(0, TOTAL_SLOTS);

  for (let i = 0; i < slotsToSpawn.length; i++) {
    spawnWorker(slotsToSpawn[i]);

    // Stagger worker starts by 3-5 seconds to avoid TTS overlap
    if (i < slotsToSpawn.length - 1) {
      const stagger = 3000 + Math.random() * 2000;
      log(`Staggering next worker by ${Math.round(stagger)}ms...`);
      await new Promise(r => setTimeout(r, stagger));
    }
  }

  log(`All ${slotsToSpawn.length} workers spawned`);

  // Start monitors
  startHealthMonitor();
  startBatteryMonitor();

  // Status printer (every 30s)
  setInterval(() => {
    console.log(chalk.gray('\n─── Hub Status ───────────────────────────'));
    for (const [slot, worker] of Object.entries(workers)) {
      const statusColor = {
        active: chalk.green,
        degraded: chalk.yellow,
        offline: chalk.red,
        starting: chalk.blue,
        stopped: chalk.gray,
      }[worker.status] || chalk.gray;

      console.log(
        `  S${slot} ${statusColor(worker.status.toUpperCase().padEnd(10))} ` +
        `${chalk.gray('swipes:')} ${chalk.white(String(worker.swipeCount).padStart(4))} ` +
        `${chalk.gray('session:')} ${chalk.white(String(worker.sessionMinutes).padStart(5))}m ` +
        `${chalk.gray('restarts:')} ${chalk.white(worker.restartCount)} ` +
        `${chalk.gray(`(${worker.config.platform})`)}`
      );
    }
    console.log(chalk.gray(`  Audio mutex: ${audioMutexLocked ? '🔒 LOCKED' : '🔓 FREE'} | Queue: ${audioQueue.length}`));
    console.log(chalk.gray('──────────────────────────────────────────\n'));
  }, 30000);

  // Graceful shutdown
  const shutdown = () => {
    log('Shutting down all workers...');
    for (const [slot, worker] of Object.entries(workers)) {
      worker.status = 'stopped';
      try {
        worker.process.send({ type: 'stop' });
      } catch (e) {
        worker.process.kill('SIGTERM');
      }
    }
    setTimeout(() => {
      log('Hub shutdown complete');
      process.exit(0);
    }, 3000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logError(`Hub fatal: ${err.message}`);
  process.exit(1);
});
