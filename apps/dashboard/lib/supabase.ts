import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  console.warn(
    `[supabase] Warning: Missing env vars: ${missing.join(", ")}. ` +
      "Supabase features will be unavailable. Add them to .env.local or Replit Secrets."
  );
}

export const supabase = createClient(
  supabaseUrl || "http://127.0.0.1:54321",
  supabaseKey || "placeholder-key-not-configured",
  {
    auth: {
      persistSession: false,
    },
  }
);

export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseKey && supabaseKey !== "placeholder-key-not-configured");
}
