import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function sendSms(
  supabaseUrl: string,
  supabaseKey: string,
  mobile: string,
  messageType: string,
  variables: Record<string, string>,
) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ mobile, message: "", message_type: messageType, variables }),
    });
  } catch (_) {}
}

async function sendEmail(
  supabaseUrl: string,
  supabaseKey: string,
  to: string,
  subject: string,
  body: string,
) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ to, subject, body, body_type: "html", use_template: true }),
    });
  } catch (_) {}
}

// Attempt gateway refund; returns { success, refund_id?, error? }
async function processGatewayRefund(
  gatewayName: string,
  gateway: Record<string, any>,
  payment: Record<string, any>,
  refundAmount: number,
): Promise<{ success: boolean; refund_id?: string; error?: string }> {
  const isTest = (payment.gateway_environment ?? "production").toLowerCase() === "test";
  const txnId = payment.gateway_transaction_id;

  if (!txnId) {
    return { success: false, error: "No gateway transaction ID on payment record" };
  }

  const name = (gatewayName ?? "").replace(/[\s_-]/g, "").toLowerCase();

  try {
    // ── RazorPay ──────────────────────────────────────────────────────────
    if (name.includes("razorpay")) {
      const keyId     = isTest ? gateway.test_api_key       : gateway.production_api_key;
      const keySecret = isTest ? gateway.test_api_secret     : gateway.production_api_secret;
      if (!keyId || !keySecret) return { success: false, error: "RazorPay credentials not configured" };

      const auth = btoa(`${keyId}:${keySecret}`);
      const res = await fetch(
        `https://api.razorpay.com/v1/payments/${txnId}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
          body: JSON.stringify({ amount: Math.round(refundAmount * 100) }),
        }
      );
      const data = await res.json();
      if (res.ok && data.id) return { success: true, refund_id: data.id };
      return { success: false, error: data.error?.description ?? data.message ?? "RazorPay refund failed" };
    }

    // ── CashFree ──────────────────────────────────────────────────────────
    if (name.includes("cashfree")) {
      const clientId     = isTest ? gateway.test_api_key    : gateway.production_api_key;
      const clientSecret = isTest ? gateway.test_api_secret  : gateway.production_api_secret;
      if (!clientId || !clientSecret) return { success: false, error: "CashFree credentials not configured" };

      const baseUrl = isTest
        ? "https://sandbox.cashfree.com/pg"
        : "https://api.cashfree.com/pg";

      // CashFree refund needs the order_id; prefer gateway_request.order_id or derive from txnId
      const orderId = (payment.gateway_request as any)?.order_id ?? txnId;
      const refundId = `refund_${payment.payment_reference ?? payment.id}`;

      const res = await fetch(`${baseUrl}/orders/${orderId}/refunds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": clientId,
          "x-client-secret": clientSecret,
          "x-api-version": "2023-08-01",
        },
        body: JSON.stringify({
          refund_id: refundId,
          refund_amount: refundAmount,
          refund_note: "KYC rejected by admin",
        }),
      });
      const data = await res.json();
      if (res.ok && (data.refund_status === "SUCCESS" || data.refund_status === "PENDING")) {
        return { success: true, refund_id: data.cf_refund_id ?? refundId };
      }
      return { success: false, error: data.message ?? JSON.stringify(data) };
    }

    // ── PayU ──────────────────────────────────────────────────────────────
    if (name.includes("payu")) {
      const merchantKey  = isTest ? gateway.test_api_key    : gateway.production_api_key;
      const merchantSalt = isTest ? gateway.test_api_secret  : gateway.production_api_secret;
      if (!merchantKey || !merchantSalt) return { success: false, error: "PayU credentials not configured" };

      const baseUrl = isTest ? "https://test.payu.in" : "https://secure.payu.in";
      const refundAmount_str = String(refundAmount.toFixed(2));
      // hash = sha512(key|mihpayid|amt|txnid||salt) – simplified for refund
      const hashInput = `${merchantKey}|refund|${txnId}|${refundAmount_str}|${merchantSalt}`;
      const hashBuf  = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(hashInput));
      const hashHex  = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

      const body = new URLSearchParams({
        key: merchantKey,
        command: "refund",
        var1: txnId,
        var2: refundAmount_str,
        hash: hashHex,
      });
      const res = await fetch(`${baseUrl}/merchant/postservice?form=2`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch (_) {}
      if (data.status === "1" || data.status === 1) {
        return { success: true, refund_id: data.mihpayid ?? txnId };
      }
      return { success: false, error: data.msg ?? text ?? "PayU refund failed" };
    }

    // ── CCAvenue ──────────────────────────────────────────────────────────
    if (name.includes("ccavenue")) {
      // CCAvenue refund API requires merchant_id + order_id via a complex form-post
      const merchantId = isTest
        ? (gateway.test_merchant_id ?? gateway.test_api_key)
        : (gateway.production_merchant_id ?? gateway.production_api_key);
      const accessCode = isTest ? gateway.test_api_key    : gateway.production_api_key;
      const workingKey = isTest ? gateway.test_api_secret  : gateway.production_api_secret;
      if (!merchantId || !accessCode || !workingKey) {
        return { success: false, error: "CCAvenue credentials not configured" };
      }

      const baseUrl = isTest ? "https://test.ccavenue.com" : "https://secure.ccavenue.com";
      const refReqData = `merchantId=${merchantId}&referenceNo=${txnId}&refundAmount=${refundAmount.toFixed(2)}`;
      const body = new URLSearchParams({
        command: "refundOrder",
        access_code: accessCode,
        enc_request: refReqData,
      });
      const res = await fetch(`${baseUrl}/apis/servlet/DoWebTrans`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const text = await res.text();
      if (res.ok && text.includes("status=0")) {
        return { success: true, refund_id: txnId };
      }
      return { success: false, error: `CCAvenue refund response: ${text.substring(0, 200)}` };
    }

    // ── EaseBuzz ──────────────────────────────────────────────────────────
    if (name.includes("easebuzz")) {
      const key  = isTest ? gateway.test_api_key    : gateway.production_api_key;
      const salt = isTest ? gateway.test_api_secret  : gateway.production_api_secret;
      if (!key || !salt) return { success: false, error: "EaseBuzz credentials not configured" };

      const baseUrl = isTest ? "https://testpay.easebuzz.in" : "https://pay.easebuzz.in";
      const hashInput = `${key}|${txnId}|${refundAmount.toFixed(2)}|${salt}`;
      const hashBuf  = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(hashInput));
      const hashHex  = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

      const body = new URLSearchParams({
        key,
        txnid: txnId,
        amount: refundAmount.toFixed(2),
        hash: hashHex,
        action: "refund",
      });
      const res = await fetch(`${baseUrl}/transaction/v2/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === "1" || data.status === 1) {
        return { success: true, refund_id: data.easepayid ?? txnId };
      }
      return { success: false, error: data.error_desc ?? data.data ?? "EaseBuzz refund failed" };
    }

    // ── ZaakPay ──────────────────────────────────────────────────────────
    if (name.includes("zaakpay")) {
      const merchantId   = isTest ? gateway.test_api_key    : gateway.production_api_key;
      const merchantKey  = isTest ? gateway.test_api_secret  : gateway.production_api_secret;
      if (!merchantId || !merchantKey) return { success: false, error: "ZaakPay credentials not configured" };

      const baseUrl = isTest
        ? "https://zaakstaging.zaakpay.com"
        : "https://api.zaakpay.com";

      const params: Record<string, string> = {
        mid: merchantId,
        orderId: txnId,
        refundAmt: (Math.round(refundAmount * 100)).toString(),
        zpToken: txnId,
        version: "4",
      };
      const hashInput = Object.values(params).join("&") + `&${merchantKey}`;
      const hashBuf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
      const hashHex  = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

      const body = new URLSearchParams({ ...params, checksum: hashHex });
      const res = await fetch(`${baseUrl}/api/zaakpay/api/paymentRefund`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (data.responseCode === "000") {
        return { success: true, refund_id: data.zaakpayTxnId ?? txnId };
      }
      return { success: false, error: data.responseMessage ?? "ZaakPay refund failed" };
    }

    // ── EnKash ────────────────────────────────────────────────────────────
    if (name.includes("enkash")) {
      const clientId     = isTest ? gateway.test_api_key    : gateway.production_api_key;
      const clientSecret = isTest ? gateway.test_api_secret  : gateway.production_api_secret;
      if (!clientId || !clientSecret) return { success: false, error: "EnKash credentials not configured" };

      const baseUrl = isTest
        ? "https://apiuat.enkash.com"
        : "https://api.enkash.com";

      const res = await fetch(`${baseUrl}/payment/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "clientId": clientId,
          "clientSecret": clientSecret,
        },
        body: JSON.stringify({
          transactionId: txnId,
          refundAmount: refundAmount,
          refundReason: "KYC rejected by admin",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "SUCCESS") {
        return { success: true, refund_id: data.refundId ?? txnId };
      }
      return { success: false, error: data.message ?? "EnKash refund failed" };
    }

    // ── PhonePe ──────────────────────────────────────────────────────────
    if (name.includes("phonepe")) {
      const merchantId = isTest ? gateway.test_api_key : gateway.production_api_key;
      const saltKey     = isTest ? gateway.test_api_secret : gateway.production_api_secret;
      if (!merchantId || !saltKey) return { success: false, error: "PhonePe credentials not configured" };

      const baseUrl = isTest
        ? "https://api-preprod.phonepe.com/apis/hermes"
        : "https://api.phonepe.com/apis/hermes";

      const originalOrderId = (payment.gateway_request as any)?.merchantOrderId ?? txnId;
      const refundId = `refund_${payment.payment_reference ?? payment.id}`;
      const amountInPaise = Math.round(refundAmount * 100);

      const payload = {
        merchantId,
        merchantOrderId: originalOrderId,
        transactionId: txnId,
        amount: amountInPaise,
        callbackUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-gateway-webhook?gateway=phonepe`,
      };

      const payloadBase64 = btoa(JSON.stringify(payload));
      const apiEndpoint = "/pg/v1/refund";
      const hashInput = payloadBase64 + apiEndpoint + saltKey;
      const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
      const xVerify = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;

      const res = await fetch(`${baseUrl}${apiEndpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VERIFY": xVerify },
        body: JSON.stringify({ request: payloadBase64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return { success: true, refund_id: data.data?.refundId ?? refundId };
      }
      return { success: false, error: data.message ?? "PhonePe refund failed" };
    }

    return { success: false, error: `Unsupported gateway for automated refund: ${gatewayName}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Refund call threw an exception" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { adminId, recordId, action, rejectionReason } = await req.json();

    if (!adminId || !recordId || !action) {
      return new Response(
        JSON.stringify({ error: "adminId, recordId and action are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["verified", "rejected"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "action must be 'verified' or 'rejected'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify admin
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id, full_name")
      .eq("id", adminId)
      .maybeSingle();

    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch merchant onboarding record
    const { data: record } = await supabase
      .from("merchant_onboarding")
      .select("*")
      .eq("id", recordId)
      .maybeSingle();

    if (!record) {
      return new Response(
        JSON.stringify({ error: "Record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();

    // ─────────────────────────────────────────────────────────────────────
    // REJECTION — mark rejected, send email to beneficiary, do NOT auto-refund.
    // The beneficiary can re-submit KYC. Auto-refund happens only via the
    // cron job when the timeline expires and KYC is still not verified.
    // ─────────────────────────────────────────────────────────────────────
    if (action === "rejected") {
      await supabase
        .from("merchant_onboarding")
        .update({ status: "rejected", rejection_reason: rejectionReason || null, updated_at: now })
        .eq("id", recordId);

      // Log the rejection
      if (record.payment_id) {
        // Set payment back to kyc_pending so the auto-refund cron can pick it up
        // when the timeline expires (if the beneficiary doesn't re-submit in time).
        await supabase
          .from("payments")
          .update({ status: "kyc_pending", updated_at: now })
          .eq("id", record.payment_id)
          .in("status", ["merchant_kyc_review", "kyc_pending"]);

        await supabase.from("payment_logs").insert({
          payment_id: record.payment_id,
          status: "merchant_kyc_review",
          message: `Merchant KYC rejected by admin. Reason: ${rejectionReason || "No reason provided"}. Beneficiary notified to re-submit KYC. Payment reverted to kyc_pending for auto-refund eligibility.`,
          metadata: { admin_id: adminId, merchant_onboarding_id: recordId },
        });
      }

      // Send email to beneficiary informing them of rejection and need to re-submit
      EdgeRuntime.waitUntil((async () => {
        const receiverName = record.full_name || "Beneficiary";
        const receiverEmail = record.email || null;
        const reason = rejectionReason || "Your KYC submission did not meet our requirements.";

        if (receiverEmail) {
          await sendEmail(
            supabaseUrl, supabaseKey,
            receiverEmail,
            "KYC Rejected – Please Re-submit",
            `<p>Dear ${receiverName},</p>
             <p>Your KYC verification has been rejected for the following reason:</p>
             <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;color:#991b1b;font-size:14px;">${reason}</p>
             <p>Please re-submit your KYC with the correct details as soon as possible. If you do not complete your KYC within the remaining time, the payment will be automatically refunded to the sender.</p>
             <p style="color:#6b7280;font-size:13px;">If you have questions, please contact support.</p>`
          );
        }

        if (record.mobile) {
          await sendSms(supabaseUrl, supabaseKey, record.mobile, "kyc_rejected", {});
        }
      })());

      // ── In-app mobile notification: merchant KYC rejected ──────────────
      if (record.payment_id) {
        const { data: pay } = await supabase.from("payments").select("user_id, amount").eq("id", record.payment_id).maybeSingle();
        if (pay) {
          await supabase.rpc("create_mobile_notification", {
            p_user_id: pay.user_id, p_type: "merchant_kyc_rejected",
            p_title: "Merchant KYC Rejected",
            p_body: `Beneficiary KYC verification was rejected. Please re-submit KYC to avoid automatic refund.`,
            p_data: { payment_id: record.payment_id, reason: "merchant_kyc_rejected" },
          });
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
              body: JSON.stringify({ userId: pay.user_id, title: "Merchant KYC Rejected", body: `Beneficiary KYC verification was rejected. Please re-submit KYC to avoid automatic refund.`, data: { type: "merchant_kyc_rejected", payment_id: record.payment_id, reason: "merchant_kyc_rejected" } }),
            });
          } catch (e) { console.error("Push failed:", e); }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          action: "rejected",
          message: "Beneficiary notified of KYC rejection. No refund initiated.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // APPROVAL — mark verified, then auto/manual payout
    // ─────────────────────────────────────────────────────────────────────

    await supabase
      .from("merchant_onboarding")
      .update({ status: "verified", verified_at: now, updated_at: now })
      .eq("id", recordId);

    if (record.mobile) {
      EdgeRuntime.waitUntil(sendSms(supabaseUrl, supabaseKey, record.mobile, "kyc_approved", {}));
    }

    // ── In-app mobile notification: merchant KYC completed ──────────────
    if (record.payment_id) {
      const { data: pay } = await supabase.from("payments").select("user_id, amount").eq("id", record.payment_id).maybeSingle();
      if (pay) {
        await supabase.rpc("create_mobile_notification", {
          p_user_id: pay.user_id, p_type: "merchant_kyc_completed",
          p_title: "Merchant KYC Completed",
          p_body: `Beneficiary KYC verification is complete. Settlement of ₹${Number(pay.amount).toFixed(2)} is now in progress.`,
          p_data: { payment_id: record.payment_id, beneficiary_name: record.full_name },
        });
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
            body: JSON.stringify({ userId: pay.user_id, title: "Merchant KYC Completed", body: `Beneficiary KYC verification is complete. Settlement of ₹${Number(pay.amount).toFixed(2)} is now in progress.`, data: { type: "merchant_kyc_completed", payment_id: record.payment_id, beneficiary_name: record.full_name } }),
          });
        } catch (e) { console.error("Push failed:", e); }
      }
    }

    if (record.beneficiary_id) {
      await supabase
        .from("beneficiaries")
        .update({ is_verified_merchant: true, updated_at: now })
        .eq("id", record.beneficiary_id);
    }

    if (!record.payment_id) {
      return new Response(
        JSON.stringify({ success: true, action: "verified", payout: "no_payment_linked" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("id, amount, beneficiary_id, payment_gateway_id, gateway_environment, status")
      .eq("id", record.payment_id)
      .maybeSingle();

    if (!payment) {
      return new Response(
        JSON.stringify({ success: true, action: "verified", payout: "payment_not_found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let gatewayName: string | null = null;
    let payoutMode: string = "manual";
    let gatewayEnvironment: string = payment.gateway_environment || "production";

    if (payment.payment_gateway_id) {
      const { data: gateway } = await supabase
        .from("payment_gateway_settings")
        .select("gateway_name, payout_mode, environment")
        .eq("id", payment.payment_gateway_id)
        .maybeSingle();

      if (gateway) {
        gatewayName      = gateway.gateway_name?.toLowerCase() ?? null;
        payoutMode       = gateway.payout_mode ?? "manual";
        gatewayEnvironment = gateway.environment ?? gatewayEnvironment;
      }
    }

    // Manual payout mode
    if (payoutMode === "manual") {
      await supabase
        .from("payments")
        .update({ status: "settlement_pending", updated_at: now })
        .eq("id", payment.id);

      await supabase.from("payment_logs").insert({
        payment_id: payment.id,
        status: "settlement_pending",
        message: "Merchant KYC approved. Payment queued for manual settlement.",
        metadata: { admin_id: adminId, merchant_onboarding_id: recordId },
      });

      return new Response(
        JSON.stringify({ success: true, action: "verified", payout: "manual_settlement_pending" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Automatic payout mode
    await supabase
      .from("payments")
      .update({ status: "settlement_pending", updated_at: now })
      .eq("id", payment.id);

    await supabase.from("payment_logs").insert({
      payment_id: payment.id,
      status: "settlement_pending",
      message: "Merchant KYC approved. Initiating automatic payout.",
      metadata: { admin_id: adminId, merchant_onboarding_id: recordId, gateway: gatewayName },
    });

    const GATEWAY_FUNCTION_MAP: Record<string, string> = {
      razorpay:  "process-razorpay-payout",
      cashfree:  "process-cashfree-payout",
      cashfreeKycpayment: "process-cashfree-payout",
      payu:      "process-payu-payout",
      ccavenue:  "process-ccavenue-payout",
      easebuzz:  "process-easebuzz-payout",
      zaakpay:   "process-zaakpay-payout",
      enkash:    "process-enkash-payout",
    };

    const normalized = (gatewayName ?? "").replace(/[\s_-]/g, "").toLowerCase();
    let payoutFnKey: string | null = null;
    for (const [key, fn] of Object.entries(GATEWAY_FUNCTION_MAP)) {
      if (normalized.includes(key.toLowerCase())) {
        payoutFnKey = fn;
        break;
      }
    }

    if (!payoutFnKey) {
      await supabase.from("payment_logs").insert({
        payment_id: payment.id,
        status: "settlement_pending",
        message: `Auto-payout skipped: unknown gateway '${gatewayName}'. Queued for manual settlement.`,
        metadata: { admin_id: adminId },
      });

      return new Response(
        JSON.stringify({ success: true, action: "verified", payout: "unknown_gateway_manual_fallback" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const payoutRes = await fetch(
      `${supabaseUrl}/functions/v1/${payoutFnKey}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          beneficiary_id: payment.beneficiary_id,
          amount: Number(payment.amount),
          transfer_type: "IMPS",
          environment: gatewayEnvironment,
          gateway_id: payment.payment_gateway_id,
          instant_settlement: false,
          payment_id: payment.id,
        }),
      }
    );

    const payoutData = await payoutRes.json();

    if (!payoutRes.ok) {
      await supabase.from("payment_logs").insert({
        payment_id: payment.id,
        status: "settlement_pending",
        message: `Auto-payout failed: ${payoutData?.error ?? "unknown error"}. Queued for manual settlement.`,
        metadata: { admin_id: adminId, gateway: gatewayName, payout_response: payoutData },
      });

      return new Response(
        JSON.stringify({ success: true, action: "verified", payout: "auto_payout_failed", error: payoutData?.error }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, action: "verified", payout: "auto_payout_initiated", payout_data: payoutData }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
