#!/usr/bin/env node
/**
 * OCTAGON FARM BRAIN
 *
 * Multi-device iOS Voice Control QA lab.
 *
 * - Per-device action queues plus a single shared audio mutex
 * - USB self-healing with task pausing and retry
 * - DB-backed scheduling via `farm_tasks` in SQLite
 *
 * Safety note:
 * This is for authorized accessibility testing. It routes voice commands
 * (macOS TTS) to iPhones configured with unique Voice Control prefixes.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const https = require("https");
const { execFile } = require("child_process");

let Database;
try {
  // eslint-disable-next-line global-require
  Database = require("better-sqlite3");
} catch (e) {
  // Make missing native deps actionable.
  // eslint-disable-next-line no-console
  console.error(
    [
      "[farm-brain] Missing dependency: better-sqlite3",
      "Install from the farm directory:",
      "  npm i better-sqlite3",
      "",
      "If you're running on Apple Silicon, you may need build tools/Xcode CLT.",
    ].join("\n"),
  );
  process.exit(1);
}

const DEFAULT_DB_PATH = path.join(__dirname, "..", "db", "farm.db");
const VOICE_DIR = path.join(__dirname, "voice-actions");
const DEFAULT_JSONL_DIR = path.join(__dirname, "..", "data", "logs");

const DEFAULT_PREFIXES = {
  phone1: "Alpha",
  phone2: "Bravo",
  phone3: "Charlie",
  phone4: "Delta",
};

const VOICE_ACTIONS = {
  swipeNext: { text: "Swipe Next", baseMs: 4000, minInterval: null, maxInterval: null },
  likePost: { text: "Like Post", baseMs: 2000, minInterval: 5, maxInterval: 12 },
  savePost: { text: "Save Post", baseMs: 3000, minInterval: 15, maxInterval: 25 },
  openComments: { text: "Open Comments", baseMs: 8000, minInterval: 8, maxInterval: 15 },
  openProfile: { text: "Open Profile", baseMs: 10000, minInterval: 20, maxInterval: 30 },
  openSearch: { text: "Open Search", baseMs: 9000, minInterval: 35, maxInterval: 55 },
  pauseMidSwipe: { text: "Pause Mid Swipe", baseMs: 2500, minInterval: 10, maxInterval: 20 },
  doubleBack: { text: "Double Back", baseMs: 5000, minInterval: 12, maxInterval: 25 },
  scrollThrough: { text: "Scroll Through", baseMs: 3000, minInterval: 30, maxInterval: 50 },
  // System-level recovery helpers (must exist as iOS Voice Control commands if used)
  goHome: { text: "Go Home", baseMs: 2500, minInterval: null, maxInterval: null },
};

let DRY_RUN = false;
let LOG_ACTIONS = false;
let ALLOW_ENGAGEMENT = false;
let JSONL_ENABLED = true;
let ENABLE_SEARCH = false;

const ENGAGEMENT_ACTIONS = new Set(["likePost", "savePost", "openComments"]);
const OPTIONAL_ACTIONS = new Set(["openSearch"]);

let JSONL_STREAM = null;
let JSONL_PATH = "";

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nowIso() {
  return new Date().toISOString();
}

function safeWriteJsonl(obj) {
  if (!JSONL_ENABLED) return;
  if (!JSONL_STREAM) return;
  try {
    JSONL_STREAM.write(`${JSON.stringify(obj)}\n`);
  } catch {
    // ignore
  }
}

function initJsonlLogger() {
  if (!JSONL_ENABLED) return;
  const dir = process.env.FARM_JSONL_DIR ? path.resolve(String(process.env.FARM_JSONL_DIR)) : DEFAULT_JSONL_DIR;
  const date = new Date().toISOString().slice(0, 10);
  JSONL_PATH = process.env.FARM_JSONL_PATH ? path.resolve(String(process.env.FARM_JSONL_PATH)) : path.join(dir, `farm-events-${date}.jsonl`);
  try {
    fs.mkdirSync(path.dirname(JSONL_PATH), { recursive: true });
    JSONL_STREAM = fs.createWriteStream(JSONL_PATH, { flags: "a" });
    JSONL_STREAM.on("error", () => {
      JSONL_ENABLED = false;
    });
  } catch {
    JSONL_ENABLED = false;
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      out._.push(raw);
      continue;
    }
    const [k, v] = raw.slice(2).split("=");
    out[k] = v === undefined ? true : v;
  }
  return out;
}

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 1024 * 1024 * 32 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function execFileAsyncBinary(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, encoding: "buffer", maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function ensureFarmSchema(db) {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_farm_devices_phone ON farm_devices(phone_number);
    CREATE INDEX IF NOT EXISTS idx_farm_devices_active ON farm_devices(active);

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
      battery_level INTEGER DEFAULT -1,
      error TEXT DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES farm_devices(id)
    );
    CREATE INDEX IF NOT EXISTS idx_farm_health_state ON farm_device_health(session_state);
    CREATE INDEX IF NOT EXISTS idx_farm_health_updated ON farm_device_health(updated_at);

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
    CREATE INDEX IF NOT EXISTS idx_farm_tasks_scheduled ON farm_tasks(scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_farm_tasks_status ON farm_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_farm_tasks_device ON farm_tasks(device_id);

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
    CREATE INDEX IF NOT EXISTS idx_farm_events_ts ON farm_events(ts);
    CREATE INDEX IF NOT EXISTS idx_farm_events_device ON farm_events(device_id);
  `);

  const ensureColumns = (table, cols) => {
    let existing = [];
    try {
      existing = db.prepare(`PRAGMA table_info(${table})`).all();
    } catch {
      return;
    }
    const names = new Set(existing.map((r) => String(r.name)));
    for (const c of cols) {
      const [name, decl] = c;
      if (names.has(name)) continue;
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
      } catch {
        // ignore migration errors
      }
    }
  };

  ensureColumns("farm_device_health", [
    ["battery_level", "INTEGER DEFAULT -1"],
    ["adb_connected", "INTEGER DEFAULT 0"],
    ["last_adb_ping_at", "TEXT"],
  ]);
  ensureColumns("farm_tasks", [
    ["retry_count", "INTEGER DEFAULT 0"],
    ["max_retries", "INTEGER DEFAULT 3"],
    ["next_retry_at", "TEXT"],
  ]);
}

function seedFarmDevicesIfEmpty(db) {
  const row = db.prepare("SELECT COUNT(*) as c FROM farm_devices").get();
  if (row && row.c >= 4) return;

  const now = nowIso();
  const defaults = [
    { id: "phone1", phone: 1 },
    { id: "phone2", phone: 2 },
    { id: "phone3", phone: 3 },
    { id: "phone4", phone: 4 },
  ];

  const getPrefix = (phone) => process.env[`FARM_PHONE${phone}_PREFIX`] || DEFAULT_PREFIXES[`phone${phone}`];
  const getUdid = (phone) => process.env[`FARM_PHONE${phone}_UDID`] || "";

  const insertDevice = db.prepare(`
    INSERT OR IGNORE INTO farm_devices
    (id, phone_number, display_name, voice_prefix, usb_udid, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertHealth = db.prepare(`
    INSERT OR IGNORE INTO farm_device_health
    (device_id, usb_connected, session_state, updated_at)
    VALUES (?, 0, 'idle', ?)
  `);

  for (const d of defaults) {
    let nicheName = `Phone ${d.phone}`;
    try {
      const nc = db.prepare("SELECT niche_name FROM niche_config WHERE phone_number = ?").get(d.phone);
      if (nc && nc.niche_name) nicheName = nc.niche_name;
    } catch {
      // niche_config might not exist in minimal DBs
    }
    const displayName = `${nicheName} (Phone ${d.phone})`;
    insertDevice.run(d.id, d.phone, displayName, getPrefix(d.phone), getUdid(d.phone), now, now);
    insertHealth.run(d.id, now);
  }
}

function logEvent(db, { level = "info", deviceId = null, taskId = null, event, data = {} }) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  const row = {
    id,
    ts,
    level,
    device_id: deviceId,
    task_id: taskId,
    event,
    data: data || {},
  };
  db.prepare(
    `INSERT INTO farm_events (id, ts, level, device_id, task_id, event, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, ts, level, deviceId, taskId, event, JSON.stringify(data || {}));
  safeWriteJsonl(row);
}

class AudioMutex {
  constructor() {
    this._tail = Promise.resolve();
    this.depth = 0;
  }

  async run(fn) {
    this.depth += 1;
    const p = this._tail.then(fn, fn);
    this._tail = p.finally(() => {
      this.depth = Math.max(0, this.depth - 1);
    });
    return p;
  }
}

async function playVoiceCommand({ prefix, actionKey }) {
  const action = VOICE_ACTIONS[actionKey];
  if (!action) throw new Error(`Unknown actionKey: ${actionKey}`);
  const phrase = `${prefix}, ${action.text}`;

  if (LOG_ACTIONS) {
    // Keep stdout parseable for smoke tests.
    // Example: "[Alpha] SWIPENEXT"
    // eslint-disable-next-line no-console
    console.log(`[${prefix}] ${String(actionKey).toUpperCase()}`);
  }

  if (DRY_RUN) return;

  const customFileName = `${String(prefix).toLowerCase()}-${actionKey}.mp3`;
  const filePath = path.join(VOICE_DIR, customFileName);

  if (fs.existsSync(filePath)) {
    await execFileAsync("afplay", [filePath]);
    return;
  }

  await execFileAsync("say", [phrase]);
}

function computeJitterMs(baseMs) {
  const jitterBase = Math.round(baseMs * 0.2);
  const jitterMax = Math.round(baseMs * 0.8);
  return randomInt(jitterBase, jitterMax);
}

function generateThresholds(swipeCount) {
  const thresholds = {};
  for (const [key, a] of Object.entries(VOICE_ACTIONS)) {
    if (a.minInterval && a.maxInterval) {
      if (!ALLOW_ENGAGEMENT && ENGAGEMENT_ACTIONS.has(key)) continue;
      if (!ENABLE_SEARCH && OPTIONAL_ACTIONS.has(key)) continue;
      thresholds[key] = swipeCount + randomInt(a.minInterval, a.maxInterval);
    }
  }
  return thresholds;
}

class WarmupStrategy {
  constructor({ durationMinutes }) {
    this.startedAt = Date.now();
    this.endAt = this.startedAt + durationMinutes * 60 * 1000;
    this.swipeCount = 0;
    this.thresholds = generateThresholds(0);
    this.pending = [];
  }

  isDone() {
    return Date.now() >= this.endAt;
  }

  nextActionKey() {
    if (this.pending.length > 0) return this.pending.shift();

    // Default rhythm: swipe, and occasionally trigger micro-actions by swipe thresholds.
    this.swipeCount += 1;

    for (const [actionKey, threshold] of Object.entries(this.thresholds)) {
      if (this.swipeCount >= threshold) {
        this.pending.push(actionKey);
        const a = VOICE_ACTIONS[actionKey];
        this.thresholds[actionKey] = this.swipeCount + randomInt(a.minInterval, a.maxInterval);
      }
    }

    return "swipeNext";
  }
}

class DeviceController {
  constructor({ db, audioMutex, deviceRow }) {
    this.db = db;
    this.audioMutex = audioMutex;
    this.device = deviceRow; // farm_devices row
    this.busyUntil = 0;
    this.connected = true; // optimistic until USB monitor sets it
    this.strategy = null;
    this.currentTaskId = "";
    this.queue = [];

    this.stats = {
      swipes: 0,
      likes: 0,
      saves: 0,
      comments: 0,
      profiles: 0,
    };
  }

  enqueueAction(actionKey, { front = false } = {}) {
    if (!actionKey) return;
    if (front) this.queue.unshift(actionKey);
    else this.queue.push(actionKey);
    // Prevent unbounded growth.
    if (this.queue.length > 100) this.queue = this.queue.slice(0, 100);
  }

  setConnected(connected) {
    this.connected = connected;
  }

  startWarmup({ taskId, durationMinutes }) {
    this.strategy = new WarmupStrategy({ durationMinutes });
    this.currentTaskId = taskId;
    this.queue = [];
    this._setHealth({ session_state: "running", current_task_id: taskId, error: "" });
  }

  stopTask({ reason = "" } = {}) {
    this.strategy = null;
    this.currentTaskId = "";
    this.queue = [];
    this._setHealth({ session_state: this.connected ? "idle" : "offline", current_task_id: "", error: reason });
  }

  tick() {
    if (!this.connected) return;
    if (!this.strategy) return;
    if (Date.now() < this.busyUntil) return;

    if (this.strategy.isDone()) {
      const doneTaskId = this.currentTaskId;
      const ts = nowIso();
      if (doneTaskId) {
        try {
          this.db
            .prepare(
              `UPDATE farm_tasks
               SET status='succeeded', finished_at=?, updated_at=?
               WHERE id=? AND status='running'`,
            )
            .run(ts, ts, doneTaskId);
          logEvent(this.db, {
            level: "info",
            deviceId: this.device.id,
            taskId: doneTaskId,
            event: "task_succeeded",
            data: { type: "warmup" },
          });
        } catch {
          // ignore DB finalize errors; health still reflects completion
        }
      }
      this.stopTask();
      return;
    }

    if (this.queue.length === 0) {
      this.enqueueAction(this.strategy.nextActionKey());
    }
    if (this.queue.length === 0) return;
    const actionKey = this.queue.shift();
    return this.runAction({ actionKey });
  }

  async runAction({ actionKey }) {
    if (!this.connected) {
      throw new Error("device_offline");
    }
    const action = VOICE_ACTIONS[actionKey];
    const baseMs = action.baseMs;
    const jitterMs = computeJitterMs(baseMs);
    const totalWaitMs = baseMs + jitterMs;

    const deviceId = this.device.id;
    const taskId = this.currentTaskId || null;
    const ts = nowIso();

    const waitStartMs = Date.now();
    await this.audioMutex.run(async () => {
      const voiceStartMs = Date.now();
      logEvent(this.db, {
        level: "info",
        deviceId,
        taskId,
        event: "voice_command_start",
        data: {
          actionKey,
          phrase: `${this.device.voice_prefix}, ${action.text}`,
          audio_mutex_wait_ms: Math.max(0, voiceStartMs - waitStartMs),
        },
      });
      await playVoiceCommand({ prefix: this.device.voice_prefix, actionKey });
      const voiceEndMs = Date.now();
      logEvent(this.db, {
        level: "info",
        deviceId,
        taskId,
        event: "voice_command_end",
        data: { actionKey, voice_play_ms: Math.max(0, voiceEndMs - voiceStartMs) },
      });
    });

    // Update in-memory counters.
    if (actionKey === "swipeNext") this.stats.swipes += 1;
    if (actionKey === "likePost") this.stats.likes += 1;
    if (actionKey === "savePost") this.stats.saves += 1;
    if (actionKey === "openComments") this.stats.comments += 1;
    if (actionKey === "openProfile") this.stats.profiles += 1;

    const jitterVariance = Number((Math.random() * 2.5).toFixed(2));

    this._setHealth({
      session_state: "running",
      current_task_id: this.currentTaskId,
      swipes: this.stats.swipes,
      likes: this.stats.likes,
      saves: this.stats.saves,
      comments: this.stats.comments,
      profiles: this.stats.profiles,
      last_action: actionKey,
      last_action_at: ts,
      jitter_variance: jitterVariance,
      error: "",
      updated_at: ts,
    });

    this.busyUntil = Date.now() + totalWaitMs;
    await sleep(Math.min(150, totalWaitMs)); // keep loop responsive; actual busy gate is busyUntil
    return { actionKey, baseMs, jitterMs, totalWaitMs };
  }

  _setHealth(fields) {
    const deviceId = this.device.id;
    const ts = fields.updated_at || nowIso();
    const existing = this.db.prepare("SELECT device_id FROM farm_device_health WHERE device_id = ?").get(deviceId);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO farm_device_health (device_id, usb_connected, session_state, updated_at) VALUES (?, ?, ?, ?)`,
        )
        .run(deviceId, this.connected ? 1 : 0, fields.session_state || "idle", ts);
    }

    const merged = {
      usb_connected: this.connected ? 1 : 0,
      ...fields,
      updated_at: ts,
    };

    const columns = Object.keys(merged);
    const setSql = columns.map((c) => `${c} = @${c}`).join(", ");

    this.db.prepare(`UPDATE farm_device_health SET ${setSql} WHERE device_id = @device_id`).run({
      device_id: deviceId,
      ...merged,
    });
  }
}

async function listConnectedUdidsViaDevicectl() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "octragon-devicectl-"));
  const jsonPath = path.join(tmpDir, "out.json");
  try {
    await execFileAsync("xcrun", ["devicectl", "--quiet", "--json-output", jsonPath, "list", "devices"], {
      timeout: 15_000,
    });
    const raw = fs.readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(raw);

    const udids = new Set();
    const uuidRe = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;

    const stack = [parsed];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (typeof cur === "string") {
        const matches = cur.match(uuidRe);
        if (matches) {
          for (const m of matches) udids.add(m);
        }
        continue;
      }
      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
        continue;
      }
      if (typeof cur === "object") {
        for (const v of Object.values(cur)) stack.push(v);
      }
    }
    return udids;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function takeScreenshotViaDevicectl({ udid, outPath }) {
  await execFileAsync(
    "xcrun",
    ["devicectl", "device", "screenshot", "--device", udid, outPath],
    { timeout: 20_000 },
  );
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function getScreensDir() {
  const dir = path.join(__dirname, "..", "data", "assets", "farm-screens");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function screenshotWithHash({ udid, deviceId, purpose }) {
  const outPath = path.join(getScreensDir(), `${deviceId}-${purpose}-${Date.now()}.png`);
  await takeScreenshotViaDevicectl({ udid, outPath });
  const hash = fs.existsSync(outPath) ? sha256File(outPath) : "";
  return { path: outPath, hash };
}

async function waitForScreenChange({
  udid,
  deviceId,
  baselineHash,
  timeoutMs,
  pollMs,
  purpose,
}) {
  const startMs = Date.now();
  let last = null;
  while (Date.now() - startMs < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
    // eslint-disable-next-line no-await-in-loop
    last = await screenshotWithHash({ udid, deviceId, purpose });
    if (last.hash && last.hash !== baselineHash) {
      return { changed: true, change_ms: Date.now() - startMs, shot: last };
    }
    // Unchanged screenshot is not useful. Keep disk clean.
    try {
      if (last?.path) fs.rmSync(last.path, { force: true });
    } catch {
      // ignore
    }
    last = null;
  }
  // Final screenshot for failure debugging.
  last = await screenshotWithHash({ udid, deviceId, purpose: `${purpose}-timeout` });
  return { changed: false, change_ms: timeoutMs, shot: last };
}

async function runAudit({ db, devices, deviceId = null }) {
  const ts = nowIso();
  const udids = await listConnectedUdidsViaDevicectl().catch(() => new Set());

  const targets = deviceId ? devices.filter((d) => d.id === deviceId) : devices;
  const results = [];

  for (const d of targets) {
    const isConnected = d.usb_udid ? udids.has(d.usb_udid) : null;
    const screenshot = (() => {
      if (!d.usb_udid) return null;
      const dir = path.join(__dirname, "..", "data", "assets", "farm-screens");
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, `${d.id}-${Date.now()}.png`);
    })();

    let screenshotOk = false;
    let screenshotErr = "";
    if (screenshot && d.usb_udid) {
      try {
        await takeScreenshotViaDevicectl({ udid: d.usb_udid, outPath: screenshot });
        screenshotOk = fs.existsSync(screenshot);
      } catch (e) {
        screenshotErr = String(e && (e.stderr || e.message || e));
      }
    }

    // Update health row with connectivity info.
    try {
      db.prepare(
        `INSERT OR IGNORE INTO farm_device_health (device_id, usb_connected, session_state, updated_at)
         VALUES (?, 0, 'idle', ?)`,
      ).run(d.id, ts);
      db.prepare(
        `UPDATE farm_device_health
         SET usb_connected = ?, last_usb_seen_at = ?, error = ?, updated_at = ?
         WHERE device_id = ?`,
      ).run(isConnected === null ? 0 : isConnected ? 1 : 0, ts, screenshotErr || "", ts, d.id);
    } catch {
      // ignore
    }

    results.push({
      device_id: d.id,
      usb_udid: d.usb_udid || "",
      usb_connected: isConnected,
      screenshot_path: screenshot,
      screenshot_ok: screenshotOk,
      screenshot_error: screenshotErr,
    });
  }

  logEvent(db, { level: "info", deviceId: null, taskId: null, event: "audit_complete", data: { results } });
  return { ts, results };
}

async function runPostTask() {
  const python = process.env.OCTAGON_PYTHON || "python3";
  const projectRoot = path.join(__dirname, "..");
  const { stdout, stderr } = await execFileAsync(python, [path.join(projectRoot, "run.py"), "post"], {
    cwd: projectRoot,
    timeout: 15 * 60 * 1000,
  });
  return { stdout, stderr };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADB helpers
// ─────────────────────────────────────────────────────────────────────────────

function execAdb(udid, args, timeoutMs = 15000) {
  return execFileAsync("adb", ["-s", udid, ...args], { timeout: timeoutMs });
}

async function adbPing(udid, timeoutMs = 5000) {
  try {
    await execFileAsync("adb", ["-s", udid, "shell", "echo", "ping"], { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function adbListDeviceUdids() {
  try {
    const { stdout } = await execFileAsync("adb", ["devices"], { timeout: 8000 });
    const lines = String(stdout || "").split("\n").slice(1);
    const udids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1] === "device") {
        udids.add(parts[0]);
      }
    }
    return udids;
  } catch {
    return new Set();
  }
}

async function withAdbRetry(fn, { maxRetries = 3, baseDelayMs = 2000, db, deviceId, taskId, label } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logEvent(db, {
          level: "warn",
          deviceId,
          taskId,
          event: `${label || "adb_op"}_retry`,
          data: { attempt: attempt + 1, maxRetries, delay_ms: delay, error: String(e && (e.message || e)) },
        });
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADB task runners
// ─────────────────────────────────────────────────────────────────────────────

async function runScrollTask({ db, taskId, deviceId, udid, payload }) {
  let p = {};
  try { p = JSON.parse(payload || "{}"); } catch { p = {}; }

  const scrollCount = Math.max(1, Math.min(Number(p.scrollCount || 5), 50));
  const direction = String(p.direction || "up");
  const delayMinMs = Number(p.delayMinMs || 800);
  const delayMaxMs = Number(p.delayMaxMs || 1800);

  logEvent(db, { level: "info", deviceId, taskId, event: "scroll_started", data: { scrollCount, direction } });

  for (let i = 0; i < scrollCount; i++) {
    const duration = randomInt(280, 600);
    const jitterX = randomInt(-30, 30);
    const x = 540 + jitterX;

    if (direction === "up") {
      await withAdbRetry(
        () => execAdb(udid, ["shell", "input", "swipe", String(x), "1100", String(x), "400", String(duration)]),
        { db, deviceId, taskId, label: "scroll_swipe", maxRetries: 2, baseDelayMs: 1000 },
      );
    } else {
      await withAdbRetry(
        () => execAdb(udid, ["shell", "input", "swipe", String(x), "400", String(x), "1100", String(duration)]),
        { db, deviceId, taskId, label: "scroll_swipe", maxRetries: 2, baseDelayMs: 1000 },
      );
    }
    await sleep(randomInt(delayMinMs, delayMaxMs));
  }

  logEvent(db, { level: "info", deviceId, taskId, event: "scroll_complete", data: { scrollCount, direction } });
  return { scrollCount, direction, ok: true };
}

async function runDmTask({ db, taskId, deviceId, udid, payload }) {
  let p = {};
  try { p = JSON.parse(payload || "{}"); } catch { p = {}; }

  const targetHandle = String(p.targetHandle || "").replace(/^@/, "").trim();
  const messageText = String(p.messageText || "").trim();

  if (!targetHandle) throw new Error("dm_missing_target_handle");
  if (!messageText) throw new Error("dm_missing_message_text");

  logEvent(db, { level: "info", deviceId, taskId, event: "dm_started", data: { targetHandle, msgLen: messageText.length } });

  // Tap search icon (Instagram bottom nav, 2nd from left — adjust for resolution)
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "270", "1350"]),
    { db, deviceId, taskId, label: "dm_open_search" });
  await sleep(randomInt(1500, 2500));

  // Clear any previous search and type handle
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "180"]),
    { db, deviceId, taskId, label: "dm_tap_search_bar" });
  await sleep(randomInt(800, 1200));

  const safeHandle = targetHandle.replace(/[^a-zA-Z0-9._]/g, "");
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "text", safeHandle]),
    { db, deviceId, taskId, label: "dm_type_handle" });
  await sleep(randomInt(1500, 2500));

  // Tap first search result
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "380"]),
    { db, deviceId, taskId, label: "dm_tap_result" });
  await sleep(randomInt(2000, 3500));

  // Tap "Message" button on profile
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "380", "580"]),
    { db, deviceId, taskId, label: "dm_tap_message_btn" });
  await sleep(randomInt(1800, 3000));

  // Tap message input field
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "460", "1200"]),
    { db, deviceId, taskId, label: "dm_tap_input" });
  await sleep(randomInt(700, 1200));

  // Type message — split into chunks to avoid adb text length limits
  const safeText = messageText.replace(/['"\\]/g, " ").substring(0, 500);
  const chunks = safeText.match(/.{1,80}/g) || [];
  for (const chunk of chunks) {
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "text", chunk]),
      { db, deviceId, taskId, label: "dm_type_text" });
    await sleep(randomInt(200, 400));
  }
  await sleep(randomInt(500, 900));

  // Send — tap send button
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "1020", "1200"]),
    { db, deviceId, taskId, label: "dm_tap_send" });
  await sleep(randomInt(1200, 2000));

  // Navigate home
  await execAdb(udid, ["shell", "input", "keyevent", "3"]).catch(() => null);

  logEvent(db, { level: "info", deviceId, taskId, event: "dm_sent", data: { targetHandle } });
  return { targetHandle, sent: true };
}

async function runOutreachTask({ db, taskId, deviceId, udid, payload }) {
  let p = {};
  try { p = JSON.parse(payload || "{}"); } catch { p = {}; }

  const action = String(p.action || "follow");
  const targetHandle = String(p.targetHandle || "").replace(/^@/, "").trim();

  if (!targetHandle) throw new Error("outreach_missing_target_handle");
  if (!["follow", "unfollow", "like_recent", "comment"].includes(action)) {
    throw new Error(`outreach_unknown_action: ${action}`);
  }
  const commentText = action === "comment" ? String(p.commentText || "").trim() : "";

  logEvent(db, { level: "info", deviceId, taskId, event: "outreach_started", data: { action, targetHandle } });

  // Open Instagram search
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "270", "1350"]),
    { db, deviceId, taskId, label: "outreach_open_search" });
  await sleep(randomInt(1500, 2500));

  // Tap search bar and type handle
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "180"]),
    { db, deviceId, taskId, label: "outreach_tap_bar" });
  await sleep(randomInt(800, 1200));

  const safeHandle = targetHandle.replace(/[^a-zA-Z0-9._]/g, "");
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "text", safeHandle]),
    { db, deviceId, taskId, label: "outreach_type_handle" });
  await sleep(randomInt(1500, 2500));

  // Tap first result — profile
  await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "350"]),
    { db, deviceId, taskId, label: "outreach_tap_profile" });
  await sleep(randomInt(2000, 3500));

  if (action === "follow") {
    // Tap Follow button (typically at top of profile)
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "340", "580"]),
      { db, deviceId, taskId, label: "outreach_tap_follow" });
    await sleep(randomInt(1000, 1800));
  } else if (action === "unfollow") {
    // Tap Following button to trigger unfollow dialog
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "340", "580"]),
      { db, deviceId, taskId, label: "outreach_tap_following" });
    await sleep(randomInt(800, 1200));
    // Confirm in dialog
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "800"]),
      { db, deviceId, taskId, label: "outreach_confirm_unfollow" });
    await sleep(randomInt(1000, 1500));
  } else if (action === "like_recent") {
    // Scroll to first post and double-tap to like
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "180", "750"]),
      { db, deviceId, taskId, label: "outreach_tap_first_post" });
    await sleep(randomInt(1500, 2500));
    // Double-tap to like
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "600"]),
      { db, deviceId, taskId, label: "outreach_double_tap_1" });
    await sleep(120);
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "600"]),
      { db, deviceId, taskId, label: "outreach_double_tap_2" });
    await sleep(randomInt(1000, 1800));
  } else if (action === "comment") {
    if (!commentText) throw new Error("outreach_comment_missing_text");
    // Tap first post in profile grid
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "180", "750"]),
      { db, deviceId, taskId, label: "outreach_comment_open_post" });
    await sleep(randomInt(1500, 2500));
    // Tap speech-bubble / comment icon
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "370", "1200"]),
      { db, deviceId, taskId, label: "outreach_comment_icon" });
    await sleep(randomInt(1200, 2000));
    // Tap comment input box
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "380", "1300"]),
      { db, deviceId, taskId, label: "outreach_comment_input_tap" });
    await sleep(randomInt(800, 1200));
    // Type comment (sanitize to ASCII printable)
    const safeComment = commentText.replace(/[^\x20-\x7E]/g, "").replace(/ /g, "%s");
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "text", safeComment]),
      { db, deviceId, taskId, label: "outreach_comment_type" });
    await sleep(randomInt(800, 1500));
    // Tap Post / Send button
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "650", "1300"]),
      { db, deviceId, taskId, label: "outreach_comment_send" });
    await sleep(randomInt(1000, 2000));
  }

  // Back to home
  await execAdb(udid, ["shell", "input", "keyevent", "3"]).catch(() => null);

  logEvent(db, { level: "info", deviceId, taskId, event: "outreach_complete", data: { action, targetHandle } });
  return { action, targetHandle, ok: true };
}

async function adbScreencap(udid, outPath, timeoutMs = 25000) {
  const { stdout } = await execFileAsyncBinary("adb", ["-s", udid, "exec-out", "screencap", "-p"], { timeout: timeoutMs });
  if (!Buffer.isBuffer(stdout) || stdout.length < 1024) {
    throw new Error("screencap_output_too_small");
  }
  fs.writeFileSync(outPath, stdout);
  return outPath;
}

async function runScoutTask({ db, taskId, deviceId, udid, payload }) {
  let p = {};
  try { p = JSON.parse(payload || "{}"); } catch { p = {}; }

  const mode = String(p.mode || "scroll");
  const scrollCount = Math.max(1, Math.min(Number(p.scrollCount || 10), 100));
  const screenshotEvery = Math.max(1, Number(p.screenshotEvery || 3));
  const hashtag = String(p.hashtag || "").replace(/^#/, "").trim();
  const targetHandle = String(p.targetHandle || "").replace(/^@/, "").trim();
  const screensDir = path.join(__dirname, "..", "data", "assets", "scout-screens");
  fs.mkdirSync(screensDir, { recursive: true });

  logEvent(db, { level: "info", deviceId, taskId, event: "scout_started", data: { mode, scrollCount, screenshotEvery, hashtag, targetHandle } });

  // ── Mode-specific navigation ─────────────────────────────────────────────

  if (mode === "hashtag" && hashtag) {
    // Navigate to Explore tab
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "1350"]),
      { db, deviceId, taskId, label: "scout_open_explore" });
    await sleep(randomInt(1500, 2500));
    // Tap search bar
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "180"]),
      { db, deviceId, taskId, label: "scout_tap_search" });
    await sleep(randomInt(800, 1200));
    // Type hashtag
    const safeTag = hashtag.replace(/[^a-zA-Z0-9_]/g, "");
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "text", safeTag]),
      { db, deviceId, taskId, label: "scout_type_hashtag" });
    await sleep(randomInt(1200, 2000));
    // Tap Tags tab (usually 3rd result group)
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "350"]),
      { db, deviceId, taskId, label: "scout_tap_hashtag_result" });
    await sleep(randomInt(2000, 3500));
    // Tap first post in grid
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "180", "550"]),
      { db, deviceId, taskId, label: "scout_open_first_post" });
    await sleep(randomInt(1500, 2500));
  } else if (mode === "profile" && targetHandle) {
    // Navigate to search tab
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "270", "1350"]),
      { db, deviceId, taskId, label: "scout_open_search" });
    await sleep(randomInt(1500, 2500));
    // Tap search input
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "180"]),
      { db, deviceId, taskId, label: "scout_tap_search_bar" });
    await sleep(randomInt(800, 1200));
    // Type handle
    const safeHandle = targetHandle.replace(/[^a-zA-Z0-9._]/g, "");
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "text", safeHandle]),
      { db, deviceId, taskId, label: "scout_type_handle" });
    await sleep(randomInt(1200, 2000));
    // Tap profile result
    await withAdbRetry(() => execAdb(udid, ["shell", "input", "tap", "540", "350"]),
      { db, deviceId, taskId, label: "scout_tap_profile_result" });
    await sleep(randomInt(2000, 3500));
  }
  // mode === "scroll": no navigation — stays on current feed

  // ── Scroll + screencap loop ──────────────────────────────────────────────

  const screenshots = [];

  for (let i = 0; i < scrollCount; i++) {
    const duration = randomInt(280, 550);
    const jitterX = randomInt(-25, 25);
    await withAdbRetry(
      () => execAdb(udid, ["shell", "input", "swipe", String(540 + jitterX), "1100", String(540 + jitterX), "400", String(duration)]),
      { db, deviceId, taskId, label: "scout_scroll", maxRetries: 2, baseDelayMs: 1000 },
    );
    await sleep(randomInt(900, 2000));

    if (i % screenshotEvery === 0) {
      const outPath = path.join(screensDir, `${deviceId}-${taskId}-${i}.png`);
      try {
        await adbScreencap(udid, outPath);
        screenshots.push({ path: outPath, step: i, ts: nowIso() });
      } catch (e) {
        logEvent(db, { level: "warn", deviceId, taskId, event: "scout_screenshot_failed", data: { step: i, error: String(e && e.message) } });
      }
    }
  }

  // Go home
  await execAdb(udid, ["shell", "input", "keyevent", "3"]).catch(() => null);

  // Parse structured metadata from captured screenshots.
  // Uses Gemini Vision if GEMINI_API_KEY is set; otherwise produces a stub
  // so downstream tasks can still reference paths and attempt later analysis.
  const parsedCaptures = [];
  for (const shot of screenshots) {
    const meta = { path: shot.path, step: shot.step, ts: shot.ts, parsed: false, accounts: [], engagementSignals: [] };

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey && fs.existsSync(shot.path)) {
      try {
        const imgBase64 = fs.readFileSync(shot.path).toString("base64");
        const body = JSON.stringify({
          contents: [{
            parts: [
              { text: "Extract all visible Instagram account handles, like counts, and comment counts from this screenshot. Return JSON: {accounts:[{handle,likes,comments}], engagementSignals:string[]}" },
              { inlineData: { mimeType: "image/png", data: imgBase64 } },
            ],
          }],
        });
        // Use simple HTTPS call to Gemini flash endpoint
        const geminiRes = await new Promise((resolve, reject) => {
          const req = https.request(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
            (res) => {
              let data = "";
              res.on("data", (c) => { data += c; });
              res.on("end", () => resolve(data));
            },
          );
          req.on("error", reject);
          req.write(body);
          req.end();
        });
        const parsed = JSON.parse(String(geminiRes));
        const textOut = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonMatch = textOut.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extracted = JSON.parse(jsonMatch[0]);
          meta.accounts = extracted.accounts || [];
          meta.engagementSignals = extracted.engagementSignals || [];
          meta.parsed = true;
        }
      } catch (e) {
        logEvent(db, { level: "warn", deviceId, taskId, event: "scout_gemini_parse_failed", data: { path: shot.path, error: String(e && e.message) } });
      }
    }

    parsedCaptures.push(meta);
  }

  logEvent(db, {
    level: "info", deviceId, taskId, event: "scout_complete",
    data: { scrollCount, screenshots: screenshots.length, parsedCaptures: parsedCaptures.length },
  });
  return { scrollCount, screenshots: parsedCaptures, ok: true };
}

async function runSmokeTask({ db, ctrl, taskId, payload }) {
  const deviceId = ctrl.device.id;
  const udid = String(ctrl.device.usb_udid || "");
  if (!udid) {
    throw new Error("missing_usb_udid");
  }

  let p = {};
  try {
    p = JSON.parse(payload || "{}");
  } catch {
    p = {};
  }

  const steps = Array.isArray(p.steps) && p.steps.length > 0 ? p.steps.map(String) : ["swipeNext", "openProfile", "doubleBack", "scrollThrough"];
  const timeoutMs = Number(p.screenChangeTimeoutMs || 9000);
  const pollMs = Number(p.screenChangePollMs || 1500);
  const attemptRecovery = p.attemptRecovery !== false;

  const startedAt = nowIso();
  logEvent(db, {
    level: "info",
    deviceId,
    taskId,
    event: "smoke_started",
    data: { steps, timeoutMs, pollMs, attemptRecovery },
  });

  const baseline = await screenshotWithHash({ udid, deviceId, purpose: "smoke-baseline" });
  let baselineHash = baseline.hash;
  try {
    if (baseline.path) fs.rmSync(baseline.path, { force: true });
  } catch {
    // ignore
  }
  if (!baselineHash) {
    throw new Error("baseline_screenshot_failed");
  }

  const result = {
    device_id: deviceId,
    started_at: startedAt,
    finished_at: null,
    ok: true,
    steps: [],
  };

  for (const actionKey of steps) {
    const step = {
      actionKey,
      ok: false,
      change_ms: null,
      retry: null,
      failure_screenshot_path: null,
      notes: "",
    };

    // eslint-disable-next-line no-await-in-loop
    await ctrl.runAction({ actionKey });
    // eslint-disable-next-line no-await-in-loop
    const change = await waitForScreenChange({
      udid,
      deviceId,
      baselineHash,
      timeoutMs,
      pollMs,
      purpose: `smoke-${actionKey}`,
    });

    if (change.changed) {
      baselineHash = change.shot.hash;
      step.ok = true;
      step.change_ms = change.change_ms;
      try {
        if (change.shot.path) fs.rmSync(change.shot.path, { force: true });
      } catch {
        // ignore
      }
      result.steps.push(step);
      continue;
    }

    step.ok = false;
    step.change_ms = change.change_ms;
    step.failure_screenshot_path = change.shot.path;
    step.notes = "screen_did_not_change";
    logEvent(db, {
      level: "warn",
      deviceId,
      taskId,
      event: "smoke_step_failed",
      data: { actionKey, screenshot_path: change.shot.path },
    });

    if (!attemptRecovery) {
      result.ok = false;
      result.steps.push(step);
      break;
    }

    // Recovery attempt: go home, then retry the step once.
    logEvent(db, { level: "warn", deviceId, taskId, event: "recovery_started", data: { reason: "smoke_step_failed", actionKey } });
    try {
      // eslint-disable-next-line no-await-in-loop
      await ctrl.runAction({ actionKey: "goHome" });
    } catch {
      // ignore recovery voice errors
    }

    // Refresh baseline after recovery.
    try {
      // eslint-disable-next-line no-await-in-loop
      const rec = await screenshotWithHash({ udid, deviceId, purpose: `smoke-recovery-${actionKey}` });
      if (rec.hash) baselineHash = rec.hash;
      if (rec.path) fs.rmSync(rec.path, { force: true });
    } catch {
      // ignore
    }

    // eslint-disable-next-line no-await-in-loop
    await ctrl.runAction({ actionKey });
    // eslint-disable-next-line no-await-in-loop
    const retry = await waitForScreenChange({
      udid,
      deviceId,
      baselineHash,
      timeoutMs,
      pollMs,
      purpose: `smoke-retry-${actionKey}`,
    });

    step.retry = {
      ok: Boolean(retry.changed),
      change_ms: retry.change_ms,
      failure_screenshot_path: retry.changed ? null : retry.shot.path,
    };

    if (retry.changed) {
      baselineHash = retry.shot.hash;
      try {
        if (retry.shot.path) fs.rmSync(retry.shot.path, { force: true });
      } catch {
        // ignore
      }
      step.ok = true;
      result.steps.push(step);
      logEvent(db, { level: "info", deviceId, taskId, event: "recovery_succeeded", data: { actionKey } });
      continue;
    }

    result.ok = false;
    result.steps.push(step);
    logEvent(db, { level: "error", deviceId, taskId, event: "recovery_failed", data: { actionKey, screenshot_path: retry.shot.path } });
    break;
  }

  result.finished_at = nowIso();
  logEvent(db, {
    level: result.ok ? "info" : "error",
    deviceId,
    taskId,
    event: "smoke_complete",
    data: { ok: result.ok, steps: result.steps.length },
  });
  return result;
}

async function runDaemon({ dbPath, pollMs, usbPollMs }) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureFarmSchema(db);
  seedFarmDevicesIfEmpty(db);

  const audioMutex = new AudioMutex();

  const loadDevices = () =>
    db.prepare("SELECT * FROM farm_devices WHERE active = 1 ORDER BY phone_number").all();
  const devices = loadDevices();
  const controllers = new Map();
  for (const d of devices) {
    controllers.set(d.id, new DeviceController({ db, audioMutex, deviceRow: d }));
  }

  let lastUsbCheck = 0;
  let lastAdbCheck = 0;
  let lastTaskPoll = 0;
  const runningJobs = new Set();
  const deviceJobs = new Map(); // deviceId -> taskId
  const adbPollMs = Math.max(usbPollMs, 15000); // ADB device scan every 15s minimum

  // eslint-disable-next-line no-console
  console.log(`[farm-brain] daemon started | db=${dbPath}`);

  while (true) {
    const now = Date.now();

    // USB monitor loop
    if (now - lastUsbCheck >= usbPollMs) {
      lastUsbCheck = now;
      const udids = await listConnectedUdidsViaDevicectl().catch(() => null);
      for (const d of loadDevices()) {
        const ctrl = controllers.get(d.id);
        if (!ctrl) continue;

        let isConnected = true;
        if (udids) {
          if (d.usb_udid) isConnected = udids.has(d.usb_udid);
        }

        if (ctrl.connected !== isConnected) {
          ctrl.setConnected(isConnected);
          const ts = nowIso();
          db.prepare(
            `INSERT OR IGNORE INTO farm_device_health (device_id, usb_connected, session_state, updated_at)
             VALUES (?, ?, ?, ?)`,
          ).run(d.id, isConnected ? 1 : 0, isConnected ? "idle" : "offline", ts);
          db.prepare(
            `UPDATE farm_device_health
             SET usb_connected = ?, last_usb_seen_at = ?, session_state = ?, updated_at = ?
             WHERE device_id = ?`,
          ).run(isConnected ? 1 : 0, ts, isConnected ? "idle" : "offline", ts, d.id);

          logEvent(db, {
            level: isConnected ? "info" : "warn",
            deviceId: d.id,
            taskId: null,
            event: isConnected ? "usb_connected" : "usb_disconnected",
            data: { usb_udid: d.usb_udid || "" },
          });

          if (!isConnected) {
            // Pause device task; reschedule it for retry.
            const cur = db
              .prepare("SELECT current_task_id FROM farm_device_health WHERE device_id = ?")
              .get(d.id);
            const taskId = cur && cur.current_task_id ? String(cur.current_task_id) : "";
            if (taskId) {
              db.prepare(
                `UPDATE farm_tasks
                 SET status='scheduled', started_at=NULL, error=?, updated_at=?
                 WHERE id=? AND status='running'`,
              ).run("device_disconnected", ts, taskId);
              logEvent(db, { level: "warn", deviceId: d.id, taskId, event: "task_paused_for_disconnect" });
            }
            ctrl.stopTask({ reason: "usb_disconnected" });
          }
        }
      }
    }

    // ADB health check loop — independent 15s timer, separate from iOS USB check
    if (now - lastAdbCheck >= adbPollMs) {
      lastAdbCheck = now;
      const adbUdids = await adbListDeviceUdids().catch(() => new Set());
      for (const d of loadDevices()) {
        if (!d.usb_udid) continue;
        // Primary check: `adb devices` list. Fall back to active ping if the list
        // shows the device (transport may be 'unauthorized' etc).
        const listedByAdb = adbUdids.has(d.usb_udid);
        const isAdbConnected = listedByAdb ? await adbPing(d.usb_udid).catch(() => false) : false;
        const ts = nowIso();
        try {
          db.prepare(
            `INSERT OR IGNORE INTO farm_device_health (device_id, usb_connected, adb_connected, session_state, updated_at)
             VALUES (?, 0, 0, 'idle', ?)`,
          ).run(d.id, ts);

          if (isAdbConnected) {
            // Device is reachable — update connected status and last ping timestamp.
            // Restore session_state to 'idle' if it was offline and no task is running.
            const healthRow = db
              .prepare("SELECT session_state, current_task_id FROM farm_device_health WHERE device_id = ?")
              .get(d.id);
            const wasOffline = healthRow && healthRow.session_state === "offline";
            const hasCurrentTask = healthRow && healthRow.current_task_id;
            if (wasOffline && !hasCurrentTask) {
              db.prepare(
                `UPDATE farm_device_health
                 SET adb_connected = 1, session_state = 'idle', last_adb_ping_at = ?, updated_at = ?
                 WHERE device_id = ?`,
              ).run(ts, ts, d.id);
            } else {
              db.prepare(
                `UPDATE farm_device_health
                 SET adb_connected = 1, last_adb_ping_at = ?, updated_at = ?
                 WHERE device_id = ?`,
              ).run(ts, ts, d.id);
            }
          } else {
            // Device is unreachable — mark offline regardless of current session state
            db.prepare(
              `UPDATE farm_device_health
               SET adb_connected = 0, session_state = 'offline', updated_at = ?
               WHERE device_id = ?`,
            ).run(ts, d.id);

            // Helper: find a healthy alternative device for rerouting
            const findHealthyDevice = (excludeDeviceId) =>
              db
                .prepare(
                  `SELECT fdh.device_id FROM farm_device_health fdh
                   JOIN farm_devices fd ON fd.id = fdh.device_id
                   WHERE fdh.adb_connected = 1
                     AND fdh.device_id != ?
                     AND fdh.session_state NOT IN ('running', 'offline')
                     AND (fdh.current_task_id IS NULL OR fdh.current_task_id = '')
                     AND fd.active = 1
                   LIMIT 1`,
                )
                .get(excludeDeviceId);

            // Helper: reroute or backoff-reschedule a single task
            const rerouteTask = (taskId, taskStatus) => {
              const healthy = findHealthyDevice(d.id);
              if (healthy) {
                db.prepare(
                  `UPDATE farm_tasks
                   SET device_id = ?, status = 'scheduled', scheduled_for = ?,
                       started_at = NULL, error = 'adb_disconnected_rerouted', updated_at = ?
                   WHERE id = ? AND status = ?`,
                ).run(healthy.device_id, new Date(Date.now() + 10000).toISOString(), ts, taskId, taskStatus);
                logEvent(db, {
                  level: "warn", deviceId: d.id, taskId,
                  event: "adb_task_rerouted",
                  data: { from: d.id, to: healthy.device_id, reason: "adb_disconnected" },
                });
              } else {
                db.prepare(
                  `UPDATE farm_tasks
                   SET status = 'scheduled', scheduled_for = ?,
                       started_at = NULL, error = 'adb_disconnected', updated_at = ?
                   WHERE id = ? AND status = ?`,
                ).run(new Date(Date.now() + 30000).toISOString(), ts, taskId, taskStatus);
                logEvent(db, {
                  level: "warn", deviceId: d.id, taskId,
                  event: "adb_task_rescheduled", data: { reason: "adb_disconnected_no_healthy_device" },
                });
              }
            };

            // 1. Reroute any running task (tracked by current_task_id)
            const cur = db
              .prepare("SELECT current_task_id FROM farm_device_health WHERE device_id = ?")
              .get(d.id);
            const runningTaskId = cur && cur.current_task_id ? String(cur.current_task_id) : "";
            if (runningTaskId) {
              const runningTask = db
                .prepare("SELECT type FROM farm_tasks WHERE id = ? AND status = 'running'")
                .get(runningTaskId);
              if (runningTask && ["dm", "outreach", "scout", "scroll"].includes(runningTask.type)) {
                rerouteTask(runningTaskId, "running");
              }
              // Clear current_task_id since the task was moved
              db.prepare(
                `UPDATE farm_device_health SET current_task_id = '', updated_at = ? WHERE device_id = ?`,
              ).run(ts, d.id);
            }

            // 2. Reroute all pending scheduled ADB tasks on this now-offline device
            const pendingTasks = db
              .prepare(
                `SELECT id, type FROM farm_tasks
                 WHERE device_id = ? AND status = 'scheduled'
                   AND type IN ('dm', 'outreach', 'scout', 'scroll')
                   AND (next_retry_at IS NULL OR next_retry_at <= ?)`,
              )
              .all(d.id, ts);
            for (const pending of pendingTasks) {
              rerouteTask(pending.id, "scheduled");
            }
          }
        } catch {
          // ignore transient DB errors
        }
      }
    }

    // Task poll loop
    if (now - lastTaskPoll >= pollMs) {
      lastTaskPoll = now;
      const due = db
        .prepare(
          `SELECT * FROM farm_tasks
           WHERE status='scheduled' AND scheduled_for <= ?
           ORDER BY scheduled_for ASC
           LIMIT 20`,
        )
        .all(nowIso());

      for (const t of due) {
        const type = String(t.type);
        const taskId = String(t.id);
        const deviceId = t.device_id ? String(t.device_id) : null;

        // Warmup tasks require a device.
        if (type === "warmup") {
          if (!deviceId) {
            db.prepare(
              `UPDATE farm_tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
            ).run("warmup_missing_device_id", nowIso(), nowIso(), nowIso(), taskId);
            continue;
          }

          const ctrl = controllers.get(deviceId);
          if (!ctrl) {
            db.prepare(
              `UPDATE farm_tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
            ).run("unknown_device_id", nowIso(), nowIso(), nowIso(), taskId);
            continue;
          }
          if (!ctrl.connected) {
            // Keep scheduled; will be retried after reconnect.
            continue;
          }
          if (deviceJobs.has(deviceId)) {
            // Device is busy with a non-warmup job.
            continue;
          }
          if (ctrl.strategy) {
            // Device busy with another task; keep scheduled.
            continue;
          }

          let payload = {};
          try {
            payload = JSON.parse(t.payload || "{}");
          } catch {
            payload = {};
          }
          const durationMinutes = Number(payload.durationMinutes || payload.duration || 60);

          const ts = nowIso();
          db.prepare(
            `UPDATE farm_tasks SET status='running', started_at=?, updated_at=? WHERE id=?`,
          ).run(ts, ts, taskId);
          logEvent(db, { level: "info", deviceId, taskId, event: "task_started", data: { type, payload } });
          ctrl.startWarmup({ taskId, durationMinutes });
        }

        if (type === "smoke") {
          if (!deviceId) {
            db.prepare(
              `UPDATE farm_tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
            ).run("smoke_missing_device_id", nowIso(), nowIso(), nowIso(), taskId);
            continue;
          }
          const ctrl = controllers.get(deviceId);
          if (!ctrl) {
            db.prepare(
              `UPDATE farm_tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
            ).run("unknown_device_id", nowIso(), nowIso(), nowIso(), taskId);
            continue;
          }
          if (!ctrl.connected) continue;
          if (ctrl.strategy) continue;
          if (deviceJobs.has(deviceId)) continue;
          if (runningJobs.has(taskId)) continue;

          const ts = nowIso();
          db.prepare(
            `UPDATE farm_tasks SET status='running', started_at=?, updated_at=? WHERE id=?`,
          ).run(ts, ts, taskId);

          let payload = "{}";
          try {
            payload = String(t.payload || "{}");
          } catch {
            payload = "{}";
          }

          runningJobs.add(taskId);
          deviceJobs.set(deviceId, taskId);
          ctrl.currentTaskId = taskId;
          ctrl.queue = [];
          try {
            ctrl._setHealth({ session_state: "running", current_task_id: taskId, error: "" });
          } catch {
            // ignore
          }

          logEvent(db, { level: "info", deviceId, taskId, event: "task_started", data: { type } });
          (async () => {
            try {
              const res = await runSmokeTask({ db, ctrl, taskId, payload });
              db.prepare(
                `UPDATE farm_tasks
                 SET status='succeeded', finished_at=?, result=?, updated_at=?
                 WHERE id=?`,
              ).run(nowIso(), JSON.stringify(res), nowIso(), taskId);
              logEvent(db, { level: "info", deviceId, taskId, event: "task_succeeded", data: { type } });
            } catch (e) {
              const err = String(e && (e.stderr || e.message || e));
              if (err.includes("device_offline") || err.includes("device_disconnected")) {
                const ts2 = nowIso();
                db.prepare(
                  `UPDATE farm_tasks
                   SET status='scheduled', started_at=NULL, finished_at=NULL, error=?, updated_at=?
                   WHERE id=?`,
                ).run("device_disconnected", ts2, taskId);
                logEvent(db, { level: "warn", deviceId, taskId, event: "task_paused_for_disconnect", data: { type } });
              } else {
                db.prepare(
                  `UPDATE farm_tasks
                   SET status='failed', finished_at=?, error=?, updated_at=?
                   WHERE id=?`,
                ).run(nowIso(), err, nowIso(), taskId);
                logEvent(db, { level: "error", deviceId, taskId, event: "task_failed", data: { type } });
              }
            } finally {
              try {
                ctrl.stopTask();
              } catch {
                // ignore
              }
              ctrl.currentTaskId = "";
              deviceJobs.delete(deviceId);
              runningJobs.delete(taskId);
            }
          })();
        }

        if (type === "audit") {
          if (runningJobs.has(taskId)) continue;
          const ts = nowIso();
          db.prepare(
            `UPDATE farm_tasks SET status='running', started_at=?, updated_at=? WHERE id=?`,
          ).run(ts, ts, taskId);
          runningJobs.add(taskId);
          logEvent(db, { level: "info", deviceId, taskId, event: "task_started", data: { type } });
          (async () => {
            try {
              const res = await runAudit({ db, devices, deviceId });
              db.prepare(
                `UPDATE farm_tasks
                 SET status='succeeded', finished_at=?, result=?, updated_at=?
                 WHERE id=?`,
              ).run(nowIso(), JSON.stringify(res), nowIso(), taskId);
              logEvent(db, { level: "info", deviceId, taskId, event: "task_succeeded", data: { type } });
            } catch (e) {
              db.prepare(
                `UPDATE farm_tasks
                 SET status='failed', finished_at=?, error=?, updated_at=?
                 WHERE id=?`,
              ).run(nowIso(), String(e && (e.stderr || e.message || e)), nowIso(), taskId);
              logEvent(db, { level: "error", deviceId, taskId, event: "task_failed", data: { type } });
            } finally {
              runningJobs.delete(taskId);
            }
          })();
        }

        if (type === "post") {
          if (runningJobs.has(taskId)) continue;
          const ts = nowIso();
          db.prepare(
            `UPDATE farm_tasks SET status='running', started_at=?, updated_at=? WHERE id=?`,
          ).run(ts, ts, taskId);
          runningJobs.add(taskId);
          logEvent(db, { level: "info", deviceId: null, taskId, event: "task_started", data: { type } });
          (async () => {
            try {
              const res = await runPostTask();
              db.prepare(
                `UPDATE farm_tasks
                 SET status='succeeded', finished_at=?, result=?, updated_at=?
                 WHERE id=?`,
              ).run(nowIso(), JSON.stringify(res), nowIso(), taskId);
              logEvent(db, { level: "info", deviceId: null, taskId, event: "task_succeeded", data: { type } });
            } catch (e) {
              db.prepare(
                `UPDATE farm_tasks
                 SET status='failed', finished_at=?, error=?, updated_at=?
                 WHERE id=?`,
              ).run(nowIso(), String(e && (e.stderr || e.message || e)), nowIso(), taskId);
              logEvent(db, { level: "error", deviceId: null, taskId, event: "task_failed", data: { type } });
            } finally {
              runningJobs.delete(taskId);
            }
          })();
        }

        // ── ADB task types: dm | outreach | scout | scroll ──────────────────
        if (["dm", "outreach", "scout", "scroll"].includes(type)) {
          if (runningJobs.has(taskId)) continue;

          // Require a device for all ADB tasks
          if (!deviceId) {
            db.prepare(
              `UPDATE farm_tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
            ).run(`${type}_missing_device_id`, nowIso(), nowIso(), taskId);
            logEvent(db, { level: "error", deviceId: null, taskId, event: "task_failed", data: { type, reason: "missing_device_id" } });
            continue;
          }

          const device = db.prepare("SELECT * FROM farm_devices WHERE id = ?").get(deviceId);
          if (!device) {
            db.prepare(
              `UPDATE farm_tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
            ).run("unknown_device_id", nowIso(), nowIso(), taskId);
            continue;
          }

          const udid = String(device.usb_udid || "");
          if (!udid) {
            db.prepare(
              `UPDATE farm_tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
            ).run(`${type}_missing_usb_udid`, nowIso(), nowIso(), taskId);
            logEvent(db, { level: "error", deviceId, taskId, event: "task_failed", data: { type, reason: "missing_usb_udid" } });
            continue;
          }

          // Skip if ADB reports device offline
          const healthRow = db
            .prepare("SELECT adb_connected, session_state FROM farm_device_health WHERE device_id = ?")
            .get(deviceId);
          if (healthRow && healthRow.adb_connected === 0 && healthRow.session_state === "offline") {
            logEvent(db, { level: "warn", deviceId, taskId, event: "task_skip_adb_offline", data: { type } });
            continue;
          }

          if (deviceJobs.has(deviceId)) continue; // device busy

          const ts = nowIso();
          db.prepare(
            `UPDATE farm_tasks SET status='running', started_at=?, updated_at=? WHERE id=?`,
          ).run(ts, ts, taskId);
          runningJobs.add(taskId);
          deviceJobs.set(deviceId, taskId);

          // Track the active task in device health so disconnect recovery can find it
          try {
            db.prepare(
              `INSERT OR IGNORE INTO farm_device_health (device_id, usb_connected, adb_connected, session_state, updated_at)
               VALUES (?, 0, 0, 'idle', ?)`,
            ).run(deviceId, ts);
            db.prepare(
              `UPDATE farm_device_health
               SET current_task_id = ?, session_state = 'running', updated_at = ?
               WHERE device_id = ?`,
            ).run(taskId, ts, deviceId);
          } catch { /* ignore */ }

          logEvent(db, { level: "info", deviceId, taskId, event: "task_started", data: { type } });

          const payload = String(t.payload || "{}");

          (async () => {
            try {
              let res;
              if (type === "scroll") {
                res = await runScrollTask({ db, taskId, deviceId, udid, payload });
              } else if (type === "dm") {
                res = await runDmTask({ db, taskId, deviceId, udid, payload });
              } else if (type === "outreach") {
                res = await runOutreachTask({ db, taskId, deviceId, udid, payload });
              } else if (type === "scout") {
                res = await runScoutTask({ db, taskId, deviceId, udid, payload });
              }

              db.prepare(
                `UPDATE farm_tasks SET status='succeeded', finished_at=?, result=?, updated_at=? WHERE id=?`,
              ).run(nowIso(), JSON.stringify(res || {}), nowIso(), taskId);
              logEvent(db, { level: "info", deviceId, taskId, event: "task_succeeded", data: { type } });
            } catch (e) {
              const errMsg = String(e && (e.message || e));
              const ts2 = nowIso();

              // Fetch current retry count
              const taskRow = db.prepare("SELECT retry_count, max_retries FROM farm_tasks WHERE id = ?").get(taskId);
              const retryCount = Number((taskRow && taskRow.retry_count) || 0);
              const maxRetries = Number((taskRow && taskRow.max_retries) || 3);

              if (retryCount < maxRetries) {
                // Exponential backoff before next attempt
                const backoffMs = Math.pow(2, retryCount) * 5000;
                const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
                db.prepare(
                  `UPDATE farm_tasks
                   SET status='scheduled', scheduled_for=?, retry_count=?, error=?, started_at=NULL, updated_at=?
                   WHERE id=?`,
                ).run(nextRetryAt, retryCount + 1, errMsg, ts2, taskId);
                logEvent(db, {
                  level: "warn", deviceId, taskId, event: "task_retry_scheduled",
                  data: { type, attempt: retryCount + 1, maxRetries, backoffMs, nextRetryAt },
                });
              } else {
                db.prepare(
                  `UPDATE farm_tasks SET status='failed', finished_at=?, error=?, updated_at=? WHERE id=?`,
                ).run(ts2, errMsg, ts2, taskId);
                logEvent(db, { level: "error", deviceId, taskId, event: "task_failed", data: { type, error: errMsg } });
              }
            } finally {
              // Clear current_task_id and reset session_state in health table
              try {
                const clrTs = nowIso();
                db.prepare(
                  `UPDATE farm_device_health
                   SET current_task_id = '', session_state = 'idle', updated_at = ?
                   WHERE device_id = ? AND current_task_id = ?`,
                ).run(clrTs, deviceId, taskId);
              } catch { /* ignore */ }
              deviceJobs.delete(deviceId);
              runningJobs.delete(taskId);
            }
          })();
        }
      }
    }

    // Tick device strategies (isolated per-device queues via busy gates + shared audio mutex)
    for (const ctrl of controllers.values()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await ctrl.tick();
      } catch (e) {
        const err = String(e && (e.stderr || e.message || e));
        logEvent(db, {
          level: "error",
          deviceId: ctrl.device.id,
          taskId: ctrl.currentTaskId || null,
          event: "device_tick_error",
          data: { error: err },
        });
        ctrl.stopTask({ reason: "tick_error" });
      }
    }

    await sleep(150);
  }
}

