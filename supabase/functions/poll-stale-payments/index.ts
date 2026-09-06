import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/**
 * poll-stale-payments
 *
 * Background job that runs every 10 minutes (triggered via a cron webhook or
 * an external scheduler calling POST /functions/v1/poll-stale-payments).
 *
 * Finds payments that are still in `pending` or `processing` status and were
 * created more than 10 minutes ago but have not yet been resolved, then polls
 * each gateway for a final status and processes accordingly:
 *
 *   • failed  → mark payment as failed, log the reason
 *   • success → run full settlement logic (mirrors save-transaction-status):
 *               determine kyc_pending vs settlement_pending, create auto-payout
 *               when applicable, send notification emails/SMS
 *
 * Safety caps:
 *   • Maximum 20 poll attempts per payment (covers ~3.5 hours at 10-min cadence)
 *   • Payments are only re-polled if at least 8 minutes have passed since the
 *     last poll attempt (avoids double-firing when the function is called early)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = () => Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_POLL_ATTEMPTS = 20;
// Don't re-poll a payment that was already checked within the last 4 minutes
const MIN_POLL_INTERVAL_MS = 4 * 60 * 1000;
// Only pick up payments older than 5 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
// Force-fail payments that remain unresolved for longer than this — user abandoned payment.
const FORCE_FAIL_AFTER_MS = 30 * 60 * 1000; // 30 minutes

// ─── Gateway status checkers ──────────────────────────────────────────────────

async function checkCashFreeStatus(payment: any, gateway: any, isTest: boolean) {
  const base = isTest
    ? "https://sandbox.cashfree.com/pg/orders"
    : "https://api.cashfree.com/pg/orders";
  const clientId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const clientSecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;

  const res = await fetch(`${base}/${payment.payment_reference}`, {
    headers: {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": "2023-08-01",
    },
  });
  const data = await res.json();
  const status =
    data.order_status === "PAID" ? "completed" :
    data.order_status === "ACTIVE" ? "processing" :
    "failed";
  return { status, transaction_id: data.cf_order_id ?? null, gateway_response: data };
}

async function checkRazorPayStatus(payment: any, gateway: any, isTest: boolean) {
  const base = "https://api.razorpay.com/v1";
  const keyId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const keySecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const auth = btoa(`${keyId}:${keySecret}`);
  const headers = { Authorization: `Basic ${auth}` };

  // Resolve a Razorpay Order ID into a unified status result
  async function resolveOrder(orderId: string) {
    const orderRes = await fetch(`${base}/orders/${orderId}`, { headers });
    const order = await orderRes.json();

    if (order.status === "paid") {
      const pmtRes = await fetch(`${base}/orders/${orderId}/payments`, { headers });
      const pmtData = await pmtRes.json();
      const payments: any[] = pmtData.items || [];
      const captured = payments.find((p: any) => p.status === "captured");
      const authorized = payments.find((p: any) => p.status === "authorized");
      const latest = captured || authorized || payments[0];
      return {
        status: "completed" as const,
        transaction_id: latest?.id ?? orderId,
        gateway_response: { order, payment: latest ?? null },
      };
    }

    if (order.status === "attempted") {
      const pmtRes = await fetch(`${base}/orders/${orderId}/payments`, { headers });
      const pmtData = await pmtRes.json();
      const payments: any[] = pmtData.items || [];
      const allFailed = payments.length > 0 && payments.every((p: any) => p.status === "failed");
      return {
        status: (allFailed ? "failed" : "processing") as "failed" | "processing",
        transaction_id: orderId,
        gateway_response: { order, payments },
      };
    }

    // "created" — no payment attempt yet
    return {
      status: "pending" as const,
      transaction_id: orderId,
      gateway_response: { order },
    };
  }

  // Case 1: gateway_transaction_id is a Razorpay Order ID (order_xxx)
  if (payment.gateway_transaction_id?.startsWith("order_")) {
    return resolveOrder(payment.gateway_transaction_id);
  }

  // Case 2: gateway_transaction_id is a Razorpay Payment ID (pay_xxx)
  if (payment.gateway_transaction_id?.startsWith("pay_")) {
    const res = await fetch(`${base}/payments/${payment.gateway_transaction_id}`, { headers });
    const data = await res.json();
    const status =
      data.status === "captured" ? "completed" :
      data.status === "authorized" ? "processing" :
      data.status === "failed" ? "failed" :
      "pending";
    return { status, transaction_id: data.id ?? null, gateway_response: data };
  }

  // Case 3: No gateway_transaction_id — search orders by receipt (= payment_reference)
  const res = await fetch(
    `${base}/orders?receipt=${encodeURIComponent(payment.payment_reference)}&count=5`,
    { headers }
  );
  const data = await res.json();
  const orders: any[] = data.items || [];

  if (orders.length === 0) {
    return { status: "pending" as const, transaction_id: null, gateway_response: {} };
  }

  return resolveOrder(orders[0].id);
}

async function checkPayUStatus(payment: any, gateway: any, isTest: boolean) {
  const base = isTest ? "https://test.payu.in" : "https://info.payu.in";
  const merchantKey = isTest ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTest ? gateway.test_api_secret : gateway.production_api_secret;

  const command = "verify_payment";
  const hashBuf = await crypto.subtle.digest(
    "SHA-512",
    new TextEncoder().encode(`${merchantKey}|${command}|${payment.payment_reference}${salt}`)
  );
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${base}/merchant/postservice.php?form=2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: merchantKey, command, var1: payment.payment_reference, hash }).toString(),
  });
  const data = await res.json();
  const txn = data.transaction_details?.[payment.payment_reference];
  const status =
    txn?.status === "success" ? "completed" :
    txn?.status === "pending" ? "processing" :
    "failed";
  return { status, transaction_id: txn?.mihpayid ?? null, gateway_response: data };
}

async function checkEaseBuzzStatus(payment: any, gateway: any, isTest: boolean) {
  const base = isTest
    ? "https://testdashboard.easebuzz.in"
    : "https://dashboard.easebuzz.in";
  const merchantKey = isTest ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const email = payment.beneficiary_details?.email || "customer@example.com";

  const hashBuf = await crypto.subtle.digest(
    "SHA-512",
    new TextEncoder().encode(`${merchantKey}|${payment.payment_reference}|${email}${salt}`)
  );
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${base}/transaction/v1/retrieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: merchantKey, txnid: payment.payment_reference, email, hash }),
  });
  const data = await res.json();
  const status =
    data.status === "success" ? "completed" :
    data.status === "pending" ? "processing" :
    "failed";
  return { status, transaction_id: data.easepayid ?? null, gateway_response: data };
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function generateInvoicePdf(payload: Record<string, any>): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL()}/functions/v1/generate-invoice-html`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.html_base64 ?? null;
  } catch (err) { console.error("Invoice generation error:", err); return null; }
}

async function sendEmail(to: string, subject: string, body: string, btnText?: string, btnLink?: string, pdfBase64?: string | null, pdfFilename?: string) {
  try {
    await fetch(`${SUPABASE_URL()}/functions/v1/send-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to, subject, body, body_type: "html", use_template: true,
        ...(btnText && btnLink ? { button_text: btnText, button_link: btnLink } : {}),
        ...(pdfBase64 ? { attachment_base64: pdfBase64, attachment_filename: pdfFilename || "invoice.pdf" } : {}),
      }),
    });
  } catch (e) { console.error("sendEmail error:", e); }
}

function formatCurrency(v: number | string) {
  return `₹${parseFloat(String(v)).toFixed(2)}`;
}

function receiptTable(rows: [string, string][]) {
  return `<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin:16px 0;">
    ${rows.map(([l, v]) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">${l}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${v}</td>
    </tr>`).join("")}
  </table>`;
}

async function sendInitiatedSms(supabase: any, payment: any) {
  try {
    const { data: user } = await supabase.from("users").select("mobile_number,first_name,last_name").eq("id", payment.user_id).maybeSingle();
    if (!user?.mobile_number) return;
    const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const category = payment.category_details?.category_name || payment.selected_payment_option?.card_type || "Payment";
    await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mobile: user.mobile_number, message: "", message_type: "payment_initiated",
        variables: { var1: category, var2: parseFloat(String(payment.amount)).toFixed(2), var3: name },
      }),
    });
  } catch (_) {}
}

async function sendSettledSms(supabase: any, payment: any) {
  try {
    const { data: user } = await supabase.from("users").select("mobile_number,first_name,last_name").eq("id", payment.user_id).maybeSingle();
    if (!user?.mobile_number) return;
    const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const category = payment.category_details?.category_name || payment.selected_payment_option?.card_type || "Payment";
    const beneficiaryName = payment.beneficiary_details?.full_name || "Beneficiary";
    await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mobile: user.mobile_number, message: "", message_type: "payment_settled",
        variables: { var1: category, var2: parseFloat(String(payment.amount)).toFixed(2), var3: name, var4: beneficiaryName },
      }),
    });
  } catch (_) {}
}

const STATUS_EMAIL_CONFIG: Record<string, { senderSubject: string; senderTitle: string; receiverSubject: string; receiverTitle: string; sendToReceiver: boolean }> = {
  settlement_pending: {
    senderSubject: "Payment Successful – Settlement In Progress",
    senderTitle: "Your payment was received and settlement is in progress.",
    receiverSubject: "Payment Incoming – Settlement In Progress",
    receiverTitle: "A payment has been initiated to your bank account and settlement is in progress.",
    sendToReceiver: true,
  },
  kyc_pending: {
    senderSubject: "Payment Successful – Awaiting Beneficiary KYC",
    senderTitle: "Your payment was received. Settlement is on hold pending beneficiary KYC verification.",
    receiverSubject: "Action Required: Complete KYC to Receive Payment",
    receiverTitle: "A payment is waiting to be released to your account. Please complete KYC verification.",
    sendToReceiver: false,
  },
  failed: {
    senderSubject: "Payment Failed",
    senderTitle: "Your payment could not be processed. No amount has been debited.",
    receiverSubject: "", receiverTitle: "", sendToReceiver: false,
  },
};

const ATTACH_INVOICE_STATUSES = new Set(["settlement_pending", "completed", "refunded"]);

async function sendTransactionEmails(supabase: any, payment: any, paymentStatus: string) {
  try {
    const { data: senderUser } = await supabase.from("users").select("first_name,last_name,email").eq("id", payment.user_id).maybeSingle();
    const bene = payment.beneficiary_details || {};
    const senderName = senderUser ? `${senderUser.first_name} ${senderUser.last_name}`.trim() : "Customer";
    const receiverName = bene.full_name || "Beneficiary";
    const paymentOptionName = payment.selected_payment_option?.card_type || payment.card_type || "Card";
    const txDate = new Date(payment.created_at || new Date()).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

    const cfg = STATUS_EMAIL_CONFIG[paymentStatus];
    if (!cfg) return;

    // Fetch additional data for enriched invoice
    const [panRes, bizRes, payoutRes, beneRes] = await Promise.all([
      supabase.from("kyc_pan_verification").select("pan_number").eq("user_id", payment.user_id).eq("status", "verified").maybeSingle(),
      supabase.from("kyc_business_info").select("business_name, business_pan, gst_number, status").eq("user_id", payment.user_id).maybeSingle(),
      supabase.from("payouts").select("status, payout_reference, gateway_transaction_id, completed_at, refunded_at").eq("payment_id", payment.id).maybeSingle(),
      payment.beneficiary_id
        ? supabase.from("beneficiaries").select("pan_number").eq("id", payment.beneficiary_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const senderPan: string | null = panRes.data?.pan_number ?? null;
    const bizKyc = bizRes.data;
    const businessKycVerified = bizKyc?.status === "verified";
    const payout = payoutRes.data;
    const receiverPan: string | null = beneRes.data?.pan_number ?? null;

    const gatewayTxDate = payout?.completed_at
      ? new Date(payout.completed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
      : null;
    const refundDate = payout?.refunded_at
      ? new Date(payout.refunded_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
      : null;

    const rows: [string, string][] = [
      ["Transaction Reference", payment.payment_reference || "N/A"],
      ["Date & Time", txDate],
      ["Payment Option", paymentOptionName],
      ["Amount", formatCurrency(payment.amount)],
      ["Platform Charges", formatCurrency(payment.charges || 0)],
      ["GST on Charges", formatCurrency(payment.gst || 0)],
      ["Total Charged", formatCurrency(payment.total_amount || payment.amount)],
      ["Status", cfg.senderTitle],
    ];
    if (payment.gateway_transaction_id) rows.push(["Gateway Reference", payment.gateway_transaction_id]);
    if (bene.bank_name) rows.push(["Beneficiary Bank", bene.bank_name]);
    if (bene.bank_account) rows.push(["Account No.", bene.bank_account]);
    const html = receiptTable(rows);

    const attachInvoice = ATTACH_INVOICE_STATUSES.has(paymentStatus);
    const isRefund = paymentStatus === "refunded";
    let pdfBase64: string | null = null;
    if (attachInvoice) {
      pdfBase64 = await generateInvoicePdf({
        payment_reference: payment.payment_reference || "N/A",
        date: txDate,
        sender_name: senderName,
        receiver_name: receiverName,
        receiver_bank: bene.bank_name || "",
        receiver_account: bene.bank_account || "",
        receiver_ifsc: bene.ifsc || "",
        receiver_pan: receiverPan || undefined,
        category_name: paymentOptionName,
        amount: payment.amount,
        charges: payment.charges || 0,
        gst: payment.gst || 0,
        total_amount: payment.total_amount || payment.amount,
        gateway_ref: payment.gateway_transaction_id || "",
        gateway_tx_date: gatewayTxDate || undefined,
        payout_status: payout?.status || undefined,
        payout_reference: payout?.payout_reference || undefined,
        refund_date: isRefund ? (refundDate || undefined) : undefined,
        status: isRefund ? "Refunded" : "Completed",
        invoice_type: isRefund ? "refund" : "settlement",
        business_kyc_verified: businessKycVerified,
        company_name: businessKycVerified ? (bizKyc?.business_name || undefined) : undefined,
        company_pan: businessKycVerified ? (bizKyc?.business_pan || undefined) : undefined,
        company_gst: businessKycVerified ? (bizKyc?.gst_number || undefined) : undefined,
        sender_pan: !businessKycVerified ? (senderPan || undefined) : undefined,
      });
    }
    const invoiceFilename = `invoice-${payment.payment_reference || "txn"}.html`;
    const attachNote = attachInvoice ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Invoice copy is attached to this email.</p>` : "";

    if (senderUser?.email && cfg.senderSubject) {
      await sendEmail(
        senderUser.email,
        `${cfg.senderSubject} – Ref: ${payment.payment_reference}`,
        `<p>Dear ${senderName},</p><p>${cfg.senderTitle}</p>${html}<p><strong>Sent to:</strong> ${receiverName}${bene.bank_name ? ` — ${bene.bank_name}` : ""}</p>${attachNote}`,
        undefined, undefined, pdfBase64, invoiceFilename,
      );
    }
    if (bene.email && cfg.sendToReceiver && cfg.receiverSubject) {
      await sendEmail(
        bene.email,
        `${cfg.receiverSubject} – Ref: ${payment.payment_reference}`,
        `<p>Dear ${receiverName},</p><p>${cfg.receiverTitle}</p>${html}<p><strong>Sent by:</strong> ${senderName}</p>${attachNote}`,
        undefined, undefined, pdfBase64, invoiceFilename,
      );
    }
  } catch (e) { console.error("sendTransactionEmails error:", e); }
}

/**
 * Looks up a previously verified merchant_onboarding record for the same beneficiary.
 * Primary match: same beneficiary_id + same email + same mobile.
 * Fallback: same bank_account + same ifsc + same mobile (handles cross-beneficiary
 * cases where the same person was added under a different user account or with
 * a slightly different email spelling).
 */
