import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PayoutRequest {
  user_id: string;
  beneficiary_id: string;
  amount: number;
  transfer_type: "IMPS" | "NEFT" | "RTGS";
  gateway_id: string;
  instant_settlement?: boolean;
}

function getCashfreePayoutBase(env: string): string {
  return env === "test"
    ? "https://sandbox.cashfree.com/payout"
    : "https://api.cashfree.com/payout";
}

function getCashfreePayoutCredentials(gateway: any, env: string): { clientId: string; clientSecret: string; twoFaPublicKey: string } {
  const isTest = env === "test";
  const clientId = isTest
    ? ((gateway.test_payout_client_id        || "").trim() || (gateway.test_api_key    || "").trim())
    : ((gateway.production_payout_client_id  || "").trim() || (gateway.production_api_key || "").trim());
  const clientSecret = isTest
    ? ((gateway.test_payout_client_secret       || "").trim() || (gateway.test_api_secret    || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());
  const twoFaPublicKey = isTest
    ? (gateway.test_cashfree_2fa_public_key       || "").trim()
    : (gateway.production_cashfree_2fa_public_key || "").trim();
  return { clientId, clientSecret, twoFaPublicKey };
}

async function generateCashfree2FASignature(clientId: string, publicKeyPem: string): Promise<string> {
  const payload = `${clientId}.${Math.floor(Date.now() / 1000)}`;
  const pemBody = publicKeyPem
    .replace(/-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/g, "")
    .replace(/-----END (CERTIFICATE|PUBLIC KEY)-----/g, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "spki", binaryDer.buffer,
    { name: "RSA-OAEP", hash: "SHA-1" }, false, ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" }, cryptoKey, new TextEncoder().encode(payload),
  );
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

async function buildCashfreeHeaders(gateway: any, env: string): Promise<Record<string, string>> {
  const { clientId, clientSecret, twoFaPublicKey } = getCashfreePayoutCredentials(gateway, env);
  const hdrs: Record<string, string> = {
    "Content-Type":    "application/json",
    "x-client-id":     clientId,
    "x-client-secret": clientSecret,
    "x-api-version":   "2024-01-01",
  };
  if (twoFaPublicKey) {
    hdrs["X-Cf-Signature"] = await generateCashfree2FASignature(clientId, twoFaPublicKey);
  }
  return hdrs;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload: PayoutRequest = await req.json();
    const {
      user_id,
      beneficiary_id,
      amount,
      transfer_type,
      gateway_id,
      instant_settlement = false,
    } = payload;

    if (!user_id) {
      return new Response(JSON.stringify({ success: false, error: "Missing user_id" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user via custom auth (app does not use Supabase JWT sessions)
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("id, is_disabled")
      .eq("id", user_id)
      .maybeSingle();

    if (userErr || !userRow) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (userRow.is_disabled) {
      return new Response(JSON.stringify({ success: false, error: "Account is disabled" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: beneficiary, error: beneficiaryError } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("id", beneficiary_id)
      .eq("user_id", user_id)
      .eq("status", "active")
      .single();

    if (beneficiaryError || !beneficiary) {
      throw new Error("Beneficiary not found or inactive");
    }

    const { data: gateway, error: gatewayError } = await supabase
      .from("payment_gateway_settings")
      .select("*")
      .eq("id", gateway_id)
      .eq("status", "active")
      .single();

    if (gatewayError || !gateway) {
      throw new Error("Gateway not found or inactive");
    }

    // Normalize environment — Admin UI saves "Testing"/"Production" (capitalized)
    const rawEnv = (gateway.environment || "").toLowerCase();
    const normalizedEnvironment = rawEnv.startsWith("prod") ? "production" : "test";

    const base = getCashfreePayoutBase(normalizedEnvironment);
    const { clientId, clientSecret } = getCashfreePayoutCredentials(gateway, normalizedEnvironment);
    if (!clientId || !clientSecret) {
      throw new Error("Gateway payout credentials not configured");
    }

    const cfHeaders = await buildCashfreeHeaders(gateway, normalizedEnvironment);

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
        user_id,
        beneficiary_id,
        payment_gateway_id: gateway_id,
        amount,
        charges,
        gst,
        instant_settlement,
        instant_settlement_charges: instantSettlementCharges,
        instant_settlement_charges_percentage: instantSettlementPercentage,
        total_deduction: totalDeduction,
        net_amount: netAmount,
        payout_reference: payoutReference,
        transfer_type,
        account_number: beneficiary.bank_account,
        ifsc_code: beneficiary.ifsc,
        account_holder_name: beneficiary.full_name,
        bank_name: beneficiary.bank_name,
        gateway_environment: normalizedEnvironment,
        status: "pending",
        ip_address: req.headers.get("x-forwarded-for") || "127.0.0.1",
      })
      .select()
      .single();

    if (payoutCreateError || !payout) {
      throw new Error("Failed to create payout record");
    }

    await supabase.from("payouts").update({ status: "processing" }).eq("id", payout.id);

    await supabase.from("payout_logs").insert({
      payout_id: payout.id,
      status: "processing",
      message: "Payout processing initiated via CashFree",
      metadata: { gateway: "CashFree", environment: normalizedEnvironment, transfer_type },
    });

    // Register beneficiary via Cashfree Payout v2
    // If already registered, skip the POST and use the stored ID directly.
    let beneId = (beneficiary.cashfree_bene_id || "").trim();
    if (!beneId) {
      beneId = `b${beneficiary.id.replace(/-/g, "").substring(0, 15)}`;
      const phone = (beneficiary.mobile || "9999999999").replace(/\D/g, "").slice(-10) || "9999999999";

      const beneRes = await fetch(`${base}/beneficiary`, {
        method: "POST",
        headers: cfHeaders,
        body: JSON.stringify({
          beneficiary_id:   beneId,
          beneficiary_name: beneficiary.full_name,
          beneficiary_instrument_details: {
            bank_account_number: beneficiary.bank_account,
            bank_ifsc:           beneficiary.ifsc,
          },
          beneficiary_contact_details: {
            beneficiary_email:        beneficiary.email || "noreply@paybycard.in",
            beneficiary_phone:        phone,
            beneficiary_country_code: "+91",
            beneficiary_address:      "India",
            beneficiary_city:         "Mumbai",
            beneficiary_state:        "Maharashtra",
            beneficiary_postal_code:  "400001",
          },
        }),
      });

      const beneData = await beneRes.json();

      if (beneRes.status === 201 || beneRes.status === 200) {
        await supabase.from("beneficiaries")
          .update({ cashfree_bene_id: beneId, updated_at: new Date().toISOString() })
          .eq("id", beneficiary.id);
      } else if (beneRes.status === 409) {
        const errCode = beneData?.code ?? "";
        if (errCode === "beneficiary_id_already_exists") {
          await supabase.from("beneficiaries")
            .update({ cashfree_bene_id: beneId, updated_at: new Date().toISOString() })
            .eq("id", beneficiary.id);
        } else {
          // Same bank account registered under a different ID — look it up
          const getRes = await fetch(
            `${base}/beneficiary?bank_account_number=${encodeURIComponent(beneficiary.bank_account)}&bank_ifsc=${encodeURIComponent(beneficiary.ifsc)}`,
            { headers: cfHeaders },
          );
          const getData = await getRes.json();
          const existingBeneId: string | null = getData?.beneficiary_id ?? null;
          if (!existingBeneId) {
          const errMsg = `Beneficiary conflict (409) and GET lookup failed: ${JSON.stringify(getData).slice(0, 200)}`;
          await supabase.from("payouts").update({ status: "failed", failure_reason: errMsg }).eq("id", payout.id);
          return new Response(JSON.stringify({ success: false, status: "failed", message: errMsg, payout_id: payout.id }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        beneId = existingBeneId;
        await supabase.from("beneficiaries")
          .update({ cashfree_bene_id: existingBeneId, updated_at: new Date().toISOString() })
          .eq("id", beneficiary.id);
      }
    } else {
      const errMsg = beneData?.message || `Beneficiary registration failed (HTTP ${beneRes.status})`;
      await supabase.from("payouts").update({ status: "failed", failure_reason: errMsg }).eq("id", payout.id);
      return new Response(JSON.stringify({ success: false, status: "failed", message: errMsg, payout_id: payout.id }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    } // end if (!beneId)

    // Initiate transfer via Cashfree Payout v2
    const transferId = `MAN-${payoutReference}`;
    const txRes = await fetch(`${base}/transfers`, {
      method: "POST",
      headers: cfHeaders,
      body: JSON.stringify({
        transfer_id:     transferId,
        transfer_amount: netAmount,
        beneficiary_details: { beneficiary_id: beneId },
      }),
    });
    const result = await txRes.json();

    await supabase.from("payouts").update({
      gateway_request:       { transfer_id: transferId, amount: netAmount, beneficiary_id: beneId },
      gateway_response:      result,
      gateway_transaction_id: result?.cf_transfer_id ?? result?.transfer_id ?? transferId,
      gateway_status_code:   result?.status || null,
    }).eq("id", payout.id);

    // v2 response: { status: "RECEIVED"|"SUCCESS"|"APPROVAL_PENDING", cf_transfer_id, utr }
    const txStatus = (result?.status ?? "").toUpperCase();
    const txOk = txRes.ok && ["RECEIVED", "SUCCESS", "APPROVAL_PENDING"].includes(txStatus);

    if (txOk) {
      const utr = result?.utr || null;
      await supabase.from("payouts").update({
        status:     "processing",
        utr_number: utr,
      }).eq("id", payout.id);

      await supabase.from("payout_logs").insert({
        payout_id: payout.id,
        status:    "processing",
        message:   "Payout accepted via CashFree",
        metadata:  { transfer_id: transferId, cf_transfer_id: result?.cf_transfer_id, utr },
      });

      return new Response(JSON.stringify({
        success:          true,
        status:           "processing",
        payout_id:        payout.id,
        payout_reference: payoutReference,
        transfer_id:      transferId,
        utr_number:       utr,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      const failureReason = result.message || "Payout failed";
      await supabase.from("payouts").update({ status: "failed", failure_reason: failureReason }).eq("id", payout.id);
      await supabase.from("payout_logs").insert({
        payout_id: payout.id,
        status:    "failed",
        message:   failureReason,
        metadata:  result,
      });

      return new Response(JSON.stringify({
        success:   false,
        status:    "failed",
        message:   failureReason,
        payout_id: payout.id,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error("CashFree payout error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// redeploy
