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

function generateZaakPayChecksum(data: string, secretKey: string): string {
  return createHash("sha256").update(data + secretKey).digest("hex");
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
    if (gateway.gateway_name !== "ZaakPay") {
      throw new Error("Invalid payment gateway");
    }

    const isTestMode = environment === "test";
    const baseUrl = isTestMode
      ? "https://zaakstaging.com/api"
      : "https://api.zaakpay.com/api";

    const merchantId = isTestMode ? gateway.test_merchant_id : gateway.production_merchant_id;
    const secretKey = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

    if (!merchantId || !secretKey) {
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
        message: "Payment processing initiated via ZaakPay",
        metadata: { gateway: "ZaakPay", environment }
      });

    const amount = parseFloat(payment.total_amount).toFixed(2);
    const currency = "INR";
    const buyerEmail = user.email;
    const orderId = payment.payment_reference;

    const checksumString = `${merchantId}|${orderId}|${amount}|${currency}|${buyerEmail}`;
    const checksum = generateZaakPayChecksum(checksumString, secretKey);

    const paymentData = {
      merchantIdentifier: merchantId,
      orderId: orderId,
      returnUrl: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      buyerEmail: buyerEmail,
      buyerFirstName: payment.beneficiaries.account_holder_name || user.email?.split("@")[0] || "User",
      buyerPhoneNumber: payment.beneficiaries.mobile_number || "9999999999",
      amount: amount,
      currency: currency,
      purpose: "1",
      productDescription: "Payment",
      checksum: checksum,
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

    const paymentUrl = `${baseUrl}/paymentTransact/V7`;

    return new Response(
      JSON.stringify({
        success: true,
        requiresAction: true,
        action: "redirect",
        paymentUrl: paymentUrl,
        paymentData: paymentData,
        payment_id: payment_id,
        message: "Redirect to ZaakPay for payment completion."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ZaakPay payment error:", error);
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
