import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PayoutRequest {
  beneficiary_id: string;
  amount: number;
  transfer_type: "IMPS" | "NEFT" | "RTGS";
  gateway_id: string;
  instant_settlement?: boolean;
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
      gateway_id,
      instant_settlement = false
    } = payload;

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
      .eq("gateway_name", "RazorPay")
      .eq("status", "active")
      .single();

    if (gatewayError || !gateway) {
      throw new Error("Gateway not found or inactive");
    }

    // Use gateway's own environment setting as the authoritative source
    const normalizedEnvironment = (gateway.environment || "production").toLowerCase();
    const isTestMode = normalizedEnvironment === "test";
    const baseUrl = "https://api.razorpay.com/v1";

    const keyId = isTestMode
      ? ((gateway.test_payout_client_id       || "").trim() || (gateway.test_api_key    || "").trim())
      : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
    const keySecret = isTestMode
      ? ((gateway.test_payout_client_secret       || "").trim() || (gateway.test_api_secret    || "").trim())
      : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());

    if (!keyId || !keySecret) {
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
        message: "Payout processing initiated via RazorPay",
        metadata: { gateway: "RazorPay", environment: normalizedEnvironment, transfer_type }
      });

    const authString = btoa(`${keyId}:${keySecret}`);

    const contactData = {
      name: beneficiary.account_holder_name,
      email: user.email,
      contact: beneficiary.mobile_number || "9999999999",
      type: "customer",
      reference_id: `contact_${beneficiary.id}`,
      notes: {
        beneficiary_id: beneficiary.id
      }
    };

    const contactResponse = await fetch(`${baseUrl}/contacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`
      },
      body: JSON.stringify(contactData)
    });

    const contactResult = await contactResponse.json();
    const contactId = contactResult.id;

    if (!contactResponse.ok) {
      if (contactResult.error?.description?.includes("already exists")) {
        const existingContactResponse = await fetch(
          `${baseUrl}/contacts?reference_id=contact_${beneficiary.id}`,
          {
            headers: { "Authorization": `Basic ${authString}` }
          }
        );
        const existingContacts = await existingContactResponse.json();
        if (existingContacts.items && existingContacts.items.length > 0) {
          contactResult.id = existingContacts.items[0].id;
        }
      } else {
        throw new Error(contactResult.error?.description || "Failed to create contact");
      }
    }

    const fundAccountData = {
      contact_id: contactResult.id,
      account_type: "bank_account",
      bank_account: {
        name: beneficiary.account_holder_name,
        ifsc: beneficiary.ifsc_code,
        account_number: beneficiary.account_number
      }
    };

    const fundAccountResponse = await fetch(`${baseUrl}/fund_accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`
      },
      body: JSON.stringify(fundAccountData)
    });

    const fundAccountResult = await fundAccountResponse.json();

    if (!fundAccountResponse.ok) {
      throw new Error(fundAccountResult.error?.description || "Failed to create fund account");
    }

    const payoutAccountNumber = isTestMode
      ? ((gateway.test_payout_account_number       || "").trim() || (gateway.razorpay_account_number || "").trim())
      : ((gateway.production_payout_account_number || "").trim() || (gateway.razorpay_account_number || "").trim());

    if (!payoutAccountNumber) {
      throw new Error("RazorPay account number not configured");
    }

    const payoutData: any = {
      account_number: payoutAccountNumber,
      fund_account_id: fundAccountResult.id,
      amount: Math.round(netAmount * 100),
      currency: "INR",
      mode: transfer_type,
      purpose: "payout",
      queue_if_low_balance: false,
      reference_id: payoutReference,
      narration: `Payout ${payoutReference}`,
      notes: {
        payout_id: payout.id,
        user_id: user.id
      }
    };

    if (instant_settlement && transfer_type === "IMPS") {
      payoutData.mode = "IMPS";
      payoutData.queue_if_low_balance = false;
    }

    const payoutResponse = await fetch(`${baseUrl}/payouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${authString}`
      },
      body: JSON.stringify(payoutData)
    });

    const result = await payoutResponse.json();

    await supabase
      .from("payouts")
      .update({
        gateway_request: payoutData,
        gateway_response: result,
        gateway_transaction_id: result.id || null,
        gateway_status_code: result.status || null
      })
      .eq("id", payout.id);

    if (payoutResponse.ok && (result.status === "processed" || result.status === "processing")) {
      const finalStatus = result.status === "processed" ? "completed" : "processing";

      const updateData: any = {
        status: finalStatus,
        utr_number: result.utr || null
      };

      if (finalStatus === "completed") {
        updateData.completed_at = new Date().toISOString();
      }

      await supabase
        .from("payouts")
        .update(updateData)
        .eq("id", payout.id);

      await supabase
        .from("payout_logs")
        .insert({
          payout_id: payout.id,
          status: finalStatus,
          message: finalStatus === "completed" ? "Payout completed successfully" : "Payout is processing",
          metadata: { transaction_id: result.id, utr: result.utr }
        });

      return new Response(
        JSON.stringify({
          success: true,
          status: finalStatus,
          payout_id: payout.id,
          payout_reference: payoutReference,
          transaction_id: result.id,
          utr_number: result.utr
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      const failureReason = result.error?.description || "Payout failed";

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
    console.error("RazorPay payout error:", error);
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
