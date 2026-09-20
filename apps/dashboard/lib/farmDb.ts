import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.join(
  process.env.FARM_DB_PATH || process.env.OCTRAGON_DB_PATH || path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db"),
);

export type FarmDevice = {
  id: string;
  phone_number: number;
  display_name: string;
  voice_prefix: string;
  usb_udid: string;
  active: number;
  created_at: string;
  updated_at: string;
};

export type FarmDeviceHealth = {
  device_id: string;
  usb_connected: number;
  last_usb_seen_at: string | null;
  session_state: string;
  current_task_id: string;
  swipes: number;
  likes: number;
  saves: number;
  comments: number;
  profiles: number;
  last_action: string;
  last_action_at: string | null;
  jitter_variance: number;
  error: string;
  updated_at: string;
};

export type FarmTask = {
  id: string;
  type: "session";
  device_id: string | null;
  scheduled_for: string;
  status: "scheduled" | "running" | "succeeded" | "failed" | "canceled";
  payload: string;
  started_at: string | null;
  finished_at: string | null;
  result: string;
  error: string;
  created_at: string;
  updated_at: string;
};

let _dbRW: Database.Database | null = null;
let _dbRO: Database.Database | null = null;

function getFarmDbRW(): Database.Database {
  if (!_dbRW) {
    _dbRW = new Database(DB_PATH, { readonly: false });
    _dbRW.pragma("journal_mode = WAL");
    _dbRW.pragma("busy_timeout = 5000"); // ponytail: 5s, fixes SQLITE_BUSY on 4-phone concurrent
    ensureFarmSchema(_dbRW);
    seedFarmDevicesIfEmpty(_dbRW);
  }
  return _dbRW;
}

export function getFarmDb({ readonly = false }: { readonly?: boolean } = {}): Database.Database {
  if (readonly) {
    // Ensure schema exists even if the first consumer is a read-only route.
    getFarmDbRW();
    if (!_dbRO) {
      _dbRO = new Database(DB_PATH, { readonly: true });
      _dbRO.pragma("journal_mode = WAL");
    }
    return _dbRO;
  }
  return getFarmDbRW();
}

export function ensureFarmSchema(db: Database.Database): void {
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
    CREATE INDEX IF NOT EXISTS idx_farm_events_device_ts ON farm_events(device_id, ts DESC);
  `);
}

function seedFarmDevicesIfEmpty(db: Database.Database): void {
  // Seed only a completely empty registry. Re-seeding a partially populated
  // one would resurrect devices the operator deleted.
  const row = db.prepare("SELECT COUNT(*) as c FROM farm_devices").get() as { c: number };
  if (row.c > 0) return;

  const now = new Date().toISOString();
  const defaults: Array<{ phone: number; prefix: string }> = [
    { phone: 1, prefix: "Alpha" },
    { phone: 2, prefix: "Bravo" },
    { phone: 3, prefix: "Charlie" },
    { phone: 4, prefix: "Delta" },
  ];

  const getPrefix = (phone: number, fallback: string) =>
    process.env[`FARM_PHONE${phone}_PREFIX`] || fallback;
  const getUdid = (phone: number) => process.env[`FARM_PHONE${phone}_UDID`] || "";

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
    const id = `phone${d.phone}`;
    const displayName = `${getPrefix(d.phone, d.prefix)} (Phone ${d.phone})`;
    insertDevice.run(id, d.phone, displayName, getPrefix(d.phone, d.prefix), getUdid(d.phone), now, now);
    insertHealth.run(id, now);
  }
}

export function listFarmDevices(): FarmDevice[] {
  return getFarmDb({ readonly: true })
    .prepare("SELECT * FROM farm_devices WHERE active = 1 ORDER BY phone_number")
    .all() as FarmDevice[];
}

export function getFarmHealth(): FarmDeviceHealth[] {
  return getFarmDb({ readonly: true })
    .prepare("SELECT * FROM farm_device_health ORDER BY device_id")
    .all() as FarmDeviceHealth[];
}

export function listFarmTasks(fromIso?: string, toIso?: string): FarmTask[] {
  const db = getFarmDb({ readonly: true });
  if (fromIso && toIso) {
    return db
      .prepare(
        "SELECT * FROM farm_tasks WHERE scheduled_for >= ? AND scheduled_for <= ? ORDER BY scheduled_for ASC",
      )
      .all(fromIso, toIso) as FarmTask[];
  }
  return db.prepare("SELECT * FROM farm_tasks ORDER BY scheduled_for DESC, created_at DESC LIMIT 500").all() as FarmTask[];
}

export type FarmEvent = { id: string; ts: string; level: string; device_id: string | null; task_id: string | null; event: string; data: string };
export function listFarmEvents(limit = 50, deviceId?: string): FarmEvent[] {
  try {
    const db = getFarmDb({ readonly: true });
    if (deviceId) {
      return db.prepare("SELECT * FROM farm_events WHERE device_id = ? ORDER BY ts DESC LIMIT ?").all(deviceId, limit) as FarmEvent[];
    }
    return db.prepare("SELECT * FROM farm_events ORDER BY ts DESC LIMIT ?").all(limit) as FarmEvent[];
  } catch {
    return [];
  }
}

export function insertFarmEvent(deviceId: string | null, event: string, level = "info", data: Record<string, unknown> = {}): FarmEvent {
  const db = getFarmDb({ readonly: false });
  const now = new Date().toISOString();
  const row = { id: crypto.randomUUID(), ts: now, level, device_id: deviceId, task_id: null, event, data: JSON.stringify(data) };
  db.prepare("INSERT INTO farm_events (id, ts, level, device_id, task_id, event, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.ts, row.level, row.device_id, row.task_id, row.event, row.data);
  return row;
}

export function createFarmDevice(prefix: string, displayName?: string): FarmDevice {
  const db = getFarmDb({ readonly: false });
  // Number from MAX, not COUNT, so deletions cannot cause id collisions.
  const maxPhone = (db.prepare("SELECT COALESCE(MAX(phone_number), 0) AS m FROM farm_devices").get() as { m: number }).m;
  const maxId = (db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 6) AS INTEGER)), 0) AS m FROM farm_devices").get() as { m: number }).m;
  const phone = Math.max(maxPhone, maxId) + 1;
  const id = `phone${phone}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO farm_devices (id, phone_number, display_name, voice_prefix, usb_udid, active, created_at, updated_at) VALUES (?, ?, ?, ?, '', 1, ?, ?)")
    .run(id, phone, displayName || `${prefix} (Phone ${phone})`, prefix, now, now);
  db.prepare("INSERT INTO farm_device_health (device_id, usb_connected, session_state, updated_at) VALUES (?, 0, 'idle', ?)")
    .run(id, now);
  return db.prepare("SELECT * FROM farm_devices WHERE id = ?").get(id) as FarmDevice;
}
