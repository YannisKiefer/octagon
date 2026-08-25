/**
 * GET  /api/scheduler  — return all job definitions + live status from Supabase
 * POST /api/scheduler  — action: "trigger" | "pause" | "resume" | "reschedule"
 *   reschedule body: { action: "reschedule", id, cronExpr? string, intervalSeconds? number }
 *
 * Mutation actions (trigger/pause/resume/reschedule) require a valid
 * SCHEDULER_API_KEY header (X-Scheduler-Key) when SCHEDULER_API_KEY env var
 * is configured. If the env var is not set, the dashboard operates in
 * development mode with no auth enforcement (suitable for local/private deploy).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getJobConfigs,
  getJobState,
  pauseJob,
  resumeJob,
  triggerJob,
  rescheduleJob,
} from "@/lib/scheduler";

export const dynamic = "force-dynamic";

const MUTATION_ACTIONS = new Set(["trigger", "pause", "resume", "reschedule"]);

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Validate the scheduler API key for mutation requests. */
function authorizeMutation(request: Request): boolean {
  const expectedKey = process.env.SCHEDULER_API_KEY;
  // If no key is configured we operate in development/private mode — allow all.
  if (!expectedKey) return true;
  const provided = request.headers.get("x-scheduler-key") ?? "";
  return provided === expectedKey;
}

export async function GET() {
  try {
    const configs = getJobConfigs();

    let dbRows: Record<string, Record<string, unknown>> = {};
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from("scheduler_jobs").select("*");
      if (data) {
        for (const row of data) dbRows[row.id as string] = row as Record<string, unknown>;
      }
    }

    const jobs = configs.map((cfg) => {
      const row = dbRows[cfg.id] ?? {};
      const state = getJobState(cfg.id);
      return {
        id: cfg.id,
        name: cfg.name,
        description: cfg.description,
        cron_expr: cfg.cronExpr ?? null,
        interval_seconds: cfg.intervalSeconds ?? null,
        interval_min: cfg.intervalMin ?? null,
        interval_max: cfg.intervalMax ?? null,
        starts_unscheduled: cfg.startsUnscheduled ?? false,
        max_retries: cfg.maxRetries,
        last_run_at: (row.last_run_at as string) ?? null,
        next_run_at: (row.next_run_at as string) ?? null,
        status: state?.running ? "running" : ((row.status as string) ?? "idle"),
        last_error: (row.last_error as string) ?? null,
        run_count: (row.run_count as number) ?? 0,
        fail_count: (row.fail_count as number) ?? 0,
        paused: state?.paused ?? (row.paused as boolean) ?? false,
      };
    });

    return NextResponse.json({ success: true, jobs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action: string;
      id: string;
      cronExpr?: string;
      intervalSeconds?: number;
    };
    const { action, id } = body;

    // Auth check for all mutation actions
    if (MUTATION_ACTIONS.has(action) && !authorizeMutation(request)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing job id" },
        { status: 400 }
      );
    }

    switch (action) {
      case "trigger": {
        triggerJob(id);
        return NextResponse.json({ success: true, message: `Triggered ${id}` });
      }
      case "pause": {
        pauseJob(id);
        return NextResponse.json({ success: true, message: `Paused ${id}` });
      }
      case "resume": {
        resumeJob(id);
        return NextResponse.json({ success: true, message: `Resumed ${id}` });
      }
      case "reschedule": {
        const result = rescheduleJob(id, {
          cronExpr: body.cronExpr,
          intervalSeconds: body.intervalSeconds,
        });
        return NextResponse.json({
          success: result.ok,
          message: result.message,
        }, { status: result.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
