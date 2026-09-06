import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PaymentRequest {
  payment_id: string;
  card_number: string;
  card_expiry_month: string;
  card_expiry_year: string;
  card_cvv: string;
  card_holder_name: string;
  card_type: "visa" | "mastercard" | "rupay" | "amex" | "diners";
  environment: "test" | "production";
}

// Maps settlement_time to Razorpay settlement period in days
function getRazorpaySettlementPeriod(settlementTime: string | null | undefined): number {
  if (!settlementTime) return 2;
  const s = settlementTime.trim().toUpperCase();
  if (s === "INSTANT" || s === "T+0") return 0;
  if (s === "T+1") return 1;
  return 2;
}

// Ensure a Razorpay Contact + Fund Account exists; return fund_account_id
async function ensureRazorpayFundAccount(
  supabase: any,
  beneficiary: any,
  authString: string,
  baseUrl: string,
): Promise<string> {
  // Return cached fund account if available
  if (beneficiary.razorpay_fund_account_id) return beneficiary.razorpay_fund_account_id;

  // Create or reuse contact
  let contactId = beneficiary.razorpay_contact_id;
  if (!contactId) {
    const contactRes = await fetch(`${baseUrl}/contacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`,
      },
      body: JSON.stringify({
        name: beneficiary.full_name || "Beneficiary",
        email: beneficiary.email || undefined,
        contact: beneficiary.mobile || undefined,
        type: "vendor",
      }),
    });
    const contactData = await contactRes.json();
    contactId = contactData.id;
    if (contactId) {
      await supabase
        .from("beneficiaries")
        .update({ razorpay_contact_id: contactId })
        .eq("id", beneficiary.id);
    }
  }

  if (!contactId) throw new Error("Failed to create Razorpay contact");

  // Create fund account
  const faRes = await fetch(`${baseUrl}/fund_accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${authString}`,
    },
    body: JSON.stringify({
      contact_id: contactId,
      account_type: "bank_account",
      bank_account: {
        name: beneficiary.full_name || "Beneficiary",
        ifsc: beneficiary.ifsc,
        account_number: beneficiary.bank_account,
      },
    }),
  });
  const faData = await faRes.json();
  const fundAccountId = faData.id;

  if (fundAccountId) {
    await supabase
      .from("beneficiaries")
      .update({ razorpay_fund_account_id: fundAccountId })
      .eq("id", beneficiary.id);
  }

  if (!fundAccountId) throw new Error("Failed to create Razorpay fund account");
  return fundAccountId;
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
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const payload: PaymentRequest = await req.json();
    const {
      payment_id,
      card_type,
      environment = "production"
    } = payload;

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*, payment_gateway_settings(*), beneficiaries(*)")
      .eq("id", payment_id)
      .eq("user_id", user.id)
      .single();

    if (paymentError || !payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "pending") {
      throw new Error(`Payment already ${payment.status}`);
    }

    const gateway = payment.payment_gateway_settings;
    if (gateway.gateway_name !== "RazorPay") {
      throw new Error("Invalid payment gateway");
    }

    const isTestMode = environment === "test";
    const baseUrl = "https://api.razorpay.com/v1";

    const keyId = isTestMode ? gateway.test_api_key : gateway.production_api_key;
    const keySecret = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

    if (!keyId || !keySecret) {
      throw new Error("Gateway credentials not configured");
    }

    await supabase
      .from("payments")
      .update({
        status: "processing",
        gateway_environment: environment,
        card_type: card_type,
        updated_at: new Date().toISOString()
      })
      .eq("id", payment_id);

    await supabase
      .from("payment_logs")
      .insert({
        payment_id: payment_id,
        status: "processing",
        message: "Payment processing initiated via RazorPay",
        metadata: { gateway: "RazorPay", environment }
      });

    const authString = btoa(`${keyId}:${keySecret}`);

    const detectedCardType = card_type.toLowerCase();
    const categoryName = payment.card_type?.toLowerCase() || "";

    // Look up per-payment-option Razorpay checkout configuration
    let checkoutConfigId: string | null = null;

    if (payment.payment_category_id) {
      const { data: razorpayConfig } = await supabase
        .from("razorpay_payment_configs")
        .select("checkout_config_id")
        .eq("payment_gateway_id", gateway.id)
        .eq("payment_option_id", payment.payment_category_id)
        .eq("is_active", true)
        .maybeSingle();

      if (razorpayConfig?.checkout_config_id) {
        checkoutConfigId = razorpayConfig.checkout_config_id;
      }
    }

    let allowedMethods: string[] = [];

    if (categoryName.includes("amex") || categoryName.includes("american express") || categoryName.includes("diners")) {
      allowedMethods = ["amex"];
    } else if (categoryName.includes("visa") || categoryName.includes("master") || categoryName.includes("rupay")) {
      allowedMethods = ["card"];
    } else if (detectedCardType === "amex" || detectedCardType === "diners") {
      allowedMethods = ["amex"];
    } else {
      allowedMethods = ["card"];
    }

    const orderMethod = allowedMethods[0] || "card";
    const allowedCardTypes = orderMethod === "amex" ? ["amex", "diners"] : ["visa", "mastercard", "rupay"];

    const orderData: any = {
      amount: Math.round(parseFloat(payment.total_amount) * 100),
      currency: "INR",
      receipt: payment.payment_reference,
      notes: {
        payment_id: payment_id,
        user_id: user.id,
        card_type: allowedCardTypes.join(",")
      },
      method: orderMethod
    };

    // Use per-option checkout config if defined; otherwise Razorpay uses the default config
    if (checkoutConfigId) {
      orderData.checkout_config_id = checkoutConfigId;
    }

    // Payment Split: configure Razorpay Route transfer at order creation time
    const payoutMode = gateway.payout_mode;
    let splitConfigured = false;
    if (payoutMode === "payment_split" && payment.beneficiaries) {
      try {
        const settlementTime = payment.category_details?.settlement_time || null;
        const settlementPeriod = getRazorpaySettlementPeriod(settlementTime);
        const fundAccountId = await ensureRazorpayFundAccount(
          supabase,
          payment.beneficiaries,
          authString,
          baseUrl,
        );

        // Transfer base amount to vendor; charges stay with platform account
        const transferAmountPaise = Math.round(parseFloat(payment.amount) * 100);

        orderData.transfers = [
          {
            account: fundAccountId,
            amount: transferAmountPaise,
            currency: "INR",
            notes: {
              payment_id: payment_id,
              beneficiary_id: payment.beneficiaries.id,
            },
            linked_account_notes: ["payment_id"],
            on_hold: settlementPeriod > 0 ? 1 : 0,
            on_hold_until: settlementPeriod > 0
              ? Math.floor((Date.now() + settlementPeriod * 24 * 60 * 60 * 1000) / 1000)
              : undefined,
          },
        ];
        splitConfigured = true;
      } catch (splitErr) {
        console.error("Razorpay route setup error (continuing without split):", splitErr);
      }
    }

    const orderResponse = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`
      },
      body: JSON.stringify(orderData)
    });

    const orderResult = await orderResponse.json();

    if (!orderResponse.ok) {
      throw new Error(orderResult.error?.description || "Failed to create order");
    }

    await supabase
      .from("payments")
      .update({
        gateway_request: { ...orderData, split_configured: splitConfigured },
        gateway_response: orderResult,
        gateway_transaction_id: orderResult.id,
        split_configured: splitConfigured,
        updated_at: new Date().toISOString()
      })
      .eq("id", payment_id);

    const checkoutOptions = {
      key_id: keyId,
      amount: orderResult.amount,
      currency: orderResult.currency,
      order_id: orderResult.id,
      name: "PayByCard",
      description: "Payment for services",
      prefill: {
        name: payment.beneficiaries?.account_holder_name || user.email?.split("@")[0],
        email: user.email,
        contact: payment.beneficiaries?.mobile_number || "9999999999"
      },
      notes: orderResult.notes,
      theme: {
        color: "#2563eb"
      },
      method: allowedMethods.length > 0 ? allowedMethods[0] : "card",
      callback_url: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      redirect: true
    };

    return new Response(
      JSON.stringify({
        success: true,
        requiresAction: true,
        action: "popup",
        checkoutOptions: checkoutOptions,
        orderId: orderResult.id,
        payment_id: payment_id,
        split_configured: splitConfigured,
        message: "Order created successfully. Please complete payment in popup."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("RazorPay payment error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});

// redeploy