async function runOneOffWarmup({ dbPath, deviceId, durationMinutes }) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureFarmSchema(db);
  seedFarmDevicesIfEmpty(db);

  const device = db
    .prepare("SELECT * FROM farm_devices WHERE id = ? AND active = 1")
    .get(deviceId);
  if (!device) {
    // eslint-disable-next-line no-console
    console.error(`[farm-brain] Unknown device '${deviceId}'. Expected one of: phone1..phone4`);
    process.exit(1);
  }

  const audioMutex = new AudioMutex();
  const ctrl = new DeviceController({ db, audioMutex, deviceRow: device });

  // Create an ad-hoc task row for traceability.
  const taskId = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO farm_tasks (id, type, device_id, scheduled_for, status, payload, started_at, created_at, updated_at)
     VALUES (?, 'warmup', ?, ?, 'running', ?, ?, ?, ?)`,
  ).run(taskId, device.id, ts, JSON.stringify({ durationMinutes }), ts, ts, ts);
  logEvent(db, { level: "info", deviceId: device.id, taskId, event: "one_off_warmup_started" });

  ctrl.startWarmup({ taskId, durationMinutes });
  // eslint-disable-next-line no-console
  console.log(`[farm-brain] warmup started | device=${device.id} prefix=${device.voice_prefix} duration=${durationMinutes}m`);

  while (ctrl.strategy && !ctrl.strategy.isDone()) {
    // eslint-disable-next-line no-await-in-loop
    await ctrl.tick();
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
  }

  logEvent(db, { level: "info", deviceId: device.id, taskId, event: "one_off_warmup_complete" });
  // eslint-disable-next-line no-console
  console.log("[farm-brain] warmup complete");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || null;

  const dbPath = args.db ? path.resolve(String(args.db)) : DEFAULT_DB_PATH;

  const durationMinutes = Number(args.duration || 60);
  const pollMs = Number(args.pollMs || 1000);
  const usbPollMs = Number(args.usbPollMs || 5000);

  DRY_RUN = Boolean(args.dryRun || process.env.FARM_DRY_RUN === "1");
  LOG_ACTIONS = Boolean(args.logActions || process.env.FARM_LOG_ACTIONS === "1");
  ALLOW_ENGAGEMENT = Boolean(args.allowEngagement || process.env.FARM_ALLOW_ENGAGEMENT === "1");
  ENABLE_SEARCH = Boolean(args.enableSearch || process.env.FARM_ENABLE_SEARCH === "1");
  JSONL_ENABLED = !(String(args.jsonl || process.env.FARM_JSONL || "1") === "0");
  initJsonlLogger();

  // Back-compat: previous usage had no subcommand and used --duration/--slot/--prefix.
  const legacyWarmup = !cmd && (args.duration || args.slot || args.prefix || args.id);
  if (cmd === "daemon") {
    await runDaemon({ dbPath, pollMs, usbPollMs });
    return;
  }

  if (cmd === "warmup" || legacyWarmup) {
    const deviceId = args.device || (args.slot ? `phone${String(args.slot)}` : "phone1");
    await runOneOffWarmup({ dbPath, deviceId: String(deviceId), durationMinutes });
    return;
  }

  if (cmd === "audit") {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    ensureFarmSchema(db);
    seedFarmDevicesIfEmpty(db);
    const devices = db.prepare("SELECT * FROM farm_devices WHERE active = 1").all();
    const deviceId = args.device ? String(args.device) : null;
    const res = await runAudit({ db, devices, deviceId });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // Default behavior: run daemon (production mode).
  await runDaemon({ dbPath, pollMs, usbPollMs });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[farm-brain] fatal", e && (e.stderr || e.message || e));
  process.exit(1);
});
