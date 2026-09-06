import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Gateway balance checkers ─────────────────────────────────────────────────

async function checkRazorPayBalance(
  gateway: any,
  isTest: boolean
): Promise<{ canProcess: boolean; balance: number | null; error?: string }> {
  const keyId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const keySecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  if (!keyId || !keySecret) return { canProcess: true, balance: null };

  try {
    const auth = btoa(`${keyId}:${keySecret}`);
    const res = await fetch("https://api.razorpay.com/v1/balance", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return { canProcess: true, balance: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    // balance is in paise
    const balanceRupees = (data.balance ?? 0) / 100;
    return { canProcess: true, balance: balanceRupees };
  } catch (e: any) {
    // If balance check fails, don't block the refund
    return { canProcess: true, balance: null, error: e?.message };
  }
}

async function checkCashFreeBalance(
  gateway: any,
  isTest: boolean
): Promise<{ canProcess: boolean; balance: number | null; error?: string }> {
  const clientId = isTest ? gateway.test_api_key : gateway.production_api_key;
  const clientSecret = isTest ? gateway.test_api_secret : gateway.production_api_secret;
  if (!clientId || !clientSecret) return { canProcess: true, balance: null };

  const base = isTest ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
  try {
    const res = await fetch(`${base}/api/v1/merchant/wallet/balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: clientId, secretKey: clientSecret }),
    });
    if (!res.ok) return { canProcess: true, balance: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    const balance = parseFloat(data.data?.balance ?? data.balance ?? "0");
    return { canProcess: true, balance };
  } catch (e: any) {
    return { canProcess: true, balance: null, error: e?.message };
  }
}

async function checkGatewayBalance(
  gateway: any,
  isTest: boolean,
  requiredAmount: number
): Promise<{ canProcess: boolean; balance: number | null; gatewayName: string }> {
  const name = (gateway.gateway_name ?? "").toLowerCase();

  let result: { canProcess: boolean; balance: number | null; error?: string };

  if (name === "razorpay") {
    result = await checkRazorPayBalance(gateway, isTest);
  } else if (name === "cashfree") {
    result = await checkCashFreeBalance(gateway, isTest);
  } else {
    // For other gateways balance check is not supported — allow by default
    return { canProcess: true, balance: null, gatewayName: name };
  }

  // If we got a real balance figure, enforce the check
  if (result.balance !== null && result.balance < requiredAmount) {
    return { canProcess: false, balance: result.balance, gatewayName: name };
  }

  return { canProcess: true, balance: result.balance, gatewayName: name };
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, body: string) {
  try {
    await fetch(`${SUPABASE_URL()}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, subject, body, body_type: "html", use_template: true }),
    });
  } catch (_) {}
}

