import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = () => Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Gateway balance checker ──────────────────────────────────────────────────

async function checkGatewayBalance(
  gateway: any,
  isTest: boolean,
  requiredAmount: number,
): Promise<{ canProcess: boolean; balance: number | null; error?: string }> {
  const name = (gateway.gateway_name ?? "").toLowerCase();

  try {
    if (name === "razorpay") {
      const keyId = isTest ? gateway.test_api_key : gateway.production_api_key;
      const keySecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
      if (!keyId || !keySecret) return { canProcess: true, balance: null };

      const auth = btoa(`${keyId}:${keySecret}`);
      const res = await fetch("https://api.razorpay.com/v1/balance", {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) return { canProcess: true, balance: null, error: `HTTP ${res.status}` };
      const data = await res.json();
      // balance is in paise
      const balance = (data.balance ?? 0) / 100;
      if (balance < requiredAmount) return { canProcess: false, balance };
      return { canProcess: true, balance };
    }

    if (name === "cashfree") {
      const clientId = isTest ? gateway.test_api_key : gateway.production_api_key;
      const clientSecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
      if (!clientId || !clientSecret) return { canProcess: true, balance: null };

      const base = isTest ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
      const res = await fetch(`${base}/api/v1/merchant/wallet/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: clientId, secretKey: clientSecret }),
      });
      if (!res.ok) return { canProcess: true, balance: null, error: `HTTP ${res.status}` };
      const data = await res.json();
      const balance = parseFloat(String(data.data?.balance ?? data.balance ?? "0"));
      if (balance < requiredAmount) return { canProcess: false, balance };
      return { canProcess: true, balance };
    }
  } catch (e: any) {
    // Non-blocking — if balance check API errors, allow the refund to proceed
    return { canProcess: true, balance: null, error: e?.message };
  }

  // Other gateways: no balance check supported
  return { canProcess: true, balance: null };
}

// ─── Gateway refund callers ───────────────────────────────────────────────────

async function refundRazorPay(
  payment: any,
  gateway: any,
  isTest: boolean,
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const keyId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const keySecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const auth = btoa(`${keyId}:${keySecret}`);
  const txnId = payment.gateway_transaction_id;

  if (!txnId) {
    return {
      success: false,
      refund_id: null,
      gateway_response: { error: "No gateway_transaction_id — Razorpay refund requires a captured payment ID (pay_xxx)" },
    };
  }

  const res = await fetch(`https://api.razorpay.com/v1/payments/${txnId}/refund`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(parseFloat(String(payment.amount)) * 100) }),
  });
  const data = await res.json();

  // Razorpay returns the refund object with an `id` field on success
  const success = res.ok && data.id != null && data.entity === "refund";
  return {
    success,
    refund_id: data.id ?? null,
    gateway_response: data,
  };
}

async function refundCashFree(
  payment: any,
  gateway: any,
  isTest: boolean,
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const base = isTest ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg";
  const clientId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const clientSecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const refundId = `RFND-${payment.payment_reference}`;

  const body: Record<string, any> = {
    refund_id: refundId,
    refund_amount: parseFloat(String(payment.amount)),
    refund_note: "Refunded by admin",
  };

  // Include cf_payment_id when available to target the specific payment within an order
  if (payment.gateway_transaction_id) {
    body.cf_payment_id = payment.gateway_transaction_id;
  }

  const res = await fetch(`${base}/orders/${payment.payment_reference}/refunds`, {
    method: "POST",
    headers: {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  // CashFree valid statuses: SUCCESS, PENDING, ONHOLD
  const validStatuses = ["SUCCESS", "PENDING", "ONHOLD"];
  const success = res.ok && validStatuses.includes(data.refund_status);

  return {
    success,
    refund_id: data.cf_refund_id ?? (success ? refundId : null),
    gateway_response: data,
  };
}

async function refundPayU(
  payment: any,
  gateway: any,
  isTest: boolean,
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const base = isTest ? "https://test.payu.in" : "https://info.payu.in";
  const merchantKey = isTest ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const txnId = payment.gateway_transaction_id;

  if (!txnId) {
    return {
      success: false,
      refund_id: null,
      gateway_response: { error: "No gateway_transaction_id — PayU refund requires mihpayid" },
    };
  }

  const command = "cancel_refund_transaction";
  const hashInput = `${merchantKey}|${command}|${txnId}|${parseFloat(String(payment.amount)).toFixed(2)}|${salt}`;
  const hashBuf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(hashInput));
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${base}/merchant/postservice.php?form=2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: merchantKey, command, var1: txnId, var2: parseFloat(String(payment.amount)).toFixed(2), hash }).toString(),
  });
  const data = await res.json();
  return {
    success: data.status === 1 || data.msg?.toLowerCase().includes("success"),
    refund_id: data.refund_id ?? null,
    gateway_response: data,
  };
}

