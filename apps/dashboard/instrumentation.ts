/**
 * Next.js instrumentation hook — runs once when the server starts.
 * The app is local-only open-source software: no required environment
 * variables, no login. This hook only warms up the local SQLite database.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log(`[instrumentation] DB: local sqlite, NODE_ENV: ${process.env.NODE_ENV}`);
    // ponytail: scheduler removed — hub owns tasks, single cron if needed add when measured
    try { const { getFarmDb } = await import("./lib/farmDb"); getFarmDb(); } catch {}
  }
}
