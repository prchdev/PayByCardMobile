import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/**
 * auto-payout — FIFO batch payout processor (runs every 10 min via pg_cron)
 *
 * Targets payments where:
 *   • status IN ('settlement_pending', 'settlement_in_progress')
 *   • payment_gateway_settings.payout_mode IN ('payout', 'payment_split')
 *
 * Processing rules:
 *   payout (Auto Payout):
 *     – For settlement_pending: apply settlement cycle delay before executing
 *     – For settlement_in_progress: only process when gateway_settlement_status
 *       indicates funds arrived ("settled", "paid", "success")
 *     – Check gateway payout account balance before each payment
 *     – Register beneficiary as vendor with KYC (PAN + Aadhaar) in gateway
 *     – Confirm payout capture after initiation
 *     – Send email + SMS on successful completion
 *
 *   payment_split:
 *     – Process immediately (no settlement cycle delay)
 *     – Sort by created_at ASC
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = () => Deno.env.get("SUPABASE_ANON_KEY")!;

// Gateway settlement statuses that mean funds are confirmed in payout account.
// "captured" is included because Razorpay test payments never get a settlement_id
// but are considered settled once captured.
const GATEWAY_SETTLED_STATUSES = new Set(["settled", "paid", "success", "captured"]);

// ─── Settlement cycle helpers ─────────────────────────────────────────────────

function getSettlementDays(settlementTime: string | null | undefined): number {
  if (!settlementTime) return 0;
  const t = settlementTime.trim().toLowerCase();
  if (t === "instant" || t === "t+0") return 0;
  const match = t.match(/^t\+(\d+)$/i);
  if (match) return parseInt(match[1], 10);
  return 0;
}

function getDueDate(createdAt: string, settlementDays: number): Date {
  return new Date(new Date(createdAt).getTime() + settlementDays * 24 * 60 * 60 * 1000);
}

function resolveTransferMode(_settlementTime: string | null | undefined): string {
  return "IMPS";
}

function priorityTier(days: number): number {
  if (days === 0) return 0;
  if (days === 1) return 1;
  return 2;
}

function getCredentials(gateway: any, env: string): { apiKey: string; apiSecret: string } {
  const isTest = (env ?? "production").toLowerCase() === "test";
  return {
    apiKey:    (isTest ? gateway.test_api_key    : gateway.production_api_key)    ?? "",
    apiSecret: (isTest ? gateway.test_api_secret : gateway.production_api_secret) ?? "",
  };
}

// ─── Payment settlement verifiers ─────────────────────────────────────────────

interface SettlementResult {
  settled: boolean;
  reason: string;
  gatewayStatus: string;
}

async function verifyRazorpaySettlement(
  gateway: any,
  env: string,
  gatewayTransactionId: string,
): Promise<SettlementResult> {
  const { apiKey, apiSecret } = getCredentials(gateway, env);
  if (!apiKey || !apiSecret) {
    return { settled: false, reason: "Missing Razorpay credentials", gatewayStatus: "check_failed" };
  }
  if (!gatewayTransactionId) {
    return { settled: false, reason: "No gateway_transaction_id on payment", gatewayStatus: "no_tx_id" };
  }
  // Test environment: Razorpay never issues settlement_id for test payments.
  // A captured test payment is equivalent to settled — allow payout to proceed.
  const isTest = (env ?? "production").toLowerCase() === "test";
  const auth = `Basic ${btoa(`${apiKey}:${apiSecret}`)}`;
  try {
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${gatewayTransactionId}`,
      { headers: { "Authorization": auth } },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { settled: false, reason: `Razorpay payment fetch failed: ${err?.error?.description ?? res.status}`, gatewayStatus: "check_failed" };
    }
    const data = await res.json();
    if (data.status !== "captured") {
      return { settled: false, reason: `Payment not captured (status: ${data.status})`, gatewayStatus: "not_captured" };
    }
    if (data.settlement_id) {
      return { settled: true, reason: `captured + settled (settlement_id: ${data.settlement_id})`, gatewayStatus: "settled" };
    }
    if (isTest) {
      return { settled: true, reason: "Payment captured in test environment (settlement_id not issued for test payments)", gatewayStatus: "captured" };
    }
    return { settled: false, reason: "Payment captured but not yet settled (no settlement_id)", gatewayStatus: "captured" };
  } catch (e: any) {
    return { settled: false, reason: `Razorpay settlement check error: ${e?.message}`, gatewayStatus: "check_failed" };
  }
}

async function verifyCashfreeSettlement(
  gateway: any,
  env: string,
  paymentReference: string,
): Promise<SettlementResult> {
  const { apiKey, apiSecret } = getCredentials(gateway, env);
  if (!apiKey || !apiSecret) {
    return { settled: false, reason: "Missing Cashfree credentials", gatewayStatus: "check_failed" };
  }
  const base = (env ?? "production").toLowerCase() === "test"
    ? "https://sandbox.cashfree.com"
    : "https://api.cashfree.com";
  const hdrs = {
    "x-client-id":     apiKey,
    "x-client-secret": apiSecret,
    "x-api-version":   "2023-08-01",
  };
  try {
    const orderRes = await fetch(`${base}/pg/orders/${paymentReference}`, { headers: hdrs });
    if (!orderRes.ok) {
      const err = await orderRes.json().catch(() => ({}));
      return { settled: false, reason: `Cashfree order fetch failed: ${err?.message ?? orderRes.status}`, gatewayStatus: "check_failed" };
    }
    const order = await orderRes.json();
    if (order.order_status !== "PAID") {
      return { settled: false, reason: `Order not PAID (status: ${order.order_status})`, gatewayStatus: "not_paid" };
    }
    const settlRes = await fetch(`${base}/pg/orders/${paymentReference}/settlements`, { headers: hdrs });
    if (!settlRes.ok) {
      return { settled: false, reason: `Cashfree settlements fetch failed (status: ${settlRes.status})`, gatewayStatus: "paid" };
    }
    const settlData = await settlRes.json();
    const settlements: any[] = Array.isArray(settlData)
      ? settlData
      : (settlData?.data ?? settlData?.settlements ?? (settlData ? [settlData] : []));
    const success = settlements.some(
      (s: any) => (s.settlement_status ?? s.status ?? "").toUpperCase() === "SUCCESS",
    );
    if (success) {
      return { settled: true, reason: "PAID + settlement SUCCESS", gatewayStatus: "settled" };
    }
    const statuses = settlements.map((s: any) => s.settlement_status ?? s.status ?? "unknown").join(", ");
    return { settled: false, reason: `Order PAID but settlement not yet SUCCESS (statuses: ${statuses || "none"})`, gatewayStatus: "paid" };
  } catch (e: any) {
    return { settled: false, reason: `Cashfree settlement check error: ${e?.message}`, gatewayStatus: "check_failed" };
  }
}

async function verifyPhonePeSettlement(
  gateway: any,
  env: string,
  paymentReference: string,
): Promise<SettlementResult> {
  const { apiKey, apiSecret } = getCredentials(gateway, env);
  if (!apiKey || !apiSecret) {
    return { settled: false, reason: "Missing PhonePe credentials", gatewayStatus: "check_failed" };
  }
  const base = (env ?? "production").toLowerCase() === "test"
    ? "https://api-preprod.phonepe.com/apis/hermes"
    : "https://api.phonepe.com/apis/hermes";

  const apiEndpoint = `/pg/v1/status/${apiKey}/${paymentReference}`;
  const hashInput = apiEndpoint + apiSecret;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
  const xVerify = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;

  try {
    const res = await fetch(`${base}${apiEndpoint}`, {
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerify,
        "X-MERCHANT-ID": apiKey,
      },
    });
    if (!res.ok) {
      return { settled: false, reason: `PhonePe status fetch failed (HTTP ${res.status})`, gatewayStatus: "check_failed" };
    }
    const data = await res.json();
    if (!data.success) {
      return { settled: false, reason: `PhonePe status check unsuccessful: ${data.message ?? ""}`, gatewayStatus: "check_failed" };
    }
    const state = (data.data?.state ?? "").toUpperCase();
    if (state !== "PAYMENT_SUCCESS" && state !== "COMPLETED") {
      return { settled: false, reason: `Payment not successful (state: ${state})`, gatewayStatus: "not_paid" };
    }
    // PhonePe does not expose a separate settlement status via the status API.
    // A successful payment is considered settled for payout purposes.
    return { settled: true, reason: `Payment ${state} — considered settled`, gatewayStatus: "settled" };
  } catch (e: any) {
    return { settled: false, reason: `PhonePe settlement check error: ${e?.message}`, gatewayStatus: "check_failed" };
  }
}

async function verifyGatewaySettlement(
  gateway: any,
  env: string,
  payment: any,
): Promise<SettlementResult> {
  const name = (gateway.gateway_name ?? "").toLowerCase();
  if (name.includes("razorpay")) {
    return verifyRazorpaySettlement(gateway, env, payment.gateway_transaction_id);
  }
  if (name.includes("cashfree")) {
    return verifyCashfreeSettlement(gateway, env, payment.payment_reference);
  }
  if (name.includes("phonepe")) {
    return verifyPhonePeSettlement(gateway, env, payment.payment_reference);
  }
  return { settled: true, reason: "unsupported_gateway_skip_check", gatewayStatus: "not_applicable" };
}

// ─── Balance checkers ─────────────────────────────────────────────────────────

async function getRazorpayBalance(gateway: any, env: string): Promise<{ balance: number | null; error?: string }> {
  const isTest = (env ?? "production").toLowerCase() === "test";
  const payoutKeyId = isTest
    ? ((gateway.test_payout_client_id       || "").trim() || (gateway.test_api_key    || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const payoutKeySecret = isTest
    ? ((gateway.test_payout_client_secret       || "").trim() || (gateway.test_api_secret    || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());
  if (!payoutKeyId || !payoutKeySecret) {
    return { balance: null, error: "Missing payout credentials (keyId or keySecret empty)" };
  }
  const accountNumber = isTest
    ? ((gateway.test_payout_account_number       || "").trim() || (gateway.razorpay_account_number || "").trim())
    : ((gateway.production_payout_account_number || "").trim() || (gateway.razorpay_account_number || "").trim());

  const auth = `Basic ${btoa(`${payoutKeyId}:${payoutKeySecret}`)}`;

  try {
    // Razorpay X API: GET /v1/banking_accounts (no query param filtering — not supported)
    // Returns { entity:"collection", count, items:[{ id, account_number, balance (paise) }] }
    const res = await fetch("https://api.razorpay.com/v1/banking_accounts", {
      headers: { "Authorization": auth },
    });

    const bodyText = await res.text();
    if (!res.ok) {
      const errMsg = `Razorpay API ${res.status}: ${bodyText}`;
      console.error(`[getRazorpayBalance] ${errMsg}`);
      return { balance: null, error: errMsg };
    }

    let data: any;
    try { data = JSON.parse(bodyText); } catch { return { balance: null, error: `Non-JSON response: ${bodyText.slice(0, 200)}` }; }

    const items: any[] = data?.items ?? (Array.isArray(data) ? data : (data?.id ? [data] : []));

    const target = accountNumber
      ? (items.find((a: any) => (a.account_number ?? "").replace(/\s/g, "") === accountNumber.replace(/\s/g, "")) ?? (items.length === 1 ? items[0] : null))
      : items[0] ?? null;

    if (!target) {
      const msg = `No matching banking account. count=${items.length}, configured_account=${accountNumber || "(none)"}`;
      console.warn(`[getRazorpayBalance] ${msg}`);
      return { balance: null, error: msg };
    }

    const raw = target.balance;
    if (raw == null) {
      const msg = `balance field missing: ${JSON.stringify(target)}`;
      console.warn(`[getRazorpayBalance] ${msg}`);
      return { balance: null, error: msg };
    }
    const parsed = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (isNaN(parsed)) {
      return { balance: null, error: `balance not a valid number: ${raw}` };
    }
    return { balance: parsed / 100 };
  } catch (e: any) {
    const msg = `Exception: ${e?.message}`;
    console.error(`[getRazorpayBalance] ${msg}`);
    return { balance: null, error: msg };
  }
}

async function getCashfreeBalance(gateway: any, env: string): Promise<{ balance: number | null; error?: string }> {
  const base = getCashfreePayoutBase(env);
  const { headers, error: authError } = await getCashfreePayoutV2Headers(gateway, env);
  if (!headers) return { balance: null, error: `Cashfree auth failed: ${authError ?? "missing credentials"}` };
  try {
    // Cashfree Payout v2: GET /balance
    const res = await fetch(`${base}/balance`, { headers });
    const bodyText = await res.text();
    if (!res.ok) return { balance: null, error: `Cashfree API ${res.status}: ${bodyText.slice(0, 300)}` };
    let data: any;
    try { data = JSON.parse(bodyText); } catch { return { balance: null, error: `Non-JSON response: ${bodyText.slice(0, 200)}` }; }
    const bal = data?.data?.available_balance ?? data?.data?.available ?? data?.available_balance ?? data?.balance;
    return bal != null ? { balance: parseFloat(String(bal)) } : { balance: null, error: `balance field missing: ${bodyText.slice(0, 200)}` };
  } catch (e: any) {
    return { balance: null, error: `Exception: ${e?.message}` };
  }
}

async function getPhonePeBalance(gateway: any, env: string): Promise<{ balance: number | null; error?: string }> {
  const isTest = (env ?? "production").toLowerCase() === "test";
  const merchantId = isTest
    ? ((gateway.test_payout_client_id || "").trim() || (gateway.test_api_key || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const saltKey = isTest
    ? ((gateway.test_payout_client_secret || "").trim() || (gateway.test_api_secret || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());
  if (!merchantId || !saltKey) return { balance: null, error: "PhonePe payout credentials missing" };
  const base = isTest ? "https://api-preprod.phonepe.com/apis/hermes" : "https://api.phonepe.com/apis/hermes";
  const apiEndpoint = `/pg/v1/payout/balance/${merchantId}`;
  const hashInput = apiEndpoint + saltKey;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
  const xVerify = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;
  try {
    const res = await fetch(`${base}${apiEndpoint}`, { headers: { "X-VERIFY": xVerify, "X-MERCHANT-ID": merchantId } });
    const bodyText = await res.text();
    if (!res.ok) return { balance: null, error: `PhonePe API ${res.status}: ${bodyText.slice(0, 300)}` };
    let data: any;
    try { data = JSON.parse(bodyText); } catch { return { balance: null, error: `Non-JSON: ${bodyText.slice(0, 200)}` }; }
    if (!data.success) return { balance: null, error: data.message ?? "PhonePe balance check failed" };
    const bal = data.data?.availableBalance ?? data.data?.balance;
    return bal != null ? { balance: parseFloat(String(bal)) / 100 } : { balance: null, error: "balance field missing" };
  } catch (e: any) {
    return { balance: null, error: `Exception: ${e?.message}` };
  }
}

async function getGatewayBalance(gateway: any, env: string): Promise<{ balance: number | null; error?: string }> {
  const name = (gateway.gateway_name ?? "").toLowerCase();
  if (name.includes("razorpay")) return getRazorpayBalance(gateway, env);
  if (name.includes("cashfree")) return getCashfreeBalance(gateway, env);
  if (name.includes("phonepe")) return getPhonePeBalance(gateway, env);
  return { balance: null, error: `Balance check not supported for gateway: ${gateway.gateway_name}` };
}

// ─── Cashfree Payout API auth ─────────────────────────────────────────────────
// Cashfree Payouts is a separate service from Payment Gateway.
// It requires a Bearer token obtained from POST /payout/v1/authorize.
// Credentials: cashfree_payout_client_id / cashfree_payout_client_secret (payout-specific)
// or falls back to the gateway test/production keys if payout-specific ones are empty.

// Cashfree Payout v2 — direct API key auth, no /authorize step
// Sandbox: sandbox.cashfree.com/payout, Production: api.cashfree.com/payout
// Endpoints have NO version prefix: /beneficiary, /transfers, /balance
function getCashfreePayoutBase(env: string): string {
  return env.toLowerCase() === "test"
    ? "https://sandbox.cashfree.com/payout"
    : "https://api.cashfree.com/payout";
}

function getCashfreePayoutCredentials(gateway: any, env: string): { clientId: string; clientSecret: string; twoFaPublicKey: string } {
  const isTest = env.toLowerCase() === "test";
  const payoutId = isTest
    ? ((gateway.test_payout_client_id        || "").trim() || (gateway.cashfree_payout_client_id     || "").trim())
    : ((gateway.production_payout_client_id  || "").trim() || (gateway.cashfree_payout_client_id     || "").trim());
  const payoutSecret = isTest
    ? ((gateway.test_payout_client_secret       || "").trim() || (gateway.cashfree_payout_client_secret || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.cashfree_payout_client_secret || "").trim());
  const twoFaPublicKey = isTest
    ? (gateway.test_cashfree_2fa_public_key        || "").trim()
    : (gateway.production_cashfree_2fa_public_key  || "").trim();
  if (payoutId && payoutSecret) return { clientId: payoutId, clientSecret: payoutSecret, twoFaPublicKey };
  return {
    clientId:     (isTest ? gateway.test_api_key    : gateway.production_api_key)    ?? "",
    clientSecret: (isTest ? gateway.test_api_secret : gateway.production_api_secret) ?? "",
    twoFaPublicKey,
  };
}

// Cashfree 2FA signature — mirrors the DigiLocker KYC auth pattern exactly:
//   payload  = "{clientId}.{epochSeconds}"
//   encrypt  = RSA-OAEP / SHA-1 with the 2FA public key (PEM certificate or SPKI)
//   result   = base64(encrypted bytes)  → sent as X-Cf-Signature header
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

async function getCashfreePayoutV2Headers(
  gateway: any,
  env: string,
): Promise<{ headers: Record<string, string> | null; error: string | null }> {
  const { clientId, clientSecret, twoFaPublicKey } = getCashfreePayoutCredentials(gateway, env);
  if (!clientId || !clientSecret) {
    return { headers: null, error: "Payout credentials missing (clientId or clientSecret empty)" };
  }
  const hdrs: Record<string, string> = {
    "Content-Type":    "application/json",
    "x-client-id":     clientId,
    "x-client-secret": clientSecret,
    "x-api-version":   "2024-01-01",
  };
  // Cashfree Payout v2 requires IP whitelisting OR a 2FA RSA signature.
  // Supabase Edge Functions have dynamic IPs, so we always generate the signature
  // when a public key is configured.
  if (twoFaPublicKey) {
    try {
      hdrs["X-Cf-Signature"] = await generateCashfree2FASignature(clientId, twoFaPublicKey);
    } catch (sigErr: any) {
      return { headers: null, error: `2FA signature generation failed: ${sigErr?.message}` };
    }
  }
  return { headers: hdrs, error: null };
}

// ─── User KYC data ────────────────────────────────────────────────────────────

interface UserKyc {
  pan_number: string | null;
  pan_photo_url: string | null;
  aadhaar_number: string | null;
  digilocker_verified: boolean;
}

async function getUserKycData(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<UserKyc> {
  const [{ data: pan }, { data: address }] = await Promise.all([
    supabase
      .from("kyc_pan_verification")
      .select("pan_number, pan_photo_url, digilocker_verified")
      .eq("user_id", userId)
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("kyc_address_proof")
      .select("aadhaar_number, digilocker_verified")
      .eq("user_id", userId)
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    pan_number:          pan?.pan_number ?? null,
    pan_photo_url:       pan?.pan_photo_url ?? null,
    aadhaar_number:      address?.aadhaar_number ?? null,
    digilocker_verified: (pan?.digilocker_verified ?? false) || (address?.digilocker_verified ?? false),
  };
}

// ─── Vendor KYC registration ──────────────────────────────────────────────────

async function submitRazorpayVendorKyc(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  apiSecret: string,
  contactId: string,
  beneficiaryId: string,
  userKyc: UserKyc,
  alreadySubmitted: boolean,
): Promise<void> {
  if (alreadySubmitted || !contactId || !userKyc.pan_number) return;
  const auth = `Basic ${btoa(`${apiKey}:${apiSecret}`)}`;
  const base = "https://api.razorpay.com/v1";
  try {
    const panRes = await fetch(`${base}/contacts/${contactId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": auth },
      body: JSON.stringify({
        document_type: "individual_proof_of_identity",
        kyc_doc_type:  "pan",
        kyc_doc_number: userKyc.pan_number,
      }),
    });
    const panData = await panRes.json();
    const docId = panData?.id ?? null;
    if (docId) {
      await supabase
        .from("beneficiaries")
        .update({ razorpay_vendor_kyc_doc_id: docId, updated_at: new Date().toISOString() })
        .eq("id", beneficiaryId);
    }

    // Submit Aadhaar as address proof if DigiLocker-verified and number available
    if (userKyc.aadhaar_number && userKyc.digilocker_verified) {
      const clean = userKyc.aadhaar_number.replace(/\D/g, "");
      if (clean.length === 12) {
        await fetch(`${base}/contacts/${contactId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": auth },
          body: JSON.stringify({
            document_type: "individual_proof_of_address",
            kyc_doc_type:  "aadhaar",
            kyc_doc_number: clean,
          }),
        });
      }
    }
  } catch (err) {
    console.error("Razorpay vendor KYC submission error:", err);
  }
}

async function registerCashfreeVendor(
  supabase: ReturnType<typeof createClient>,
  gateway: any,
  env: string,
  beneficiary: any,
  _userKyc: UserKyc,
  headers: Record<string, string>,
): Promise<string | null> {
  const base = getCashfreePayoutBase(env);

  // If already registered in Cashfree, skip the POST entirely and use the stored ID.
  const storedBeneId = (beneficiary.cashfree_bene_id || "").trim();
  if (storedBeneId) {
    return storedBeneId;
  }

  // Not yet registered — derive an ID and create the beneficiary.
  let beneId = `b${beneficiary.id.replace(/-/g, "").substring(0, 15)}`;
  const phone = (beneficiary.mobile || "9999999999").replace(/\D/g, "").slice(-10) || "9999999999";

  const res = await fetch(`${base}/beneficiary`, {
    method: "POST",
    headers,
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
  const data = await res.json();

  // v2: 201/200 = created, 409 = conflict (two sub-cases below)
  if (res.status === 201 || res.status === 200) {
    await supabase.from("beneficiaries")
      .update({ cashfree_bene_id: beneId, updated_at: new Date().toISOString() })
      .eq("id", beneficiary.id);
  } else if (res.status === 409) {
    const errCode = data?.code ?? "";
    if (errCode === "beneficiary_id_already_exists") {
      // Our derived beneId is already registered — store and use it
      await supabase.from("beneficiaries")
        .update({ cashfree_bene_id: beneId, updated_at: new Date().toISOString() })
        .eq("id", beneficiary.id);
    } else {
      // Same bank account registered under a different ID — look it up
      const getRes = await fetch(
        `${base}/beneficiary?bank_account_number=${encodeURIComponent(beneficiary.bank_account)}&bank_ifsc=${encodeURIComponent(beneficiary.ifsc)}`,
        { headers },
      );
      const getData = await getRes.json();
      const existingBeneId: string | null = getData?.beneficiary_id ?? null;
      if (!existingBeneId) {
        throw new Error(`Cashfree beneficiary conflict (409) but GET lookup failed: ${JSON.stringify(getData).slice(0, 200)}`);
      }
      beneId = existingBeneId;
      await supabase.from("beneficiaries")
        .update({ cashfree_bene_id: existingBeneId, updated_at: new Date().toISOString() })
        .eq("id", beneficiary.id);
    }
  } else {
    const errMsg = data?.message || data?.error || JSON.stringify(data).slice(0, 200);
    throw new Error(`Cashfree beneficiary registration failed (HTTP ${res.status}): ${errMsg}`);
  }

  return beneId;
}

// ─── Payout status checkers ───────────────────────────────────────────────────

interface PayoutStatusResult {
  status: "processed" | "processing" | "failed" | "queued" | "unknown";
  utr: string | null;
}

async function checkRazorpayPayoutStatus(
  gateway: any,
  env: string,
  payoutId: string,
): Promise<PayoutStatusResult> {
  const isTest = (env ?? "production").toLowerCase() === "test";
  const payoutKeyId = isTest
    ? ((gateway.test_payout_client_id       || "").trim() || (gateway.test_api_key    || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const payoutKeySecret = isTest
    ? ((gateway.test_payout_client_secret       || "").trim() || (gateway.test_api_secret    || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());
  if (!payoutKeyId || !payoutKeySecret) return { status: "unknown", utr: null };
  try {
    const res = await fetch(`https://api.razorpay.com/v1/payouts/${payoutId}`, {
      headers: { "Authorization": `Basic ${btoa(`${payoutKeyId}:${payoutKeySecret}`)}` },
    });
    const data = await res.json();
    const s = data?.status ?? "unknown";
    const status: PayoutStatusResult["status"] =
      s === "processed" ? "processed"
      : s === "failed" || s === "reversed" ? "failed"
      : s === "queued" ? "queued"
      : s === "processing" ? "processing"
      : "unknown";
    return { status, utr: data?.utr ?? null };
  } catch {
    return { status: "unknown", utr: null };
  }
}

async function checkCashfreePayoutStatus(
  gateway: any,
  env: string,
  transferId: string,
): Promise<PayoutStatusResult> {
  const base = getCashfreePayoutBase(env);
  const { headers } = await getCashfreePayoutV2Headers(gateway, env);
  if (!headers) return { status: "unknown", utr: null };
  try {
    // Cashfree Get Transfer Status V2: GET /transfers?transfer_id={custom_id}
    // transfer_id is a QUERY PARAMETER — NOT a path segment.
    const res  = await fetch(`${base}/transfers?transfer_id=${encodeURIComponent(transferId)}`, { headers });
    const data = await res.json();
    const raw  = (data?.status ?? "unknown").toUpperCase();
    const status: PayoutStatusResult["status"] =
      raw === "SUCCESS" || raw === "PROCESSED"                                ? "processed"
      : raw === "FAILED" || raw === "ERROR" || raw === "REVERSED"             ? "failed"
      : raw === "PENDING" || raw === "RECEIVED" || raw === "APPROVAL_PENDING" ? "processing"
      : "unknown";
    return { status, utr: data?.utr ?? null };
  } catch {
    return { status: "unknown", utr: null };
  }
}

async function checkPhonePePayoutStatus(
  gateway: any,
  env: string,
  transferId: string,
): Promise<PayoutStatusResult> {
  const isTest = (env ?? "production").toLowerCase() === "test";
  const merchantId = isTest
    ? ((gateway.test_payout_client_id || "").trim() || (gateway.test_api_key || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const saltKey = isTest
    ? ((gateway.test_payout_client_secret || "").trim() || (gateway.test_api_secret || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());
  if (!merchantId || !saltKey) return { status: "unknown", utr: null };
  const base = isTest ? "https://api-preprod.phonepe.com/apis/hermes" : "https://api.phonepe.com/apis/hermes";
  try {
    const apiEndpoint = `/pg/v1/payout/status/${merchantId}/${transferId}`;
    const hashInput = apiEndpoint + saltKey;
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
    const xVerify = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;
    const res = await fetch(`${base}${apiEndpoint}`, { headers: { "X-VERIFY": xVerify, "X-MERCHANT-ID": merchantId } });
    const data = await res.json();
    if (!data.success) return { status: "unknown", utr: null };
    const state = (data.data?.state ?? data.data?.status ?? "").toUpperCase();
    const status: PayoutStatusResult["status"] =
      state === "SUCCESS" || state === "PAYOUT_SUCCESS" || state === "COMPLETED" ? "processed"
      : state === "FAILED" || state === "PAYOUT_FAILED" || state === "REJECTED" ? "failed"
      : state === "PENDING" || state === "ACCEPTED" || state === "PROCESSING" ? "processing"
      : "unknown";
    return { status, utr: data.data?.utr ?? null };
  } catch {
    return { status: "unknown", utr: null };
  }
}

async function checkGatewayPayoutStatus(
  gateway: any,
  env: string,
  payoutId: string,
): Promise<PayoutStatusResult> {
  const name = (gateway.gateway_name ?? "").toLowerCase();
  if (name.includes("razorpay")) return checkRazorpayPayoutStatus(gateway, env, payoutId);
  if (name.includes("cashfree")) return checkCashfreePayoutStatus(gateway, env, payoutId);
  if (name.includes("phonepe")) return checkPhonePePayoutStatus(gateway, env, payoutId);
  return { status: "unknown", utr: null };
}

// ─── Payout executors ─────────────────────────────────────────────────────────

async function executeRazorpayPayout(
  supabase: ReturnType<typeof createClient>,
  payment: any,
  gateway: any,
  beneficiary: any,
  payoutRef: string,
  userKyc: UserKyc,
): Promise<{ success: boolean; gateway_tx_id: string | null; utr: string | null; response: any }> {
  const env = (payment.gateway_environment ?? "production").toLowerCase();
  const isTest = env === "test";

  // Use env-specific payout credentials if set, fall back to PG keys
  const payoutKeyId = isTest
    ? ((gateway.test_payout_client_id       || "").trim() || (gateway.test_api_key    || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const payoutKeySecret = isTest
    ? ((gateway.test_payout_client_secret       || "").trim() || (gateway.test_api_secret    || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());

  const apiKey    = payoutKeyId    || "";
  const apiSecret = payoutKeySecret || "";
  const auth = btoa(`${apiKey}:${apiSecret}`);
  const base = "https://api.razorpay.com/v1";

  // ── Contact ────────────────────────────────────────────────────────────────
  // Razorpay reference_id limit is 40 chars. UUID is 36 chars, so use first 8 hex segments (no dashes, 32 chars) with a short prefix.
  const refId = `b_${beneficiary.id.replace(/-/g, "").slice(0, 32)}`;
  let contactId = (beneficiary.razorpay_contact_id || "").trim();
  if (!contactId) {
    const searchRes = await fetch(`${base}/contacts?reference_id=${refId}`, {
      headers: { "Authorization": `Basic ${auth}` },
    });
    const searchData = await searchRes.json();
    contactId = searchData?.items?.[0]?.id ?? "";
    if (!contactId) {
      // Try "vendor" first; fall back to "customer" if vendor KYC requirements block it.
      // "vendor" requires full GST/KYC setup on the RazorpayX account — not available
      // in test environments or newly onboarded accounts.
      let cd: any;
      let cr: Response;
      for (const contactType of ["customer", "vendor"] as const) {
        cr = await fetch(`${base}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
          body: JSON.stringify({
            name:         beneficiary.full_name,
            email:        beneficiary.email  || "noreply@paybycard.in",
            contact:      (beneficiary.mobile || "").replace(/\D/g, "").slice(-10) || "9999999999",
            type:         contactType,
            reference_id: refId,
          }),
        });
        cd = await cr!.json();
        if (cr!.ok) break;
        // If the error is not a KYC/vendor-type restriction, throw immediately
        const errDesc: string = cd?.error?.description ?? "";
        if (!errDesc.toLowerCase().includes("kyc") && !errDesc.toLowerCase().includes("vendor") && contactType === "vendor") {
          throw new Error(errDesc || "RazorPay contact creation failed");
        }
      }
      if (!cr!.ok) throw new Error(cd?.error?.description ?? "RazorPay contact creation failed");
      contactId = cd.id;
    }
    await supabase.from("beneficiaries")
      .update({ razorpay_contact_id: contactId, updated_at: new Date().toISOString() })
      .eq("id", beneficiary.id);
  }

  // ── Vendor KYC (PAN + Aadhaar via DigiLocker) ──────────────────────────────
  await submitRazorpayVendorKyc(
    supabase, apiKey, apiSecret, contactId, beneficiary.id, userKyc,
    !!beneficiary.razorpay_vendor_kyc_doc_id,
  );

  // ── Fund Account (dedup: search by bank account + IFSC before creating) ───
  let fundAccountId = (beneficiary.razorpay_fund_account_id || "").trim();
  if (!fundAccountId && contactId) {
    // Search existing fund accounts for this contact — avoid duplicate creation
    const searchFaRes = await fetch(
      `${base}/fund_accounts?contact_id=${contactId}&account_type=bank_account`,
      { headers: { "Authorization": `Basic ${auth}` } },
    );
    const searchFaData = await searchFaRes.json();
    const match = (searchFaData?.items ?? []).find((fa: any) =>
      fa.bank_account?.account_number === beneficiary.bank_account &&
      fa.bank_account?.ifsc === beneficiary.ifsc,
    );
    if (match?.id) {
      fundAccountId = match.id;
      await supabase.from("beneficiaries")
        .update({ razorpay_fund_account_id: fundAccountId, updated_at: new Date().toISOString() })
        .eq("id", beneficiary.id);
    }
  }
  if (!fundAccountId) {
    const far = await fetch(`${base}/fund_accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
      body: JSON.stringify({
        contact_id:   contactId,
        account_type: "bank_account",
        bank_account: {
          name:           beneficiary.full_name,
          ifsc:           beneficiary.ifsc,
          account_number: beneficiary.bank_account,
        },
      }),
    });
    const fad = await far.json();
    if (!far.ok) throw new Error(fad.error?.description ?? "RazorPay fund account creation failed");
    fundAccountId = fad.id;
    await supabase.from("beneficiaries")
      .update({ razorpay_fund_account_id: fundAccountId, updated_at: new Date().toISOString() })
      .eq("id", beneficiary.id);
  }

  // ── Payout ─────────────────────────────────────────────────────────────────
  const idempKey = `AP-${payoutRef}`;
  const accountNumber = isTest
    ? ((gateway.test_payout_account_number        || "").trim() || (gateway.razorpay_account_number || "").trim())
    : ((gateway.production_payout_account_number  || "").trim() || (gateway.razorpay_account_number || "").trim());
  if (!accountNumber) throw new Error("RazorPay account number not configured");
  const transferMode = resolveTransferMode(payment.category_details?.settlement_time);

  const pr = await fetch(`${base}/payouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${auth}`,
      "X-Payout-Idempotency": idempKey,
    },
    body: JSON.stringify({
      account_number:       accountNumber,
      fund_account_id:      fundAccountId,
      amount:               Math.round(parseFloat(payment.amount) * 100),
      currency:             "INR",
      mode:                 transferMode,
      purpose:              "payout",
      queue_if_low_balance: true,
      reference_id:         idempKey,
      narration:            `Payout ${payment.payment_reference}`.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 30),
      notes:                { payment_id: payment.id, beneficiary_id: beneficiary.id },
    }),
  });
  const pd = await pr.json();

  if (!pr.ok && pd.error?.description?.includes("idempotency")) {
    const fr = await fetch(`${base}/payouts?reference_id=${idempKey}`, {
      headers: { "Authorization": `Basic ${auth}` },
    });
    const fd = await fr.json();
    const ex = fd?.items?.[0];
    if (ex) return { success: true, gateway_tx_id: ex.id, utr: ex.utr ?? null, response: ex };
  }
  if (!pr.ok) throw new Error(pd.error?.description ?? "RazorPay payout failed");
  const success = ["processed", "processing", "queued"].includes(pd.status);
  return { success, gateway_tx_id: pd.id ?? null, utr: pd.utr ?? null, response: pd };
}

async function executeCashfreePayout(
  supabase: ReturnType<typeof createClient>,
  payment: any,
  gateway: any,
  beneficiary: any,
  payoutRef: string,
  userKyc: UserKyc,
): Promise<{ success: boolean; gateway_tx_id: string | null; utr: string | null; response: any }> {
  const env  = (payment.gateway_environment ?? "production").toLowerCase();
  const base = getCashfreePayoutBase(env);

  const { headers, error: authError } = await getCashfreePayoutV2Headers(gateway, env);
  if (!headers) throw new Error(`Cashfree Payout credentials error — ${authError ?? "check payout credentials"}`);

  // Step 1: Create beneficiary (409 = already exists, both are OK)
  const beneId = await registerCashfreeVendor(supabase, gateway, env, beneficiary, userKyc, headers);
  if (!beneId) throw new Error("Failed to register Cashfree beneficiary");

  // Step 2: Initiate transfer via Cashfree Payout v2
  const transferId = `AUTO-${payoutRef}`;
  const txRes = await fetch(`${base}/transfers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      transfer_id:     transferId,
      transfer_amount: parseFloat(payment.amount),
      beneficiary_details: { beneficiary_id: beneId },
    }),
  });
  const txData = await txRes.json();

  // v2 duplicate transfer_id → 409
  if (txRes.status === 409) {
    const statusResult = await checkCashfreePayoutStatus(gateway, env, transferId);
    if (statusResult.status !== "failed") {
      // Transfer is still in flight at Cashfree — report as processing
      return {
        success:       true,
        gateway_tx_id: transferId,
        utr:           statusResult.utr ?? null,
        response:      txData,
      };
    }
    // Transfer permanently failed at Cashfree. Do NOT submit a new transfer —
    // that would create a duplicate payout. Throw so the caller marks this
    // payment as auto_payout_failed and routes it to manual payout queue.
    throw new Error(`Auto-payout failed: Cashfree transfer ${transferId} has permanently failed. Admin manual payout required.`);
  }

  // v2 response: { transfer_id, cf_transfer_id, status: "RECEIVED"|"SUCCESS", utr }
  const txStatus = (txData?.status ?? "").toUpperCase();
  const success = txRes.ok && ["RECEIVED", "SUCCESS", "APPROVAL_PENDING"].includes(txStatus);
  return {
    success,
    gateway_tx_id: transferId,
    utr:           txData?.utr ?? null,
    response:      txData,
  };
}

async function executePhonePePayout(
  _supabase: ReturnType<typeof createClient>,
  payment: any,
  gateway: any,
  beneficiary: any,
  payoutRef: string,
): Promise<{ success: boolean; gateway_tx_id: string | null; utr: string | null; response: any }> {
  const env = (payment.gateway_environment ?? "production").toLowerCase();
  const isTest = env === "test";
  const merchantId = isTest
    ? ((gateway.test_payout_client_id || "").trim() || (gateway.test_api_key || "").trim())
    : ((gateway.production_payout_client_id || "").trim() || (gateway.production_api_key || "").trim());
  const saltKey = isTest
    ? ((gateway.test_payout_client_secret || "").trim() || (gateway.test_api_secret || "").trim())
    : ((gateway.production_payout_client_secret || "").trim() || (gateway.production_api_secret || "").trim());
  if (!merchantId || !saltKey) throw new Error("PhonePe payout credentials not configured");

  const base = isTest ? "https://api-preprod.phonepe.com/apis/hermes" : "https://api.phonepe.com/apis/hermes";
  const transferId = `AUTO-${payoutRef}`;
  const amountInPaise = Math.round(parseFloat(payment.amount) * 100);

  const payload = {
    merchantId,
    transferId,
    amount: amountInPaise,
    transferMode: "IMPS",
    beneficiary: {
      accountNumber: beneficiary.bank_account,
      ifsc: beneficiary.ifsc,
      name: beneficiary.full_name,
    },
  };

  const payloadBase64 = btoa(JSON.stringify(payload));
  const apiEndpoint = "/pg/v1/payout";
  const hashInput = payloadBase64 + apiEndpoint + saltKey;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
  const xVerify = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;

  const res = await fetch(`${base}${apiEndpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VERIFY": xVerify, "X-MERCHANT-ID": merchantId },
    body: JSON.stringify({ request: payloadBase64 }),
  });
  const data = await res.json();

  if (res.status === 409) {
    // Duplicate transfer — check status
    const statusEndpoint = `/pg/v1/payout/status/${merchantId}/${transferId}`;
    const statusHashInput = statusEndpoint + saltKey;
    const statusHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(statusHashInput));
    const statusXVerify = Array.from(new Uint8Array(statusHashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("") + "###" + 1;
    const statusRes = await fetch(`${base}${statusEndpoint}`, { headers: { "X-VERIFY": statusXVerify, "X-MERCHANT-ID": merchantId } });
    const statusData = await statusRes.json();
    if (statusData.success && statusData.data?.state?.toUpperCase() !== "FAILED") {
      return { success: true, gateway_tx_id: transferId, utr: statusData.data?.utr ?? null, response: statusData };
    }
    throw new Error(`Auto-payout failed: PhonePe transfer ${transferId} has permanently failed. Admin manual payout required.`);
  }

  const state = (data?.data?.state ?? data?.data?.status ?? "").toUpperCase();
  const success = res.ok && data.success && ["SUCCESS", "PAYOUT_SUCCESS", "PENDING", "ACCEPTED", "PROCESSING"].includes(state);
  return {
    success,
    gateway_tx_id: transferId,
    utr: data?.data?.utr ?? null,
    response: data,
  };
}

async function executePayout(
  supabase: ReturnType<typeof createClient>,
  payment: any,
  gateway: any,
  beneficiary: any,
  userKyc: UserKyc,
): Promise<{ success: boolean; gateway_tx_id: string | null; utr: string | null; response: any }> {
  const name = (gateway.gateway_name ?? "").toLowerCase();
  const payoutRef = payment.payment_reference;
  if (name.includes("razorpay")) {
    return executeRazorpayPayout(supabase, payment, gateway, beneficiary, payoutRef, userKyc);
  }
  if (name.includes("cashfree")) {
    return executeCashfreePayout(supabase, payment, gateway, beneficiary, payoutRef, userKyc);
  }
  if (name.includes("phonepe")) {
    return executePhonePePayout(supabase, payment, gateway, beneficiary, payoutRef);
  }
  throw new Error(`Gateway ${gateway.gateway_name} does not support auto payout`);
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function notifyPayoutCompleted(
  supabase: ReturnType<typeof createClient>,
  payment: any,
  utr: string | null,
): Promise<void> {
  try {
    const [{ data: user }, { data: bene }] = await Promise.all([
      supabase.from("users").select("email, mobile_number, first_name, last_name").eq("id", payment.user_id).maybeSingle(),
      supabase.from("beneficiaries").select("full_name, bank_account, bank_name, ifsc").eq("id", payment.beneficiary_id).maybeSingle(),
    ]);
    if (!user?.email) return;

    const amount  = parseFloat(payment.amount ?? "0").toFixed(2);
    const name    = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Customer";
    const utrLine = utr ? `<p style="margin:4px 0;"><strong>UTR:</strong> ${utr}</p>` : "";
    const html = `
      <p>Dear ${name},</p>
      <p>Your payment of <strong>₹${amount}</strong> has been processed and the payout has been initiated successfully.</p>
      <p style="margin:4px 0;"><strong>Reference:</strong> ${payment.payment_reference}</p>
      ${utrLine}
      ${bene ? `<p style="margin:4px 0;"><strong>Beneficiary:</strong> ${bene.full_name} — ${bene.bank_name} (${bene.bank_account})</p>` : ""}
      <p>Please find your invoice attached to this email.</p>
      <p>Thank you for using PayByCard.</p>
    `;

    // Fetch invoice HTML as base64 attachment
    let invoiceBase64: string | null = null;
    try {
      const invRes = await fetch(`${SUPABASE_URL()}/functions/v1/generate-invoice-html`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: payment.id, invoice_type: "settlement" }),
      });
      if (invRes.ok) {
        const invData = await invRes.json();
        invoiceBase64 = invData?.html_base64 ?? null;
      }
    } catch (invErr) {
      console.error("Invoice fetch error:", invErr);
    }

    await fetch(`${SUPABASE_URL()}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to:           user.email,
        subject:      `Transaction Completed – ${payment.payment_reference}`,
        body:         html,
        body_type:    "html",
        use_template: true,
        ...(invoiceBase64 ? {
          attachment_base64:        invoiceBase64,
          attachment_filename:      `Invoice-${payment.payment_reference}.html`,
          attachment_content_type:  "text/html",
        } : {}),
      }),
    });

    if (user.mobile_number) {
      await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile:        user.mobile_number,
          message:       `Your payment of Rs.${amount} (Ref: ${payment.payment_reference}) has been completed. Funds transferred to ${bene?.full_name ?? "beneficiary"}${utr ? ". UTR: " + utr : ""}. - PayByCard`,
          template_type: "transaction_completed",
        }),
      });
    }
  } catch (err) {
    console.error("Payout notification error:", err);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startedAt = Date.now();
  const results: { id: string; reference: string; action: string; error?: string }[] = [];

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const singlePaymentId: string | null = body?.payment_id ?? null;
    const forceReleaseLock: boolean = body?.force === true;

    // If force=true, clear the payout lock on the specified payment so it can be re-claimed
    if (forceReleaseLock && singlePaymentId) {
      await supabase.rpc("fn_release_payment_lock", { p_payment_id: singlePaymentId });
    }

    // ── Fetch global payout settings ──────────────────────────────────────────
    const { data: payoutSettings } = await supabase
      .from("payout_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    const globalPayoutMode = payoutSettings?.payout_mode ?? "manual";
    const globalEnv = payoutSettings?.environment ?? "test";

    // ── Fetch eligible payments ───────────────────────────────────────────────
    // Target: settlement_pending OR settlement_in_progress, payout_mode is an auto mode
    let query = supabase
      .from("payments")
      .select("*, payment_gateway_settings(*), beneficiaries(*)")
      .in("status", ["settlement_pending", "settlement_in_progress"])
      .order("created_at", { ascending: true });

    if (singlePaymentId) {
      query = query.eq("id", singlePaymentId);
    } else {
      query = query.limit(200);
    }

    const { data: payments, error: fetchErr } = await query;

    if (fetchErr) throw new Error(`Fetch failed: ${fetchErr.message}`);
    if (!payments || payments.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No eligible payments", processed: 0, durationMs: Date.now() - startedAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date();

    // ── Filter ────────────────────────────────────────────────────────────────
    const AUTO_PAYOUT_MODES = new Set([
      "payout", "payment_split",
      "cashfree_payout", "cashfree_payment_split",
      "razorpay_payout", "razorpay_payment_split",
      "axis_payout",
    ]);
    const eligible = payments
      .filter((p: any) => {
        const mode      = p.payout_mode ?? globalPayoutMode;
        const gwSettled = GATEWAY_SETTLED_STATUSES.has(
          (p.gateway_settlement_status ?? "").toLowerCase(),
        );

        if (!AUTO_PAYOUT_MODES.has(mode)) return false;

        // Skip payments already marked as auto_payout_failed — they are in the
        // manual payout queue and must not be retried by the cron to prevent
        // double spending.
        if (p.auto_payout_failed === true) return false;

        // payment_split / cashfree_payment_split / razorpay_payment_split: process immediately
        if (mode.includes("payment_split")) return true;

        // payout modes (payout, cashfree_payout, razorpay_payout, axis_payout):
        // always require gateway to confirm settlement first.
        return gwSettled;
      })
      .sort((a: any, b: any) => {
        const daysA = getSettlementDays(a.category_details?.settlement_time);
        const daysB = getSettlementDays(b.category_details?.settlement_time);
        const tierDiff = priorityTier(daysA) - priorityTier(daysB);
        if (tierDiff !== 0) return tierDiff;
        const dueDateA = getDueDate(a.created_at, daysA).getTime();
        const dueDateB = getDueDate(b.created_at, daysB).getTime();
        if (dueDateA !== dueDateB) return dueDateA - dueDateB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

    if (eligible.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No payments due for payout", processed: 0, durationMs: Date.now() - startedAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Per-gateway balance cache ──────────────────────────────────────────────
    const balanceCache: Record<string, { balance: number | null; error?: string }> = {};

    // Track gateways that hit insufficient balance during this run so all
    // subsequent (newer) payments on the same gateway are also skipped,
    // preserving FIFO order (first confirmed payment gets paid first).
    const insufficientGateways = new Set<string>();

    for (const payment of eligible) {
      const gateway     = payment.payment_gateway_settings;
      const beneficiary = payment.beneficiaries;
      const amount      = parseFloat(payment.amount ?? "0");
      const payoutMode  = payment.payout_mode ?? globalPayoutMode;
      const env         = payment.gateway_environment ?? globalEnv;

      if (!gateway) {
        results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped", error: "No gateway settings" });
        continue;
      }
      if (!beneficiary) {
        results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped", error: "No beneficiary" });
        continue;
      }
      if (amount <= 0) {
        results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped", error: "Invalid amount" });
        continue;
      }

      // ── Check for existing payout ──────────────────────────────────────────
      const { data: existingPayout } = await supabase
        .from("payouts")
        .select("id, status, gateway_transaction_id, utr_number")
        .eq("payment_id", payment.id)
        .maybeSingle();

      if (existingPayout) {
        if (existingPayout.status === "completed") {
          // Ensure payment is marked completed
          if (payment.status !== "completed") {
            await supabase.from("payments")
              .update({ status: "completed", updated_at: new Date().toISOString() })
              .eq("id", payment.id);
          }
          results.push({ id: payment.id, reference: payment.payment_reference, action: "already_completed" });
          continue;
        }

        if (existingPayout.status === "processing" && existingPayout.gateway_transaction_id) {
          const captureStatus = await checkGatewayPayoutStatus(gateway, env, existingPayout.gateway_transaction_id);
          if (captureStatus.status === "processed") {
            const utr = captureStatus.utr || existingPayout.utr_number;
            await supabase.from("payouts").update({
              status:       "completed",
              utr_number:   utr,
              completed_at: new Date().toISOString(),
              updated_at:   new Date().toISOString(),
            }).eq("id", existingPayout.id);
            await supabase.from("payments").update({
              status:       "completed",
              completed_at: new Date().toISOString(),
              updated_at:   new Date().toISOString(),
            }).eq("id", payment.id);
            await supabase.from("payment_logs").insert({
              payment_id: payment.id,
              status:     "payout_confirmed",
              message:    `Auto-payout confirmed via ${gateway.gateway_name}. UTR: ${utr ?? "N/A"}`,
              metadata:   { utr, gateway: gateway.gateway_name },
            });
            EdgeRuntime.waitUntil(notifyPayoutCompleted(supabase, payment, utr));
            results.push({ id: payment.id, reference: payment.payment_reference, action: "payout_confirmed" });
          } else if (captureStatus.status === "failed") {
            await supabase.from("payouts").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", existingPayout.id);
            await supabase.from("payments").update({ auto_payout_failed: true, updated_at: new Date().toISOString() }).eq("id", payment.id);
            await supabase.from("payment_logs").insert({
              payment_id: payment.id,
              status:     "auto_payout_failed",
              message:    `Auto-payout failed at gateway ${gateway.gateway_name}. Moved to manual payout queue.`,
              metadata:   { gateway: gateway.gateway_name },
            });
            results.push({ id: payment.id, reference: payment.payment_reference, action: "auto_payout_failed" });
          } else {
            results.push({ id: payment.id, reference: payment.payment_reference, action: "payout_in_progress" });
          }
          continue;
        }

        // Any failed payout — never auto-retry to prevent duplicate transfers.
        // Mark for manual review; admin handles via the Manual Payout queue.
        if (existingPayout.status === "failed") {
          await supabase.from("payments").update({ auto_payout_failed: true, updated_at: new Date().toISOString() }).eq("id", payment.id);
          results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped", error: "Previous payout failed — moved to manual payout queue" });
          continue;
        } else {
          // Any other non-retriable state (processing without tx id, etc.) — skip
          results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped", error: `Payout exists with status: ${existingPayout.status}` });
          continue;
        }
      }

      // ── Pessimistic lock: atomically claim this payment ────────────────────
      // Prevents two concurrent cron executions from both creating a payout for
      // the same payment.  fn_try_claim_for_payout uses FOR UPDATE semantics:
      //   - settlement_pending → atomically advances to settlement_in_progress
      //   - settlement_in_progress with expired lock (>10 min) → re-acquires lock
      //   - settlement_in_progress with active lock → returns false (skip)
      const { data: claimGranted, error: claimErr } = await supabase
        .rpc("fn_try_claim_for_payout", { p_payment_id: payment.id });

      if (claimErr || !claimGranted) {
        results.push({
          id: payment.id,
          reference: payment.payment_reference,
          action: "skipped",
          error: "Concurrent process holds the lock for this payment",
        });
        continue;
      }

      // fn_try_claim_for_payout atomically advances DB status to settlement_in_progress,
      // but the JS object still has the stale value from the earlier SELECT.
      // Update it so the settlement re-verification block below doesn't fire unnecessarily.
      payment.status = "settlement_in_progress";

      const gwCacheKey = `${gateway.id}:${env}`;

      // ── Balance check ──────────────────────────────────────────────────────
      if (!(gwCacheKey in balanceCache)) {
        const result = await getGatewayBalance(gateway, env);
        balanceCache[gwCacheKey] = result;
        if (result.balance !== null) {
          await supabase.from("payment_logs").insert({
            payment_id: payment.id,
            status:     "balance_check",
            message:    `Gateway ${gateway.gateway_name} (${env}) balance: ₹${result.balance.toFixed(2)}`,
            metadata:   { gateway: gateway.gateway_name, environment: env, balance: result.balance },
          });
        }
      }

      // FIFO: if this gateway already hit insufficient balance for an earlier
      // (older) payment, skip all subsequent payments on the same gateway so
      // newer payments don't jump ahead of older ones in the queue.
      if (insufficientGateways.has(gwCacheKey)) {
        await supabase.rpc("fn_release_payment_lock", { p_payment_id: payment.id });
        results.push({
          id:        payment.id,
          reference: payment.payment_reference,
          action:    "skipped_fifo_insufficient_balance",
          error:     `Earlier payment in queue had insufficient balance on ${gateway.gateway_name} (${env}) — holding this payment for FIFO order`,
        });
        continue;
      }

      const cachedBalance = balanceCache[gwCacheKey];
      if (cachedBalance.balance === null) {
        // Balance API returned an error — this means we couldn't CHECK the balance,
        // not that the balance is zero. Log the error and proceed; the payout API
        // itself will reject if funds are actually insufficient.
        await supabase.from("payment_logs").insert({
          payment_id: payment.id,
          status:     "balance_check_error",
          message:    `Balance check failed for ${gateway.gateway_name} (${env}): ${cachedBalance.error ?? "unknown error"}. Proceeding with payout attempt — gateway will reject if funds are insufficient.`,
          metadata:   { gateway: gateway.gateway_name, environment: env, balance_error: cachedBalance.error },
        });
        // Fall through to attempt payout — do NOT skip here.
      }
      const currentBalance = cachedBalance.balance;
      if (currentBalance !== null && currentBalance < amount) {
        await supabase.from("payment_logs").insert({
          payment_id: payment.id,
          status:     "payout_skipped_low_balance",
          message:    `Auto-payout skipped: insufficient balance in ${gateway.gateway_name} ${env} account. Available: ₹${currentBalance.toFixed(2)}, Required: ₹${amount.toFixed(2)}. Holding FIFO order — subsequent payments on this gateway will also be skipped until funds are available.`,
          metadata:   { available_balance: currentBalance, required_amount: amount, gateway: gateway.gateway_name, environment: env },
        });
        // Release the lock so the payment can be re-claimed in the next job run
        await supabase.rpc("fn_release_payment_lock", { p_payment_id: payment.id });
        // Mark this gateway as insufficient so all subsequent (newer) payments
        // on the same gateway are also skipped, preserving FIFO order
        insufficientGateways.add(gwCacheKey);
        results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped_low_balance" });
        continue;
      }

      // ── Verify gateway settlement (for settlement_pending with payout mode) ─
      // Skip re-verification if DB already has a confirmed settled status —
      // calling the gateway again would return the same result and burn quota.
      if (payment.status === "settlement_pending" && !payoutMode.includes("payment_split")) {
        const alreadySettled = GATEWAY_SETTLED_STATUSES.has(
          (payment.gateway_settlement_status ?? "").toLowerCase(),
        );
        if (!alreadySettled) {
          const settlementCheck = await verifyGatewaySettlement(gateway, env, payment);
          await supabase.from("payments").update({
            gateway_settlement_status:     settlementCheck.settled ? "settled" : settlementCheck.gatewayStatus,
            gateway_settlement_checked_at: new Date().toISOString(),
          }).eq("id", payment.id);

          if (!settlementCheck.settled) {
            await supabase.from("payment_logs").insert({
              payment_id: payment.id,
              status:     "payout_skipped_not_settled",
              message:    `Auto-payout skipped: payment not yet settled at ${gateway.gateway_name}. Reason: ${settlementCheck.reason}.`,
              metadata:   { gateway: gateway.gateway_name, environment: env, reason: settlementCheck.reason, gatewayStatus: settlementCheck.gatewayStatus },
            });
            results.push({ id: payment.id, reference: payment.payment_reference, action: "skipped_not_settled", error: settlementCheck.reason });
            continue;
          }
        }
      }

      // ── Fetch user KYC for vendor onboarding ───────────────────────────────
      const userKyc = await getUserKycData(supabase, payment.user_id);

      // ── Execute payout ─────────────────────────────────────────────────────
      try {
        // For axis_payout mode, use the Axis Bank process function instead
        let result: { success: boolean; gateway_tx_id: string | null; utr: string | null; response: any };
        if (payoutMode === "axis_payout") {
          const axisRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-axis-payout`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payment_id: payment.id,
              beneficiary_account_number: beneficiary.bank_account,
              beneficiary_ifsc: beneficiary.ifsc,
              beneficiary_name: beneficiary.full_name,
              amount,
              remarks: `Payout for ${payment.payment_reference}`,
            }),
          });
          const axisData = await axisRes.json();

          // Axis Bank returns pending when available balance is insufficient.
          // Skip this payment without creating a payout record — leave it
          // for the next job run (FIFO: first confirmed payment gets paid first).
          if (!axisData.success && axisData.status === "pending") {
            await supabase.from("payment_logs").insert({
              payment_id: payment.id,
              status:     "payout_skipped_insufficient_balance",
              message:    `Axis Bank payout skipped: ${axisData.message || "insufficient balance"}. Available: ₹${(axisData.available_balance ?? 0).toFixed(2)}, Required: ₹${(axisData.required_amount ?? amount).toFixed(2)}. Will retry in next job run.`,
              metadata:   {
                payout_mode:       payoutMode,
                available_balance: axisData.available_balance,
                required_amount:   axisData.required_amount,
                pending_reason:    axisData.pending_reason,
              },
            });
            // Release the lock so the payment can be re-claimed in the next run
            await supabase.rpc("fn_release_payment_lock", { p_payment_id: payment.id });
            results.push({
              id:        payment.id,
              reference: payment.payment_reference,
              action:    "skipped_insufficient_balance",
              error:     axisData.message || "Insufficient balance — will retry next run",
            });
            continue;
          }

          result = {
            success: !!axisData.success,
            gateway_tx_id: axisData.reference_number ?? null,
            utr: axisData.utr ?? axisData.reference_number ?? null,
            response: axisData,
          };
        } else {
          // Merge payout_settings credentials into gateway object for cashfree/razorpay modes
          const mergedGateway = { ...gateway };
          if (payoutSettings) {
            if (payoutMode.startsWith("cashfree_")) {
              mergedGateway.test_payout_client_id = payoutSettings.cashfree_test_client_id;
              mergedGateway.test_payout_client_secret = payoutSettings.cashfree_test_client_secret;
              mergedGateway.production_payout_client_id = payoutSettings.cashfree_production_client_id;
              mergedGateway.production_payout_client_secret = payoutSettings.cashfree_production_client_secret;
              mergedGateway.test_cashfree_2fa_public_key = payoutSettings.cashfree_test_2fa_public_key;
              mergedGateway.production_cashfree_2fa_public_key = payoutSettings.cashfree_production_2fa_public_key;
            } else if (payoutMode.startsWith("razorpay_")) {
              mergedGateway.test_payout_client_id = payoutSettings.razorpay_test_key_id;
              mergedGateway.test_payout_client_secret = payoutSettings.razorpay_test_key_secret;
              mergedGateway.production_payout_client_id = payoutSettings.razorpay_production_key_id;
              mergedGateway.production_payout_client_secret = payoutSettings.razorpay_production_key_secret;
              mergedGateway.test_payout_account_number = payoutSettings.razorpay_test_account_number;
              mergedGateway.production_payout_account_number = payoutSettings.razorpay_production_account_number;
            }
          }
          result = await executePayout(supabase, payment, mergedGateway, beneficiary, userKyc);
        }
        const payoutRef = `AUTO-${payment.payment_reference}`;
        const transferMode = resolveTransferMode(payment.category_details?.settlement_time);

        // Deduct from tracked balance
        if (result.success) {
          const cur = balanceCache[gwCacheKey]?.balance;
          if (cur !== null && cur !== undefined) {
            balanceCache[gwCacheKey] = { balance: cur - amount };
          }
        } else {
          // Payout failed — if it looks like an insufficient-funds error from the
          // gateway, mark this gateway as insufficient so subsequent (newer)
          // payments on the same gateway are also skipped, preserving FIFO order.
          const respStr = JSON.stringify(result.response ?? "").toLowerCase();
          if (respStr.includes("insufficient") || respStr.includes("low balance") || respStr.includes("not enough")) {
            insufficientGateways.add(gwCacheKey);
          }
        }

        // ── Confirm payout capture (one immediate check) ───────────────────
        // Only upgrade to "completed" if the gateway confirms immediately.
        // Do NOT downgrade to "failed" here: Cashfree marks a transfer RECEIVED
        // (accepted) and processes it asynchronously — an immediate FAILED response
        // from the status API is a sandbox race condition, not a real rejection.
        // The UTR polling loop handles the eventual terminal state.
        let capturedStatus = result.success ? "processing" : "failed";
        let confirmedUtr   = result.utr;
        if (result.success && result.gateway_tx_id) {
          const captureCheck = await checkGatewayPayoutStatus(gateway, env, result.gateway_tx_id);
          if (captureCheck.status === "processed") {
            capturedStatus = "completed";
            confirmedUtr   = captureCheck.utr ?? result.utr;
          }
        }

        const payoutDbStatus = capturedStatus === "completed" ? "completed"
          : result.success ? "processing"
          : "failed";

        // Mark payment completed on acceptance; settlement_in_progress flags it for manual payout if it fails.
        const paymentFinalStatus = result.success ? "completed" : "settlement_in_progress";

        await supabase.from("payouts").insert({
          user_id:               payment.user_id,
          beneficiary_id:        payment.beneficiary_id,
          payment_gateway_id:    payment.payment_gateway_id,
          payment_id:            payment.id,
          payout_type:           payoutMode.includes("payment_split") ? "split" : payoutMode === "axis_payout" ? "axis" : "auto",
          amount,
          charges:               0,
          gst:                   0,
          instant_settlement:    false,
          instant_settlement_charges: 0,
          instant_settlement_charges_percentage: 0,
          total_deduction:       0,
          net_amount:            amount,
          payout_reference:      payoutRef,
          transfer_type:         transferMode,
          account_number:        beneficiary.bank_account ?? "",
          ifsc_code:             beneficiary.ifsc         ?? "",
          account_holder_name:   beneficiary.full_name    ?? "",
          bank_name:             beneficiary.bank_name    ?? "",
          gateway_environment:   env,
          status:                payoutDbStatus,
          gateway_transaction_id: result.gateway_tx_id,
          utr_number:            confirmedUtr,
          gateway_response:      result.response,
          completed_at:          payoutDbStatus === "completed" ? new Date().toISOString() : null,
          ip_address:            "auto",
        });

        await supabase.from("payments").update({
          status:             paymentFinalStatus,
          auto_payout_failed: !result.success,
          completed_at:       paymentFinalStatus === "completed" ? new Date().toISOString() : null,
          updated_at:         new Date().toISOString(),
        }).eq("id", payment.id);

        await supabase.from("payment_logs").insert({
          payment_id: payment.id,
          status:     result.success ? "auto_payout_triggered" : "auto_payout_failed",
          message:    `${payoutMode === "payment_split" ? "Split" : "Auto"}-payout ${result.success ? "initiated" : "failed"} via ${gateway.gateway_name}. Amount: ₹${amount.toFixed(2)}. Mode: ${transferMode}. KYC PAN: ${userKyc.pan_number ? "submitted" : "not available"}.`,
          metadata:   {
            gateway:         gateway.gateway_name,
            payout_mode:     payoutMode,
            payout_ref:      payoutRef,
            gateway_tx_id:   result.gateway_tx_id,
            utr:             confirmedUtr,
            captured_status: capturedStatus,
            kyc_pan_submitted: !!userKyc.pan_number,
            kyc_digilocker:  userKyc.digilocker_verified,
            response:        result.response,
          },
        });

        // Send email + SMS only when payout is confirmed completed
        if (payoutDbStatus === "completed") {
          EdgeRuntime.waitUntil(notifyPayoutCompleted(supabase, payment, confirmedUtr));
        }

        results.push({
          id:        payment.id,
          reference: payment.payment_reference,
          action:    payoutDbStatus === "completed" ? "completed" : result.success ? "processing" : "failed",
        });
      } catch (err: any) {
        console.error(`Payout error for ${payment.payment_reference}:`, err);
        // Mark the payment as auto_payout_failed so it appears in the Manual Payout queue.
        // Release the lock so it can be re-claimed if admin retries manually.
        await supabase.from("payments").update({
          auto_payout_failed: true,
          status:            "settlement_in_progress",
          updated_at:        new Date().toISOString(),
        }).eq("id", payment.id);
        await supabase.rpc("fn_release_payment_lock", { p_payment_id: payment.id });
        await supabase.from("payment_logs").insert({
          payment_id: payment.id,
          status:     "auto_payout_error",
          message:    `Auto-payout error for ${payment.payment_reference}: ${err?.message}. Moved to manual payout queue.`,
          metadata:   { error: err?.message, payout_mode: payoutMode },
        });
        results.push({ id: payment.id, reference: payment.payment_reference, action: "auto_payout_failed", error: err?.message });
      }
    }

    // ── UTR polling: check processing payouts and notify on confirmation ──────
    const { data: processingPayouts } = await supabase
      .from("payouts")
      .select("id, payment_id, gateway_transaction_id, utr_number, gateway_environment, payment_gateway_id")
      .eq("status", "processing")
      .not("gateway_transaction_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(50);

    for (const payout of processingPayouts ?? []) {
      try {
        const { data: paymentData } = await supabase
          .from("payments")
          .select("*, payment_gateway_settings(*)")
          .eq("id", payout.payment_id)
          .maybeSingle();
        if (!paymentData?.payment_gateway_settings) continue;

        const gw  = paymentData.payment_gateway_settings;
        const env = paymentData.gateway_environment ?? "production";
        const statusResult = await checkGatewayPayoutStatus(gw, env, payout.gateway_transaction_id);

        if (statusResult.status === "processed") {
          const utr = statusResult.utr ?? payout.utr_number;
          await supabase.from("payouts").update({
            status:       "completed",
            utr_number:   utr,
            completed_at: new Date().toISOString(),
            updated_at:   new Date().toISOString(),
          }).eq("id", payout.id);
          await supabase.from("payment_logs").insert({
            payment_id: payout.payment_id,
            status:     "payout_utr_confirmed",
            message:    `Payout UTR confirmed: ${utr ?? "N/A"}. Transfer completed via ${gw.gateway_name}.`,
            metadata:   { utr, gateway: gw.gateway_name, transfer_id: payout.gateway_transaction_id },
          });
          EdgeRuntime.waitUntil(notifyPayoutCompleted(supabase, paymentData, utr));
          results.push({ id: payout.payment_id, reference: paymentData.payment_reference, action: "utr_confirmed" });

        } else if (statusResult.status === "failed") {
          // Do not mark as failed on a single check — Cashfree can transiently return
          // FAILED for transfers that are still pending (observed in sandbox and
          // occasionally in production).  Confirm with a second immediate check
          // before treating the failure as permanent.
          const confirmResult = await checkGatewayPayoutStatus(gw, env, payout.gateway_transaction_id);
          if (confirmResult.status !== "failed") {
            results.push({ id: payout.payment_id, reference: paymentData.payment_reference, action: "payout_in_progress" });
            continue;
          }
          // Two consecutive FAILED responses — treat as genuinely failed.
          await supabase.from("payouts").update({
            status:     "failed",
            updated_at: new Date().toISOString(),
          }).eq("id", payout.id);
          await supabase.from("payments").update({
            status:             "settlement_in_progress",
            auto_payout_failed: true,
            completed_at:       null,
            updated_at:         new Date().toISOString(),
          }).eq("id", payout.payment_id);
          await supabase.from("payment_logs").insert({
            payment_id: payout.payment_id,
            status:     "payout_transfer_failed",
            message:    `Payout transfer failed at gateway ${gw.gateway_name}. TX: ${payout.gateway_transaction_id}.`,
            metadata:   { gateway: gw.gateway_name, transfer_id: payout.gateway_transaction_id },
          });
          results.push({ id: payout.payment_id, reference: paymentData.payment_reference, action: "payout_transfer_failed" });
        }
      } catch (pollErr: any) {
        console.error("UTR poll error:", pollErr);
      }
    }

    // ── Backfill UTR: fetch UTR for completed payouts that are still missing it ─
    const { data: completedMissingUtr } = await supabase
      .from("payouts")
      .select("id, payment_id, gateway_transaction_id, utr_number, gateway_environment, payment_gateway_id")
      .eq("status", "completed")
      .is("utr_number", null)
      .not("gateway_transaction_id", "is", null)
      .order("completed_at", { ascending: true })
      .limit(20);

    for (const payout of completedMissingUtr ?? []) {
      try {
        const { data: gw } = await supabase
          .from("payment_gateway_settings")
          .select("*")
          .eq("id", payout.payment_gateway_id)
          .maybeSingle();
        if (!gw) continue;

        const env = (payout.gateway_environment ?? "production").toLowerCase();
        const statusResult = await checkGatewayPayoutStatus(gw, env, payout.gateway_transaction_id);

        if (statusResult.utr) {
          await supabase.from("payouts").update({
            utr_number:  statusResult.utr,
            updated_at:  new Date().toISOString(),
          }).eq("id", payout.id);
          results.push({ id: payout.payment_id ?? payout.id, reference: payout.gateway_transaction_id, action: "utr_backfilled", utr: statusResult.utr });
        }
      } catch (backfillErr: any) {
        console.error("UTR backfill error:", backfillErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results, durationMs: Date.now() - startedAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("auto-payout fatal error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// redeploy
