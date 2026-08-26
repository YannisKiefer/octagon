/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used for startup validation of required environment variables.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const required: { key: string; description: string }[] = [
      { key: "NEXTAUTH_SECRET", description: "JWT signing secret for NextAuth" },
      { key: "NEXTAUTH_URL", description: "Canonical URL for the dashboard" },
      { key: "DASHBOARD_ADMIN_USER", description: "Admin username" },
    ];

    const adminCred = process.env.DASHBOARD_ADMIN_HASH || process.env.DASHBOARD_ADMIN_PASSWORD;
    if (!adminCred) {
      required.push({ key: "DASHBOARD_ADMIN_PASSWORD", description: "Admin password (or DASHBOARD_ADMIN_HASH for bcrypt)" });
    }

    const missing = required.filter(({ key }) => !process.env[key]);
    if (missing.length > 0) {
      const lines = missing.map(({ key, description }) => `  • ${key} — ${description}`);
      const msg = [
        "",
        "══════════════════════════════════════════════════════",
        "  OCTRAGON DASHBOARD — MISSING REQUIRED ENV VARS",
        "══════════════════════════════════════════════════════",
        ...lines,
        "",
        "  Add these to Replit Secrets before starting the server.",
        "══════════════════════════════════════════════════════",
        "",
      ].join("\n");
      console.error(msg);
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Missing required env vars: ${missing.map((v) => v.key).join(", ")}`);
      }
    }

    console.log(`[instrumentation] DB: sqlite (Supabase removed for open-source), NODE_ENV: ${process.env.NODE_ENV}`);
    // ponytail: scheduler removed — hub owns tasks, single cron if needed add when measured
    try { const { getFarmDb } = await import("./lib/farmDb"); getFarmDb(); } catch {}
  }
}
