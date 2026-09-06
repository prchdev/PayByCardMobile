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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { admin_id, settings, ip_address } = await req.json();

    if (!admin_id) {
      return new Response(JSON.stringify({ error: "Missing admin_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: admin } = await supabase
      .from("admin_users")
      .select("id, is_active")
      .eq("id", admin_id)
      .maybeSingle();

    if (!admin || !admin.is_active) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientIp = ip_address || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "Unknown";

    const updatePayload = {
      environment: settings.environment || "test",
      payout_mode: settings.payout_mode || "manual",
      cashfree_test_client_id: settings.cashfree_test_client_id || "",
      cashfree_test_client_secret: settings.cashfree_test_client_secret || "",
      cashfree_production_client_id: settings.cashfree_production_client_id || "",
      cashfree_production_client_secret: settings.cashfree_production_client_secret || "",
      cashfree_test_2fa_public_key: settings.cashfree_test_2fa_public_key || "",
      cashfree_production_2fa_public_key: settings.cashfree_production_2fa_public_key || "",
      razorpay_test_key_id: settings.razorpay_test_key_id || "",
      razorpay_test_key_secret: settings.razorpay_test_key_secret || "",
      razorpay_production_key_id: settings.razorpay_production_key_id || "",
      razorpay_production_key_secret: settings.razorpay_production_key_secret || "",
      razorpay_test_account_number: settings.razorpay_test_account_number || "",
      razorpay_production_account_number: settings.razorpay_production_account_number || "",
      axis_test_client_id: settings.axis_test_client_id || "",
      axis_test_client_secret: settings.axis_test_client_secret || "",
      axis_production_client_id: settings.axis_production_client_id || "",
      axis_production_client_secret: settings.axis_production_client_secret || "",
      axis_test_base_url: settings.axis_test_base_url || "https://uatapis.axisbank.co.uk",
      axis_production_base_url: settings.axis_production_base_url || "https://apis.axisbank.co.uk",
      axis_corporate_id: settings.axis_corporate_id || "",
      axis_channel_id: settings.axis_channel_id || "TXB",
      axis_test_virtual_account: settings.axis_test_virtual_account || "",
      axis_production_virtual_account: settings.axis_production_virtual_account || "",
      updated_at: new Date().toISOString(),
      updated_by: admin_id,
      updated_ip: clientIp,
    };

    if (settings.id) {
      const { error } = await supabase
        .from("payout_settings")
        .update(updatePayload)
        .eq("id", settings.id);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const { data: existing } = await supabase
        .from("payout_settings")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("payout_settings")
          .update(updatePayload)
          .eq("id", existing.id);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const { error } = await supabase
          .from("payout_settings")
          .insert(updatePayload);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, message: "Payout settings saved successfully" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
