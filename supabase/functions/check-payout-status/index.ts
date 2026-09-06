import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function getRazorpayPayoutCredentials(gateway: any, isTestMode: boolean): { keyId: string; keySecret: string } {
  if (isTestMode) {
    const keyId = (gateway.test_payout_client_id || "").trim() || (gateway.test_api_key || "").trim();
    const keySecret = (gateway.test_payout_client_secret || "").trim() || (gateway.test_api_secret || "").trim();
    return { keyId, keySecret };
  }
  const keyId = (gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim();
  const keySecret = (gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim();
  return { keyId, keySecret };
}

async function checkRazorPayPayoutStatus(payout: any, gateway: any, isTestMode: boolean) {
  const { keyId, keySecret } = getRazorpayPayoutCredentials(gateway, isTestMode);
  const authString = btoa(`${keyId}:${keySecret}`);

  if (!payout.gateway_transaction_id) {
    return { status: "pending", transaction_id: null, utr: null, gateway_response: {} };
  }

  const response = await fetch(`https://api.razorpay.com/v1/payouts/${payout.gateway_transaction_id}`, {
    method: "GET",
    headers: { "Authorization": `Basic ${authString}` },
  });

  const result = await response.json();

  return {
    status: result.status === "processed" ? "completed"
          : result.status === "processing" || result.status === "queued" ? "processing"
          : result.status === "failed" || result.status === "reversed" ? "failed"
          : "processing",
    transaction_id: result.id,
    utr: result.utr ?? null,
    gateway_response: result,
  };
}

async function checkCashFreePayoutStatus(payout: any, gateway: any, isTestMode: boolean) {
  const baseUrl = isTestMode
    ? "https://sandbox.cashfree.com/payout"
    : "https://api.cashfree.com/payout";

  const clientId = isTestMode
    ? ((gateway.test_payout_client_id || "").trim() || (gateway.test_api_key || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const clientSecret = isTestMode
    ? ((gateway.test_payout_client_secret || "").trim() || (gateway.test_api_secret || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());

  const transferId = `AUTO-${payout.payout_reference}`;
  const headers = {
    "Content-Type": "application/json",
    "x-client-id": clientId,
    "x-client-secret": clientSecret,
    "x-api-version": "2023-08-01",
  };

  const response = await fetch(`${baseUrl}/transfers/${encodeURIComponent(transferId)}`, {
    method: "GET",
    headers,
  });

  const result = await response.json();
  const raw = (result?.status ?? "unknown").toUpperCase();

  return {
    status: raw === "SUCCESS" ? "completed"
          : raw === "FAILED" || raw === "ERROR" ? "failed"
          : "processing",
    transaction_id: result?.cf_transfer_id ?? result?.transfer_id ?? null,
    utr: result?.utr ?? null,
    gateway_response: result,
  };
}

async function checkPayUPayoutStatus(payout: any, gateway: any, isTestMode: boolean) {
  const baseUrl = isTestMode
    ? "https://test.payu.in/merchant/payouts"
    : "https://info.payu.in/merchant/payouts";

  const merchantKey = isTestMode ? gateway.test_api_key : gateway.production_api_key;

  const response = await fetch(`${baseUrl}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: merchantKey, txnid: payout.payout_reference }),
  });

  const result = await response.json();

  return {
    status: result.status === "success" ? "completed"
          : result.status === "pending" ? "processing" : "failed",
    transaction_id: result.payuMoneyId,
    utr: result.utr || result.bankRRN,
    gateway_response: result,
  };
}

async function checkEaseBuzzPayoutStatus(payout: any, gateway: any, isTestMode: boolean) {
  const baseUrl = isTestMode
    ? "https://testpayout.easebuzz.in"
    : "https://payout.easebuzz.in";

  const merchantKey = isTestMode ? gateway.test_api_key : gateway.production_api_key;

  const response = await fetch(`${baseUrl}/v1/payout/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchant_key: merchantKey, txn_id: payout.payout_reference }),
  });

  const result = await response.json();

  return {
    status: result.status === 1 || result.status === "success" ? "completed"
          : result.status === "pending" ? "processing" : "failed",
    transaction_id: result.data?.easepayid,
    utr: result.data?.utr,
    gateway_response: result,
  };
}

async function checkPhonePePayoutStatus(payout: any, gateway: any, isTestMode: boolean) {
  const merchantId = isTestMode
    ? ((gateway.test_payout_client_id || "").trim() || (gateway.test_api_key || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const saltKey = isTestMode
    ? ((gateway.test_payout_client_secret || "").trim() || (gateway.test_api_secret || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());

  if (!merchantId || !saltKey) {
    return { status: payout.status, transaction_id: null, utr: null, gateway_response: { error: "PhonePe payout credentials not configured" } };
  }

  const baseUrl = isTestMode
    ? "https://api-preprod.phonepe.com/apis/hermes"
    : "https://api.phonepe.com/apis/hermes";

  const transferId = payout.payout_reference;
  const apiEndpoint = `/pg/v1/payout/status/${merchantId}/${transferId}`;
  const hashInput = apiEndpoint + saltKey;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
  const xVerify = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;

  const response = await fetch(`${baseUrl}${apiEndpoint}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": xVerify,
      "X-MERCHANT-ID": merchantId,
    },
  });

  const result = await response.json();

  if (!result.success) {
    return { status: "processing", transaction_id: null, utr: null, gateway_response: result };
  }

  const state = (result.data?.state || result.data?.status || "").toUpperCase();
  const status = state === "SUCCESS" || state === "PAYOUT_SUCCESS" || state === "COMPLETED" ? "completed"
    : state === "FAILED" || state === "PAYOUT_FAILED" || state === "REJECTED" ? "failed"
    : "processing";

  return {
    status,
    transaction_id: result.data?.payoutId || result.data?.referenceId || null,
    utr: result.data?.utr || result.data?.rrn || null,
    gateway_response: result,
  };
}

async function checkGatewayStatus(payout: any, gateway: any, isTestMode: boolean) {
  const name = (gateway.gateway_name ?? "").toLowerCase();
  if (name.includes("razorpay")) return checkRazorPayPayoutStatus(payout, gateway, isTestMode);
  if (name.includes("cashfree")) return checkCashFreePayoutStatus(payout, gateway, isTestMode);
  if (name.includes("payu")) return checkPayUPayoutStatus(payout, gateway, isTestMode);
  if (name.includes("easebuzz")) return checkEaseBuzzPayoutStatus(payout, gateway, isTestMode);
  if (name.includes("phonepe")) return checkPhonePePayoutStatus(payout, gateway, isTestMode);
  return {
    status: payout.status,
    transaction_id: payout.gateway_transaction_id,
    utr: payout.utr_number,
    gateway_response: payout.gateway_response,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const url = new URL(req.url);
    const payoutId = url.searchParams.get("payout_id");
    if (!payoutId) throw new Error("Payout ID is required");

    const { data: payout, error: payoutError } = await supabase
      .from("payouts")
      .select("*, payment_gateway_settings(*)")
      .eq("id", payoutId)
      .eq("user_id", user.id)
      .single();

    if (payoutError || !payout) throw new Error("Payout not found");

    if (payout.status === "processing" || payout.status === "pending") {
      const gateway = payout.payment_gateway_settings;
      const isTestMode = (payout.gateway_environment ?? "production").toLowerCase() === "test";

      try {
        const statusResult = await checkGatewayStatus(payout, gateway, isTestMode);

        if (statusResult.status !== payout.status || (statusResult.utr && !payout.utr_number)) {
          const updateData: any = {
            status: statusResult.status,
            gateway_response: statusResult.gateway_response,
            updated_at: new Date().toISOString(),
          };
          if (statusResult.status === "completed") {
            updateData.completed_at = new Date().toISOString();
          }
          if (statusResult.transaction_id && !payout.gateway_transaction_id) {
            updateData.gateway_transaction_id = statusResult.transaction_id;
          }
          if (statusResult.utr) {
            updateData.utr_number = statusResult.utr;
          }

          await supabase.from("payouts").update(updateData).eq("id", payoutId);

          if (statusResult.status === "completed" && statusResult.status !== payout.status) {
            await supabase.from("payments")
              .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq("id", payout.payment_id);
          }
        }
      } catch (err) {
        console.error("Error checking gateway status:", err);
      }
    }

    const { data: updatedPayout } = await supabase
      .from("payouts")
      .select("*")
      .eq("id", payoutId)
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        payout: {
          id: updatedPayout.id,
          amount: updatedPayout.amount,
          net_amount: updatedPayout.net_amount,
          status: updatedPayout.status,
          payout_reference: updatedPayout.payout_reference,
          gateway_transaction_id: updatedPayout.gateway_transaction_id,
          utr_number: updatedPayout.utr_number,
          transfer_type: updatedPayout.transfer_type,
          account_number: updatedPayout.account_number,
          ifsc_code: updatedPayout.ifsc_code,
          account_holder_name: updatedPayout.account_holder_name,
          bank_name: updatedPayout.bank_name,
          created_at: updatedPayout.created_at,
          completed_at: updatedPayout.completed_at,
          failure_reason: updatedPayout.failure_reason,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Check payout status error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
