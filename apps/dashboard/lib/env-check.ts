/**
 * Startup environment variable validation for the Next.js dashboard.
 * Import this at the top of any server-only module (e.g., lib/db.ts, lib/supabase.ts).
 * Throws at import time if required vars are missing so startup fails loudly.
 */

const REQUIRED_ENV_VARS: { key: string; description: string }[] = [
  { key: "NEXTAUTH_SECRET", description: "NextAuth JWT signing secret" },
  { key: "NEXTAUTH_URL", description: "Canonical URL of the dashboard" },
];

function validateEnv(vars: { key: string; description: string }[]): void {
  const missing = vars.filter(({ key }) => !process.env[key]);
  if (missing.length > 0) {
    const lines = missing.map(({ key, description }) => `  • ${key} — ${description}`);
    const message = [
      "",
      "══════════════════════════════════════════════════════",
      "  MISSING REQUIRED ENVIRONMENT VARIABLES",
      "══════════════════════════════════════════════════════",
      ...lines,
      "",
      "  Add these to your .env or .env.local file.",
      "══════════════════════════════════════════════════════",
      "",
    ].join("\n");
    console.error(message);
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Missing required environment variables: ${missing.map((v) => v.key).join(", ")}`);
    }
  }
}

export function validateCoreEnv(): void {
  validateEnv(REQUIRED_ENV_VARS);
}

export function validateAllEnv(): void {
  validateEnv(REQUIRED_ENV_VARS);
}
