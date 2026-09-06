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

    // Statuses that count as "successful / completed" payments (includes refunded)
    const completedStatuses = ["completed", "settlement_pending", "refunded"];
    // Statuses that count as "in progress"
    const inProgressStatuses = ["pending", "processing", "kyc_pending", "merchant_kyc_review"];

    const [
      usersRes,
      panAllRes,
      addressAllRes,
      businessAllRes,
      merchantKycRes,
      pendingPayoutsRes,
      manualPaymentsRes,
      totalPaymentsRes,
      completedPaymentsRes,
      inProgressPaymentsRes,
      revenueRes,
      openTicketsRes,
      inProgressTicketsRes,
    ] = await Promise.all([
      // Total registered users
      supabase.from("users").select("id", { count: "exact", head: true }),

      // KYC: all PAN records (needed for per-user overall status computation)
      supabase
        .from("kyc_pan_verification")
        .select("user_id, status"),

      // KYC: all address proof records
      supabase
        .from("kyc_address_proof")
        .select("user_id, status"),

      // KYC: all business info records
      supabase
        .from("kyc_business_info")
        .select("user_id, status, incorporation_certificate_url, gst_certificate_url, loa_url"),

      // Merchant KYC awaiting review
      supabase
        .from("merchant_onboarding")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "under_review"]),

      // Payouts awaiting processing (pending + processing) — existing payout records
      supabase
        .from("payouts")
        .select("id, payment_id")
        .in("status", ["pending", "processing"]),

      // Manual-mode payments needing payout (no payout record created yet)
      supabase
        .from("payments")
        .select("id")
        .in("status", ["settlement_pending", "settlement_in_progress", "kyc_pending", "merchant_kyc_review"])
        .eq("payout_mode", "manual"),

      // All payments ever
      supabase.from("payments").select("id", { count: "exact", head: true }),

      // Completed / settled / refunded payments
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("status", ["completed", "settlement_pending"]),

      // In-progress payments
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("status", inProgressStatuses),

      // Revenue: sum total_amount for completed + settled + refunded payments
      supabase
        .from("payments")
        .select("total_amount")
        .in("status", completedStatuses),

      // Open support tickets
      supabase
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .in("status", ["Open", "open"]),

      // In-progress support tickets (also unresolved)
      supabase
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .in("status", ["In Progress", "in_progress"]),
    ]);

    // Pending payouts = existing payout records + manual-mode payments with no payout record yet
    const payoutCoveredPaymentIds = new Set(
      (pendingPayoutsRes.data || []).map((p: any) => p.payment_id).filter(Boolean)
    );
    const uncoveredManualPayments = (manualPaymentsRes.data || []).filter(
      (p: any) => !payoutCoveredPaymentIds.has(p.id)
    );
    const pendingPayoutsCount = (pendingPayoutsRes.data || []).length + uncoveredManualPayments.length;

    // KYC reviews = count of distinct users whose overall status is "verification_pending"
    // Uses the same getOverallStatus() logic as the KYC Verification page
    const panMap = new Map<string, any>();
    for (const row of (panAllRes.data || [])) panMap.set(row.user_id, row);
    const addressMap = new Map<string, any>();
    for (const row of (addressAllRes.data || [])) addressMap.set(row.user_id, row);
    const businessMap = new Map<string, any>();
    for (const row of (businessAllRes.data || [])) businessMap.set(row.user_id, row);

    const allUserIds = new Set<string>([
      ...panMap.keys(),
      ...addressMap.keys(),
      ...businessMap.keys(),
    ]);

    let pendingKycReviews = 0;
    for (const userId of allUserIds) {
      const pan = panMap.get(userId);
      const address = addressMap.get(userId);
      const business = businessMap.get(userId);

      const panStatus = pan?.status;
      const addressStatus = address?.status;
      const businessStatus = business?.status;

      if (!panStatus || !addressStatus) continue; // "pending" — not a review

      if (panStatus === "rejected" || addressStatus === "rejected") continue; // "rejected"

      const hasBusinessDocs = business?.incorporation_certificate_url || business?.gst_certificate_url || business?.loa_url;
      if (hasBusinessDocs && businessStatus === "rejected") continue; // "rejected"

      if (panStatus === "verification_pending" || addressStatus === "verification_pending") {
        pendingKycReviews++;
        continue;
      }

      if (hasBusinessDocs && businessStatus === "verification_pending") {
        pendingKycReviews++;
        continue;
      }

      // fully verified or other statuses don't count
    }

    pendingKycReviews += (merchantKycRes.count ?? 0);

    // Support tickets = open + in-progress
    const openSupportTickets =
      (openTicketsRes.count ?? 0) + (inProgressTicketsRes.count ?? 0);

    // Compute total payments processed (completed + settled + refunded)
    const totalRevenue = (revenueRes.data || []).reduce(
      (sum: number, p: any) => sum + parseFloat(p.total_amount || "0"),
      0
    );

    // Non-KYCed transactions:
    // Payment was successful (gateway completed) in a business category that requires
    // receiver KYC, but merchant onboarding is not verified even after the refund window.
    let nonKycedCount = 0;
    const { data: kycRequiredCategories } = await supabase
      .from("payment_categories")
      .select("id, refund_after_hours")
      .eq("receiver_kyc_required", true)
      .gt("refund_after_hours", 0);

    if (kycRequiredCategories && kycRequiredCategories.length > 0) {
      const categoryIds = kycRequiredCategories.map((c: any) => c.id);

      // Only kyc_pending payments — matching exactly what Refund Processing page shows
      const { data: kycPayments } = await supabase
        .from("payments")
        .select("id, business_category_id, created_at")
        .in("business_category_id", categoryIds)
        .eq("status", "kyc_pending");

      if (kycPayments && kycPayments.length > 0) {
        const now = new Date();
        const catMap: Record<string, number> = {};
        for (const c of kycRequiredCategories) catMap[c.id] = c.refund_after_hours ?? 0;

        // Keep only payments where the KYC window has already expired
        const expired = kycPayments.filter((p: any) => {
          const hours = catMap[p.business_category_id] ?? 0;
          return (now.getTime() - new Date(p.created_at).getTime()) / 3600000 >= hours;
        });

        if (expired.length > 0) {
          const expiredIds = expired.map((p: any) => p.id);
          const { data: onboarding } = await supabase
            .from("merchant_onboarding")
            .select("payment_id, status")
            .in("payment_id", expiredIds);

          const verifiedIds = new Set(
            (onboarding || [])
              .filter((o: any) => o.status === "verified")
              .map((o: any) => o.payment_id)
          );
          // Count payments with no onboarding record OR onboarding not verified
          nonKycedCount = expired.filter((p: any) => !verifiedIds.has(p.id)).length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        totalUsers: usersRes.count ?? 0,
        pendingKycReviews,
        pendingPayouts: pendingPayoutsCount,
        totalPayments: totalPaymentsRes.count ?? 0,
        completedPayments: completedPaymentsRes.count ?? 0,
        pendingPayments: inProgressPaymentsRes.count ?? 0,
        totalRevenue: totalRevenue.toFixed(2),
        openSupportTickets,
        nonKycedTransactions: nonKycedCount,
      }),
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