async function sendSms(mobile: string, variables: Record<string, string>) {
  try {
    await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mobile, message: "", message_type: "payment_refund", variables }),
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
      onboardingId,
      paymentId,
      is_payment_record,
      refund_reference,
      refund_amount,
      refund_date,
    } = await req.json();

    if (!adminId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!refund_reference || !refund_amount || !refund_date) {
      return new Response(
        JSON.stringify({ error: "Refund reference, amount, and date are required" }),
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

    let resolvedPaymentId: string | null = null;

    if (is_payment_record && paymentId) {
      resolvedPaymentId = paymentId;
    } else if (onboardingId) {
      const { data: record } = await supabase
        .from("merchant_onboarding")
        .select("*")
        .eq("id", onboardingId)
        .maybeSingle();

      if (!record) {
        return new Response(
          JSON.stringify({ error: "Record not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      resolvedPaymentId = record.payment_id || null;
    } else {
      return new Response(
        JSON.stringify({ error: "Either paymentId or onboardingId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (resolvedPaymentId) {
      // ── Pessimistic lock: claim payment before any refund work ─────────────
      // Prevents simultaneous refund + auto-payout on the same payment.
      // fn_try_claim_for_refund does an atomic UPDATE with a 5-minute lock window.
      const { data: lockGranted, error: lockErr } = await supabase
        .rpc("fn_try_claim_for_refund", { p_payment_id: resolvedPaymentId });

      if (lockErr || !lockGranted) {
        return new Response(
          JSON.stringify({
            error: "Payment is currently being processed by another operation. Please try again in a few minutes.",
            code: "PAYMENT_LOCKED",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: payment } = await supabase
        .from("payments")
        .select("*")
        .eq("id", resolvedPaymentId)
        .maybeSingle();

      // ── Balance check ──────────────────────────────────────────────────────
      if (payment?.payment_gateway_id) {
        const { data: gateway } = await supabase
          .from("payment_gateway_settings")
          .select("*")
          .eq("id", payment.payment_gateway_id)
          .maybeSingle();

        if (gateway) {
          const isTest = payment.gateway_environment === "test";
          const requiredAmount = parseFloat(String(refund_amount));
          const balanceCheck = await checkGatewayBalance(gateway, isTest, requiredAmount);

          if (!balanceCheck.canProcess) {
            return new Response(
              JSON.stringify({
                error: `Insufficient balance in ${gateway.gateway_name} ${isTest ? "test" : "production"} account. Available: ${fmt(balanceCheck.balance!)}, Required: ${fmt(requiredAmount)}. Refund not processed.`,
                insufficient_balance: true,
                available_balance: balanceCheck.balance,
                required_amount: requiredAmount,
              }),
              { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      await supabase
        .from("payments")
        .update({ status: "refunded", updated_at: new Date().toISOString() })
        .eq("id", resolvedPaymentId);

      // Mark the linked merchant_onboarding record as rejected (KYC not completed)
      await supabase
        .from("merchant_onboarding")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("payment_id", resolvedPaymentId)
        .in("status", ["pending", "submitted", "expired"]);

      // Also mark a directly-passed onboardingId record
      if (onboardingId) {
        await supabase
          .from("merchant_onboarding")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("id", onboardingId);
      }

      const { data: existingPayout } = await supabase
        .from("payouts")
        .select("id")
        .eq("payment_id", resolvedPaymentId)
        .maybeSingle();

      if (existingPayout) {
        await supabase
          .from("payouts")
          .update({
            status: "refunded",
            refund_reason: `KYC expired. Refund ref: ${refund_reference}`,
            refunded_by: adminId,
            refunded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingPayout.id);
      }

      await supabase.from("payment_logs").insert({
        payment_id: resolvedPaymentId,
        status: "refunded",
        message: `Refund processed by admin. Ref: ${refund_reference}, Amount: ${refund_amount}, Date: ${refund_date}`,
        metadata: { refund_reference, refund_amount, refund_date, admin_id: adminId },
      });

      // Record in refund_transactions for audit trail
      await supabase.from("refund_transactions").insert({
        payment_id: resolvedPaymentId,
        payout_id: existingPayout?.id ?? null,
        admin_id: adminId,
        gateway_id: payment?.payment_gateway_id ?? null,
        gateway_name: null,
        refund_reference,
        gateway_refund_id: null,
        gateway_response: null,
        amount: parseFloat(String(refund_amount)),
        status: "processed",
        refund_type: "manual",
        payout_mode: null,
        gateway_settlement_status: payment?.gateway_settlement_status ?? null,
        initiated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {});

      EdgeRuntime.waitUntil((async () => {
        if (!payment) return;
        const beneficiaryDetails = payment.beneficiary_details || {};
        const { data: senderUser } = await supabase
          .from("users")
          .select("first_name, last_name, email, mobile_number")
          .eq("id", payment.user_id)
          .maybeSingle();

        const senderName = senderUser
          ? `${senderUser.first_name} ${senderUser.last_name}`.trim()
          : "Customer";
        const senderEmail = senderUser?.email;
        const senderMobile = senderUser?.mobile_number;
        const receiverName = beneficiaryDetails.full_name || "Beneficiary";
        const receiverEmail = beneficiaryDetails.email;

        const receiptRows = `
          <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin:16px 0;">
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Transaction Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payment.payment_reference}</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Refund Amount</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${fmt(refund_amount)}</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Refund Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${refund_reference}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b7280;font-size:14px;">Refund Date</td><td style="padding:8px 12px;font-weight:600;color:#111827;font-size:14px;text-align:right;">${refund_date}</td></tr>
          </table>`;

        if (senderEmail) {
          await sendEmail(
            senderEmail,
            `Refund Processed – Ref: ${payment.payment_reference}`,
            `<p>Dear ${senderName},</p><p>The payment has been refunded. The amount will be returned to your source account within a few business days.</p>${receiptRows}<p style="color:#6b7280;font-size:13px;">Contact support for any queries.</p>`
          );
        }
        if (receiverEmail) {
          await sendEmail(
            receiverEmail,
            `Payment Cancelled – KYC Not Completed – Ref: ${payment.payment_reference}`,
            `<p>Dear ${receiverName},</p><p>The payment to your account has been cancelled as KYC verification was not completed in time. The amount has been refunded to the sender.</p>${receiptRows}`
          );
        }

        if (senderMobile) {
          await sendSms(senderMobile, {
            var1: parseFloat(String(refund_amount)).toFixed(2),
            var2: payment.payment_reference,
          });
        }
      })());
    }

    return new Response(
      JSON.stringify({ success: true, message: "Refund processed successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