async function findPreviousVerifiedKyc(supabase: any, beneficiaryId: string | null): Promise<any | null> {
  if (!beneficiaryId) return null;

  const { data: bene } = await supabase
    .from("beneficiaries")
    .select("email, mobile, bank_account, ifsc")
    .eq("id", beneficiaryId)
    .maybeSingle();

  const email = bene?.email?.trim() || null;
  const mobile = bene?.mobile?.trim() || null;
  const bankAccount = bene?.bank_account?.trim() || null;
  const ifsc = bene?.ifsc?.trim() || null;

  if (email && mobile) {
    const { data: matches } = await supabase
      .from("merchant_onboarding")
      .select("*")
      .eq("status", "verified")
      .eq("beneficiary_id", beneficiaryId)
      .eq("email", email)
      .eq("mobile", mobile)
      .order("verified_at", { ascending: false })
      .limit(1);
    if (matches?.[0]) return matches[0];
  }

  if (bankAccount && ifsc && mobile) {
    const { data: beneMatches } = await supabase
      .from("beneficiaries")
      .select("id")
      .eq("bank_account", bankAccount)
      .eq("ifsc", ifsc)
      .eq("mobile", mobile);

    if (beneMatches && beneMatches.length > 0) {
      const beneIds = beneMatches.map((b: any) => b.id);
      const { data: fallbackMatches } = await supabase
        .from("merchant_onboarding")
        .select("*")
        .eq("status", "verified")
        .in("beneficiary_id", beneIds)
        .order("verified_at", { ascending: false })
        .limit(1);
      if (fallbackMatches?.[0]) return fallbackMatches[0];
    }
  }

  return null;
}

