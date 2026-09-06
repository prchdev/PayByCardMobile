import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = () => Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Settlement status set ────────────────────────────────────────────────────
// When gateway_settlement_status is one of these, money has moved to merchant
// wallet — a balance check is required before refunding.
const SETTLED_STATUSES = new Set(["settled", "paid", "captured"]);

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
    return { canProcess: true, balance: null, error: e?.message };
  }
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
  const base = "https://api.razorpay.com/v1";
  let txnId = payment.gateway_transaction_id;

  if (!txnId) {
    return { success: false, refund_id: null, gateway_response: { error: "No gateway_transaction_id — Razorpay refund requires a captured payment ID (pay_xxx)" } };
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
  const success = res.ok && data.id != null && data.entity === "refund";
  return { success, refund_id: data.id ?? null, gateway_response: data };
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
  const validStatuses = ["SUCCESS", "PENDING", "ONHOLD"];
  const success = res.ok && validStatuses.includes(data.refund_status);
  return { success, refund_id: data.cf_refund_id ?? (success ? refundId : null), gateway_response: data };
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
    return { success: false, refund_id: null, gateway_response: { error: "No gateway_transaction_id — PayU refund requires mihpayid" } };
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
  return { success: data.status === 1 || data.msg?.toLowerCase().includes("success"), refund_id: data.refund_id ?? null, gateway_response: data };
}

async function refundEaseBuzz(
  payment: any,
  gateway: any,
  isTest: boolean,
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
    body: JSON.stringify({ key: merchantKey, txnid: txnId, amount: parseFloat(String(payment.amount)).toFixed(2), hash }),
  });
  const data = await res.json();
  return { success: data.status === "success" || data.status === 1, refund_id: data.data?.refund_id ?? null, gateway_response: data };
}

