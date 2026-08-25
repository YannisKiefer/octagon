import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.OCTRAGON_DB_PATH ||
  path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getWritableDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: false });
  db.pragma("journal_mode = WAL");
  db.exec(
    `CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  return db;
}

export async function GET() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ enabled: false });
    }
    const db = getWritableDb();
    const row = db
      .prepare("SELECT value FROM system_settings WHERE key = ?")
      .get("radar_enabled") as { value: string } | undefined;
    const enabled = row ? row.value === "true" : false;
    db.close();

    return NextResponse.json({ enabled });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const enabled = !!body.enabled;
    const value = enabled ? "true" : "false";
    const updated_at = new Date().toISOString();

    const db = getWritableDb();
    db.prepare(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("radar_enabled", value, updated_at);
    db.close();

    return NextResponse.json({ success: true, enabled });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