async function sendKycRequestEmails(supabase: any, payment: any): Promise<boolean> {
  try {
    const bene = payment.beneficiary_details || {};
    const receiverName = bene.full_name || "Beneficiary";
    const receiverEmail = bene.email;
    const receiverMobile = bene.mobile || "";

    // ── Auto-reuse: if beneficiary was previously verified, skip KYC flow ──
    const previousKyc = await findPreviousVerifiedKyc(supabase, payment.beneficiary_id || null);

    if (previousKyc) {
      const nowIso = new Date().toISOString();

      await supabase.from("merchant_onboarding").insert({
        payment_id: payment.id,
        beneficiary_id: payment.beneficiary_id || null,
        full_name: previousKyc.full_name ?? receiverName,
        email: previousKyc.email ?? receiverEmail ?? "",
        mobile: previousKyc.mobile ?? receiverMobile,
        sender_name: payment.beneficiary_details?.full_name ?? "Sender",
        category_name: payment.category_details?.category_name ?? "Payment",
        token: crypto.randomUUID(),
        status: "verified",
        expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        kyc_completed_at: nowIso,
        verified_at: nowIso,
        updated_at: nowIso,
        pan_number: previousKyc.pan_number ?? null,
        pan_photo_url: previousKyc.pan_photo_url ?? null,
        dob: previousKyc.dob ?? null,
        id_number: previousKyc.id_number ?? null,
        aadhaar_front_url: previousKyc.aadhaar_front_url ?? null,
        aadhaar_back_url: previousKyc.aadhaar_back_url ?? null,
        address: previousKyc.address ?? null,
        city: previousKyc.city ?? null,
        state: previousKyc.state ?? null,
        pincode: previousKyc.pincode ?? null,
        bank_account_number: previousKyc.bank_account_number ?? null,
        bank_ifsc: previousKyc.bank_ifsc ?? null,
        bank_name: previousKyc.bank_name ?? null,
        bank_branch: previousKyc.bank_branch ?? null,
        kyc_method: previousKyc.kyc_method ?? null,
        digilocker_verified: previousKyc.digilocker_verified ?? null,
        digilocker_provider: previousKyc.digilocker_provider ?? null,
        address_proof_type: previousKyc.address_proof_type ?? null,
      });

      await supabase.from("payments")
        .update({ status: "settlement_pending", updated_at: nowIso })
        .eq("id", payment.id);

      await supabase.from("payment_logs").insert({
        payment_id: payment.id,
        status: "settlement_pending",
        message: "Merchant KYC auto-reused from a previous verified submission (stale-payment poller). Payment queued for settlement.",
        metadata: { previous_merchant_onboarding_id: previousKyc.id },
      });

      return true;
    }
    // ── End auto-reuse ────────────────────────────────────────────────────

    const { data: senderUser } = await supabase.from("users").select("first_name,last_name,middle_name").eq("id", payment.user_id).maybeSingle();
    const senderName = senderUser
      ? [senderUser.first_name, senderUser.middle_name, senderUser.last_name].filter(Boolean).join(" ").trim()
      : "Sender";

    const categoryName = payment.category_details?.category_name || payment.selected_payment_option?.card_type || "Payment";
    const refundHours = payment.category_details?.refund_after_hours || payment.selected_payment_option?.refund_after_hours;
    const expiryHours = refundHours ? Number(refundHours) : 72;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
    const token = crypto.randomUUID();

    const { data: existing } = await supabase.from("merchant_onboarding")
      .select("id,token").eq("payment_id", payment.id).in("status", ["pending", "submitted"]).maybeSingle();

    let onboardingToken = token;
    if (existing) {
      onboardingToken = existing.token;
    } else {
      await supabase.from("merchant_onboarding").insert({
        payment_id: payment.id,
        beneficiary_id: payment.beneficiary_id || null,
        full_name: receiverName,
        email: receiverEmail || "",
        mobile: receiverMobile,
        sender_name: senderName,
        category_name: categoryName,
        token,
        status: "pending",
        expires_at: expiresAt,
      });
    }

    const appUrl = (Deno.env.get("APP_URL") || "https://paybycard.in").trim();
    const link = `${appUrl}/merchant-onboarding?token=${onboardingToken}`;
    const refundNote = refundHours
      ? `<p style="color:#d97706;font-weight:600;margin-top:16px;">Note: If KYC is not completed within ${refundHours} hours, the payment will be refunded.</p>`
      : `<p style="color:#d97706;font-weight:600;margin-top:16px;">Note: If KYC is not completed within the required timeframe, the payment may be refunded.</p>`;

    if (receiverEmail) {
      const body = `<p>Dear ${receiverName},</p>
        <p>A payment of <strong>${formatCurrency(payment.amount)}</strong> has been initiated for you by <strong>${senderName}</strong>.
        To receive the funds, please complete your Merchant KYC verification.</p>
        ${receiptTable([
          ["Payment Reference", payment.payment_reference || "N/A"],
          ["Amount to Receive", formatCurrency(payment.amount)],
          ["Category", categoryName],
          ["Link Expires", new Date(expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })],
        ])}
        ${refundNote}`;
      await sendEmail(receiverEmail, `Action Required: Complete KYC – Ref: ${payment.payment_reference}`, body, "Complete KYC Verification", link);
    }

    if (receiverMobile) {
      await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: receiverMobile, message: "", message_type: "merchant_onboarding", variables: { var1: onboardingToken } }),
      }).catch((_) => {});
    }
  } catch (e) { console.error("sendKycRequestEmails error:", e); }
  return false;
}