async function refundEaseBuzz(
  payment: any,
  gateway: any,
  isTest: boolean,
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const base = isTest ? "https://testdashboard.easebuzz.in" : "https://dashboard.easebuzz.in";
  const merchantKey = isTest ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  // EaseBuzz can use gateway_transaction_id or fall back to payment_reference
  const txnId = payment.gateway_transaction_id || payment.payment_reference;

  const hashInput = `${merchantKey}|${txnId}|${parseFloat(String(payment.amount)).toFixed(2)}|${salt}`;
  const hashBuf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(hashInput));
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${base}/transaction/v1/initiate_refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: merchantKey, txnid: txnId, amount: parseFloat(String(payment.amount)).toFixed(2), hash }),
  });
  const data = await res.json();
  return {
    success: data.status === "success" || data.status === 1,
    refund_id: data.data?.refund_id ?? null,
    gateway_response: data,
  };
}

async function initiateGatewayRefund(
  payment: any,
  gateway: any,
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const isTest = payment.gateway_environment === "test";
  switch ((gateway.gateway_name ?? "").toLowerCase()) {
    case "razorpay":  return refundRazorPay(payment, gateway, isTest);
    case "cashfree":  return refundCashFree(payment, gateway, isTest);
    case "payu":      return refundPayU(payment, gateway, isTest);
    case "easebuzz":  return refundEaseBuzz(payment, gateway, isTest);
    default:
      return { success: false, refund_id: null, gateway_response: { error: `Unsupported gateway for refund: ${gateway.gateway_name}` } };
  }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

function fmt(v: number | string): string {
  return `₹${parseFloat(String(v)).toFixed(2)}`;
}

async function generateInvoiceHtml(paymentId: string): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL()}/functions/v1/generate-invoice-html`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payment_id: paymentId, invoice_type: "refund" }),
    });
    const data = await res.json();
    return data.html_base64 ?? null;
  } catch { return null; }
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  attachmentBase64?: string | null,
  attachmentFilename?: string,
) {
  try {
    await fetch(`${SUPABASE_URL()}/functions/v1/send-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to, subject, body, body_type: "html", use_template: true,
        ...(attachmentBase64 ? {
          attachment_base64: attachmentBase64,
          attachment_filename: attachmentFilename || "refund-invoice.html",
          attachment_content_type: "text/html",
        } : {}),
      }),
    });
  } catch (_) {}
}

