/**
 * Cloud-native task scheduler for Octragon OS.
 *
 * Uses node-cron for scheduling. Job state is persisted in Supabase so
 * rescheduling and pause/resume survive process restarts.
 *
 * Jobs:
 *   scrape-discover    every 4 hours
 *   daily-post-plan    every day at 06:00 UTC
 *   outreach-trigger   configurable interval (default 15s, range 10–30s)
 *   forge-deploy       on-demand + optional cron schedule (default: manual only)
 *   post-watchdog      every 5 minutes
 */

import cron, { ScheduledTask } from "node-cron";
import { spawn } from "child_process";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client ───────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = "idle" | "running" | "success" | "failed" | "paused";

export interface JobConfig {
  id: string;
  name: string;
  description: string;
  /** 5-field cron expression. Mutually exclusive with intervalSeconds. */
  cronExpr?: string;
  /** Interval in seconds. Mutually exclusive with cronExpr. */
  intervalSeconds?: number;
  /** If true the job starts without any automatic schedule (manual trigger only).
   *  Can be converted to a scheduled job at runtime via rescheduleJob(). */
  startsUnscheduled?: boolean;
  /** Allowed interval range for interval-based jobs (seconds). */
  intervalMin?: number;
  intervalMax?: number;
  command: string[];
  maxRetries: number;
}

interface LiveJobState {
  paused: boolean;
  running: boolean;
  retries: number;
  retryTimeout?: ReturnType<typeof setTimeout>;
  intervalHandle?: ReturnType<typeof setInterval>;
  cronTask?: ScheduledTask;
}

// ── Job definitions ───────────────────────────────────────────────────────────

const ENGINE_DIR = path.resolve(process.cwd(), "..", "..", "engine");

/**
 * Mutable live config. startScheduler() hydrates this from the DB so runtime
 * changes (reschedule / pause) survive restarts.
 */
const JOB_CONFIGS: JobConfig[] = [
  {
    id: "scrape-discover",
    name: "Scrape & Discover",
    description: "Runs the 4-phone discovery cycle: radar sweep + feed health",
    cronExpr: "0 */4 * * *",
    command: ["python3", path.join(ENGINE_DIR, "run.py"), "discover"],
    maxRetries: 3,
  },
  {
    id: "daily-post-plan",
    name: "Daily Post Plan",
    description: "Generates the daily posting plan for all 16 accounts at 6 AM",
    cronExpr: "0 6 * * *",
    command: ["python3", path.join(ENGINE_DIR, "run.py"), "daily"],
    maxRetries: 2,
  },
  {
    id: "outreach-trigger",
    name: "Outreach Trigger",
    description: "Triggers outreach pipeline on configurable interval (10–30s)",
    intervalSeconds: 15,
    intervalMin: 10,
    intervalMax: 30,
    command: ["python3", path.join(ENGINE_DIR, "run.py"), "outreach"],
    maxRetries: 1,
  },
  {
    id: "forge-deploy",
    name: "Forge Deploy",
    description:
      "Video forge & deploy pipeline — on-demand by default; schedulable via reschedule",
    startsUnscheduled: true,
    command: ["python3", path.join(ENGINE_DIR, "run.py"), "forge"],
    maxRetries: 2,
  },
  {
    id: "post-watchdog",
    name: "Post Watchdog",
    description: "Checks posting queue for stuck/overdue posts every 5 minutes",
    cronExpr: "*/5 * * * *",
    command: ["python3", path.join(ENGINE_DIR, "run.py"), "watchdog"],
    maxRetries: 1,
  },
];

// ── In-memory state ───────────────────────────────────────────────────────────

const jobState: Record<string, LiveJobState> = {};
for (const cfg of JOB_CONFIGS) {
  jobState[cfg.id] = { paused: false, running: false, retries: 0 };
}

// ── Cron next-run helper ──────────────────────────────────────────────────────

