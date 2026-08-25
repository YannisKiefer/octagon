// Octragon System — UTM Redirect Edge Function
// Handles octragon.link/abc123 → target URL with click tracking
//
// Deploy: supabase functions deploy utm-redirect

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.pathname.split("/").pop();

    if (!code) {
      return new Response(JSON.stringify({ error: "Missing link code" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Initialize Supabase with service role (RLS bypass)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the short URL
    const { data, error } = await supabase
      .from("link_tracking")
      .select("id, target_url")
      .eq("short_url", code)
      .single();

    if (error || !data) {
      return new Response(JSON.stringify({ error: "Link not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Increment clicks asynchronously via RPC (non-blocking)
    supabase.rpc("increment_clicks", { link_id: data.id }).then(() => {});

    // 302 redirect to target
    return new Response(null, {
      status: 302,
      headers: {
        Location: data.target_url,
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
