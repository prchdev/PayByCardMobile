import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHash } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PayoutRequest {
  beneficiary_id: string;
  amount: number;
  transfer_type: "IMPS" | "NEFT" | "RTGS";
  environment?: "test" | "production";
  gateway_id: string;
  instant_settlement?: boolean;
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

    const payload: PayoutRequest = await req.json();
    const {
      beneficiary_id,
      amount,
      transfer_type,
      environment = "production",
      gateway_id,
      instant_settlement = false
    } = payload;

    const normalizedEnvironment = environment.toLowerCase();

    const { data: beneficiary, error: beneficiaryError } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("id", beneficiary_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (beneficiaryError || !beneficiary) {
      throw new Error("Beneficiary not found or inactive");
    }

    const { data: gateway, error: gatewayError } = await supabase
      .from("payment_gateway_settings")
      .select("*")
      .eq("id", gateway_id)
      .eq("gateway_name", "ZaakPay")
      .eq("status", "active")
      .single();

    if (gatewayError || !gateway) {
      throw new Error("Gateway not found or inactive");
    }

    const isTestMode = normalizedEnvironment === "test";
    const baseUrl = isTestMode
      ? "https://zaakstaging.com/api/payouts"
      : "https://api.zaakpay.com/api/payouts";

    const merchantId = isTestMode ? gateway.test_merchant_id : gateway.production_merchant_id;
    const secretKey = isTestMode ? gateway.test_api_secret : gateway.production_api_secret;

    if (!merchantId || !secretKey) {
      throw new Error("Gateway credentials not configured");
    }

    const payoutReference = await supabase.rpc("generate_payout_reference").then(({ data }) => data);

    const charges = 0;
    const gst = 0;
    let instantSettlementCharges = 0;
    let instantSettlementPercentage = 0;

    if (instant_settlement && gateway.instant_settlement_charges_percentage > 0) {
      instantSettlementPercentage = gateway.instant_settlement_charges_percentage;
      instantSettlementCharges = (amount * instantSettlementPercentage) / 100;
    }

    const totalDeduction = charges + gst + instantSettlementCharges;
    const netAmount = amount - totalDeduction;

    const { data: payout, error: payoutCreateError } = await supabase
      .from("payouts")
      .insert({
        user_id: user.id,
        beneficiary_id: beneficiary_id,
        payment_gateway_id: gateway_id,
        amount: amount,
        charges: charges,
        gst: gst,
        instant_settlement: instant_settlement,
        instant_settlement_charges: instantSettlementCharges,
        instant_settlement_charges_percentage: instantSettlementPercentage,
        total_deduction: totalDeduction,
        net_amount: netAmount,
        payout_reference: payoutReference,
        transfer_type: transfer_type,
        account_number: beneficiary.account_number,
        ifsc_code: beneficiary.ifsc_code,
        account_holder_name: beneficiary.account_holder_name,
        bank_name: beneficiary.bank_name,
        gateway_environment: normalizedEnvironment,
        status: "pending",
        ip_address: req.headers.get("x-forwarded-for") || "127.0.0.1"
      })
      .select()
      .single();

    if (payoutCreateError || !payout) {
      throw new Error("Failed to create payout record");
    }

    await supabase
      .from("payouts")
      .update({ status: "processing" })
      .eq("id", payout.id);

    await supabase
      .from("payout_logs")
      .insert({
        payout_id: payout.id,
        status: "processing",
        message: "Payout processing initiated via ZaakPay",
        metadata: { gateway: "ZaakPay", environment, transfer_type }
      });

    const checksumString = `'${merchantId}'+'${payoutReference}'+'${netAmount.toFixed(2)}'+'${beneficiary.account_number}'+'${beneficiary.ifsc_code}'`;
    const checksum = generateZaakPayChecksum(checksumString, secretKey);

    const payoutData: any = {
      merchantIdentifier: merchantId,
      transactionId: payoutReference,
      amount: netAmount.toFixed(2),
      beneficiaryAccount: beneficiary.account_number,
      beneficiaryIFSC: beneficiary.ifsc_code,
      beneficiaryName: beneficiary.account_holder_name,
      transferMode: transfer_type,
      purpose: "payout",
      remarks: `Payout ${payoutReference}`,
      checksum: checksum,
      email: user.email,
      phone: beneficiary.mobile_number || "9999999999"
    };

    if (instant_settlement) {
      payoutData.instantSettlement = "Y";
    }

    const response = await fetch(`${baseUrl}/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payoutData)
    });

    const result = await response.json();

    await supabase
      .from("payouts")
      .update({
        gateway_request: payoutData,
        gateway_response: result,
        gateway_transaction_id: result.transactionId || result.referenceId || null,
        gateway_status_code: result.responseCode || null
      })
      .eq("id", payout.id);

    if (response.ok && result.responseCode === "200") {
      await supabase
        .from("payouts")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          utr_number: result.utrNumber || result.bankReferenceNumber || null
        })
        .eq("id", payout.id);

      await supabase
        .from("payout_logs")
        .insert({
          payout_id: payout.id,
          status: "completed",
          message: "Payout completed successfully",
          metadata: { transaction_id: result.transactionId, utr: result.utrNumber }
        });

      return new Response(
        JSON.stringify({
          success: true,
          status: "completed",
          payout_id: payout.id,
          payout_reference: payoutReference,
          transaction_id: result.transactionId,
          utr_number: result.utrNumber
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      const failureReason = result.responseDescription || result.message || "Payout failed";

      await supabase
        .from("payouts")
        .update({
          status: "failed",
          failure_reason: failureReason
        })
        .eq("id", payout.id);

      await supabase
        .from("payout_logs")
        .insert({
          payout_id: payout.id,
          status: "failed",
          message: failureReason,
          metadata: result
        });

      return new Response(
        JSON.stringify({
          success: false,
          status: "failed",
          message: failureReason,
          payout_id: payout.id
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  } catch (error) {
    console.error("ZaakPay payout error:", error);
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
