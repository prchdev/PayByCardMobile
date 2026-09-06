import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHash, createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function triggerAutoPayout(supabaseUrl: string, supabaseKey: string, paymentId: string) {
  const call = fetch(`${supabaseUrl}/functions/v1/auto-payout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
    body: JSON.stringify({ payment_id: paymentId }),
  }).catch((e) => console.error("Auto payout trigger failed:", e));

  try {
    EdgeRuntime.waitUntil(call);
  } catch (_) {
    // EdgeRuntime.waitUntil not available — promise already running
  }
}

/**
 * Compute the resolved payment status after a gateway confirms the payment as PAID.
 * Same logic as save-transaction-status so all code paths stay consistent.
 */
function resolvePaymentStatus(payment: any): string {
  const isVerifiedMerchant = payment.beneficiary_details?.is_verified_merchant === true;
  const kycRequired =
    payment.category_details?.receiver_kyc_required === true ||
    payment.selected_payment_option?.receiver_kyc_required === true;
  const isEligibleForPayout = isVerifiedMerchant || !kycRequired;
  const payoutMode = payment.payment_gateway_settings?.payout_mode || "manual";
  const splitConfigured = payment.split_configured === true;

  if (!isEligibleForPayout) return "kyc_pending";
  if (payoutMode === "payment_split" && splitConfigured) return "completed";
  return "settlement_pending";
}

function verifyCashFreeSignature(payload: string, signature: string, timestamp: string, clientSecret: string): boolean {
  const signatureData = `${timestamp}${payload}`;
  const expectedSignature = createHmac("sha256", clientSecret).update(signatureData).digest("base64");
  return signature === expectedSignature;
}

function verifyPayUHash(payload: any, salt: string): boolean {
  const hashString = `${salt}|${payload.status}|||||||||||${payload.udf5}|${payload.udf4}|${payload.udf3}|${payload.udf2}|${payload.udf1}|${payload.email}|${payload.firstname}|${payload.productinfo}|${payload.amount}|${payload.txnid}|${payload.key}`;
  const expectedHash = createHash("sha512").update(hashString).digest("hex");
  return payload.hash === expectedHash;
}

async function handleCashFreeWebhook(req: Request, supabase: any, supabaseUrl: string, supabaseKey: string) {
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");
  const payload = await req.text();
  const data = JSON.parse(payload);

  const { data: payment } = await supabase
    .from("payments")
    .select("*, payment_gateway_settings(*)")
    .eq("payment_reference", data.data.order.order_id)
    .single();

  if (!payment) throw new Error("Payment not found");

  const gateway = payment.payment_gateway_settings;
  const clientSecret = payment.gateway_environment === "test"
    ? gateway.test_api_secret
    : gateway.production_api_secret;

  if (!signature || !timestamp) {
    throw new Error("Missing CashFree webhook signature");
  }
  if (!verifyCashFreeSignature(payload, signature, timestamp, clientSecret)) {
    throw new Error("Invalid CashFree webhook signature");
  }

  const orderStatus = data.data.order.order_status;
  let status = "pending";
  let failureReason = null;

  if (orderStatus === "PAID") {
    status = resolvePaymentStatus(payment);
  } else if (orderStatus === "FAILED" || orderStatus === "CANCELLED") {
    status = "failed";
    failureReason = data.data.payment?.payment_message || "Payment failed";
  } else {
    // ACTIVE or other transient states — do not overwrite current DB status
    return { success: true, status: "ignored", message: `Order status ${orderStatus} ignored` };
  }

  const updateData: any = {
    status,
    gateway_response: data,
    gateway_transaction_id: data.data.payment?.cf_payment_id || payment.gateway_transaction_id,
    updated_at: new Date().toISOString(),
  };
  if (status === "completed") updateData.completed_at = new Date().toISOString();
  if (status === "failed") updateData.failure_reason = failureReason;

  await supabase.from("payments").update(updateData).eq("id", payment.id);
  await supabase.from("payment_logs").insert({
    payment_id: payment.id,
    status,
    message: `Webhook received: ${orderStatus} → resolved to ${status}`,
    metadata: data,
  });

  // Trigger auto-payout only for settlement_pending (payout mode payments)
  if (status === "settlement_pending") {
    triggerAutoPayout(supabaseUrl, supabaseKey, payment.id);
  }

  return { success: true, status };
}

async function handleRazorPayWebhook(req: Request, supabase: any, supabaseUrl: string, supabaseKey: string) {
  const signature = req.headers.get("x-razorpay-signature");
  const payload = await req.text();
  const data = JSON.parse(payload);

  const paymentEntity = data.payload.payment.entity;

  // Look up by our internal payment_id stored in notes, falling back to payment_reference
  const internalPaymentId = paymentEntity.notes?.payment_id;
  const query = internalPaymentId
    ? supabase.from("payments").select("*, payment_gateway_settings(*)").eq("id", internalPaymentId).single()
    : supabase.from("payments").select("*, payment_gateway_settings(*)").eq("payment_reference", paymentEntity.notes?.receipt || paymentEntity.description).single();

  const { data: payment } = await query;

  if (!payment) throw new Error("Payment not found");

  const gateway = payment.payment_gateway_settings;
  const keySecret = payment.gateway_environment === "test"
    ? gateway.test_api_secret
    : gateway.production_api_secret;

  if (!signature) {
    throw new Error("Missing Razorpay webhook signature");
  }
  const expectedSignature = createHmac("sha256", keySecret).update(payload).digest("hex");
  if (signature !== expectedSignature) throw new Error("Invalid Razorpay webhook signature");

  let status = "pending";
  let failureReason = null;

  if (paymentEntity.status === "captured") {
    status = resolvePaymentStatus(payment);
  } else if (paymentEntity.status === "failed") {
    status = "failed";
    failureReason = paymentEntity.error_description || "Payment failed";
  } else {
    return { success: true, status: "ignored", message: `Payment status ${paymentEntity.status} ignored` };
  }

  const updateData: any = {
    status,
    gateway_response: data,
    gateway_transaction_id: paymentEntity.id,
    updated_at: new Date().toISOString(),
  };
  if (status === "completed") updateData.completed_at = new Date().toISOString();
  if (status === "failed") updateData.failure_reason = failureReason;

  await supabase.from("payments").update(updateData).eq("id", payment.id);
  await supabase.from("payment_logs").insert({
    payment_id: payment.id,
    status,
    message: `Webhook received: ${paymentEntity.status} → resolved to ${status}`,
    metadata: data,
  });

  if (status === "settlement_pending") {
    triggerAutoPayout(supabaseUrl, supabaseKey, payment.id);
  }

  return { success: true, status };
}

async function handlePayUWebhook(req: Request, supabase: any, supabaseUrl: string, supabaseKey: string) {
  const formData = await req.formData();
  const payload: any = {};
  for (const [key, value] of formData.entries()) {
    payload[key] = value;
  }

  const { data: payment } = await supabase
    .from("payments")
    .select("*, payment_gateway_settings(*)")
    .eq("payment_reference", payload.txnid)
    .single();

  if (!payment) throw new Error("Payment not found");

  const gateway = payment.payment_gateway_settings;
  const salt = payment.gateway_environment === "test"
    ? gateway.test_api_secret
    : gateway.production_api_secret;

  if (!verifyPayUHash(payload, salt)) throw new Error("Invalid hash");

  let status = "pending";
  let failureReason = null;

  if (payload.status === "success") {
    status = resolvePaymentStatus(payment);
  } else if (payload.status === "failure") {
    status = "failed";
    failureReason = payload.error_Message || "Payment failed";
  } else {
    return { success: true, status: "ignored", message: `Payment status ${payload.status} ignored` };
  }

  const updateData: any = {
    status,
    gateway_response: payload,
    gateway_transaction_id: payload.mihpayid,
    updated_at: new Date().toISOString(),
  };
  if (status === "completed") updateData.completed_at = new Date().toISOString();
  if (status === "failed") updateData.failure_reason = failureReason;

  await supabase.from("payments").update(updateData).eq("id", payment.id);
  await supabase.from("payment_logs").insert({
    payment_id: payment.id,
    status,
    message: `Webhook received: ${payload.status} → resolved to ${status}`,
    metadata: payload,
  });

  if (status === "settlement_pending") {
    triggerAutoPayout(supabaseUrl, supabaseKey, payment.id);
  }

  return { success: true, status };
}

async function handlePhonePeWebhook(req: Request, supabase: any, supabaseUrl: string, supabaseKey: string) {
  const body = await req.json();
  const payload = body;

  // PhonePe sends { merchantId, merchantOrderId, transactionId, amount, state, ... }
  const merchantOrderId = payload.merchantOrderId || payload.merchantTransactionId;

  const { data: payment } = await supabase
    .from("payments")
    .select("*, payment_gateway_settings(*)")
    .eq("payment_reference", merchantOrderId)
    .single();

  if (!payment) throw new Error("Payment not found");

  const gateway = payment.payment_gateway_settings;
  const saltKey = payment.gateway_environment === "test"
    ? gateway.test_api_secret
    : gateway.production_api_secret;

  // F7: PhonePe X-VERIFY checksum is mandatory — reject if missing or mismatched.
  const xVerify = req.headers.get("x-verify");
  if (!xVerify || !saltKey) {
    throw new Error("Missing PhonePe webhook signature");
  }
  const callbackResponse = payload.response || JSON.stringify(payload);
  const base64Response = typeof callbackResponse === "string"
    ? btoa(callbackResponse)
    : btoa(JSON.stringify(callbackResponse));
  const checkString = base64Response + "/pg/v1/status" + saltKey;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(checkString));
  const expectedHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;
  if (xVerify !== expectedHash) {
    throw new Error("Invalid PhonePe webhook signature");
  }

  const state = (payload.state || payload.code || "").toUpperCase();
  let status = "pending";
  let failureReason = null;

  if (state === "PAYMENT_SUCCESS" || state === "COMPLETED") {
    status = resolvePaymentStatus(payment);
  } else if (state === "PAYMENT_ERROR" || state === "FAILED" || state === "PAYMENT_DECLINED") {
    status = "failed";
    failureReason = payload.message || payload.errorDescription || "Payment failed";
  } else {
    return { success: true, status: "ignored", message: `Payment state ${state} ignored` };
  }

  const updateData: any = {
    status,
    gateway_response: payload,
    gateway_transaction_id: payload.transactionId || payload.providerReferenceId || payment.gateway_transaction_id,
    updated_at: new Date().toISOString(),
  };
  if (status === "completed") updateData.completed_at = new Date().toISOString();
  if (status === "failed") updateData.failure_reason = failureReason;

  await supabase.from("payments").update(updateData).eq("id", payment.id);
  await supabase.from("payment_logs").insert({
    payment_id: payment.id,
    status,
    message: `Webhook received: ${state} → resolved to ${status}`,
    metadata: payload,
  });

  if (status === "settlement_pending") {
    triggerAutoPayout(supabaseUrl, supabaseKey, payment.id);
  }

  return { success: true, status };
}

async function handleGenericWebhook(req: Request, supabase: any) {
  const contentType = req.headers.get("content-type");
  let payload: any;
  if (contentType?.includes("application/json")) {
    payload = await req.json();
  } else if (contentType?.includes("application/x-www-form-urlencoded")) {
    const formData = await req.formData();
    payload = {};
    for (const [key, value] of formData.entries()) payload[key] = value;
  } else {
    payload = await req.text();
  }
  return { success: true, message: "Webhook received", data: payload };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const gateway = url.searchParams.get("gateway");

    let result;

    switch (gateway?.toLowerCase()) {
      case "cashfree":
        result = await handleCashFreeWebhook(req, supabase, supabaseUrl, supabaseKey);
        break;
      case "razorpay":
        result = await handleRazorPayWebhook(req, supabase, supabaseUrl, supabaseKey);
        break;
      case "payu":
        result = await handlePayUWebhook(req, supabase, supabaseUrl, supabaseKey);
        break;
      case "phonepe":
        result = await handlePhonePeWebhook(req, supabase, supabaseUrl, supabaseKey);
        break;
      default:
        result = await handleGenericWebhook(req, supabase);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
