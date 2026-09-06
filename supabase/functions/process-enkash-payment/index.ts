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
    if (gateway.gateway_name !== "EnKash") {
      throw new Error("Invalid payment gateway");
    }

    const isTestMode = environment === "test";
    const baseUrl = isTestMode
      ? "https://sandbox.enkash.com/api/v1"
      : "https://api.enkash.com/api/v1";

    const apiKey = isTestMode ? gateway.test_api_key : gateway.production_api_key;
    const apiSecret = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

    if (!apiKey || !apiSecret) {
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
        message: "Payment processing initiated via EnKash",
        metadata: { gateway: "EnKash", environment }
      });

    const authString = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    const paymentData = {
      order_id: payment.payment_reference,
      amount: parseFloat(payment.total_amount),
      currency: "INR",
      customer_name: payment.beneficiaries.account_holder_name || user.email?.split("@")[0] || "User",
      customer_email: user.email,
      customer_phone: payment.beneficiaries.mobile_number || "9999999999",
      return_url: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      callback_url: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      card_type: card_type,
      metadata: {
        payment_id: payment_id,
        user_id: user.id
      }
    };

    const response = await fetch(`${baseUrl}/payments/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`
      },
      body: JSON.stringify(paymentData)
    });

    const result = await response.json();

    await supabase
      .from("payments")
      .update({
        gateway_request: paymentData,
        gateway_response: result,
        gateway_transaction_id: result.transaction_id || result.order_id,
        updated_at: new Date().toISOString()
      })
      .eq("id", payment_id);

    if (response.ok && result.payment_url) {
      return new Response(
        JSON.stringify({
          success: true,
          requiresAction: true,
          action: "redirect",
          paymentUrl: result.payment_url,
          transactionId: result.transaction_id,
          payment_id: payment_id,
          message: "Redirect to EnKash for payment completion."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      throw new Error(result.message || "Failed to initiate payment");
    }
  } catch (error) {
    console.error("EnKash payment error:", error);
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
