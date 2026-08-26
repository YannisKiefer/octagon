"""Octagon — Minimal SQLite. Ponytail: 4 tables only, global WAL, log to farm_events."""
from __future__ import annotations
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from loguru import logger
from .models import NicheConfig, NicheType, DeviceProfile
import os

DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "infra" / "db" / "farm.db"

# ponytail: global mutex for TTS, 4-table DB, split analytics when CMO proves value
class OctagonDB:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self):
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=5000")  # ponytail: 5s, fixes concurrent hub+brain+MCP
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._create_tables()
        logger.info("[DB] farm.db ready")

    def _create_tables(self):
        self.conn.executescript("""
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
            CREATE TABLE IF NOT EXISTS niche_config (
                phone_number INTEGER PRIMARY KEY,
                niche TEXT NOT NULL,
                niche_name TEXT NOT NULL,
                telegram_group_id TEXT NOT NULL,
                tiktok_handle TEXT DEFAULT '',
                instagram_handle TEXT DEFAULT '',
                linkedin_handle TEXT DEFAULT '',
                gps_lat_center REAL DEFAULT 47.3769,
                gps_lon_center REAL DEFAULT 8.5417,
                gps_radius REAL DEFAULT 0.01,
                device_profile TEXT DEFAULT 'iphone_15_pro',
                platforms TEXT DEFAULT '[]',
                active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL
            );
        """)
        self.conn.commit()
        self._seed_devices()

    def _seed_devices(self):
        if self.conn.execute("SELECT COUNT(*) FROM farm_devices").fetchone()[0] >= 4:
            return
        now = datetime.now(timezone.utc).isoformat()
        defaults = [(1,"Alpha"),(2,"Bravo"),(3,"Charlie"),(4,"Delta")]
        for phone, prefix in defaults:
            pref = os.getenv(f"FARM_PHONE{phone}_PREFIX", prefix)
            udid = os.getenv(f"FARM_PHONE{phone}_UDID", "")
            name = f"Phone {phone} ({pref})"
            self.conn.execute("INSERT OR IGNORE INTO farm_devices (id, phone_number, display_name, voice_prefix, usb_udid, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                              (f"phone{phone}", phone, name, pref, udid, 1, now, now))
            self.conn.execute("INSERT OR IGNORE INTO farm_device_health (device_id, updated_at) VALUES (?,?)", (f"phone{phone}", now))
        self.conn.commit()

    # minimal helpers used by seed-demo and health API
    def log_event(self, event: str, level: str = "info", device_id: str | None = None, task_id: str | None = None, data: str = "{}"):
        import uuid
        self.conn.execute("INSERT INTO farm_events (id, ts, level, device_id, task_id, event, data) VALUES (?,?,?,?,?,?,?)",
                          (str(uuid.uuid4())[:12], datetime.now(timezone.utc).isoformat(), level, device_id, task_id, event, data))
        self.conn.commit()
