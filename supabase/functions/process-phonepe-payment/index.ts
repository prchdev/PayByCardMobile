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

    const { paymentId, gatewaySettings, environment } = await req.json();

    if (!paymentId || !gatewaySettings) {
      return new Response(
        JSON.stringify({ error: "paymentId and gatewaySettings are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isTestMode = environment === "test";
    const merchantId = isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key;
    const saltKey = isTestMode ? gatewaySettings.test_api_secret : gatewaySettings.production_api_secret;

    if (!merchantId || !saltKey) {
      return new Response(
        JSON.stringify({ error: "PhonePe credentials not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = isTestMode
      ? "https://api-preprod.phonepe.com/apis/hermes"
      : "https://api.phonepe.com/apis/hermes";

    const apiEndpoint = `/pg/v1/status/${merchantId}/${payment.payment_reference}`;
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
        JSON.stringify({ success: false, status: "pending", message: statusData.message || "Status check failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const state = (statusData.data?.state ?? "").toUpperCase();
    let paymentStatus = "pending";

    if (state === "PAYMENT_SUCCESS" || state === "COMPLETED") {
      paymentStatus = "completed";
    } else if (state === "PAYMENT_ERROR" || state === "FAILED" || state === "PAYMENT_DECLINED") {
      paymentStatus = "failed";
    } else if (state === "PENDING" || state === "PAYMENT_INITIATED") {
      paymentStatus = "processing";
    }

    const updateData: any = {
      status: paymentStatus,
      gateway_response: statusData,
      gateway_transaction_id: statusData.data?.transactionId || payment.gateway_transaction_id,
      updated_at: new Date().toISOString(),
    };

    if (paymentStatus === "completed") updateData.completed_at = new Date().toISOString();
    if (paymentStatus === "failed") updateData.failure_reason = statusData.data?.message || "Payment failed";

    await supabase.from("payments").update(updateData).eq("id", paymentId);
    await supabase.from("payment_logs").insert({
      payment_id: paymentId,
      status: paymentStatus,
      message: `PhonePe payment status: ${state} → ${paymentStatus}`,
      metadata: statusData,
    });

    return new Response(
      JSON.stringify({ success: true, status: paymentStatus, gateway_response: statusData }),
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
