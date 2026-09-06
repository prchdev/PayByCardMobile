import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/**
 * auto-refund-kyc-expired
 *
 * Background job triggered every 10 minutes via pg_cron.
 *
 * Finds payments with status = 'kyc_pending' where:
 *   • The payment category requires receiver KYC (receiver_kyc_required = true)
 *   • The category has a non-zero refund_after_hours threshold
 *   • The payment was created more than refund_after_hours ago
 *   • The receiver's KYC (kyc_business_info) is still not verified
 *
 * For each eligible payment it:
 *   1. Calls the original gateway's refund API with the base amount
 *   2. Marks the payment status as 'refunded'
 *   3. Inserts a refund record into the payouts table
 *   4. Logs the action in payment_logs
 *   5. Sends email + SMS notifications to sender and receiver
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = () => Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Settlement status set ────────────────────────────────────────────────────
// When gateway_settlement_status is one of these, money has moved to merchant
// wallet — a balance check is required before refunding.
const SETTLED_STATUSES = new Set(["settled", "paid", "captured"]);

// ─── Gateway balance checkers ─────────────────────────────────────────────────

async function checkRazorPayBalance(
  gateway: any,
  isTest: boolean
): Promise<{ balance: number | null; error?: string }> {
  const keyId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const keySecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  if (!keyId || !keySecret) return { balance: null };
  try {
    const auth = btoa(`${keyId}:${keySecret}`);
    const res = await fetch("https://api.razorpay.com/v1/balance", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return { balance: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { balance: (data.balance ?? 0) / 100 };
  } catch (e: any) {
    return { balance: null, error: e?.message };
  }
}

async function checkCashFreeBalance(
  gateway: any,
  isTest: boolean
): Promise<{ balance: number | null; error?: string }> {
  const clientId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const clientSecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  if (!clientId || !clientSecret) return { balance: null };
  const base = isTest ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
  try {
    const res = await fetch(`${base}/api/v1/merchant/wallet/balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: clientId, secretKey: clientSecret }),
    });
    if (!res.ok) return { balance: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { balance: parseFloat(data.data?.balance ?? data.balance ?? "0") };
  } catch (e: any) {
    return { balance: null, error: e?.message };
  }
}

async function hasEnoughBalance(
  gateway: any,
  isTest: boolean,
  requiredAmount: number
): Promise<{ sufficient: boolean; balance: number | null }> {
  const name = (gateway?.gateway_name ?? "").toLowerCase();
  let result: { balance: number | null; error?: string };

  if (name === "razorpay") {
    result = await checkRazorPayBalance(gateway, isTest);
  } else if (name === "cashfree") {
    result = await checkCashFreeBalance(gateway, isTest);
  } else {
    return { sufficient: true, balance: null };
  }

  if (result.balance !== null && result.balance < requiredAmount) {
    return { sufficient: false, balance: result.balance };
  }
  return { sufficient: true, balance: result.balance };
}

// ─── Gateway refund callers ───────────────────────────────────────────────────

async function refundRazorPay(
  payment: any,
  gateway: any,
  isTest: boolean
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const keyId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const keySecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const auth = btoa(`${keyId}:${keySecret}`);
  const base = "https://api.razorpay.com/v1";
  let txnId = payment.gateway_transaction_id;

  if (!txnId) {
    return { success: false, refund_id: null, gateway_response: { error: "No gateway_transaction_id on payment" } };
  }

  // Resolve Order ID (order_xxx) → captured Payment ID (pay_xxx)
  if (txnId.startsWith("order_")) {
    const ordPmtRes = await fetch(`${base}/orders/${txnId}/payments`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const ordPmtData = await ordPmtRes.json();
    const payments: any[] = ordPmtData.items || [];
    const captured = payments.find((p: any) => p.status === "captured");
    if (!captured) {
      return {
        success: false,
        refund_id: null,
        gateway_response: { error: `No captured payment found for Razorpay order ${txnId}. Cannot refund.`, order_payments: ordPmtData },
      };
    }
    txnId = captured.id;
  }

  const res = await fetch(`${base}/payments/${txnId}/refund`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(parseFloat(String(payment.amount)) * 100) }),
  });
  const data = await res.json();
  return {
    success: res.ok && data.id != null && data.entity === "refund",
    refund_id: data.id ?? null,
    gateway_response: data,
  };
}

async function refundCashFree(
  payment: any,
  gateway: any,
  isTest: boolean
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const base = isTest
    ? "https://sandbox.cashfree.com/pg"
    : "https://api.cashfree.com/pg";
  const clientId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const clientSecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const refundId = `REFUND-${payment.payment_reference}`;

  const res = await fetch(`${base}/orders/${payment.payment_reference}/refunds`, {
    method: "POST",
    headers: {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refund_id: refundId,
      refund_amount: parseFloat(String(payment.amount)),
      refund_note: "KYC not completed within required time. Auto-refund.",
    }),
  });
  const data = await res.json();
  return {
    success: res.ok && data.refund_status !== "CANCELLED",
    refund_id: data.cf_refund_id ?? refundId,
    gateway_response: data,
  };
}

async function refundPayU(
  payment: any,
  gateway: any,
  isTest: boolean
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const base = isTest ? "https://test.payu.in" : "https://info.payu.in";
  const merchantKey = isTest ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const txnId = payment.gateway_transaction_id;

  if (!txnId) {
    return { success: false, refund_id: null, gateway_response: { error: "No gateway_transaction_id on payment" } };
  }

  const command = "cancel_refund_transaction";
  const hashInput = `${merchantKey}|${command}|${txnId}|${parseFloat(String(payment.amount)).toFixed(2)}|${salt}`;
  const hashBuf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(hashInput));
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${base}/merchant/postservice.php?form=2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      key: merchantKey,
      command,
      var1: txnId,
      var2: parseFloat(String(payment.amount)).toFixed(2),
      hash,
    }).toString(),
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
  isTest: boolean
): Promise<{ success: boolean; refund_id: string | null; gateway_response: any }> {
  const base = isTest ? "https://testdashboard.easebuzz.in" : "https://dashboard.easebuzz.in";
  const merchantKey = isTest ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  const txnId = payment.gateway_transaction_id || payment.payment_reference;

  const hashInput = `${merchantKey}|${txnId}|${parseFloat(String(payment.amount)).toFixed(2)}|${salt}`;
  const hashBuf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(hashInput));
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`${base}/transaction/v1/initiate_refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: merchantKey,
      txnid: txnId,
      amount: parseFloat(String(payment.amount)).toFixed(2),
      hash,
    }),
  });
  const data = await res.json();
  return {
    success: data.status === "success" || data.status === 1,
    refund_id: data.data?.refund_id ?? null,
    gateway_response: data,
  };
}

async function initiateGatewayRefund(payment: any, gateway: any) {
  const isTest = payment.gateway_environment === "test";
  const name = gateway.gateway_name?.toLowerCase();

  switch (name) {
    case "razorpay": return refundRazorPay(payment, gateway, isTest);
    case "cashfree":  return refundCashFree(payment, gateway, isTest);
    case "payu":      return refundPayU(payment, gateway, isTest);
    case "easebuzz":  return refundEaseBuzz(payment, gateway, isTest);
    default:
      return { success: false, refund_id: null, gateway_response: { error: `Unsupported gateway: ${name}` } };
  }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

function fmt(v: number | string) {
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

async function generateInvoicePdf(payload: Record<string, any>): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL()}/functions/v1/generate-invoice-html`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.html_base64 ?? null;
  } catch (err) {
    console.error("Invoice generation error:", err);
    return null;
  }
}

async function sendEmail(to: string, subject: string, body: string, pdfBase64?: string | null, filename?: string) {
  try {
    await fetch(`${SUPABASE_URL()}/functions/v1/send-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to, subject, body, body_type: "html", use_template: true,
        ...(pdfBase64 ? { attachment_base64: pdfBase64, attachment_filename: filename || "invoice.pdf" } : {}),
      }),
    });
  } catch (e) { console.error("sendEmail error:", e); }
}

async function sendRefundNotifications(supabase: any, payment: any, refundRef: string) {
  try {
    const { data: senderUser } = await supabase
      .from("users")
      .select("first_name, last_name, email, mobile_number")
      .eq("id", payment.user_id)
      .maybeSingle();

    const bene = payment.beneficiary_details || {};
    const senderName = senderUser ? `${senderUser.first_name} ${senderUser.last_name}`.trim() : "Customer";
    const receiverName = bene.full_name || "Beneficiary";
    const txDate = new Date(payment.created_at).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
    });

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

    const refundDate = payout?.refunded_at
      ? new Date(payout.refunded_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
      : new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

    const rows: [string, string][] = [
      ["Transaction Reference", payment.payment_reference],
      ["Refund Reference", refundRef],
      ["Date", txDate],
      ["Refund Amount", fmt(payment.amount)],
      ["Reason", "KYC verification not completed within the required time"],
    ];
    const table = receiptTable(rows);

    // Generate refund invoice PDF
    const pdfBase64 = await generateInvoicePdf({
      payment_reference: payment.payment_reference,
      date: txDate,
      sender_name: senderName,
      receiver_name: receiverName,
      receiver_bank: bene.bank_name || "",
      receiver_account: bene.bank_account || "",
      receiver_ifsc: bene.ifsc || "",
      receiver_pan: receiverPan || undefined,
      category_name: payment.category_details?.category_name || payment.selected_payment_option?.card_type || "Payment",
      amount: payment.amount,
      charges: payment.charges || 0,
      gst: payment.gst || 0,
      total_amount: payment.total_amount || payment.amount,
      gateway_ref: refundRef,
      payout_status: payout?.status || "refunded",
      payout_reference: payout?.payout_reference || refundRef,
      refund_date: refundDate,
      status: "Refunded",
      invoice_type: "refund",
      business_kyc_verified: businessKycVerified,
      company_name: businessKycVerified ? (bizKyc?.business_name || undefined) : undefined,
      company_pan: businessKycVerified ? (bizKyc?.business_pan || undefined) : undefined,
      company_gst: businessKycVerified ? (bizKyc?.gst_number || undefined) : undefined,
      sender_pan: !businessKycVerified ? (senderPan || undefined) : undefined,
    });

    const invoiceFilename = `refund-invoice-${payment.payment_reference}.html`;

    if (senderUser?.email) {
      await sendEmail(
        senderUser.email,
        `Refund Processed – Ref: ${payment.payment_reference}`,
        `<p>Dear ${senderName},</p>
         <p>Your payment could not be settled as the beneficiary did not complete KYC verification within the required time. The base amount has been refunded to your source account.</p>
         ${table}
         <p style="color:#6b7280;font-size:13px;">Refund invoice is attached. Refunds typically reflect within 5–7 business days. Contact support for queries.</p>`,
        pdfBase64,
        invoiceFilename,
      );
    }

    if (bene.email) {
      await sendEmail(
        bene.email,
        `Payment Cancelled – KYC Not Completed – Ref: ${payment.payment_reference}`,
        `<p>Dear ${receiverName},</p>
         <p>The payment intended for your account has been cancelled and refunded to the sender because KYC verification was not completed in time.</p>
         ${table}
         <p style="color:#6b7280;font-size:13px;">Refund invoice is attached. To receive future payments, please complete your KYC at the earliest.</p>`,
        pdfBase64,
        invoiceFilename,
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
    console.error("sendRefundNotifications error:", e);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startedAt = Date.now();
  const results: { id: string; reference: string; action: string; error?: string }[] = [];

  try {
    const supabase = createClient(SUPABASE_URL(), SERVICE_ROLE_KEY());

    // Fetch only kyc_pending payments.
    // We only target kyc_pending — where the merchant has not submitted KYC at all.
    // merchant_kyc_review (manually submitted, awaiting admin approval) must NOT be auto-refunded.
    // Category config is read from the snapshotted category_details JSONB — NOT from a live join —
    // because admin may change category settings after the payment was created.
    const { data: candidates, error: fetchErr } = await supabase
      .from("payments")
      .select("*, payment_gateway_settings(*)")
      .eq("status", "kyc_pending")
      .order("created_at", { ascending: true })
      .limit(100);

    if (fetchErr) throw new Error(`Fetch failed: ${fetchErr.message}`);
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No kyc_pending payments", processed: 0, durationMs: Date.now() - startedAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = Date.now();

    for (const payment of candidates) {
      // Use the snapshotted category_details — avoids stale reads when category config changes
      const category = payment.category_details;

      // Skip if snapshot indicates category doesn't require KYC or has no refund timeout
      if (!category?.receiver_kyc_required || !category?.refund_after_hours) {
        continue;
      }

      const refundAfterMs = category.refund_after_hours * 60 * 60 * 1000;
      const ageMs = now - new Date(payment.created_at).getTime();

      // Not yet past the timeout window
      if (ageMs < refundAfterMs) continue;

      // Only refund when merchant has taken NO action on the onboarding link.
      // If status is 'submitted' (manual PAN upload) or 'verified' (DigiLocker completed),
      // the merchant has acted — do not auto-refund.
      const { data: onboarding } = await supabase
        .from("merchant_onboarding")
        .select("status")
        .eq("payment_id", payment.id)
        .maybeSingle();

      if (onboarding && onboarding.status !== "pending" && onboarding.status !== "rejected") {
        // Merchant submitted and is under review, or already verified — skip auto-refund.
        // "rejected" means admin rejected and beneficiary was told to re-submit —
        // only auto-refund if the timeline has passed (checked below).
        continue;
      }

      // ── Pessimistic lock: claim payment before refund ─────────────────────────
      // Prevents two concurrent cron executions from both passing the checks
      // above and then both calling the gateway refund API → double refund.
      // fn_try_claim_for_refund does an atomic UPDATE; only one winner per payment.
      const { data: refundClaimed, error: refundClaimErr } = await supabase
        .rpc("fn_try_claim_for_refund", { p_payment_id: payment.id });

      if (refundClaimErr || !refundClaimed) {
        results.push({
          id: payment.id,
          reference: payment.payment_reference,
          action: "skipped",
          error: "Refund lock held by concurrent process",
        });
        continue;
      }

      const gateway = payment.payment_gateway_settings;
      const refundRef = `RFND-${payment.payment_reference}`;

      try {
        // 1. Check gateway balance — only when payment is already settled at the gateway.
        // If not settled, money is still in gateway escrow and refund goes back to source
        // without requiring balance in the merchant wallet.
        const isTestEnv = payment.gateway_environment === "test";
        const isSettled = SETTLED_STATUSES.has(payment.gateway_settlement_status);
        const isPaymentSplit = gateway?.payout_mode === "payment_split";
        if (gateway && isSettled && !isPaymentSplit) {
          const balanceCheck = await hasEnoughBalance(gateway, isTestEnv, parseFloat(String(payment.amount)));
          if (!balanceCheck.sufficient) {
            await supabase.from("payment_logs").insert({
              payment_id: payment.id,
              status: "refund_skipped",
              message: `Auto-refund skipped: insufficient balance in ${gateway.gateway_name} ${isTestEnv ? "test" : "production"} account. Available: ₹${balanceCheck.balance?.toFixed(2)}, Required: ₹${parseFloat(String(payment.amount)).toFixed(2)}.`,
              metadata: { available_balance: balanceCheck.balance, required_amount: payment.amount, gateway: gateway.gateway_name },
            });
            results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped_insufficient_balance" });
            continue;
          }
        }

        // 2. Call the gateway refund API
        let gatewayRefundResult: { success: boolean; refund_id: string | null; gateway_response: any };

        if (!gateway) {
          // No gateway record — mark refunded manually (record-only refund)
          gatewayRefundResult = {
            success: true,
            refund_id: null,
            gateway_response: { note: "No gateway record; refund recorded manually." },
          };
        } else {
          gatewayRefundResult = await initiateGatewayRefund(payment, gateway);
        }

        if (!gatewayRefundResult.success) {
          // Gateway rejected the refund — log and skip, will retry next cycle
          await supabase.from("payment_logs").insert({
            payment_id: payment.id,
            status: "refund_failed",
            message: `Auto-refund attempt failed at gateway: ${JSON.stringify(gatewayRefundResult.gateway_response)}`,
            metadata: gatewayRefundResult.gateway_response,
          });
          results.push({ id: payment.id, reference: payment.payment_reference, action: "refund_gateway_failed", error: JSON.stringify(gatewayRefundResult.gateway_response) });
          continue;
        }

        // 3. Mark payment as refunded
        await supabase.from("payments").update({
          status: "refunded",
          updated_at: new Date().toISOString(),
          gateway_response: gatewayRefundResult.gateway_response,
        }).eq("id", payment.id);

        // Mark the linked merchant_onboarding record as rejected (KYC not completed)
        await supabase
          .from("merchant_onboarding")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("payment_id", payment.id)
          .in("status", ["pending", "submitted", "expired", "rejected"]);

        // 4. Insert refund record in payouts table
        const payoutRef = refundRef;
        const bene = payment.beneficiary_details || {};

        await supabase.from("payouts").insert({
          user_id: payment.user_id,
          beneficiary_id: payment.beneficiary_id,
          payment_id: payment.id,
          payment_gateway_id: payment.payment_gateway_id,
          amount: payment.amount,
          charges: 0,
          gst: 0,
          total_deduction: 0,
          net_amount: payment.amount,
          payout_reference: payoutRef,
          transfer_type: "IMPS",
          account_number: bene.bank_account || "",
          ifsc_code: bene.ifsc || "",
          account_holder_name: bene.full_name || "",
          bank_name: bene.bank_name || "",
          status: "refunded",
          gateway_transaction_id: gatewayRefundResult.refund_id,
          gateway_response: gatewayRefundResult.gateway_response,
          gateway_environment: payment.gateway_environment,
          payout_type: "auto",
          refund_reason: `KYC not completed within ${category.refund_after_hours}h. Auto-refund via ${gateway?.gateway_name ?? "system"}.`,
          refunded_at: new Date().toISOString(),
          ip_address: "system",
        });

        // 5. Log the action
        await supabase.from("payment_logs").insert({
          payment_id: payment.id,
          status: "refunded",
          message: `Auto-refund initiated. KYC deadline (${category.refund_after_hours}h) exceeded. Gateway refund ref: ${gatewayRefundResult.refund_id ?? "N/A"}. Payout ref: ${payoutRef}.`,
          metadata: {
            refund_reference: payoutRef,
            refund_amount: payment.amount,
            gateway_refund_id: gatewayRefundResult.refund_id,
            gateway_response: gatewayRefundResult.gateway_response,
            category_name: category.category_name,
            refund_after_hours: category.refund_after_hours,
          },
        });

        // 6. Send notifications asynchronously
        EdgeRuntime.waitUntil(sendRefundNotifications(supabase, payment, payoutRef));

        results.push({ id: payment.id, reference: payment.payment_reference, action: "refunded" });
      } catch (err: any) {
        console.error(`Error processing refund for ${payment.payment_reference}:`, err);
        results.push({ id: payment.id, reference: payment.payment_reference, action: "error", error: err?.message });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results, durationMs: Date.now() - startedAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("auto-refund-kyc-expired fatal error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
