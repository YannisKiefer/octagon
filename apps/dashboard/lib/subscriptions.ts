import Database from "better-sqlite3";
import path from "path";
import { Tier } from "./tiers";

const DB_PATH = path.join(
  process.env.OCTRAGON_DB_PATH ||
  path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db")
);

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: false });
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}

export type UserSubscription = {
  user_id: string;
  email: string;
  tier: Tier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  subscription_status: string;
  current_period_end: string | null;
  onboarding_completed: number;
  onboarding_step: number;
  created_at: string;
  updated_at: string;
};

export type UsageRecord = {
  user_id: string;
  date: string;
  posts_count: number;
  accounts_count: number;
  phones_count: number;
};

function ensureTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT 'solo',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_price_id TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'trialing',
      current_period_end TEXT,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      onboarding_step INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      posts_count INTEGER NOT NULL DEFAULT 0,
      accounts_count INTEGER NOT NULL DEFAULT 0,
      phones_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, date)
    );
  `);
}

export function getUserSubscription(userId: string): UserSubscription | null {
  const db = getDb();
  ensureTables(db);
  return db.prepare("SELECT * FROM user_subscriptions WHERE user_id = ?").get(userId) as UserSubscription | null;
}

export function getOrCreateSubscription(userId: string, email = ""): UserSubscription {
  const db = getDb();
  ensureTables(db);

  const existing = db.prepare("SELECT * FROM user_subscriptions WHERE user_id = ?").get(userId) as UserSubscription | null;
  if (existing) return existing;

  db.prepare(`
    INSERT INTO user_subscriptions (user_id, email, tier, subscription_status)
    VALUES (?, ?, 'solo', 'trialing')
  `).run(userId, email);

  return db.prepare("SELECT * FROM user_subscriptions WHERE user_id = ?").get(userId) as UserSubscription;
}

export function updateSubscriptionByStripeCustomer(
  stripeCustomerId: string,
  updates: Partial<UserSubscription>
): void {
  const db = getDb();
  ensureTables(db);

  const sets: string[] = [];
  const vals: any[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (key !== "user_id") {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }

  sets.push("updated_at = datetime('now')");
  vals.push(stripeCustomerId);

  if (sets.length > 1) {
    db.prepare(`UPDATE user_subscriptions SET ${sets.join(", ")} WHERE stripe_customer_id = ?`).run(...vals);
  }
}

export function updateSubscription(userId: string, updates: Partial<UserSubscription>): void {
  const db = getDb();
  ensureTables(db);

  const sets: string[] = [];
  const vals: any[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (key !== "user_id") {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }

  sets.push("updated_at = datetime('now')");
  vals.push(userId);

  if (sets.length > 1) {
    db.prepare(`UPDATE user_subscriptions SET ${sets.join(", ")} WHERE user_id = ?`).run(...vals);
  }
}

export function getTodayUsage(userId: string): UsageRecord {
  const db = getDb();
  ensureTables(db);

  const today = new Date().toISOString().split("T")[0];
  const existing = db.prepare("SELECT * FROM usage_records WHERE user_id = ? AND date = ?").get(userId, today) as UsageRecord | null;

  if (existing) return existing;

  db.prepare("INSERT OR IGNORE INTO usage_records (user_id, date) VALUES (?, ?)").run(userId, today);
  return db.prepare("SELECT * FROM usage_records WHERE user_id = ? AND date = ?").get(userId, today) as UsageRecord;
}

export function incrementPostCount(userId: string): void {
  const db = getDb();
  ensureTables(db);
  const today = new Date().toISOString().split("T")[0];
  db.prepare(`
    INSERT INTO usage_records (user_id, date, posts_count) VALUES (?, ?, 1)
    ON CONFLICT(user_id, date) DO UPDATE SET posts_count = posts_count + 1
  `).run(userId, today);
}

export function getDefaultUserId(): string {
  return process.env.DASHBOARD_ADMIN_USER || "default_user";
}
