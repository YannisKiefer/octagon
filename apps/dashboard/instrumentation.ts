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

    const dbBackend = process.env.OCTAGON_DB_BACKEND ?? "sqlite";
    if (dbBackend === "supabase") {
      const supabaseRequired = [
        { key: "NEXT_PUBLIC_SUPABASE_URL", description: "Supabase project URL" },
        { key: "SUPABASE_SERVICE_ROLE_KEY", description: "Supabase service role key" },
      ];
      const missingSupabase = supabaseRequired.filter(({ key }) => !process.env[key]);
      if (missingSupabase.length > 0) {
        const lines = missingSupabase.map(({ key, description }) => `  • ${key} — ${description}`);
        console.error([
          "",
          "  OCTAGON_DB_BACKEND=supabase but Supabase credentials are missing:",
          ...lines,
          "  Add them to Replit Secrets or switch OCTAGON_DB_BACKEND=sqlite for local dev.",
          "",
        ].join("\n"));
        if (process.env.NODE_ENV === "production") {
          throw new Error(`Supabase backend selected but credentials missing: ${missingSupabase.map((v) => v.key).join(", ")}`);
        }
      }
    }

    console.log(`[instrumentation] DB backend: ${dbBackend}, NODE_ENV: ${process.env.NODE_ENV}`);

    // Boot singleton services
    const { startScheduler } = await import("./lib/scheduler");
    await startScheduler();
  }
}
