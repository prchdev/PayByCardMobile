import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { adminId } = await req.json();

    if (!adminId) {
      return new Response(
        JSON.stringify({ error: "Admin ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: admin } = await supabase
      .from("admin_users")
      .select("id")
      .eq("id", adminId)
      .maybeSingle();

    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load all payment_categories that require receiver KYC
    const { data: categories, error: catError } = await supabase
      .from("payment_categories")
      .select("id, category_name, refund_after_hours, receiver_kyc_required")
      .eq("receiver_kyc_required", true)
      .gt("refund_after_hours", 0);

    if (catError) throw new Error(catError.message);

    if (!categories || categories.length === 0) {
      return new Response(
        JSON.stringify({ records: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const categoryIds = categories.map((c: any) => c.id);
    const categoryMap: Record<string, { category_name: string; refund_after_hours: number }> = {};
    for (const c of categories) {
      categoryMap[c.id] = {
        category_name: c.category_name,
        refund_after_hours: c.refund_after_hours ?? 0,
      };
    }

    // Fetch kyc_pending payments in KYC-required business categories.
    // business_category_id links to payment_categories (not payment_category_id).
    const { data: kycPendingPayments, error: fetchError } = await supabase
      .from("payments")
      .select(`
        id, payment_reference, amount, charges, gst, total_amount,
        status, created_at, updated_at, user_id, beneficiary_id,
        payment_gateway_id, gateway_transaction_id, card_type,
        gateway_environment, beneficiary_details, category_details,
        business_category_id, selected_payment_option, payout_mode
      `)
      .eq("status", "kyc_pending")
      .in("business_category_id", categoryIds)
      .order("created_at", { ascending: true });

    if (fetchError) throw new Error(fetchError.message);

    if (!kycPendingPayments || kycPendingPayments.length === 0) {
      return new Response(
        JSON.stringify({ records: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = Date.now();

    // Filter: only payments where the refund window has already passed
    const expiredPending = kycPendingPayments.filter((p: any) => {
      const cat = categoryMap[p.business_category_id];
      const refundAfterHours = cat?.refund_after_hours ?? 0;
      if (refundAfterHours <= 0) return false;
      // Use created_at — the moment payment was made, not when status changed
      const paymentTime = new Date(p.created_at).getTime();
      const windowMs = refundAfterHours * 60 * 60 * 1000;
      return now > paymentTime + windowMs;
    });

    if (expiredPending.length === 0) {
      return new Response(
        JSON.stringify({ records: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load merchant_onboarding for expired payments
    const paymentIds = expiredPending.map((p: any) => p.id);
    const { data: onboardingRecords } = await supabase
      .from("merchant_onboarding")
      .select("payment_id, status, pan_number, pan_photo_url")
      .in("payment_id", paymentIds);

    const onboardingMap: Record<string, { status: string; pan_number: string | null; pan_photo_url: string | null }> = {};
    for (const o of (onboardingRecords || [])) {
      onboardingMap[o.payment_id] = {
        status: o.status,
        pan_number: o.pan_number,
        pan_photo_url: o.pan_photo_url,
      };
    }

    // Exclude payments where merchant KYC is already verified
    const nonKycedPayments = expiredPending.filter((p: any) => {
      const onboarding = onboardingMap[p.id];
      return !onboarding || onboarding.status !== "verified";
    });

    if (nonKycedPayments.length === 0) {
      return new Response(
        JSON.stringify({ records: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch-load users, beneficiaries, and gateways
    const userIds = [...new Set(nonKycedPayments.map((p: any) => p.user_id).filter(Boolean))];
    const beneficiaryIds = [...new Set(nonKycedPayments.map((p: any) => p.beneficiary_id).filter(Boolean))];
    const gatewayIds = [...new Set(nonKycedPayments.map((p: any) => p.payment_gateway_id).filter(Boolean))];

    const [usersRes, beneficiariesRes, gatewaysRes] = await Promise.all([
      userIds.length > 0
        ? supabase.from("users").select("id, first_name, last_name, email, mobile_number").in("id", userIds)
        : { data: [] },
      beneficiaryIds.length > 0
        ? supabase.from("beneficiaries").select("id, full_name, bank_account, ifsc, bank_name, email, mobile").in("id", beneficiaryIds)
        : { data: [] },
      gatewayIds.length > 0
        ? supabase.from("payment_gateway_settings").select("id, gateway_name").in("id", gatewayIds)
        : { data: [] },
    ]);

    const userMap: Record<string, any> = {};
    for (const u of (usersRes.data || [])) userMap[u.id] = u;

    const beneficiaryMap: Record<string, any> = {};
    for (const b of (beneficiariesRes.data || [])) beneficiaryMap[b.id] = b;

    const gatewayNameMap: Record<string, string> = {};
    for (const g of (gatewaysRes.data || [])) gatewayNameMap[g.id] = g.gateway_name;

    // Build enriched records
    const records = nonKycedPayments.map((p: any) => {
      const cat = categoryMap[p.business_category_id];
      const refundAfterHours = cat?.refund_after_hours ?? 0;
      const paymentTime = new Date(p.created_at).getTime();
      const expiresAt = new Date(paymentTime + refundAfterHours * 60 * 60 * 1000).toISOString();

      const u = userMap[p.user_id];
      const b = beneficiaryMap[p.beneficiary_id] || {};
      const onboarding = onboardingMap[p.id];

      const cardType = p.card_type ||
        (typeof p.selected_payment_option === "object" ? p.selected_payment_option?.card_type : null) ||
        null;

      return {
        id: p.id,
        payment_id: p.id,
        is_payment_record: true,
        sender_name: u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() : "Unknown",
        sender_email: u?.email || "",
        sender_mobile: u?.mobile_number || "",
        category_name:
          cat?.category_name ||
          (p.category_details as any)?.category_name ||
          "N/A",
        beneficiary_name: b.full_name || (p.beneficiary_details as any)?.full_name || "Unknown",
        beneficiary_bank_account: b.bank_account || (p.beneficiary_details as any)?.bank_account || "",
        beneficiary_ifsc: b.ifsc || (p.beneficiary_details as any)?.ifsc || "",
        beneficiary_bank_name: b.bank_name || (p.beneficiary_details as any)?.bank_name || "",
        email: b.email || (p.beneficiary_details as any)?.email || "",
        mobile: b.mobile || (p.beneficiary_details as any)?.mobile || "",
        expires_at: expiresAt,
        created_at: p.created_at,
        kyc_status: onboarding ? onboarding.status : "not_submitted",
        payment: {
          amount: p.amount,
          charges: p.charges,
          gst: p.gst,
          total_amount: p.total_amount,
          payment_reference: p.payment_reference,
          status: p.status,
          gateway_transaction_id: p.gateway_transaction_id || null,
          card_type: cardType,
          gateway_environment: p.gateway_environment || null,
          gateway_name: p.payment_gateway_id ? (gatewayNameMap[p.payment_gateway_id] || null) : null,
          payout_mode: p.payout_mode || null,
        },
      };
    });

    return new Response(
      JSON.stringify({ records }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in admin-get-expired-onboarding:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
