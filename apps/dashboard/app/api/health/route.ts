import { NextResponse } from "next/server";
import fs from "fs";
import { DB_PATH } from "@/lib/farmDb";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbPath = DB_PATH;

  let dbStatus: "ok" | "missing" | "error" = "missing";
  try {
    if (fs.existsSync(dbPath)) {
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath, { readonly: true });
      db.prepare("SELECT 1").get();
      db.close();
      dbStatus = "ok";
    }
  } catch {
    dbStatus = "error";
  }

  const status = dbStatus === "ok" ? "healthy" : "degraded";

  return NextResponse.json(
    {
      status,
      version: process.env.npm_package_version || "0.1.0",
      timestamp: new Date().toISOString(),
      checks: {
        database: dbStatus,
        runtime: "ok",
      },
    },
    { status: status === "healthy" ? 200 : 503 }
  );
}