async function sendNotifications(supabase: any, payment: any, refundId: string | null) {
  try {
    const bene = payment.beneficiary_details || {};
    const { data: senderUser } = await supabase
      .from("users")
      .select("first_name, last_name, email, mobile_number")
      .eq("id", payment.user_id)
      .maybeSingle();

    const senderName = senderUser ? `${senderUser.first_name} ${senderUser.last_name}`.trim() : "Customer";
    const receiverName = bene.full_name || "Beneficiary";
    const txDate = new Date(payment.created_at).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
    });

    const invoiceBase64 = await generateInvoiceHtml(payment.id);
    const invoiceFilename = `refund-invoice-${payment.payment_reference}.html`;

    const receiptRows = `
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin:16px 0;">
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Transaction Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payment.payment_reference}</td></tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Date</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${txDate}</td></tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Refund Amount</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${fmt(payment.amount)}</td></tr>
        ${refundId ? `<tr><td style="padding:8px 12px;color:#6b7280;font-size:14px;">Gateway Refund ID</td><td style="padding:8px 12px;font-weight:600;color:#111827;font-size:14px;text-align:right;">${refundId}</td></tr>` : ""}
      </table>`;

    if (senderUser?.email) {
      await sendEmail(
        senderUser.email,
        `Refund Processed – Ref: ${payment.payment_reference}`,
        `<p>Dear ${senderName},</p>
         <p>Your payment has been refunded. The base amount will be returned to your source account within 5–7 business days.</p>
         ${receiptRows}
         <p style="color:#6b7280;font-size:13px;">Refund invoice is attached. Contact support for any queries.</p>`,
        invoiceBase64,
        invoiceFilename,
      );
    }
    if (bene.email) {
      await sendEmail(
        bene.email,
        `Payment Cancelled – Ref: ${payment.payment_reference}`,
        `<p>Dear ${receiverName},</p>
         <p>The payment intended for your account has been cancelled and refunded to the sender.</p>
         ${receiptRows}`,
      );
    }
    if (senderUser?.mobile_number) {
      await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile: senderUser.mobile_number,
          message: "",
          message_type: "payment_refund",
          variables: {
            var1: parseFloat(String(payment.amount)).toFixed(2),
            var2: payment.payment_reference,
          },
        }),
      }).catch(() => {});
    }
  } catch (e) {
    console.error("sendNotifications error:", e);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

const NON_REFUNDABLE_STATUSES = new Set(["refunded", "failed", "cancelled"]);

// When gateway_settlement_status is one of these, the money has moved — check balance
const SETTLED_STATUSES = new Set(["settled", "paid", "captured"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { adminId, paymentId } = await req.json();

    if (!adminId || !paymentId) {
      return new Response(
        JSON.stringify({ error: "adminId and paymentId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL(), SERVICE_ROLE_KEY());

    const { data: admin } = await supabase
      .from("admin_users")
      .select("id, full_name")
      .eq("id", adminId)
      .maybeSingle();

    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("*, payment_gateway_settings(*)")
      .eq("id", paymentId)
      .maybeSingle();

    if (!payment) {
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (NON_REFUNDABLE_STATUSES.has(payment.status)) {
      return new Response(
        JSON.stringify({ error: `Payment is already ${payment.status} and cannot be refunded` }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const gateway = payment.payment_gateway_settings;

    if (!gateway) {
      return new Response(
        JSON.stringify({ error: "No payment gateway found for this payment" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const isTest = payment.gateway_environment === "test";
    const refundAmount = parseFloat(String(payment.amount));
    const payoutMode = gateway.payout_mode || "manual";
    const gatewayName = (gateway.gateway_name ?? "").toLowerCase();

    // Balance check: required when the payment has already been settled at the gateway
    // (money has moved from gateway escrow to merchant wallet)
    if (SETTLED_STATUSES.has(payment.gateway_settlement_status)) {
      const balanceCheck = await checkGatewayBalance(gateway, isTest, refundAmount);
      if (!balanceCheck.canProcess) {
        return new Response(
          JSON.stringify({
            error: `Insufficient balance in ${gateway.gateway_name} ${isTest ? "test" : "production"} account. Available: ${fmt(balanceCheck.balance!)}, Required: ${fmt(refundAmount)}. Top up your ${gateway.gateway_name} refund wallet before processing.`,
            insufficient_balance: true,
            available_balance: balanceCheck.balance,
            required_amount: refundAmount,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const refundRef = `RFND-${payment.payment_reference}`;

    // Determine if we can call the gateway API.
    // Razorpay and PayU require gateway_transaction_id (captured payment ID).
    // CashFree and EaseBuzz can work with payment_reference / fall back to it.
    const requiresTxnId = gatewayName === "razorpay" || gatewayName === "payu";
    const hasTxnId = !!payment.gateway_transaction_id;

    let refundResult: { success: boolean; refund_id: string | null; gateway_response: any };
    let refundType: string;

    if (requiresTxnId && !hasTxnId) {
      // Cannot call gateway API — payment was never captured (no txn ID in DB)
      refundResult = {
        success: true,
        refund_id: null,
        gateway_response: {
          note: `No gateway transaction ID for ${gateway.gateway_name}. Payment was not captured. Marked as refunded in DB only. Payout mode: ${payoutMode}.`,
        },
      };
      refundType = "db_only";
    } else {
      // Call gateway refund API (for all payout modes: manual, payment_split, etc.)
      refundResult = await initiateGatewayRefund(payment, gateway);
      refundType = "gateway";

      if (!refundResult.success) {
        // Log failed refund attempt
        await supabase.from("refund_transactions").insert({
          payment_id: paymentId,
          admin_id: adminId,
          gateway_id: payment.payment_gateway_id,
          gateway_name: gateway.gateway_name,
          refund_reference: `${refundRef}-FAIL-${Date.now()}`,
          amount: refundAmount,
          status: "failed",
          refund_type: refundType,
          payout_mode: payoutMode,
          gateway_settlement_status: payment.gateway_settlement_status,
          failure_reason: refundResult.gateway_response?.error ?? JSON.stringify(refundResult.gateway_response),
          gateway_response: refundResult.gateway_response,
          initiated_at: new Date().toISOString(),
        }).then(() => {}).catch(() => {});

        await supabase.from("payment_logs").insert({
          payment_id: paymentId,
          status: "refund_failed",
          message: `Admin gateway refund failed (payout_mode: ${payoutMode}): ${JSON.stringify(refundResult.gateway_response)}`,
          metadata: { admin_id: adminId, payout_mode: payoutMode, gateway_response: refundResult.gateway_response },
        });

        return new Response(
          JSON.stringify({
            error: `Gateway refund failed: ${refundResult.gateway_response?.error ?? JSON.stringify(refundResult.gateway_response)}`,
            gateway_response: refundResult.gateway_response,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Mark payment as refunded
    await supabase
      .from("payments")
      .update({
        status: "refunded",
        updated_at: new Date().toISOString(),
        gateway_response: refundResult.gateway_response,
      })
      .eq("id", paymentId);

    // Mark any linked merchant_onboarding as rejected
    await supabase
      .from("merchant_onboarding")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("payment_id", paymentId)
      .in("status", ["pending", "submitted", "expired"]);

    // Upsert payout record
    const { data: existingPayout } = await supabase
      .from("payouts")
      .select("id")
      .eq("payment_id", paymentId)
      .maybeSingle();

    const bene = payment.beneficiary_details || {};
    let payoutId: string | null = null;

    if (existingPayout) {
      payoutId = existingPayout.id;
      await supabase
        .from("payouts")
        .update({
          status: "refunded",
          refund_reason: `Refunded by admin via ${gateway.gateway_name} (payout_mode: ${payoutMode})`,
          refunded_by: adminId,
          refunded_at: new Date().toISOString(),
          gateway_transaction_id: refundResult.refund_id,
          gateway_response: refundResult.gateway_response,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingPayout.id);
    } else {
      const { data: newPayout } = await supabase
        .from("payouts")
        .insert({
          user_id: payment.user_id,
          beneficiary_id: payment.beneficiary_id,
          payment_id: paymentId,
          payment_gateway_id: payment.payment_gateway_id,
          amount: payment.amount,
          charges: 0,
          gst: 0,
          total_deduction: 0,
          net_amount: payment.amount,
          payout_reference: refundRef,
          transfer_type: "IMPS",
          account_number: bene.bank_account || "",
          ifsc_code: bene.ifsc || "",
          account_holder_name: bene.full_name || "",
          bank_name: bene.bank_name || "",
          status: "refunded",
          gateway_transaction_id: refundResult.refund_id,
          gateway_response: refundResult.gateway_response,
          gateway_environment: payment.gateway_environment,
          payout_type: "admin",
          refund_reason: `Refunded by admin via ${gateway.gateway_name} (payout_mode: ${payoutMode})`,
          refunded_by: adminId,
          refunded_at: new Date().toISOString(),
          ip_address: "admin",
        })
        .select("id")
        .maybeSingle();
      payoutId = newPayout?.id ?? null;
    }

    // Record in refund_transactions for audit trail
    await supabase.from("refund_transactions").insert({
      payment_id: paymentId,
      payout_id: payoutId,
      admin_id: adminId,
      gateway_id: payment.payment_gateway_id,
      gateway_name: gateway.gateway_name,
      refund_reference: refundRef,
      gateway_refund_id: refundResult.refund_id,
      gateway_response: refundResult.gateway_response,
      amount: refundAmount,
      status: refundType === "db_only" ? "skipped" : "processed",
      refund_type: refundType,
      payout_mode: payoutMode,
      gateway_settlement_status: payment.gateway_settlement_status,
      initiated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).then(() => {}).catch((e: any) => console.error("refund_transactions insert error:", e));

    // Audit log
    await supabase.from("payment_logs").insert({
      payment_id: paymentId,
      status: "refunded",
      message: `Admin initiated ${refundType === "db_only" ? "DB-only" : "gateway"} refund via ${gateway.gateway_name} (payout_mode: ${payoutMode}). Refund ID: ${refundResult.refund_id ?? "N/A"}. Amount: ${fmt(payment.amount)}.`,
      metadata: {
        admin_id: adminId,
        admin_name: admin.full_name,
        gateway: gateway.gateway_name,
        payout_mode: payoutMode,
        refund_id: refundResult.refund_id,
        refund_amount: payment.amount,
        refund_type: refundType,
        gateway_settlement_status: payment.gateway_settlement_status,
        gateway_response: refundResult.gateway_response,
      },
    });

    EdgeRuntime.waitUntil(sendNotifications(supabase, payment, refundResult.refund_id));

    return new Response(
      JSON.stringify({
        success: true,
        message: `Refund of ${fmt(payment.amount)} ${refundType === "db_only" ? "recorded (no gateway capture)" : `initiated via ${gateway.gateway_name}`} successfully`,
        refund_id: refundResult.refund_id,
        refund_reference: refundRef,
        refund_type: refundType,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("admin-gateway-refund error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});


// redeploy
