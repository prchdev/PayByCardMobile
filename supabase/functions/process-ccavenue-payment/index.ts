import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createCipheriv, createHash } from "node:crypto";

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

function encryptCCAvenueData(data: string, workingKey: string): string {
  const md5 = createHash("md5").update(workingKey).digest();
  const keyBase = Buffer.concat([md5, createHash("md5").update(md5).digest()]);
  const key = keyBase.subarray(0, 24);
  const iv = Buffer.alloc(8, 0);

  const cipher = createCipheriv("des-ede3-cbc", key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
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
    if (gateway.gateway_name !== "CCAvenue") {
      throw new Error("Invalid payment gateway");
    }

    const isTestMode = environment === "test";
    const apiUrl = isTestMode
      ? "https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction"
      : "https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction";

    const merchantId = isTestMode ? gateway.test_merchant_id : gateway.production_merchant_id;
    const accessCode = isTestMode ? gateway.test_api_key : gateway.production_api_key;
    const workingKey = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

    if (!merchantId || !accessCode || !workingKey) {
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
        message: "Payment processing initiated via CCAvenue",
        metadata: { gateway: "CCAvenue", environment }
      });

    const detectedCardType = card_type.toLowerCase();
    const categoryName = payment.card_type?.toLowerCase() || "";

    let cardTypeCode = "CRDC";

    if (categoryName.includes("amex") || categoryName.includes("american express")) {
      cardTypeCode = "AMEX";
    } else if (categoryName.includes("diners")) {
      cardTypeCode = "DINR";
    } else if (detectedCardType === "amex") {
      cardTypeCode = "AMEX";
    } else if (detectedCardType === "diners") {
      cardTypeCode = "DINR";
    }

    const orderData = {
      merchant_id: merchantId,
      order_id: payment.payment_reference,
      currency: "INR",
      amount: parseFloat(payment.total_amount).toFixed(2),
      redirect_url: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      cancel_url: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      billing_name: payment.beneficiaries.account_holder_name || user.email?.split("@")[0] || "User",
      billing_email: user.email,
      billing_tel: payment.beneficiaries.mobile_number || "9999999999",
      delivery_name: payment.beneficiaries.account_holder_name || user.email?.split("@")[0] || "User",
      delivery_tel: payment.beneficiaries.mobile_number || "9999999999",
      merchant_param1: payment_id,
      merchant_param2: user.id,
      merchant_param3: card_type,
      payment_option: "OPTCRDC",
      card_type: cardTypeCode
    };

    const merchantData = Object.entries(orderData)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    const encryptedData = encryptCCAvenueData(merchantData, workingKey);

    await supabase
      .from("payments")
      .update({
        gateway_request: orderData,
        updated_at: new Date().toISOString()
      })
      .eq("id", payment_id);

    return new Response(
      JSON.stringify({
        success: true,
        requiresAction: true,
        action: "redirect",
        paymentUrl: apiUrl,
        encRequest: encryptedData,
        accessCode: accessCode,
        payment_id: payment_id,
        message: "Redirect to CCAvenue for payment completion."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("CCAvenue payment error:", error);
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
