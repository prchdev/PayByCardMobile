import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * process-axis-payout — Transfer money to a beneficiary using Axis Bank Corporate Payout API
 *
 * Based on Axis Bank Corporate API Process and Requirement Specification:
 *   Product 35409: Corporate Payout (7 APIs)
 *   Product 36009: Beneficiary Management (2 APIs)
 *
 * Flow:
 *   1. Fetch OAuth2 access token from Axis Bank token endpoint
 *   2. Call Balance Enquiry API to verify available balance
 *   3. If available balance >= transfer amount, create fund transfer request
 *   4. Return the transfer status and reference number
 *
 * If balance is insufficient, returns a "pending" status so the auto-payout
 * job can retry in the next run (FIFO — first confirmed payment gets paid first).
 */

interface AxisPayoutRequest {
  payment_id: string;
  beneficiary_account_number: string;
  beneficiary_ifsc: string;
  beneficiary_name: string;
  amount: number;
  remarks?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      payment_id,
      beneficiary_account_number,
      beneficiary_ifsc,
      beneficiary_name,
      amount,
      remarks,
    } = await req.json() as AxisPayoutRequest;

    if (!payment_id || !beneficiary_account_number || !beneficiary_ifsc || !beneficiary_name || !amount) {
      return new Response(JSON.stringify({ error: "Missing required payout parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch payout settings
    const { data: settings, error: settingsError } = await supabase
      .from("payout_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings) {
      return new Response(JSON.stringify({ error: "Payout settings not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isTest = settings.environment === "test";
    const clientId = isTest ? settings.axis_test_client_id : settings.axis_production_client_id;
    const clientSecret = isTest ? settings.axis_test_client_secret : settings.axis_production_client_secret;
    const baseUrl = isTest ? settings.axis_test_base_url : settings.axis_production_base_url;
    const corpAccNum = isTest ? settings.axis_test_virtual_account : settings.axis_production_virtual_account;
    const corpCode = settings.axis_corporate_id;
    const channelId = settings.axis_channel_id || "TXB";

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Axis Bank API credentials not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!corpAccNum || !corpCode) {
      return new Response(JSON.stringify({ error: "Axis Bank corporate account number or corporate ID not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Get OAuth2 access token
    const tokenUrl = `${baseUrl}/oauth/v2/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "neoapi",
      }),
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error("Axis Bank token error:", tokenError);
      return new Response(JSON.stringify({ error: "Failed to authenticate with Axis Bank API" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "No access token received from Axis Bank" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Balance Enquiry API — verify available balance before transfer
    const balanceUrl = `${baseUrl}/neo/v1/account/balance`;
    const balancePayload = {
      channelId,
      corpCode,
      corpAccNum,
    };

    const balanceResponse = await fetch(balanceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "client-id": clientId,
      },
      body: JSON.stringify(balancePayload),
    });

    const balanceData = await balanceResponse.json();

    if (!balanceResponse.ok || balanceData?.status !== "S") {
      console.error("Axis Bank balance enquiry error:", JSON.stringify(balanceData));
      return new Response(JSON.stringify({
        error: "Failed to verify account balance with Axis Bank",
        details: balanceData?.message || "Balance enquiry failed",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const availableBalance = parseFloat(balanceData?.data?.Balance ?? "0");

    // If available balance is less than the transfer amount, return pending status
    // so the auto-payout job can retry in the next run (FIFO order)
    if (availableBalance < amount) {
      return new Response(JSON.stringify({
        success: false,
        status: "pending",
        pending_reason: "insufficient_balance",
        available_balance: availableBalance,
        required_amount: amount,
        message: `Insufficient balance in Axis Bank account. Available: ₹${availableBalance.toFixed(2)}, Required: ₹${amount.toFixed(2)}. Payment will be retried in the next payout job run.`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 3: Create fund transfer using Corporate Payout API
    const transferUrl = `${baseUrl}/neo/v1/payments/transfer`;
    const transferPayload = {
      channelId,
      corpCode,
      corpAccNum,
      paymentDetails: {
        paymentReference: payment_id,
        beneAccNum: beneficiary_account_number,
        beneIfscCode: beneficiary_ifsc,
        beneName: beneficiary_name,
        amount: String(amount),
        currency: "INR",
        remarks: remarks || `Payout for ${payment_id}`,
        transferType: "IMPS",
      },
    };

    const transferResponse = await fetch(transferUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "client-id": clientId,
      },
      body: JSON.stringify(transferPayload),
    });

    const transferData = await transferResponse.json();

    if (!transferResponse.ok || transferData?.status !== "S") {
      console.error("Axis Bank transfer error:", JSON.stringify(transferData));
      return new Response(JSON.stringify({
        error: "Axis Bank transfer failed",
        details: transferData?.message || "Unknown error",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 4: Return transfer status
    const responseData = transferData?.data || {};
    return new Response(JSON.stringify({
      success: true,
      status: "processing",
      reference_number: responseData.referenceNumber || responseData.rrn || responseData.utr || "",
      utr: responseData.utr || responseData.rrn || null,
      message: transferData?.message || "Transfer initiated successfully",
      raw_response: transferData,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Axis payout error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
