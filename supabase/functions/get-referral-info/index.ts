import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId } = await req.json() as { userId: string };

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Missing userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, referral_code, referred_by")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let referredBy: { first_name: string | null; last_name: string | null; full_name: string | null } | null = null;
    if (user.referred_by) {
      const { data: referrer } = await supabase
        .from("users")
        .select("first_name, last_name, full_name")
        .eq("id", user.referred_by)
        .maybeSingle();
      referredBy = referrer || null;
    }

    const { count, error: countErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("referred_by", userId);

    let referralMessage: string | null = null;
    const { data: masterSettings } = await supabase
      .from("master_settings")
      .select("referral_message")
      .limit(1)
      .maybeSingle();
    if (masterSettings?.referral_message) {
      referralMessage = masterSettings.referral_message;
    }

    return new Response(
      JSON.stringify({
        referralCode: user.referral_code,
        referredBy: referredBy ? {
          name: referredBy.full_name || [referredBy.first_name, referredBy.last_name].filter(Boolean).join(" ") || null,
        } : null,
        totalReferrals: countErr ? 0 : (count ?? 0),
        referralMessage,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("get-referral-info error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
