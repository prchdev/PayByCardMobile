import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_AMOUNT = 1_000_000;
const MIN_AMOUNT = 1;
const MAX_STR = 500;

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      userId,
      beneficiaryId,
      businessCategoryId,
      paymentOptionId,
      gatewayId,
      cardType,
      amount,
      charges,
      gst,
      discount,
      totalAmount,
      billFileUrl,
      ipAddress,
      beneficiaryDetails,
      categoryDetails,
      paymentOptionDetails,
    } = await req.json();

    // ── Authenticate: verify userId exists in public.users ───────────────────
    if (!userId) return err("Unauthorized: userId is required", 401);
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("id, is_disabled")
      .eq("id", userId)
      .maybeSingle();
    if (userErr || !userRow) return err("Unauthorized", 401);
    if (userRow.is_disabled) return err("Account is disabled", 403);

    if (!beneficiaryId || !paymentOptionId || !gatewayId || !cardType || !amount || !totalAmount) {
      return err("Required fields are missing");
    }

    // ── Input validation ──────────────────────────────────────────────────────
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < MIN_AMOUNT || parsedAmount > MAX_AMOUNT) {
      return err(`Amount must be between ₹${MIN_AMOUNT} and ₹${MAX_AMOUNT}`);
    }
    if (billFileUrl && typeof billFileUrl === "string" && billFileUrl.length > MAX_STR) {
      return err("billFileUrl too long");
    }
    // Ensure nested details are plain objects, not arrays or primitives
    for (const [key, val] of [["beneficiaryDetails", beneficiaryDetails], ["categoryDetails", categoryDetails], ["paymentOptionDetails", paymentOptionDetails]] as const) {
      if (val !== null && val !== undefined && (typeof val !== "object" || Array.isArray(val))) {
        return err(`Invalid ${key}`);
      }
    }

    // F4: Recompute charges, GST, discount and total server-side — never trust the browser.
    const chargesRes = await fetch(`${supabaseUrl}/functions/v1/calculate-payment-option-charges`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: parsedAmount,
        categoryId: paymentOptionId,
        gatewayId: gatewayId,
      }),
    });
    if (!chargesRes.ok) {
      return err("Failed to calculate payment charges");
    }
    const chargesData = await chargesRes.json();
    const parsedCharges = parseFloat(chargesData.charges || 0);
    const parsedGst = parseFloat(chargesData.gst || 0);
    const parsedDiscount = parseFloat(chargesData.discount || 0);
    const parsedTotal = parsedAmount + parsedCharges + parsedGst - parsedDiscount;

    // ── Duplicate payment guard ───────────────────────────────────────────────
    // Detects double-submit within 30 s: same user + beneficiary + amount.
    const { data: isDuplicate } = await supabase.rpc("fn_check_recent_duplicate_payment", {
      p_user_id:        userId,
      p_beneficiary_id: beneficiaryId,
      p_amount:         parsedAmount,
      p_window_secs:    30,
    });
    if (isDuplicate) {
      return err("A duplicate payment was submitted within the last 30 seconds. Please wait before trying again.", 429);
    }

    const { data: gatewaySettings, error: gatewayError } = await supabase
      .from("payment_gateway_settings")
      .select("*")
      .eq("id", gatewayId)
      .maybeSingle();

    if (gatewayError || !gatewaySettings) {
      return new Response(
        JSON.stringify({ error: "Gateway not found or disabled" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch the payment option to get the per-option environment
    const { data: paymentOption, error: optionError } = await supabase
      .from("payment_options")
      .select("id, gateway_id, environment, is_enabled")
      .eq("id", paymentOptionId)
      .maybeSingle();

    if (optionError || !paymentOption) {
      return new Response(
        JSON.stringify({ error: "Payment option not found" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!paymentOption.is_enabled) {
      return new Response(
        JSON.stringify({ error: "Selected payment option is not enabled" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use the environment from the payment option, not from the gateway settings
    const optionEnvironment = paymentOption.environment || "test";

    const allowedCards = determineAllowedCards(cardType);

    const paymentReference = await generatePaymentReference(supabase);

    const transactionSummary = {
      payment_reference: paymentReference,
      amount: parsedAmount,
      charges: parsedCharges,
      gst: parsedGst,
      discount: parsedDiscount,
      total_amount: parsedTotal,
      card_type: cardType,
      gateway_name: gatewaySettings.gateway_name,
      environment: optionEnvironment,
      allowed_cards: allowedCards,
      initiated_at: new Date().toISOString(),
      ip_address: ipAddress || "unknown",
    };

    const validCardType = cardType ? extractSingleCardType(cardType) : null;
    // Normalize: "Testing"/"test" → "test", "Production"/"production" → "production"
    const rawEnv = (optionEnvironment || "").toLowerCase();
    const normalizedEnvironment = rawEnv.startsWith("prod") ? "production" : "test";

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        user_id: userId,
        beneficiary_id: beneficiaryId,
        business_category_id: businessCategoryId || null,
        payment_category_id: paymentOptionId,
        payment_gateway_id: gatewayId,
        payout_mode: gatewaySettings.payout_mode || null,
        card_type: validCardType,
        allowed_cards: allowedCards,
        gateway_environment: normalizedEnvironment,
        amount: parsedAmount,
        charges: parsedCharges,
        gst: parsedGst,
        discount: parsedDiscount,
        total_amount: parsedTotal,
        payment_reference: paymentReference,
        bill_file_url: billFileUrl || null,
        status: "pending",
        ip_address: ipAddress || "unknown",
        transaction_summary: transactionSummary,
        beneficiary_details: beneficiaryDetails || {},
        category_details: categoryDetails || {},
        selected_payment_option: paymentOptionDetails || {},
      })
      .select()
      .single();

    if (paymentError) {
      console.error("Error creating payment:", paymentError);
      return new Response(
        JSON.stringify({
          error: "Failed to create payment",
          details: paymentError.message,
          code: paymentError.code,
          hint: paymentError.hint
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { error: logError } = await supabase
      .from("payment_logs")
      .insert({
        payment_id: payment.id,
        status: "pending",
        message: "Payment initiated",
        metadata: {
          user_id: userId,
          amount: amount,
          reference: paymentReference,
          gateway: gatewaySettings.gateway_name,
          environment: gatewaySettings.environment,
        },
      });

    if (logError) {
      console.error("Error creating payment log:", logError);
    }

    const gatewayConfig = await createGatewayPaymentConfig(
      gatewaySettings,
      payment,
      allowedCards,
      normalizedEnvironment
    );

    return new Response(
      JSON.stringify({
        success: true,
        payment: {
          id: payment.id,
          reference: paymentReference,
          amount: payment.amount,
          totalAmount: payment.total_amount,
          status: payment.status,
        },
        gatewayConfig: gatewayConfig,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Exception in initiate-payment:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        error: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function extractSingleCardType(cardTypeName: string): string | null {
  const normalized = cardTypeName.toLowerCase();
  if (normalized.includes('visa')) return 'visa';
  if (normalized.includes('master')) return 'mastercard';
  if (normalized.includes('rupay')) return 'rupay';
  if (normalized.includes('amex') || normalized.includes('american express')) return 'amex';
  if (normalized.includes('diners')) return 'diners';
  return null;
}

function determineAllowedCards(cardType: string): string[] {
  const lowerCardType = cardType.toLowerCase();

  if (lowerCardType.includes("visa") || lowerCardType.includes("master") || lowerCardType.includes("rupay")) {
    return ["visa", "mastercard", "rupay"];
  } else if (lowerCardType.includes("american express") || lowerCardType.includes("diners")) {
    return ["amex", "diners"];
  }

  return ["visa", "mastercard", "rupay", "amex", "diners"];
}

async function generatePhonePeChecksum(base64Payload: string, apiEndpoint: string, saltKey: string): Promise<string> {
  const data = base64Payload + apiEndpoint + saltKey;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex + "###" + 1;
}

async function createGatewayPaymentConfig(
  gatewaySettings: any,
  payment: any,
  allowedCards: string[],
  environment: string
): Promise<any> {
  const gatewayName = gatewaySettings.gateway_name.toLowerCase();
  const isTestMode = environment === "test";
  const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-gateway-webhook`;

  const config = {
    gateway: gatewaySettings.gateway_name,
    environment: environment,
    allowedCards: allowedCards,
    amount: payment.total_amount,
    currency: "INR",
    orderId: payment.payment_reference,
    callbackUrl: callbackUrl,
  };

  switch (gatewayName) {
    case "razorpay": {
      const keyId = isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key;
      const keySecret = isTestMode ? gatewaySettings.test_api_secret : gatewaySettings.production_api_secret;

      if (!keyId || !keySecret) {
        throw new Error("Razorpay credentials not configured");
      }

      // Create Razorpay order
      const authString = btoa(`${keyId}:${keySecret}`);
      const orderData = {
        amount: Math.round(payment.total_amount * 100),
        currency: "INR",
        receipt: payment.payment_reference,
        notes: {
          payment_id: payment.id,
          user_id: payment.user_id
        }
      };

      const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${authString}`
        },
        body: JSON.stringify(orderData)
      });

      if (!orderResponse.ok) {
        const errorData = await orderResponse.json();
        throw new Error(errorData.error?.description || "Failed to create Razorpay order");
      }

      const orderResult = await orderResponse.json();

      // Razorpay card network filtering:
      // - Domestic/International card filtering is controlled at the merchant dashboard level
      // - To accept only Indian cards, disable "International Payments" in Razorpay Dashboard
      // - Checkout configuration only allows hiding methods, not filtering by card BIN/network
      // - Card type validation (Visa/Master/RuPay/Amex) happens at payment gateway

      const options: any = {
        key: keyId,
        amount: orderResult.amount,
        currency: orderResult.currency,
        name: "PayByCard",
        description: `Payment Reference: ${payment.payment_reference}`,
        order_id: orderResult.id,
        prefill: {
          name: "",
          email: "",
          contact: ""
        },
        theme: {
          color: "#2563eb"
        },
        modal: {
          ondismiss: function() {
            console.log('Checkout form closed');
          }
        }
      };

      return {
        ...config,
        keyId: keyId,
        sdkUrl: "https://checkout.razorpay.com/v1/checkout.js",
        options: options,
        cardType: payment.card_type
      };
    }

    case "cashfree": {
      const cashfreeApiUrl = isTestMode
        ? "https://sandbox.cashfree.com/pg/orders"
        : "https://api.cashfree.com/pg/orders";

      const clientId = isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key;
      const clientSecret = isTestMode ? gatewaySettings.test_api_secret : gatewaySettings.production_api_secret;

      if (!clientId || !clientSecret) {
        throw new Error("Cashfree credentials not configured");
      }

      const orderRequest: any = {
        order_id: payment.payment_reference,
        order_amount: parseFloat(payment.total_amount),
        order_currency: "INR",
        customer_details: {
          customer_id: payment.user_id,
          customer_phone: "9999999999"
        },
        order_meta: {
          return_url: callbackUrl,
        }
      };

      const orderResponse = await fetch(cashfreeApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": clientId,
          "x-client-secret": clientSecret,
          "x-api-version": "2025-01-01"
        },
        body: JSON.stringify(orderRequest)
      });

      if (!orderResponse.ok) {
        const errorData = await orderResponse.json();
        throw new Error(errorData.message || "Failed to create Cashfree order");
      }

      const orderData = await orderResponse.json();

      return {
        ...config,
        appId: clientId,
        environment: isTestMode ? "sandbox" : "production",
        sdkUrl: "https://sdk.cashfree.com/js/v3/cashfree.js",
        options: {
          paymentSessionId: orderData.payment_session_id,
          orderAmount: payment.total_amount,
          orderCurrency: "INR",
          returnUrl: callbackUrl,
          cardType: payment.card_type
        }
      };
    }

    case "payu": {
      const key = isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key;
      const salt = isTestMode ? gatewaySettings.test_api_secret : gatewaySettings.production_api_secret;

      // PayU hash format: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
      const hashString = `${key}|${payment.payment_reference}|${payment.total_amount}|Payment|Customer|customer@example.com|||||||||||${salt}`;

      const encoder = new TextEncoder();
      const data = encoder.encode(hashString);
      const hashBuffer = await crypto.subtle.digest('SHA-512', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Map card types to PayU's category names
      const payuCardCategories: string[] = [];
      allowedCards.forEach(card => {
        if (card === 'visa') payuCardCategories.push('CC');
        if (card === 'mastercard') payuCardCategories.push('CC');
        if (card === 'rupay') payuCardCategories.push('CC');
        if (card === 'amex') payuCardCategories.push('AMEX');
        if (card === 'diners') payuCardCategories.push('DINR');
      });

      // Remove duplicates
      const uniqueCategories = [...new Set(payuCardCategories)];

      return {
        ...config,
        merchantKey: key,
        sdkUrl: "https://jssdk.payu.in/bolt/bolt.min.js",
        options: {
          key: key,
          txnid: payment.payment_reference,
          amount: payment.total_amount,
          productinfo: "Payment",
          firstname: "Customer",
          email: "customer@example.com",
          phone: "9999999999",
          surl: callbackUrl,
          furl: callbackUrl,
          hash: hash,
          enforce_paymethod: uniqueCategories.join("|"),
        }
      };
    }

    case "ccavenue":
      return {
        ...config,
        merchantId: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
        sdkUrl: isTestMode
          ? "https://test.ccavenue.com/transaction/transaction.do"
          : "https://secure.ccavenue.com/transaction/transaction.do",
        options: {
          merchant_id: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
          order_id: payment.payment_reference,
          amount: payment.total_amount,
          currency: "INR",
          redirect_url: callbackUrl,
          cancel_url: callbackUrl,
          payment_option: "OPTCRDC",
          card_type: allowedCards.join(",")
        }
      };

    case "easebuzz":
      return {
        ...config,
        merchantKey: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
        sdkUrl: isTestMode
          ? "https://testpay.easebuzz.in/payment/v1/js/easebuzz-checkout.js"
          : "https://pay.easebuzz.in/payment/v1/js/easebuzz-checkout.js",
        options: {
          key: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
          txnid: payment.payment_reference,
          amount: payment.total_amount,
          productinfo: "Payment",
          firstname: "Customer",
          phone: "9999999999",
          email: "customer@example.com",
          surl: callbackUrl,
          furl: callbackUrl,
          show_payment_mode: "card",
          allowed_card_types: allowedCards.join(",")
        }
      };

    case "zaakpay":
      return {
        ...config,
        merchantId: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
        sdkUrl: isTestMode
          ? "https://zaakstaging.com/checkoutjs/checkoutPayment.js"
          : "https://api.zaakpay.com/checkoutjs/checkoutPayment.js",
        options: {
          merchantIdentifier: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
          orderId: payment.payment_reference,
          amount: payment.total_amount,
          currency: "INR",
          returnUrl: callbackUrl,
          paymentMode: "card",
          allowedCardTypes: allowedCards.join(",")
        }
      };

    case "enkash":
      return {
        ...config,
        apiKey: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
        sdkUrl: isTestMode
          ? "https://uat.enkash.com/sdk/enkash-checkout.js"
          : "https://api.enkash.com/sdk/enkash-checkout.js",
        options: {
          apiKey: isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key,
          reference: payment.payment_reference,
          amount: payment.total_amount,
          callbackUrl: callbackUrl,
          paymentMethods: ["card"],
          allowedCardNetworks: allowedCards
        }
      };

    case "phonepe": {
      const merchantId = isTestMode ? gatewaySettings.test_api_key : gatewaySettings.production_api_key;
      const saltKey = isTestMode ? gatewaySettings.test_api_secret : gatewaySettings.production_api_secret;

      if (!merchantId || !saltKey) {
        throw new Error("PhonePe credentials not configured");
      }

      const phonepeBaseUrl = isTestMode
        ? "https://api-preprod.phonepe.com/apis/hermes"
        : "https://api.phonepe.com/apis/hermes";

      const merchantOrderId = payment.payment_reference;
      const amountInPaise = Math.round(payment.total_amount * 100);
      const redirectUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-gateway-webhook?gateway=phonepe`;
      const callbackUrlFull = callbackUrl;

      // Look up per-payment-option PhonePe configuration
      let phonepeConfig: any = null;
      if (payment.payment_category_id) {
        const { data: ppConfig } = await supabase
          .from("phonepe_payment_configs")
          .select("card_types, networks, variants, geo_scopes")
          .eq("payment_gateway_id", gatewaySettings.id)
          .eq("payment_option_id", payment.payment_category_id)
          .eq("is_active", true)
          .maybeSingle();

        if (ppConfig) {
          phonepeConfig = ppConfig;
        }
      }

      // Build paymentModeConfig only if any constraint values are defined
      const hasCardTypes = phonepeConfig?.card_types?.length > 0;
      const hasNetworks = phonepeConfig?.networks?.length > 0;
      const hasVariants = phonepeConfig?.variants?.length > 0;
      const hasGeoScopes = phonepeConfig?.geo_scopes?.length > 0;

      const cardMode: any = { type: "CARD" };
      if (hasCardTypes) cardMode.types = phonepeConfig.card_types;
      if (hasNetworks) cardMode.networks = phonepeConfig.networks;
      if (hasVariants) cardMode.variants = phonepeConfig.variants;
      if (hasGeoScopes) cardMode.geoScopes = phonepeConfig.geo_scopes;

      const usePaymentModeConfig = hasCardTypes || hasNetworks || hasVariants || hasGeoScopes;

      // PhonePe Standard Checkout: initiate a PG transaction
      const payload: any = {
        merchantId,
        merchantOrderId,
        amount: amountInPaise,
        redirectUrl,
        redirectMode: "REDIRECT",
        callbackUrl: callbackUrlFull,
        paymentInstrument: {
          type: "PAY_PAGE",
        },
      };

      if (usePaymentModeConfig) {
        payload.paymentFlow = {
          type: "PG_CHECKOUT",
          merchantUrls: {
            redirectUrl,
          },
          paymentModeConfig: {
            version: "V2",
            enabledPaymentModes: [cardMode],
          },
        };
      }

      const payloadBase64 = btoa(JSON.stringify(payload));
      const xVerify = await generatePhonePeChecksum(payloadBase64, "/pg/v1/pay", saltKey);

      const initiateResponse = await fetch(`${phonepeBaseUrl}/pg/v1/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerify,
        },
        body: JSON.stringify({ request: payloadBase64 }),
      });

      if (!initiateResponse.ok) {
        const errorData = await initiateResponse.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to create PhonePe order");
      }

      const orderData = await initiateResponse.json();

      return {
        ...config,
        merchantId,
        sdkUrl: "https://phonepe.merchant.sdk/v1/phonepe-checkout.js",
        environment: isTestMode ? "test" : "production",
        options: {
          merchantId,
          merchantOrderId,
          amount: amountInPaise,
          redirectUrl,
          redirectMode: "REDIRECT",
          token: orderData.data?.token ?? orderData.data?.merchantTransactionId,
          checkoutUrl: orderData.data?.redirectUrl ?? orderData.data?.instrumentResponse?.redirectInfo?.url,
          cardType: payment.card_type,
        }
      };
    }

    default:
      throw new Error(`Gateway ${gatewayName} not supported`);
  }
}

async function generatePaymentReference(supabase: any): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const randomNum = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
    const reference = `PAY-${dateStr}-${randomNum}`;

    const { data } = await supabase
      .from("payments")
      .select("id")
      .eq("payment_reference", reference)
      .maybeSingle();

    if (!data) {
      return reference;
    }

    attempts++;
  }

  throw new Error("Failed to generate unique payment reference");
}


// redeploy
