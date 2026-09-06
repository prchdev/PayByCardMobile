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

// Maps settlement_time string to CashFree split schedule
function getCashfreeSplitSchedule(settlementTime: string | null | undefined): string {
  if (!settlementTime) return "T+2";
  const s = settlementTime.trim().toUpperCase();
  if (s === "INSTANT" || s === "T+0") return "T+0";
  if (s === "T+1") return "T+1";
  return "T+2";
}

// Ensure vendor exists in CashFree; return vendor_id
async function ensureCashfreeVendor(
  supabase: any,
  beneficiary: any,
  clientId: string,
  clientSecret: string,
  isTestMode: boolean,
): Promise<string> {
  // Return cached vendor ID if available
  if (beneficiary.cashfree_bene_id) return beneficiary.cashfree_bene_id;

  const baseUrl = isTestMode
    ? "https://sandbox.cashfree.com/pg"
    : "https://api.cashfree.com/pg";

  const vendorId = `bene_${beneficiary.id}`;
  const vendorBody: any = {
    vendor_id: vendorId,
    status: "ACTIVE",
    name: beneficiary.full_name || "Beneficiary",
    email: beneficiary.email || "noemail@paybycard.in",
    phone: beneficiary.mobile || "9999999999",
    bank: [
      {
        account_number: beneficiary.bank_account,
        account_ifsc: beneficiary.ifsc,
      },
    ],
  };

  const res = await fetch(`${baseUrl}/easy-split/vendors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": "2025-01-01",
    },
    body: JSON.stringify(vendorBody),
  });

  const data = await res.json();
  const returnedId = data.vendor_id || vendorId;

  // Cache back to beneficiaries table
  await supabase
    .from("beneficiaries")
    .update({ cashfree_bene_id: returnedId })
    .eq("id", beneficiary.id);

  return returnedId;
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
      card_number,
      card_expiry_month,
      card_expiry_year,
      card_cvv,
      card_holder_name,
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
    if (gateway.gateway_name !== "CashFree") {
      throw new Error("Invalid payment gateway");
    }

    const isTestMode = environment === "test";
    const apiUrl = isTestMode
      ? "https://sandbox.cashfree.com/pg/orders"
      : "https://api.cashfree.com/pg/orders";

    const clientId = isTestMode ? gateway.test_api_key : gateway.production_api_key;
    const clientSecret = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

    if (!clientId || !clientSecret) {
      throw new Error("Gateway credentials not configured");
    }

    await supabase
      .from("payments")
      .update({
        status: "processing",
        gateway_environment: environment,
        card_type: card_type,
        card_last_four: card_number.slice(-4),
        updated_at: new Date().toISOString()
      })
      .eq("id", payment_id);

    await supabase
      .from("payment_logs")
      .insert({
        payment_id: payment_id,
        status: "processing",
        message: "Payment processing initiated via CashFree",
        metadata: { gateway: "CashFree", environment }
      });

    const categoryName = payment.card_type?.toLowerCase() || "";

    let allowedSchemes: string[] = [];

    if (categoryName.includes("american express") || categoryName.includes("diners")) {
      allowedSchemes = ["AMEX", "DINERS"];
    } else if (categoryName.includes("visa") || categoryName.includes("master") || categoryName.includes("rupay")) {
      allowedSchemes = ["VISA", "MASTERCARD", "RUPAY"];
    } else {
      allowedSchemes = ["VISA", "MASTERCARD", "RUPAY", "AMEX", "DINERS"];
    }

    const orderMeta: any = {
      return_url: `${req.headers.get("origin")}/payment-status?payment_id=${payment_id}`,
      notify_url: `${supabaseUrl}/functions/v1/cashfree-webhook`,
      payment_methods_filters: {
        methods: {
          action: "ALLOW",
          values: ["credit_card"]
        },
        filters: {
          card_schemes: {
            action: "ALLOW",
            values: allowedSchemes
          }
        }
      }
    };

    const orderRequest: any = {
      order_id: payment.payment_reference,
      order_amount: parseFloat(payment.total_amount),
      order_currency: "INR",
      customer_details: {
        customer_id: user.id,
        customer_email: user.email,
        customer_phone: payment.beneficiaries?.mobile_number || "9999999999",
        customer_name: card_holder_name
      },
      order_meta: orderMeta
    };

    // Payment Split: configure Easy Split vendor at order creation time
    const payoutMode = gateway.payout_mode;
    let splitConfigured = false;
    if (payoutMode === "payment_split" && payment.beneficiaries) {
      try {
        const settlementTime = payment.category_details?.settlement_time || null;
        const splitSchedule = getCashfreeSplitSchedule(settlementTime);
        const vendorId = await ensureCashfreeVendor(
          supabase,
          payment.beneficiaries,
          clientId,
          clientSecret,
          isTestMode,
        );

        // Calculate vendor amount = base amount (charges stay with platform)
        const vendorAmount = parseFloat(payment.amount);

        orderRequest.order_splits = [
          {
            vendor_id: vendorId,
            amount: vendorAmount,
            percentage: null,
            tags: { settlement_schedule: splitSchedule },
          },
        ];
        splitConfigured = true;
      } catch (splitErr) {
        console.error("CashFree split setup error (continuing without split):", splitErr);
      }
    }

    const orderResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2025-01-01"
      },
      body: JSON.stringify(orderRequest)
    });

    const orderData = await orderResponse.json();

    if (!orderResponse.ok) {
      throw new Error(orderData.message || "Failed to create order");
    }

    const paymentRequestBody = {
      payment_method: {
        card: {
          channel: "link",
          card_number: card_number,
          card_holder_name: card_holder_name,
          card_expiry_mm: card_expiry_month,
          card_expiry_yy: card_expiry_year,
          card_cvv: card_cvv
        }
      },
      payment_session_id: orderData.payment_session_id
    };

    const paymentUrl = `${apiUrl}/${orderData.order_id}/pay`;
    const paymentResponse = await fetch(paymentUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2023-08-01"
      },
      body: JSON.stringify(paymentRequestBody)
    });

    const paymentData = await paymentResponse.json();

    const gatewayRequestLog = {
      order_request: {
        ...orderRequest,
        // Omit sensitive split vendor details from log if needed
      },
      payment_request: {
        ...paymentRequestBody,
        payment_method: {
          card: {
            ...paymentRequestBody.payment_method.card,
            card_number: `****${card_number.slice(-4)}`,
            card_cvv: '***'
          }
        }
      },
      api_url: paymentUrl,
      split_configured: splitConfigured,
      timestamp: new Date().toISOString(),
    };

    await supabase
      .from("payments")
      .update({
        gateway_request: gatewayRequestLog,
        gateway_response: paymentData,
        gateway_transaction_id: paymentData.cf_payment_id || null,
        gateway_status_code: paymentData.payment_status || null,
        split_configured: splitConfigured,
        updated_at: new Date().toISOString()
      })
      .eq("id", payment_id);

    if (paymentResponse.ok && paymentData.payment_status === "SUCCESS") {
      const isVerifiedMerchant = payment.beneficiary_details?.is_verified_merchant === true;
      const kycRequired =
        payment.category_details?.receiver_kyc_required === true ||
        payment.selected_payment_option?.receiver_kyc_required === true;
      const isEligibleForPayout = isVerifiedMerchant || !kycRequired;
      const splitConfigured_ = splitConfigured;

      let finalStatus: string;
      if (!isEligibleForPayout) {
        finalStatus = "kyc_pending";
      } else if (payoutMode === "payment_split" && splitConfigured_) {
        finalStatus = "completed";
      } else {
        finalStatus = "settlement_pending";
      }

      await supabase
        .from("payments")
        .update({
          status: finalStatus,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", payment_id);

      await supabase
        .from("payment_logs")
        .insert({
          payment_id: payment_id,
          status: finalStatus,
          message: splitConfigured
            ? "Payment completed via CashFree with split settlement configured"
            : "Payment completed successfully via CashFree",
          metadata: {
            transaction_id: paymentData.cf_payment_id,
            gateway: "CashFree",
            environment: environment,
            payment_status: paymentData.payment_status,
            card_type: card_type,
            card_last_four: card_number.slice(-4),
            amount: payment.total_amount,
            split_configured: splitConfigured,
            response_data: paymentData
          }
        });

      // Trigger auto-payout only for non-split mode (split is handled by CashFree directly)
      if (payoutMode !== "payment_split") {
        fetch(`${supabaseUrl}/functions/v1/auto-payout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ payment_id }),
        }).catch((e) => console.error("Auto payout trigger failed:", e));
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: finalStatus,
          transactionId: paymentData.cf_payment_id,
          transaction_id: paymentData.cf_payment_id,
          payment_id: payment_id,
          split_configured: splitConfigured,
          message: splitConfigured
            ? "Payment completed with split settlement"
            : "Payment completed successfully"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      const failureReason = paymentData.payment_message || paymentData.error_description || "Payment failed";

      await supabase
        .from("payments")
        .update({
          status: "failed",
          failure_reason: failureReason,
          updated_at: new Date().toISOString()
        })
        .eq("id", payment_id);

      await supabase
        .from("payment_logs")
        .insert({
          payment_id: payment_id,
          status: "failed",
          message: `Payment failed via CashFree: ${failureReason}`,
          metadata: {
            gateway: "CashFree",
            environment: environment,
            failure_reason: failureReason,
            card_type: card_type,
            card_last_four: card_number.slice(-4),
            amount: payment.total_amount,
            response_data: paymentData
          }
        });

      return new Response(
        JSON.stringify({
          success: false,
          status: "failed",
          message: failureReason
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  } catch (error) {
    console.error("CashFree payment error:", error);
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
