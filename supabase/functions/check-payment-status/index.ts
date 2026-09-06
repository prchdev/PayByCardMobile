import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function checkCashFreeStatus(payment: any, gateway: any, isTestMode: boolean) {
  const apiUrl = isTestMode
    ? "https://sandbox.cashfree.com/pg/orders"
    : "https://api.cashfree.com/pg/orders";

  const clientId = isTestMode ? gateway.test_api_key : gateway.production_api_key;
  const clientSecret = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

  const response = await fetch(`${apiUrl}/${payment.payment_reference}`, {
    method: "GET",
    headers: {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": "2023-08-01",
    },
  });

  const result = await response.json();
  const status = result.order_status === "PAID" ? "completed"
    : result.order_status === "ACTIVE" ? "processing"
    : "failed";

  return { status, transaction_id: result.cf_order_id, gateway_response: result };
}

async function checkRazorPayStatus(payment: any, gateway: any, isTestMode: boolean) {
  const baseUrl = "https://api.razorpay.com/v1";
  const keyId = isTestMode ? gateway.test_api_key : gateway.production_api_key;
  const keySecret = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;
  const authString = btoa(`${keyId}:${keySecret}`);

  // If we have a gateway order id, check order payments
  if (payment.gateway_transaction_id) {
    const response = await fetch(`${baseUrl}/payments/${payment.gateway_transaction_id}`, {
      method: "GET",
      headers: { "Authorization": `Basic ${authString}` },
    });
    const result = await response.json();
    const status = result.status === "captured" ? "completed"
      : result.status === "authorized" ? "processing"
      : result.status === "failed" ? "failed"
      : "pending";
    return { status, transaction_id: result.id, gateway_response: result };
  }

  // Try to find payment by order reference
  const response = await fetch(
    `${baseUrl}/payments?count=10&notes[payment_reference]=${payment.payment_reference}`,
    {
      method: "GET",
      headers: { "Authorization": `Basic ${authString}` },
    }
  );
  const result = await response.json();
  const items = result.items || [];

  if (items.length > 0) {
    const latest = items[0];
    const status = latest.status === "captured" ? "completed"
      : latest.status === "authorized" ? "processing"
      : latest.status === "failed" ? "failed"
      : "pending";
    return { status, transaction_id: latest.id, gateway_response: latest };
  }

  return { status: "pending", transaction_id: null, gateway_response: {} };
}

async function checkPayUStatus(payment: any, gateway: any, isTestMode: boolean) {
  const baseUrl = isTestMode ? "https://test.payu.in" : "https://info.payu.in";
  const merchantKey = isTestMode ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

  const command = "verify_payment";
  const encoder = new TextEncoder();
  const hashData = encoder.encode(`${merchantKey}|${command}|${payment.payment_reference}${salt}`);
  const hashBuffer = await crypto.subtle.digest("SHA-512", hashData);
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

  const formBody = new URLSearchParams({
    key: merchantKey,
    command,
    var1: payment.payment_reference,
    hash,
  });

  const response = await fetch(`${baseUrl}/merchant/postservice.php?form=2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  const result = await response.json();
  const txnDetails = result.transaction_details?.[payment.payment_reference];
  const status = txnDetails?.status === "success" ? "completed"
    : txnDetails?.status === "pending" ? "processing"
    : "failed";

  return { status, transaction_id: txnDetails?.mihpayid, gateway_response: result };
}

async function checkEaseBuzzStatus(payment: any, gateway: any, isTestMode: boolean) {
  const baseUrl = isTestMode
    ? "https://testdashboard.easebuzz.in"
    : "https://dashboard.easebuzz.in";

  const merchantKey = isTestMode ? gateway.test_api_key : gateway.production_api_key;
  const salt = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

  const userEmail = payment.beneficiary_details?.email || "customer@example.com";
  const encoder = new TextEncoder();
  const hashData = encoder.encode(`${merchantKey}|${payment.payment_reference}|${userEmail}${salt}`);
  const hashBuffer = await crypto.subtle.digest("SHA-512", hashData);
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

  const response = await fetch(`${baseUrl}/transaction/v1/retrieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: merchantKey,
      txnid: payment.payment_reference,
      email: userEmail,
      hash,
    }),
  });

  const result = await response.json();
  const status = result.status === "success" ? "completed"
    : result.status === "pending" ? "processing"
    : "failed";

  return { status, transaction_id: result.easepayid, gateway_response: result };
}