// ─── Auto-payout (mirrors save-transaction-status / check-payment-status) ────

async function triggerAutoPayout(supabase: any, payment: any, gateway: any) {
  try {
    const isTest = payment.gateway_environment === "test";
    const keyId = isTest ? gateway.test_api_key : gateway.production_api_key;
    const keySecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
    if (!keyId || !keySecret) return;

    const { data: beneficiary } = await supabase.from("beneficiaries").select("*").eq("id", payment.beneficiary_id).maybeSingle();
    if (!beneficiary) return;

    const auth = btoa(`${keyId}:${keySecret}`);
    const base = "https://api.razorpay.com/v1";
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
    const payoutReference = `POUT-${dateStr}-${rand}`;

    const { data: payoutRecord } = await supabase.from("payouts").insert({
      user_id: payment.user_id,
      payment_id: payment.id,
      beneficiary_id: payment.beneficiary_id,
      payment_gateway_id: payment.payment_gateway_id,
      amount: payment.amount,
      charges: 0, gst: 0, total_deduction: 0, net_amount: payment.amount,
      payout_reference: payoutReference,
      transfer_type: "IMPS",
      account_number: beneficiary.bank_account,
      ifsc_code: beneficiary.ifsc,
      account_holder_name: beneficiary.full_name,
      bank_name: beneficiary.bank_name,
      gateway_environment: payment.gateway_environment,
      status: "processing",
      ip_address: "system",
    }).select().single();

    if (!payoutRecord) return;

    // Create contact
    let contactResp = await fetch(`${base}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ name: beneficiary.full_name, email: beneficiary.email, contact: beneficiary.mobile || "9999999999", type: "customer", reference_id: `contact_${beneficiary.id}` }),
    });
    let contact = await contactResp.json();
    if (!contactResp.ok) {
      if (contact.error?.description?.includes("already exists")) {
        const ex = await (await fetch(`${base}/contacts?reference_id=contact_${beneficiary.id}`, { headers: { Authorization: `Basic ${auth}` } })).json();
        if (ex.items?.[0]) contact = ex.items[0];
        else throw new Error("Contact not found");
      } else throw new Error(contact.error?.description || "Contact failed");
    }

    // Create fund account
    const faResp = await fetch(`${base}/fund_accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ contact_id: contact.id, account_type: "bank_account", bank_account: { name: beneficiary.full_name, ifsc: beneficiary.ifsc, account_number: beneficiary.bank_account } }),
    });
    const fa = await faResp.json();
    if (!faResp.ok) throw new Error(fa.error?.description || "Fund account failed");

    // Initiate payout
    const payoutData = {
      fund_account_id: fa.id, amount: Math.round(payment.amount * 100), currency: "INR",
      mode: "IMPS", purpose: "payout", queue_if_low_balance: true,
      reference_id: payoutReference, narration: `Payout ${payoutReference}`,
      notes: { payment_id: payment.id },
    };
    const payoutResp = await fetch(`${base}/payouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}`, "X-Payout-Idempotency": payoutReference },
      body: JSON.stringify(payoutData),
    });
    const payoutResult = await payoutResp.json();

    const finalStatus = payoutResp.ok && ["processed", "processing"].includes(payoutResult.status)
      ? (payoutResult.status === "processed" ? "completed" : "processing")
      : "failed";

    await supabase.from("payouts").update({
      status: finalStatus,
      gateway_transaction_id: payoutResult.id || null,
      utr_number: payoutResult.utr || null,
      gateway_request: payoutData,
      gateway_response: payoutResult,
      ...(finalStatus === "completed" ? { completed_at: new Date().toISOString() } : {}),
      ...(finalStatus === "failed" ? { failure_reason: payoutResult.error?.description || "Payout failed" } : {}),
    }).eq("id", payoutRecord.id);

    if (finalStatus === "completed") {
      await supabase.from("payments").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", payment.id);
    }
  } catch (e) {
    console.error("triggerAutoPayout error:", e);
  }
}