async function callGatewayRefundApi(
  payment: any,
  gateway: any,
): Promise<{ success: boolean; skipped?: boolean; refund_id: string | null; gateway_response: any }> {
  const isTest = payment.gateway_environment === "test";
  const gatewayName = (gateway.gateway_name ?? "").toLowerCase();

  switch (gatewayName) {
    case "razorpay": return refundRazorPay(payment, gateway, isTest);
    case "cashfree":  return refundCashFree(payment, gateway, isTest);
    case "payu":      return refundPayU(payment, gateway, isTest);
    case "easebuzz":  return refundEaseBuzz(payment, gateway, isTest);
    default:
      // Unsupported gateway — allow DB-only refund
      return { success: true, skipped: true, refund_id: null, gateway_response: { note: `Gateway ${gateway.gateway_name} does not support API refunds. DB-only update.` } };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateInvoicePdf(paymentId: string, invoiceType: "settlement" | "refund"): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL()}/functions/v1/generate-invoice-html`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payment_id: paymentId, invoice_type: invoiceType }),
    });
    const data = await res.json();
    return data.html_base64 ?? null;
  } catch (err) {
    console.error("Invoice generation error:", err);
    return null;
  }
}

async function sendSettledSms(
  supabase: any,
  payment: any,
  confirmedAmount: number | string,
) {
  try {
    const { data: senderUser } = await supabase
      .from("users")
      .select("mobile_number, first_name, last_name")
      .eq("id", payment.user_id)
      .maybeSingle();
    const mobile = senderUser?.mobile_number;
    if (!mobile) return;
    const senderName = senderUser
      ? `${senderUser.first_name || ""} ${senderUser.last_name || ""}`.trim()
      : "Customer";
    const categoryName =
      payment.category_details?.category_name ||
      payment.selected_payment_option?.card_type ||
      "Payment";
    const beneficiaryDetails = payment.beneficiary_details || payment.beneficiaries || {};
    const beneficiaryName = beneficiaryDetails.full_name || "Beneficiary";
    await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mobile,
        message: "",
        message_type: "payment_settled",
        variables: {
          var1: categoryName,
          var2: parseFloat(String(confirmedAmount)).toFixed(2),
          var3: senderName,
          var4: beneficiaryName,
        },
      }),
    });
  } catch (_) {}
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
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to, subject, body, body_type: "html", use_template: true,
        ...(attachmentBase64 ? {
          attachment_base64: attachmentBase64,
          attachment_filename: attachmentFilename || "invoice.pdf",
          attachment_content_type: "text/html",
        } : {}),
      }),
    });
  } catch (_) {}
}

function fmt(amount: number | string): string {
  return `₹${parseFloat(String(amount)).toFixed(2)}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const {
      adminId,
      payoutId,
      paymentId,
      action,
      payout_date,
      payout_reference_number,
      payout_confirmed_amount,
      refund_reason,
      is_payment_record,
    } = await req.json();

    if (!adminId || !action) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["confirm", "refund"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Resolve the actual payment record
    let payment: any = null;
    let existingPayoutId: string | null = null;

    if (is_payment_record && paymentId) {
      const { data: p } = await supabase
        .from("payments")
        .select("*, payment_gateway_settings(*), beneficiaries(*)")
        .eq("id", paymentId)
        .maybeSingle();
      payment = p;
    } else if (payoutId) {
      const { data: payout } = await supabase
        .from("payouts")
        .select("*, payments(*)")
        .eq("id", payoutId)
        .maybeSingle();

      if (!payout) {
        return new Response(
          JSON.stringify({ error: "Payout not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      existingPayoutId = payout.id;

      if (payout.payment_id) {
        const { data: p } = await supabase
          .from("payments")
          .select("*, payment_gateway_settings(*), beneficiaries(*)")
          .eq("id", payout.payment_id)
          .maybeSingle();
        payment = p;
      }
    }

    if (!payment) {
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
    const newPayoutRef = `POUT-${dateStr}-${rand}`;

    if (action === "confirm") {
      if (!payout_date || !payout_reference_number || !payout_confirmed_amount) {
        return new Response(
          JSON.stringify({ error: "Payout date, reference number, and amount are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (existingPayoutId) {
        await supabase
          .from("payouts")
          .update({
            status: "completed",
            payout_date,
            payout_reference_number,
            payout_confirmed_amount: Number(payout_confirmed_amount),
            payout_confirmed_by: adminId,
            payout_confirmed_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            utr_number: payout_reference_number,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingPayoutId);
      } else {
        const beneficiary = payment.beneficiaries;
        await supabase.from("payouts").insert({
          user_id: payment.user_id,
          payment_id: payment.id,
          beneficiary_id: payment.beneficiary_id,
          payment_gateway_id: payment.payment_gateway_id,
          amount: payment.amount,
          charges: 0,
          gst: 0,
          total_deduction: 0,
          net_amount: payment.amount,
          payout_reference: newPayoutRef,
          transfer_type: "IMPS",
          account_number: beneficiary?.bank_account || "",
          ifsc_code: beneficiary?.ifsc || "",
          account_holder_name: beneficiary?.full_name || "",
          bank_name: beneficiary?.bank_name || "",
          gateway_environment: payment.gateway_environment,
          status: "completed",
          payout_date,
          payout_reference_number,
          payout_confirmed_amount: Number(payout_confirmed_amount),
          payout_confirmed_by: adminId,
          payout_confirmed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          utr_number: payout_reference_number,
          ip_address: "admin",
        });
      }

      await supabase
        .from("payments")
        .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", payment.id);

      await supabase.from("payment_logs").insert({
        payment_id: payment.id,
        status: "completed",
        message: `Manual payout confirmed by admin. UTR: ${payout_reference_number}, Amount: ${payout_confirmed_amount}`,
        metadata: { admin_id: adminId, payout_date, payout_reference_number, payout_confirmed_amount },
      });

      EdgeRuntime.waitUntil((async () => {
        const [senderRes, beneficiaryDetails] = await Promise.all([
          supabase.from("users").select("first_name, last_name, email").eq("id", payment.user_id).maybeSingle(),
          Promise.resolve(payment.beneficiary_details || payment.beneficiaries || {}),
        ]);
        const senderName = senderRes.data ? `${senderRes.data.first_name} ${senderRes.data.last_name}`.trim() : "Customer";
        const senderEmail = senderRes.data?.email;
        const receiverName = beneficiaryDetails?.full_name || "Beneficiary";
        const receiverEmail = beneficiaryDetails?.email;

        const invoiceBase64 = await generateInvoicePdf(payment.id, "settlement");
        const invoiceFilename = `invoice-${payment.payment_reference || "txn"}.html`;

        const receiptRows = `
          <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin:16px 0;">
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Transaction Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payment.payment_reference}</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Amount Transferred</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${fmt(payout_confirmed_amount)}</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Payout Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payout_reference_number}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:14px;">Payout Date</td><td style="padding:8px 12px;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payout_date}</td></tr>
          </table>`;

        if (senderEmail) {
          await sendEmail(
            senderEmail,
            `Transaction Completed – Ref: ${payment.payment_reference}`,
            `<p>Dear ${senderName},</p><p>Your payment has been completed and funds have been transferred to the beneficiary.</p>${receiptRows}${invoiceBase64 ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Invoice copy is attached to this email.</p>` : ""}<p style="color:#6b7280;font-size:13px;">Contact support for any queries.</p>`,
            invoiceBase64,
            invoiceFilename,
          );
        }
        if (receiverEmail) {
          await sendEmail(
            receiverEmail,
            `Payment Received – Ref: ${payment.payment_reference}`,
            `<p>Dear ${receiverName},</p><p>The payment to your bank account has been completed successfully.</p>${receiptRows}<p><strong>Sent by:</strong> ${senderName}</p>${invoiceBase64 ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Invoice copy is attached to this email.</p>` : ""}<p style="color:#6b7280;font-size:13px;">Contact support if you have any concerns.</p>`,
            invoiceBase64,
            invoiceFilename,
          );
        }
        await sendSettledSms(supabase, payment, payout_confirmed_amount);
      })());

      return new Response(
        JSON.stringify({ success: true, message: "Payout confirmed successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "refund") {
      const reason = refund_reason || "Refunded by admin";
      const gateway = payment.payment_gateway_settings;
      const refundAmount = parseFloat(String(payment.amount));
      const isTest = payment.gateway_environment === "test";

      // Balance check: only required when payment has already been settled at the gateway
      if (gateway && SETTLED_STATUSES.has(payment.gateway_settlement_status)) {
        const balanceCheck = await checkGatewayBalance(gateway, isTest, refundAmount);
        if (!balanceCheck.canProcess) {
          return new Response(
            JSON.stringify({
              error: `Insufficient balance in ${gateway.gateway_name} ${isTest ? "test" : "production"} account. Available: ${fmt(balanceCheck.balance!)}, Required: ${fmt(refundAmount)}. Top up your ${gateway.gateway_name} refund wallet before processing.`,
              insufficient_balance: true,
              available_balance: balanceCheck.balance,
              required_amount: refundAmount,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Call gateway refund API first — only update DB if it succeeds
      let gatewayRefundResult: { success: boolean; skipped?: boolean; refund_id: string | null; gateway_response: any };
      if (gateway) {
        gatewayRefundResult = await callGatewayRefundApi(payment, gateway);
        if (!gatewayRefundResult.success) {
          await supabase.from("payment_logs").insert({
            payment_id: payment.id,
            status: "refund_failed",
            message: `Manual payout refund failed at gateway (${gateway.gateway_name}): ${JSON.stringify(gatewayRefundResult.gateway_response)}`,
            metadata: { admin_id: adminId, refund_reason: reason, gateway_response: gatewayRefundResult.gateway_response },
          });
          return new Response(
            JSON.stringify({
              error: `Gateway refund failed: ${gatewayRefundResult.gateway_response?.error ?? JSON.stringify(gatewayRefundResult.gateway_response)}`,
              gateway_response: gatewayRefundResult.gateway_response,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        gatewayRefundResult = { success: true, skipped: true, refund_id: null, gateway_response: { note: "No gateway record. DB-only refund." } };
      }

      // Gateway confirmed (or skipped for unsupported) — update DB
      if (existingPayoutId) {
        await supabase
          .from("payouts")
          .update({
            status: "refunded",
            refund_reason: reason,
            refunded_by: adminId,
            refunded_at: new Date().toISOString(),
            gateway_transaction_id: gatewayRefundResult.refund_id,
            gateway_response: gatewayRefundResult.gateway_response,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingPayoutId);
      }

      await supabase
        .from("payments")
        .update({ status: "refunded", updated_at: new Date().toISOString() })
        .eq("id", payment.id);

      await supabase.from("payment_logs").insert({
        payment_id: payment.id,
        status: "refunded",
        message: `Payout refunded by admin${gatewayRefundResult.skipped ? " (DB-only, gateway not supported)" : ` via ${gateway?.gateway_name}. Refund ID: ${gatewayRefundResult.refund_id ?? "N/A"}`}. Reason: ${reason}`,
        metadata: { admin_id: adminId, refund_reason: reason, refund_id: gatewayRefundResult.refund_id, gateway_response: gatewayRefundResult.gateway_response },
      });

      EdgeRuntime.waitUntil((async () => {
        const { data: senderRes } = await supabase
          .from("users")
          .select("first_name, last_name, email")
          .eq("id", payment.user_id)
          .maybeSingle();
        const senderName = senderRes ? `${senderRes.first_name} ${senderRes.last_name}`.trim() : "Customer";
        const senderEmail = senderRes?.email;

        const invoiceBase64 = await generateInvoicePdf(payment.id, "refund");
        const invoiceFilename = `invoice-${payment.payment_reference || "txn"}.html`;

        const refundTable = `
          <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin:16px 0;">
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Transaction Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payment.payment_reference}</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Refund Amount</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${fmt(payment.amount)}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:14px;">Reason</td><td style="padding:8px 12px;font-weight:600;color:#111827;font-size:14px;text-align:right;">${reason}</td></tr>
          </table>`;

        if (senderEmail) {
          await sendEmail(
            senderEmail,
            `Refund Processed – Ref: ${payment.payment_reference}`,
            `<p>Dear ${senderName},</p><p>The payment has been refunded. The amount will be returned to your source account.</p>${refundTable}${invoiceBase64 ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Refund invoice is attached to this email.</p>` : ""}<p style="color:#6b7280;font-size:13px;">Contact support for any queries.</p>`,
            invoiceBase64,
            invoiceFilename,
          );
        }
      })());

      return new Response(
        JSON.stringify({ success: true, message: "Payout refunded successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