async function checkPhonePeStatus(payment: any, gateway: any, isTestMode: boolean) {
  const merchantId = isTestMode ? gateway.test_api_key : gateway.production_api_key;
  const saltKey = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

  if (!merchantId || !saltKey) {
    return { status: "pending", transaction_id: null, gateway_response: { error: "PhonePe credentials not configured" } };
  }

  const baseUrl = isTestMode
    ? "https://api-preprod.phonepe.com/apis/hermes"
    : "https://api.phonepe.com/apis/hermes";

  const apiEndpoint = `/pg/v1/status/${merchantId}/${payment.payment_reference}`;
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
    return { status: "pending", transaction_id: null, gateway_response: result };
  }

  const state = (result.data?.state || result.data?.state || "").toUpperCase();
  const status = state === "PAYMENT_SUCCESS" || state === "COMPLETED" ? "completed"
    : state === "PAYMENT_ERROR" || state === "FAILED" || state === "PAYMENT_DECLINED" ? "failed"
    : state === "PENDING" || state === "PAYMENT_INITIATED" ? "processing"
    : "pending";

  return {
    status,
    transaction_id: result.data?.transactionId || result.data?.providerReferenceId || null,
    gateway_response: result,
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

    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const paymentId = body.paymentId || url.searchParams.get("payment_id");
    const userId = body.userId;

    if (!paymentId) {
      return new Response(
        JSON.stringify({ error: "Payment ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const query = supabase
      .from("payments")
      .select("*, payment_gateway_settings(*)")
      .eq("id", paymentId);

    if (userId) query.eq("user_id", userId);

    const { data: payment, error: paymentError } = await query.maybeSingle();

    if (paymentError || !payment) {
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let statusResult: any = {
      status: payment.status,
      transaction_id: payment.gateway_transaction_id,
      gateway_response: payment.gateway_response,
    };

    if (payment.status === "processing" || payment.status === "pending") {
      const gateway = payment.payment_gateway_settings;
      const isTestMode = payment.gateway_environment === "test";

      try {
        const gatewayName = gateway?.gateway_name?.toLowerCase();
        switch (gatewayName) {
          case "cashfree":
            statusResult = await checkCashFreeStatus(payment, gateway, isTestMode);
            break;
          case "razorpay":
            statusResult = await checkRazorPayStatus(payment, gateway, isTestMode);
            break;
          case "payu":
            statusResult = await checkPayUStatus(payment, gateway, isTestMode);
            break;
          case "easebuzz":
            statusResult = await checkEaseBuzzStatus(payment, gateway, isTestMode);
            break;
          case "phonepe":
            statusResult = await checkPhonePeStatus(payment, gateway, isTestMode);
            break;
        }

        if (statusResult.status !== payment.status) {
          if (statusResult.status === "completed") {
            // Delegate to save-transaction-status so KYC checks, payout mode,
            // settlement resolution, and notifications are all applied consistently.
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            await fetch(`${supabaseUrl}/functions/v1/save-transaction-status`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                userId: payment.user_id,
                paymentId,
                transactionReference: payment.payment_reference,
                status: "completed",
                amount: payment.total_amount || payment.amount,
                gatewayResponse: statusResult.gateway_response,
                gatewayTransactionId: statusResult.transaction_id || payment.gateway_transaction_id,
                gatewayName: gateway?.gateway_name,
              }),
            });
          } else {
            const updateData: any = {
              status: statusResult.status,
              gateway_response: statusResult.gateway_response,
              updated_at: new Date().toISOString(),
            };

            if (statusResult.transaction_id && !payment.gateway_transaction_id) {
              updateData.gateway_transaction_id = statusResult.transaction_id;
            }

            await supabase.from("payments").update(updateData).eq("id", paymentId);

            await supabase.from("payment_logs").insert({
              payment_id: paymentId,
              status: statusResult.status,
              message: `Payment status updated to ${statusResult.status} via poll`,
              metadata: statusResult.gateway_response,
            });
          }
        }
      } catch (err) {
        console.error("Error checking gateway status:", err);
      }
    }

    const { data: updatedPayment } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        success: true,
        payment: {
          id: updatedPayment.id,
          amount: updatedPayment.amount,
          total_amount: updatedPayment.total_amount,
          status: updatedPayment.status,
          payment_reference: updatedPayment.payment_reference,
          gateway_transaction_id: updatedPayment.gateway_transaction_id,
          card_type: updatedPayment.card_type,
          created_at: updatedPayment.created_at,
          completed_at: updatedPayment.completed_at,
          failure_reason: updatedPayment.failure_reason,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Check payment status error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function triggerAutoPayout(supabase: any, payment: any, gateway: any) {
  try {
    const isTestMode = payment.gateway_environment === "test";
    const keyId = isTestMode ? gateway.test_api_key : gateway.production_api_key;
    const keySecret = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;
    if (!keyId || !keySecret) return;

    const { data: beneficiary } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("id", payment.beneficiary_id)
      .maybeSingle();

    if (!beneficiary) return;

    const authString = btoa(`${keyId}:${keySecret}`);
    const baseUrl = "https://api.razorpay.com/v1";
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
    const payoutReference = `POUT-${dateStr}-${rand}`;

    const { data: payoutRecord } = await supabase.from("payouts").insert({
      user_id: payment.user_id,
      beneficiary_id: payment.beneficiary_id,
      payment_gateway_id: payment.payment_gateway_id,
      amount: payment.amount,
      charges: 0,
      gst: 0,
      total_deduction: 0,
      net_amount: payment.amount,
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

    const contactResp = await fetch(`${baseUrl}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${authString}` },
      body: JSON.stringify({
        name: beneficiary.full_name,
        email: beneficiary.email,
        contact: beneficiary.mobile || "9999999999",
        type: "customer",
        reference_id: `contact_${beneficiary.id}`,
      }),
    });
    let contactResult = await contactResp.json();
    if (!contactResp.ok) {
      if (contactResult.error?.description?.includes("already exists")) {
        const ex = await (await fetch(`${baseUrl}/contacts?reference_id=contact_${beneficiary.id}`, {
          headers: { "Authorization": `Basic ${authString}` },
        })).json();
        if (ex.items?.[0]) contactResult = ex.items[0];
        else throw new Error("Contact not found");
      } else throw new Error(contactResult.error?.description || "Contact failed");
    }

    const faResp = await fetch(`${baseUrl}/fund_accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${authString}` },
      body: JSON.stringify({
        contact_id: contactResult.id,
        account_type: "bank_account",
        bank_account: { name: beneficiary.full_name, ifsc: beneficiary.ifsc, account_number: beneficiary.bank_account },
      }),
    });
    const faResult = await faResp.json();
    if (!faResp.ok) throw new Error(faResult.error?.description || "Fund account failed");

    const payoutData = {
      fund_account_id: faResult.id,
      amount: Math.round(payment.amount * 100),
      currency: "INR",
      mode: "IMPS",
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: payoutReference,
      narration: `Payout ${payoutReference}`,
      notes: { payment_id: payment.id },
    };

    const payoutResp = await fetch(`${baseUrl}/payouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`,
        "X-Payout-Idempotency": payoutReference,
      },
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
  } catch (err) {
    console.error("Auto-payout error:", err);
  }
}


// redeploy
