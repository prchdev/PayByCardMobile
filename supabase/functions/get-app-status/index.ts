import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settings } = await supabase
      .from("master_settings")
      .select("mobile_app_enabled, android_min_version, android_min_build, ios_min_version, ios_min_build")
      .limit(1)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        mobile_app_enabled: settings?.mobile_app_enabled ?? true,
        android_min_version: settings?.android_min_version ?? "",
        android_min_build: settings?.android_min_build ?? "",
        ios_min_version: settings?.ios_min_version ?? "",
        ios_min_build: settings?.ios_min_build ?? "",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ mobile_app_enabled: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