// Match one cron field: supports *, step (slash-n), ranges lo-hi, lists a,b,c.
function fieldMatches(expr: string, val: number): boolean {
  if (expr === "*") return true;
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10);
    return Number.isFinite(step) && step > 0 && val % step === 0;
  }
  for (const part of expr.split(",")) {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (val >= lo && val <= hi) return true;
    } else {
      if (parseInt(part, 10) === val) return true;
    }
  }
  return false;
}

function cronMatchesDate(expr: string, d: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minE, hrE, domE, monE, dowE] = parts;
  return (
    fieldMatches(minE, d.getMinutes()) &&
    fieldMatches(hrE, d.getHours()) &&
    fieldMatches(domE, d.getDate()) &&
    fieldMatches(monE, d.getMonth() + 1) &&
    fieldMatches(dowE, d.getDay())
  );
}

/**
 * Compute next firing time for a cron expression by scanning forward up to
 * 7 days (covers weekly schedules such as "0 6 * * 1").
 */
function nextRunFromCron(expr: string): string | null {
  try {
    const now = new Date();
    for (let i = 1; i <= 60 * 24 * 7; i++) {
      const candidate = new Date(now.getTime() + i * 60 * 1000);
      candidate.setSeconds(0, 0);
      if (cronMatchesDate(expr, candidate)) return candidate.toISOString();
    }
  } catch {
    // ignore
  }
  return null;
}

function computeNextRun(cfg: JobConfig): string | null {
  if (!cfg.cronExpr && !cfg.intervalSeconds) return null;
  if (cfg.cronExpr) return nextRunFromCron(cfg.cronExpr);
  if (cfg.intervalSeconds) {
    return new Date(Date.now() + cfg.intervalSeconds * 1000).toISOString();
  }
  return null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertJobRow(id: string, fields: Record<string, unknown>) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("scheduler_jobs").upsert({ id, ...fields }, { onConflict: "id" });
  } catch {
    // Supabase not configured — never crash the scheduler
  }
}

async function incrementCounter(id: string, field: "run_count" | "fail_count") {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb
      .from("scheduler_jobs")
      .select(field)
      .eq("id", id)
      .single();
    const current = (data as Record<string, number> | null)?.[field] ?? 0;
    await sb.from("scheduler_jobs").update({ [field]: current + 1 }).eq("id", id);
  } catch {
    // ignore
  }
}

async function logFailureAlert(jobId: string, error: string) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("cybernetic_log").insert({
      id: `alert_${jobId}_${Date.now()}`,
      level: "error",
      source: "scheduler",
      message: `[Scheduler] Job '${jobId}' failed after max retries: ${error}`,
      data: { job_id: jobId, error },
      created_at: new Date().toISOString(),
    });
  } catch {
    // ignore
  }
}

// ── Schedule attachment ───────────────────────────────────────────────────────

function attachSchedule(cfg: JobConfig) {
  const state = jobState[cfg.id];

  // Tear down existing schedule
  if (state.cronTask) { state.cronTask.destroy(); state.cronTask = undefined; }
  if (state.intervalHandle !== undefined) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = undefined;
  }

  if (cfg.cronExpr) {
    state.cronTask = cron.schedule(cfg.cronExpr, () => runJob(cfg));
  } else if (cfg.intervalSeconds) {
    state.intervalHandle = setInterval(
      () => runJob(cfg),
      cfg.intervalSeconds * 1000
    );
  }
  // else: no schedule attached (manual trigger only)
}

// ── Job runner ────────────────────────────────────────────────────────────────

