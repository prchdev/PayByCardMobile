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
    const {
      adminId,
      page = 1,
      limit = 50,
      status,
      statuses,            // string[] for multi-select; takes priority over status
      dateFrom,
      dateTo,
      search,
      include_kyc = false, // opt-in: skip KYC lookups for table view (much faster)
    } = await req.json();

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

    // Verify admin
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

    const offset = (page - 1) * limit;

    // Build query — all filtering at DB level
    let query = supabase
      .from("payments")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    // Multi-status: statuses[] takes priority over single status
    const activeStatuses: string[] =
      Array.isArray(statuses) && statuses.length > 0
        ? statuses.filter((s: string) => s !== "all")
        : status && status !== "all"
        ? [status]
        : [];

    if (activeStatuses.length === 1) {
      query = query.eq("status", activeStatuses[0]);
    } else if (activeStatuses.length > 1) {
      query = query.in("status", activeStatuses);
    }

    if (dateFrom) {
      query = query.gte("created_at", dateFrom);
    }

    if (dateTo) {
      const dateToEnd = dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.999Z`;
      query = query.lte("created_at", dateToEnd);
    }

    // DB-level text search on payment_reference, beneficiary name, and invoice number
    if (search && search.trim().length > 0) {
      const term = search.trim().replace(/[%_]/g, "\\$&");
      // Support searching by formatted invoice "PAY-YYYY-NNNN" or bare number
      const invoiceNumMatch = term.match(/^(?:PAY-\d{4}-)?(?:\d+)$/i);
      const invoiceFilter = invoiceNumMatch
        ? `,invoice_number.eq.${parseInt(term.split("-").pop() ?? term, 10)}`
        : "";
      query = query.or(
        `payment_reference.ilike.%${term}%,beneficiary_details->>full_name.ilike.%${term}%${invoiceFilter}`
      );
    }

    // Always use DB-level pagination
    query = query.range(offset, offset + limit - 1);

    const { data: payments, error: paymentsError, count: dbCount } = await query;

    if (paymentsError) {
      return new Response(
        JSON.stringify({ error: paymentsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!payments || payments.length === 0) {
      return new Response(
        JSON.stringify({ payments: [], total: 0, totalPages: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const paymentIds = payments.map((p: any) => p.id);
    const userIds = [...new Set(payments.map((p: any) => p.user_id).filter(Boolean))] as string[];
    const gatewayIds = [...new Set(payments.map((p: any) => p.payment_gateway_id).filter(Boolean))] as string[];
    const beneficiaryIds = [...new Set(payments.map((p: any) => p.beneficiary_id).filter(Boolean))] as string[];

    // All enrichment queries run in parallel — biggest speed improvement
    const [
      payoutsResult,
      paymentOptionsResult,
      usersResult,
      gatewaysResult,
      panResult,
      addrResult,
      bizResult,
      beneResult,
      merchantResult,
    ] = await Promise.all([
      // Payouts (always needed)
      supabase
        .from("payouts")
        .select("id, payment_id, status, payout_type, payout_reference, utr_number, completed_at, payout_date, payout_reference_number, payout_confirmed_amount, failure_reason, gateway_transaction_id")
        .in("payment_id", paymentIds)
        .order("created_at", { ascending: false }),

      // Payment options for settlement time (always needed)
      supabase.from("payment_options").select("category_name, settlement_time"),

      // Users / sender info (always needed)
      userIds.length > 0
        ? supabase.from("users").select("id, first_name, last_name, email, mobile_number").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),

      // Gateway name + payout mode (always needed)
      gatewayIds.length > 0
        ? supabase.from("payment_gateway_settings").select("id, gateway_name, payout_mode").in("id", gatewayIds)
        : Promise.resolve({ data: [] as any[] }),

      // KYC: sender PAN — opt-in only (skipped for table view)
      include_kyc && userIds.length > 0
        ? supabase.from("kyc_pan_verification").select("user_id, pan_number").in("user_id", userIds).eq("status", "verified")
        : Promise.resolve({ data: [] as any[] }),

      // KYC: address proof — opt-in only
      include_kyc && userIds.length > 0
        ? supabase.from("kyc_address_proof").select("user_id, address, city, state, pincode").in("user_id", userIds).eq("status", "verified")
        : Promise.resolve({ data: [] as any[] }),

      // KYC: business info — opt-in only
      include_kyc && userIds.length > 0
        ? supabase.from("kyc_business_info").select("user_id, business_name, business_pan, gst_number, business_address, status").in("user_id", userIds).eq("status", "verified")
        : Promise.resolve({ data: [] as any[] }),

      // Beneficiary PAN — opt-in only
      include_kyc && beneficiaryIds.length > 0
        ? supabase.from("beneficiaries").select("id, pan_number").in("id", beneficiaryIds)
        : Promise.resolve({ data: [] as any[] }),

      // Merchant onboarding PAN — fallback when beneficiary has no PAN (opt-in only)
      include_kyc && paymentIds.length > 0
        ? supabase.from("merchant_onboarding").select("payment_id, pan_number").in("payment_id", paymentIds).neq("pan_number", "")
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // Build lookup maps
    const payoutMap: Record<string, any> = {};
    for (const p of (payoutsResult.data || [])) {
      if (p.payment_id && !payoutMap[p.payment_id]) payoutMap[p.payment_id] = p;
    }

    const settlementTimeMap: Record<string, string> = {};
    for (const opt of (paymentOptionsResult.data || [])) {
      if (opt.category_name) settlementTimeMap[opt.category_name] = opt.settlement_time || "";
    }

    const userMap: Record<string, { full_name: string; email: string; mobile: string }> = {};
    for (const u of (usersResult.data || [])) {
      userMap[u.id] = {
        full_name: `${u.first_name || ""} ${u.last_name || ""}`.trim(),
        email: u.email,
        mobile: u.mobile_number,
      };
    }

    const gatewayMap: Record<string, { gateway_name: string; payout_mode: string | null }> = {};
    for (const g of (gatewaysResult.data || [])) {
      gatewayMap[g.id] = { gateway_name: g.gateway_name, payout_mode: g.payout_mode ?? null };
    }

    const senderPanMap: Record<string, string> = {};
    for (const r of (panResult.data || [])) senderPanMap[r.user_id] = r.pan_number;

    const senderAddressMap: Record<string, string> = {};
    for (const r of (addrResult.data || [])) {
      const parts = [r.address, r.city, r.state, r.pincode].filter(Boolean);
      if (parts.length > 0) senderAddressMap[r.user_id] = parts.join(", ");
    }

    const bizMap: Record<string, any> = {};
    for (const r of (bizResult.data || [])) {
      bizMap[r.user_id] = {
        business_name: r.business_name || "",
        business_pan: r.business_pan || "",
        gst_number: r.gst_number || "",
        business_address: r.business_address || "",
      };
    }

    const benePanMap: Record<string, string> = {};
    for (const r of (beneResult.data || [])) {
      if (r.pan_number) benePanMap[r.id] = r.pan_number;
    }

    const merchantPanMap: Record<string, string> = {};
    for (const r of (merchantResult.data || [])) {
      if (r.payment_id && r.pan_number) merchantPanMap[r.payment_id] = r.pan_number;
    }

    // Enrich payments
    const enriched = payments.map((payment: any) => {
      const payout = payoutMap[payment.id] ?? null;
      const sender = userMap[payment.user_id] ?? null;
      const gatewayEntry = payment.payment_gateway_id ? (gatewayMap[payment.payment_gateway_id] ?? null) : null;
      const biz = bizMap[payment.user_id] ?? null;

      const categoryName = payment.category_details?.category_name || "";
      const settlementTime =
        payment.category_details?.settlement_time ||
        (categoryName ? settlementTimeMap[categoryName] : "") ||
        "";

      return {
        ...payment,
        category_details: payment.category_details
          ? { ...payment.category_details, settlement_time: settlementTime }
          : payment.category_details,
        payout: payout
          ? {
              id: payout.id,
              status: payout.status,
              payout_type: payout.payout_type ?? null,
              payout_reference: payout.payout_reference,
              utr_number: payout.utr_number,
              completed_at: payout.completed_at,
              payout_date: payout.payout_date,
              payout_reference_number: payout.payout_reference_number,
              payout_confirmed_amount: payout.payout_confirmed_amount,
              failure_reason: payout.failure_reason,
              gateway_transaction_id: payout.gateway_transaction_id ?? null,
            }
          : null,
        sender,
        gateway_name: gatewayEntry?.gateway_name ?? null,
        payout_mode: payment.payout_mode ?? gatewayEntry?.payout_mode ?? null,
        sender_pan: senderPanMap[payment.user_id] ?? null,
        sender_address: senderAddressMap[payment.user_id] ?? null,
        business_kyc_verified: !!biz,
        company_name: biz?.business_name ?? null,
        company_pan: biz?.business_pan ?? null,
        company_gst: biz?.gst_number ?? null,
        company_address: biz?.business_address ?? null,
        receiver_pan: (payment.beneficiary_id ? benePanMap[payment.beneficiary_id] : null) ?? merchantPanMap[payment.id] ?? null,
      };
    });

    const total = dbCount ?? 0;
    const totalPages = Math.ceil(total / limit);

    return new Response(
      JSON.stringify({ payments: enriched, total, totalPages }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in admin-get-all-transactions:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
