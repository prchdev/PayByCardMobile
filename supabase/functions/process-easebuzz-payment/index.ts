import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHash } from "node:crypto";

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

function generateEasebuzzHash(data: string, salt: string): string {
  return createHash("sha512").update(data + salt).digest("hex");
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
    if (gateway.gateway_name !== "EaseBuzz") {
      throw new Error("Invalid payment gateway");
    }

    const isTestMode = environment === "test";
    const baseUrl = isTestMode
      ? "https://testpay.easebuzz.in"
      : "https://pay.easebuzz.in";

    const merchantKey = isTestMode ? gateway.test_api_key : gateway.production_api_key;
    const salt = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

    if (!merchantKey || !salt) {
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
        message: "Payment processing initiated via EaseBuzz",
        metadata: { gateway: "EaseBuzz", environment }
      });

    const amount = parseFloat(payment.total_amount).toFixed(2);
    const productInfo = "Payment";
    const firstname = payment.beneficiaries.account_holder_name || user.email?.split("@")[0] || "User";
    const email = user.email;
    const phone = payment.beneficiaries.mobile_number || "9999999999";

    const hashString = `${merchantKey}|${payment.payment_reference}|${amount}|${productInfo}|${firstname}|${email}|${phone}|||||||||||`;
    const hash = generateEasebuzzHash(hashString, salt);

    const paymentData = {
      key: merchantKey,
      txnid: payment.payment_reference,
      amount: amount,
      productinfo: productInfo,
      firstname: firstname,
      email: email,
      phone: phone,
      surl: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      furl: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      hash: hash,
      udf1: payment_id,
      udf2: user.id,
      udf3: card_type
    };

    await supabase
      .from("payments")
      .update({
        gateway_request: paymentData,
        updated_at: new Date().toISOString()
      })
      .eq("id", payment_id);

    const paymentUrl = `${baseUrl}/payment/initiateLink`;

    return new Response(
      JSON.stringify({
        success: true,
        requiresAction: true,
        action: "redirect",
        paymentUrl: paymentUrl,
        paymentData: paymentData,
        payment_id: payment_id,
        message: "Redirect to EaseBuzz for payment completion."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("EaseBuzz payment error:", error);
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
