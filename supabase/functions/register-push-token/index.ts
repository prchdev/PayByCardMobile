import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TOKEN_DURATION_MONTHS = 6;

function getExpiryDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + TOKEN_DURATION_MONTHS);
  return d.toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId, push_token, platform, appVersion, action } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    // ── Unregister: mark token as inactive ──────────────────────────────
    if (action === "unregister") {
      if (!push_token) {
        return new Response(
          JSON.stringify({ error: "Push token is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { error } = await supabase
        .from("mobile_push_tokens")
        .update({ is_active: false, updated_at: now })
        .eq("user_id", userId)
        .eq("push_token", push_token);
      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Check: return whether token is expired/invalid so client can recreate ──
    if (action === "check") {
      if (!push_token) {
        return new Response(
          JSON.stringify({ error: "Push token is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: existing } = await supabase
        .from("mobile_push_tokens")
        .select("id, is_active, expires_at")
        .eq("user_id", userId)
        .eq("push_token", push_token)
        .maybeSingle();

      const isExpired = !existing || !existing.is_active ||
        (existing.expires_at && new Date(existing.expires_at) < new Date(now));

      return new Response(
        JSON.stringify({ success: true, expired: isExpired }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Register: upsert token with 6-month expiry ─────────────────────
    if (!push_token) {
      return new Response(
        JSON.stringify({ error: "Push token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const expiresAt = getExpiryDate();

    // Check if token already exists for this user
    const { data: existing } = await supabase
      .from("mobile_push_tokens")
      .select("id, is_active, expires_at")
      .eq("user_id", userId)
      .eq("push_token", push_token)
      .maybeSingle();

    if (existing) {
      // Reactivate and refresh expiry (6 months from now)
      await supabase
        .from("mobile_push_tokens")
        .update({
          is_active: true,
          platform: platform || null,
          app_version: appVersion || null,
          expires_at: expiresAt,
          updated_at: now,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("mobile_push_tokens").insert({
        user_id: userId,
        push_token: push_token,
        platform: platform || null,
        app_version: appVersion || null,
        is_active: true,
        expires_at: expiresAt,
      });
    }

    // Clean up: deactivate tokens that have expired for this user
    await supabase
      .from("mobile_push_tokens")
      .update({ is_active: false, updated_at: now })
      .eq("user_id", userId)
      .lt("expires_at", now)
      .eq("is_active", true);

    return new Response(
      JSON.stringify({ success: true, expires_at: expiresAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Register push token error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