async function runJob(cfg: JobConfig, attempt = 0): Promise<void> {
  const state = jobState[cfg.id];
  if (state.paused) return;
  if (state.running) return;
  state.running = true;

  const startedAt = new Date().toISOString();
  console.log(`[Scheduler] ▶ ${cfg.id} (attempt ${attempt + 1})`);

  await upsertJobRow(cfg.id, { status: "running", last_run_at: startedAt });

  try {
    await spawnJob(cfg.command);
    state.running = false;
    state.retries = 0;

    const nextRun = computeNextRun(cfg);
    console.log(`[Scheduler] ✓ ${cfg.id} succeeded`);
    await upsertJobRow(cfg.id, {
      status: "success",
      last_run_at: new Date().toISOString(),
      next_run_at: nextRun,
      last_error: null,
    });
    await incrementCounter(cfg.id, "run_count");
  } catch (err: unknown) {
    state.running = false;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduler] ✗ ${cfg.id} failed: ${errMsg}`);

    if (attempt < cfg.maxRetries) {
      const backoffMs = Math.pow(2, attempt) * 5000;
      console.log(`[Scheduler] ↩ ${cfg.id} retry in ${backoffMs / 1000}s`);
      await upsertJobRow(cfg.id, {
        status: "failed",
        last_error: `${errMsg} (retry ${attempt + 1}/${cfg.maxRetries} in ${backoffMs / 1000}s)`,
      });
      state.retryTimeout = setTimeout(() => runJob(cfg, attempt + 1), backoffMs);
    } else {
      console.error(`[Scheduler] ✗✗ ${cfg.id} max retries exhausted`);
      await upsertJobRow(cfg.id, {
        status: "failed",
        last_error: errMsg,
        next_run_at: computeNextRun(cfg),
      });
      await incrementCounter(cfg.id, "fail_count");
      await logFailureAlert(cfg.id, errMsg);
    }
  }
}

function spawnJob(command: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.stdout?.on("data", (d) => { process.stdout.write(`[Job] ${d}`); });
    child.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`Exit ${code}: ${stderr.slice(0, 500)}`));
    });
    child.on("error", reject);
  });
}

// ── Public control API ────────────────────────────────────────────────────────

export function pauseJob(id: string) {
  if (!jobState[id]) return;
  jobState[id].paused = true;
  upsertJobRow(id, { status: "paused", paused: true }).catch(console.error);
}

export function resumeJob(id: string) {
  if (!jobState[id]) return;
  jobState[id].paused = false;
  upsertJobRow(id, { paused: false, status: "idle" }).catch(console.error);
}

export function triggerJob(id: string): void {
  const cfg = JOB_CONFIGS.find((c) => c.id === id);
  if (!cfg) throw new Error(`Unknown job: ${id}`);
  runJob(cfg, 0).catch(console.error);
}

/**
 * Reschedule a job at runtime. Persists to DB so change survives restart.
 *
 * - Pass `cronExpr` to switch to (or change) a cron schedule.
 * - Pass `intervalSeconds` to switch to (or change) an interval schedule.
 * - Pass neither to remove any schedule (make job manual-trigger-only again).
 *
 * Works for all jobs including forge-deploy.
 */
export function rescheduleJob(
  id: string,
  opts: { cronExpr?: string; intervalSeconds?: number }
): { ok: boolean; message: string } {
  const cfg = JOB_CONFIGS.find((c) => c.id === id);
  if (!cfg) return { ok: false, message: `Unknown job: ${id}` };

  if (opts.cronExpr !== undefined) {
    if (!cron.validate(opts.cronExpr)) {
      return { ok: false, message: `Invalid cron expression: ${opts.cronExpr}` };
    }
    cfg.cronExpr = opts.cronExpr;
    cfg.intervalSeconds = undefined;
    cfg.startsUnscheduled = false;
  } else if (opts.intervalSeconds !== undefined) {
    const lo = cfg.intervalMin ?? 1;
    const hi = cfg.intervalMax ?? 86400;
    cfg.intervalSeconds = Math.max(lo, Math.min(hi, opts.intervalSeconds));
    cfg.cronExpr = undefined;
    cfg.startsUnscheduled = false;
  } else {
    return { ok: false, message: "Provide cronExpr or intervalSeconds" };
  }

  attachSchedule(cfg);

  const nextRun = computeNextRun(cfg);
  upsertJobRow(id, {
    cron_expr: cfg.cronExpr ?? null,
    interval_seconds: cfg.intervalSeconds ?? null,
    next_run_at: nextRun,
    paused: false,
  }).catch(console.error);

  console.log(`[Scheduler] Rescheduled ${id} → cron:${cfg.cronExpr ?? "—"} interval:${cfg.intervalSeconds ?? "—"}s`);
  return { ok: true, message: `Rescheduled ${id}` };
}

export function getJobConfigs(): JobConfig[] {
  return JOB_CONFIGS;
}

export function getJobState(id: string): LiveJobState | undefined {
  return jobState[id];
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

let _started = false;

export async function startScheduler() {
  if (_started) return;
  _started = true;

  console.log("[Scheduler] Initialising cloud-native scheduler…");

  // 1. Hydrate live config from persisted DB rows (respects runtime reschedules
  //    and pauses that happened before the last restart)
  const sb = getSupabase();
  const dbRowsById: Record<string, Record<string, unknown>> = {};
  if (sb) {
    try {
      const { data } = await sb.from("scheduler_jobs").select("*");
      if (data) {
        for (const row of data) {
          dbRowsById[row.id as string] = row as Record<string, unknown>;
        }
      }
    } catch {
      // DB not yet migrated or no connection — skip hydration
    }
  }

  for (const cfg of JOB_CONFIGS) {
    jobState[cfg.id] ??= { paused: false, running: false, retries: 0 };

    const row = dbRowsById[cfg.id];
    if (row) {
      // Restore persisted schedule (if it differs from the hardcoded default)
      const dbCron = row.cron_expr as string | null;
      const dbInterval = row.interval_seconds as number | null;
      const dbPaused = (row.paused as boolean) ?? false;

      if (dbCron !== undefined && dbCron !== (cfg.cronExpr ?? null)) {
        if (dbCron && cron.validate(dbCron)) {
          cfg.cronExpr = dbCron;
          cfg.intervalSeconds = undefined;
        } else if (dbCron === null) {
          cfg.cronExpr = undefined;
        }
      }
      if (
        dbInterval !== undefined &&
        dbInterval !== null &&
        dbInterval !== (cfg.intervalSeconds ?? null)
      ) {
        cfg.intervalSeconds = dbInterval;
        cfg.cronExpr = undefined;
      }
      jobState[cfg.id].paused = dbPaused;
    }

    // 2. Seed/update DB row with current config (do not overwrite paused/counts)
    const nextRun = computeNextRun(cfg);
    const seedFields: Record<string, unknown> = {
      name: cfg.name,
      description: cfg.description,
      // Preserve runtime schedule if already in DB; write default only on first seed
      ...(row ? {} : {
        cron_expr: cfg.cronExpr ?? null,
        interval_seconds: cfg.intervalSeconds ?? null,
      }),
      next_run_at: nextRun,
    };
    if (!row) {
      seedFields.status = "idle";
      seedFields.paused = false;
    }
    upsertJobRow(cfg.id, seedFields).catch(console.error);

    // 3. Attach cron/interval schedule (skip if job has no schedule or is paused)
    if (!cfg.startsUnscheduled || cfg.cronExpr || cfg.intervalSeconds) {
      attachSchedule(cfg);
    }

    const schedInfo = cfg.cronExpr
      ? `cron: ${cfg.cronExpr}`
      : cfg.intervalSeconds
        ? `interval: ${cfg.intervalSeconds}s`
        : "unscheduled (manual only)";
    const pausedInfo = jobState[cfg.id].paused ? " [PAUSED]" : "";
    console.log(`[Scheduler] ${cfg.id} — ${schedInfo} (next: ${nextRun})${pausedInfo}`);
  }

  console.log("[Scheduler] Started.");
}