// ─── Process a single payment after confirmed gateway success ─────────────────

async function processSuccessfulPayment(supabase: any, payment: any, gatewayResult: { status: string; transaction_id: string | null; gateway_response: any }) {
  // Check live beneficiary KYC status — the payment snapshot may be stale if the
  // beneficiary became a verified merchant after this payment was created.
  let isVerifiedMerchant = payment.beneficiary_details?.is_verified_merchant === true;
  if (payment.beneficiary_id && !isVerifiedMerchant) {
    const { data: liveBene } = await supabase
      .from("beneficiaries")
      .select("is_verified_merchant")
      .eq("id", payment.beneficiary_id)
      .maybeSingle();
    if (liveBene?.is_verified_merchant === true) isVerifiedMerchant = true;
  }

  const kycRequired =
    payment.category_details?.receiver_kyc_required === true ||
    payment.selected_payment_option?.receiver_kyc_required === true;
  const isEligibleForPayout = isVerifiedMerchant || !kycRequired;

  // Re-fetch enriched payment for notifications and payout_mode check
  const { data: enriched } = await supabase
    .from("payments")
    .select("*, payment_gateway_settings(*)")
    .eq("id", payment.id)
    .maybeSingle();

  const payoutMode = enriched?.payout_mode ?? enriched?.payment_gateway_settings?.payout_mode ?? "manual";
  const splitConfigured = enriched?.split_configured === true;

  // Resolve status matching the same logic as save-transaction-status:
  // payment_split + split_configured → completed (gateway handled settlement)
  // payout mode or payment_split without split → settlement_pending
  // kyc required → kyc_pending
  let resolvedStatus: string;
  if (!isEligibleForPayout) {
    resolvedStatus = "kyc_pending";
  } else if (payoutMode === "payment_split" && splitConfigured) {
    resolvedStatus = "completed";
  } else {
    resolvedStatus = "settlement_pending";
  }

  const updateData: any = {
    status: resolvedStatus,
    updated_at: new Date().toISOString(),
    gateway_response: gatewayResult.gateway_response,
    last_polled_at: new Date().toISOString(),
  };
  if (resolvedStatus === "completed") updateData.completed_at = new Date().toISOString();
  if (gatewayResult.transaction_id && !payment.gateway_transaction_id) {
    updateData.gateway_transaction_id = gatewayResult.transaction_id;
  }

  await supabase.from("payments").update(updateData).eq("id", payment.id);

  await supabase.from("payment_logs").insert({
    payment_id: payment.id,
    status: resolvedStatus,
    message: `Payment resolved to ${resolvedStatus} via stale-payment poller`,
    metadata: gatewayResult.gateway_response,
  });

  // Trigger payout for payment_split when split was NOT configured at order time
  if (isEligibleForPayout && payoutMode === "payment_split" && !splitConfigured && enriched?.payment_gateway_settings) {
    EdgeRuntime.waitUntil(triggerAutoPayout(supabase, enriched, enriched.payment_gateway_settings));
  }

  EdgeRuntime.waitUntil(sendInitiatedSms(supabase, enriched || payment));
  EdgeRuntime.waitUntil(sendTransactionEmails(supabase, enriched || payment, resolvedStatus));
  if (isEligibleForPayout) {
    EdgeRuntime.waitUntil(sendSettledSms(supabase, enriched || payment));
  }
  if (!isEligibleForPayout) {
    EdgeRuntime.waitUntil(
      sendKycRequestEmails(supabase, enriched || payment).then((autoResolved) => {
        if (autoResolved) {
          const payoutModeResolved = enriched?.payout_mode ?? enriched?.payment_gateway_settings?.payout_mode ?? "manual";
          const splitConfiguredResolved = enriched?.split_configured === true;
          if (payoutModeResolved === "payout" || (payoutModeResolved === "payment_split" && !splitConfiguredResolved)) {
            return triggerAutoPayout(supabase, enriched || payment, enriched?.payment_gateway_settings);
          }
        }
      })
    );
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startedAt = Date.now();
  const results: { id: string; reference: string; action: string; newStatus?: string; error?: string }[] = [];

  try {
    const supabase = createClient(SUPABASE_URL(), SERVICE_ROLE_KEY());
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    const rePollBefore = new Date(Date.now() - MIN_POLL_INTERVAL_MS).toISOString();

    // Fetch stale unresolved payments
    const { data: stalePayments, error: fetchErr } = await supabase
      .from("payments")
      .select("*, payment_gateway_settings(*)")
      .in("status", ["pending", "processing"])
      .lt("created_at", cutoff)
      .lt("poll_count", MAX_POLL_ATTEMPTS)
      .or(`last_polled_at.is.null,last_polled_at.lt.${rePollBefore}`)
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchErr) {
      throw new Error(`Failed to fetch stale payments: ${fetchErr.message}`);
    }

    if (!stalePayments || stalePayments.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No stale payments to process", processed: 0, durationMs: Date.now() - startedAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    for (const payment of stalePayments) {
      const gateway = payment.payment_gateway_settings;

      // ── Pessimistic lock: atomically claim this payment for polling ───────────
      // fn_try_claim_for_poll does a single UPDATE that both CHECKS and SETS
      // last_polled_at in one statement.  Two concurrent cron executions racing
      // on the same row will serialize at the PostgreSQL level; only the first
      // satisfies the WHERE condition.  The second returns FALSE and skips.
      const { data: pollClaimed, error: pollClaimErr } = await supabase
        .rpc("fn_try_claim_for_poll", {
          p_payment_id:      payment.id,
          p_min_interval_ms: MIN_POLL_INTERVAL_MS,
          p_max_attempts:    MAX_POLL_ATTEMPTS,
        });

      if (pollClaimErr || !pollClaimed) {
        results.push({
          id: payment.id,
          reference: payment.payment_reference,
          action: "skipped",
          error: "Poll claimed by concurrent process or poll cap reached",
        });
        continue;
      }

      try {
        if (!gateway) {
          results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped", error: "No gateway settings" });
          continue;
        }

        const gatewayName = gateway.gateway_name?.toLowerCase();
        const isTest = payment.gateway_environment === "test";
        let gatewayResult: { status: string; transaction_id: string | null; gateway_response: any };

        switch (gatewayName) {
          case "cashfree":
            gatewayResult = await checkCashFreeStatus(payment, gateway, isTest);
            break;
          case "razorpay":
            gatewayResult = await checkRazorPayStatus(payment, gateway, isTest);
            break;
          case "payu":
            gatewayResult = await checkPayUStatus(payment, gateway, isTest);
            break;
          case "easebuzz":
            gatewayResult = await checkEaseBuzzStatus(payment, gateway, isTest);
            break;
          default:
            results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped", error: `Unsupported gateway: ${gatewayName}` });
            continue;
        }

        if (gatewayResult.status === "pending" || gatewayResult.status === "processing") {
          const ageMs = Date.now() - new Date(payment.created_at).getTime();
          if (ageMs >= FORCE_FAIL_AFTER_MS) {
            // Payment has been pending/active at the gateway beyond the timeout window.
            // The user abandoned the payment page — force-fail it.
            await supabase.from("payments").update({
              status: "failed",
              failure_reason: "Payment session expired — customer did not complete the payment.",
              gateway_response: gatewayResult.gateway_response,
              updated_at: new Date().toISOString(),
            }).eq("id", payment.id);

            await supabase.from("payment_logs").insert({
              payment_id: payment.id,
              status: "failed",
              message: `Payment force-failed by stale-payment poller after ${Math.round(ageMs / 3600000)}h timeout (gateway still reported ${gatewayResult.status}).`,
              metadata: gatewayResult.gateway_response,
            });

            EdgeRuntime.waitUntil(
              (async () => {
                const { data: enriched } = await supabase.from("payments").select("*").eq("id", payment.id).maybeSingle();
                await sendTransactionEmails(supabase, enriched || payment, "failed");
              })()
            );

            results.push({ id: payment.id, reference: payment.payment_reference, action: "force_failed", newStatus: "failed" });
          } else {
            // Still within the timeout window — log and check again next cycle
            await supabase.from("payment_logs").insert({
              payment_id: payment.id,
              status: "poll_pending",
              message: `Poll attempt ${(payment.poll_count || 0) + 1}: gateway reported ${gatewayResult.status}. Age: ${Math.round(ageMs / 60000)}min. Will force-fail after 30min.`,
              metadata: gatewayResult.gateway_response,
            });
            results.push({ id: payment.id, reference: payment.payment_reference, action: "still_pending", newStatus: gatewayResult.status });
          }
          continue;
        }

        if (gatewayResult.status === "failed") {
          await supabase.from("payments").update({
            status: "failed",
            failure_reason: "Payment not completed at gateway — timed out.",
            gateway_response: gatewayResult.gateway_response,
            updated_at: new Date().toISOString(),
          }).eq("id", payment.id);

          await supabase.from("payment_logs").insert({
            payment_id: payment.id,
            status: "failed",
            message: "Payment marked failed by stale-payment poller after gateway poll.",
            metadata: gatewayResult.gateway_response,
          });

          EdgeRuntime.waitUntil(
            (async () => {
              const { data: enriched } = await supabase.from("payments").select("*").eq("id", payment.id).maybeSingle();
              await sendTransactionEmails(supabase, enriched || payment, "failed");
            })()
          );

          results.push({ id: payment.id, reference: payment.payment_reference, action: "marked_failed", newStatus: "failed" });
          continue;
        }

        if (gatewayResult.status === "completed") {
          await processSuccessfulPayment(supabase, payment, gatewayResult);
          results.push({ id: payment.id, reference: payment.payment_reference, action: "processed_success" });
        }
      } catch (paymentErr: any) {
        console.error(`Error processing payment ${payment.payment_reference}:`, paymentErr);
        // Log gateway errors to payment_logs for visibility
        await supabase.from("payment_logs").insert({
          payment_id: payment.id,
          status: "poll_error",
          message: `Poll attempt ${(payment.poll_count || 0) + 1} failed: ${paymentErr?.message || "Unknown error"}`,
          metadata: { error: paymentErr?.message },
        }).catch(() => {});
        results.push({ id: payment.id, reference: payment.payment_reference, action: "error", error: paymentErr?.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results,
        durationMs: Date.now() - startedAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("poll-stale-payments fatal error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || "Internal server error", durationMs: Date.now() - startedAt }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
