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
    const { adminId, page = 1, pageSize = 20, search = "" } = await req.json();

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

    // Fetch all payment categories that require receiver KYC
    const { data: kycRequiredCategories } = await supabase
      .from("payment_categories")
      .select("id, category_name, refund_after_hours")
      .eq("receiver_kyc_required", true);

    if (!kycRequiredCategories || kycRequiredCategories.length === 0) {
      return new Response(
        JSON.stringify({ transactions: [], total: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const categoryIds = kycRequiredCategories.map((c) => c.id);
    const categoryMap: Record<string, { name: string; refund_after_hours: number }> = {};
    for (const c of kycRequiredCategories) {
      categoryMap[c.id] = { name: c.category_name, refund_after_hours: c.refund_after_hours ?? 0 };
    }

    // Fetch completed/processing payments for these categories
    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select(`
        id, payment_reference, amount, total_amount, status, created_at,
        user_id, beneficiary_id, payment_category_id,
        beneficiary_details, category_details
      `)
      .in("payment_category_id", categoryIds)
      .in("status", ["completed", "processing"])
      .order("created_at", { ascending: false });

    if (paymentsError) throw new Error(paymentsError.message);

    if (!payments || payments.length === 0) {
      return new Response(
        JSON.stringify({ transactions: [], total: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();

    // Filter: only payments where refund window has passed
    const expiredPayments = payments.filter((p) => {
      const cat = categoryMap[p.payment_category_id];
      if (!cat || cat.refund_after_hours <= 0) return false;
      const createdAt = new Date(p.created_at);
      const hoursElapsed = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      return hoursElapsed >= cat.refund_after_hours;
    });

    if (expiredPayments.length === 0) {
      return new Response(
        JSON.stringify({ transactions: [], total: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const paymentIds = expiredPayments.map((p) => p.id);

    // Get merchant_onboarding records for these payments
    const { data: onboardingRecords } = await supabase
      .from("merchant_onboarding")
      .select("payment_id, status, verified_at, pan_number")
      .in("payment_id", paymentIds);

    const onboardingMap: Record<string, { status: string; verified_at: string | null; pan_number: string | null }> = {};
    for (const o of (onboardingRecords || [])) {
      onboardingMap[o.payment_id] = {
        status: o.status,
        verified_at: o.verified_at,
        pan_number: o.pan_number,
      };
    }

    // Keep only payments where onboarding is missing or not verified
    const nonKycedPayments = expiredPayments.filter((p) => {
      const onboarding = onboardingMap[p.id];
      if (!onboarding) return true; // no KYC submitted
      return onboarding.status !== "verified"; // submitted but not verified
    });

    // Enrich with user info
    const userIds = [...new Set(nonKycedPayments.map((p) => p.user_id))];
    const { data: users } = await supabase
      .from("users")
      .select("id, first_name, last_name, email, mobile_number")
      .in("id", userIds);

    const userMap: Record<string, { name: string; email: string; mobile: string }> = {};
    for (const u of (users || [])) {
      userMap[u.id] = {
        name: `${u.first_name} ${u.last_name}`,
        email: u.email,
        mobile: u.mobile_number,
      };
    }

    let enriched = nonKycedPayments.map((p) => {
      const cat = categoryMap[p.payment_category_id];
      const onboarding = onboardingMap[p.id];
      const user = userMap[p.user_id];
      const createdAt = new Date(p.created_at);
      const hoursElapsed = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60));

      const beneficiaryName =
        (p.beneficiary_details as any)?.full_name ||
        (p.beneficiary_details as any)?.name ||
        "—";

      return {
        id: p.id,
        payment_reference: p.payment_reference,
        amount: p.amount,
        total_amount: p.total_amount,
        status: p.status,
        created_at: p.created_at,
        hours_elapsed: hoursElapsed,
        category_name: cat?.name || (p.category_details as any)?.name || "—",
        refund_after_hours: cat?.refund_after_hours ?? 0,
        sender_name: user?.name || "—",
        sender_email: user?.email || "—",
        sender_mobile: user?.mobile || "—",
        beneficiary_name: beneficiaryName,
        kyc_status: onboarding ? onboarding.status : "not_submitted",
        kyc_pan: onboarding?.pan_number || null,
      };
    });

    // Apply search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      enriched = enriched.filter(
        (t) =>
          t.payment_reference.toLowerCase().includes(q) ||
          t.sender_name.toLowerCase().includes(q) ||
          t.sender_email.toLowerCase().includes(q) ||
          t.beneficiary_name.toLowerCase().includes(q)
      );
    }

    const total = enriched.length;
    const offset = (page - 1) * pageSize;
    const paginated = enriched.slice(offset, offset + pageSize);

    return new Response(
      JSON.stringify({ transactions: paginated, total }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
