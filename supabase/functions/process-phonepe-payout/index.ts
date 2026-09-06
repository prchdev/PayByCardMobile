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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { payoutId, gatewaySettings, environment } = await req.json();

    if (!payoutId || !gatewaySettings) {
      return new Response(
        JSON.stringify({ error: "payoutId and gatewaySettings are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isTestMode = environment === "test";
    const merchantId = isTestMode
      ? ((gatewaySettings.test_payout_client_id || "").trim() || (gatewaySettings.test_api_key || "").trim())
      : ((gatewaySettings.production_payout_client_id || "").trim() || (gatewaySettings.production_api_key || "").trim());
    const saltKey = isTestMode
      ? ((gatewaySettings.test_payout_client_secret || "").trim() || (gatewaySettings.test_api_secret || "").trim())
      : ((gatewaySettings.production_payout_client_secret || "").trim() || (gatewaySettings.production_api_secret || "").trim());

    if (!merchantId || !saltKey) {
      return new Response(
        JSON.stringify({ error: "PhonePe payout credentials not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: payout, error: payoutError } = await supabase
      .from("payouts")
      .select("*")
      .eq("id", payoutId)
      .single();

    if (payoutError || !payout) {
      return new Response(
        JSON.stringify({ error: "Payout not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = isTestMode
      ? "https://api-preprod.phonepe.com/apis/hermes"
      : "https://api.phonepe.com/apis/hermes";

    const transferId = payout.payout_reference;
    const apiEndpoint = `/pg/v1/payout/status/${merchantId}/${transferId}`;
    const hashInput = apiEndpoint + saltKey;
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
    const xVerify = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;

    const statusResponse = await fetch(`${baseUrl}${apiEndpoint}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerify,
        "X-MERCHANT-ID": merchantId,
      },
    });

    const statusData = await statusResponse.json();

    if (!statusData.success) {
      return new Response(
        JSON.stringify({ success: false, status: "processing", message: statusData.message || "Payout status check failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const state = (statusData.data?.state ?? statusData.data?.status ?? "").toUpperCase();
    let payoutStatus = "processing";

    if (state === "SUCCESS" || state === "PAYOUT_SUCCESS" || state === "COMPLETED") {
      payoutStatus = "completed";
    } else if (state === "FAILED" || state === "PAYOUT_FAILED" || state === "REJECTED") {
      payoutStatus = "failed";
    }

    const updateData: any = {
      status: payoutStatus,
      gateway_response: statusData,
      updated_at: new Date().toISOString(),
    };

    if (payoutStatus === "completed") {
      updateData.completed_at = new Date().toISOString();
      if (statusData.data?.utr) updateData.utr_number = statusData.data.utr;
      if (statusData.data?.payoutId || statusData.data?.referenceId) {
        updateData.gateway_transaction_id = statusData.data.payoutId || statusData.data.referenceId;
      }
    }
    if (payoutStatus === "failed") {
      updateData.failure_reason = statusData.data?.message || "Payout failed";
    }

    await supabase.from("payouts").update(updateData).eq("id", payoutId);

    if (payoutStatus === "completed") {
      await supabase.from("payments")
        .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", payout.payment_id);
    }

    return new Response(
      JSON.stringify({ success: true, status: payoutStatus, gateway_response: statusData }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
