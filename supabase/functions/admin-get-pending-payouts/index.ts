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

    const { data: pendingPayments, error: paymentsError } = await supabase
      .from("payments")
      .select(`
        id, payment_reference, amount, charges, gst, total_amount, status,
        created_at, user_id, beneficiary_id, payment_gateway_id,
        gateway_transaction_id, card_type, gateway_environment,
        payment_category_id, gateway_settlement_status, auto_payout_failed,
        payout_mode, payment_gateway_settings(*), beneficiaries(*)
      `)
      .in("status", ["settlement_pending", "settlement_in_progress", "kyc_pending", "merchant_kyc_review"])
      .order("created_at", { ascending: false });

    if (paymentsError) {
      return new Response(
        JSON.stringify({ error: paymentsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const manualPayments = (pendingPayments || []).filter(
      (p: any) =>
        (p.payout_mode ?? p.payment_gateway_settings?.payout_mode) === "manual" ||
        (p.auto_payout_failed === true && p.status === "settlement_in_progress")
    );

    const { data: existingPayouts } = await supabase
      .from("payouts")
      .select("*, payments!inner(status)")
      .in("status", ["pending", "processing", "failed"])
      .not("payments.status", "in", '("completed","refunded","cancelled")')
      .order("created_at", { ascending: false });

    const payoutPaymentIds = new Set(
      (existingPayouts || []).map((p: any) => p.payment_id)
    );

    // Fetch kyc_required AND settlement_time in a single query
    async function getCategoryDetails(categoryId: string | null): Promise<{ kyc_required: boolean; settlement_time: string | null }> {
      if (!categoryId) return { kyc_required: false, settlement_time: null };
      const { data } = await supabase
        .from("payment_options")
        .select("receiver_kyc_required, settlement_time")
        .eq("id", categoryId)
        .maybeSingle();
      return {
        kyc_required: data?.receiver_kyc_required ?? false,
        settlement_time: data?.settlement_time ?? null,
      };
    }

    const enrichedFromPayments = await Promise.all(
      manualPayments
        .filter((p: any) => !payoutPaymentIds.has(p.id))
        .map(async (payment: any) => {
          const gw = payment.payment_gateway_settings;
          const [userRes, kycRes, categoryDetails] = await Promise.all([
            supabase.from("users").select("first_name, last_name, email, mobile_number").eq("id", payment.user_id).maybeSingle(),
            supabase.from("merchant_onboarding").select("status, pan_number, pan_photo_url").eq("payment_id", payment.id).maybeSingle(),
            getCategoryDetails(payment.payment_category_id),
          ]);

          const beneficiary = payment.beneficiaries;
          const u = userRes.data;
          const isAutoFailed = payment.auto_payout_failed === true;
          return {
            id: `payment_${payment.id}`,
            payment_id: payment.id,
            payment_reference: payment.payment_reference,
            amount: payment.amount,
            charges: payment.charges,
            gst: payment.gst,
            net_amount: payment.amount,
            total_amount: payment.total_amount,
            payout_reference: null,
            account_number: beneficiary?.bank_account || "",
            ifsc_code: beneficiary?.ifsc || "",
            account_holder_name: beneficiary?.full_name || "",
            bank_name: beneficiary?.bank_name || "",
            transfer_type: "IMPS",
            status: payment.status,
            payment_status: payment.status,
            is_payment_record: true,
            auto_payout_failed: isAutoFailed,
            created_at: payment.created_at,
            gateway_transaction_id: payment.gateway_transaction_id || null,
            card_type: payment.card_type || null,
            gateway_environment: payment.gateway_environment || null,
            kyc_required: categoryDetails.kyc_required,
            settlement_time: categoryDetails.settlement_time,
            payout_mode: isAutoFailed ? "manual" : (payment.payout_mode ?? gw?.payout_mode ?? null),
            gateway_settlement_status: payment.gateway_settlement_status ?? null,
            sender: u ? { full_name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), email: u.email, mobile: u.mobile_number } : null,
            beneficiary: beneficiary ? {
              beneficiary_name: beneficiary.full_name,
              account_number: beneficiary.bank_account,
              ifsc_code: beneficiary.ifsc,
              bank_name: beneficiary.bank_name,
              mobile: beneficiary.mobile || null,
              email: beneficiary.email || null,
            } : null,
            gateway: gw ? { gateway_name: gw.gateway_name, payout_mode: isAutoFailed ? "manual" : (payment.payout_mode ?? gw.payout_mode) } : null,
            merchant_kyc: kycRes.data,
          };
        })
    );

    const enrichedPayouts = await Promise.all(
      (existingPayouts || []).map(async (payout: any) => {
        const [userRes, beneficiaryRes, gatewayRes, onboardingRes, paymentRes] = await Promise.all([
          supabase.from("users").select("first_name, last_name, email, mobile_number").eq("id", payout.user_id).maybeSingle(),
          supabase.from("beneficiaries").select("beneficiary_name, account_number, ifsc_code, bank_name, mobile, email").eq("id", payout.beneficiary_id).maybeSingle(),
          supabase.from("payment_gateway_settings").select("gateway_name, payout_mode").eq("id", payout.payment_gateway_id).maybeSingle(),
          supabase.from("merchant_onboarding").select("status, pan_number, pan_photo_url").eq("payment_id", payout.payment_id).maybeSingle(),
          payout.payment_id
            ? supabase.from("payments").select("gateway_transaction_id, card_type, gateway_environment, charges, gst, total_amount, payment_reference, status, payment_category_id, gateway_settlement_status, payout_mode").eq("id", payout.payment_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        const u = userRes.data;
        const pm = paymentRes.data;
        const gw = gatewayRes.data;
        const categoryDetails = await getCategoryDetails(pm?.payment_category_id ?? null);

        return {
          ...payout,
          is_payment_record: false,
          gateway_transaction_id: pm?.gateway_transaction_id || null,
          card_type: pm?.card_type || null,
          gateway_environment: pm?.gateway_environment || null,
          charges: pm?.charges ?? payout.charges ?? null,
          gst: pm?.gst ?? payout.gst ?? null,
          total_amount: pm?.total_amount ?? payout.total_amount ?? null,
          payment_reference: pm?.payment_reference || payout.payment_reference || null,
          payment_status: pm?.status || null,
          kyc_required: categoryDetails.kyc_required,
          settlement_time: categoryDetails.settlement_time,
          payout_mode: pm?.payout_mode ?? gw?.payout_mode ?? payout.payout_mode ?? null,
          gateway_settlement_status: pm?.gateway_settlement_status ?? null,
          sender: u ? { full_name: `${u.first_name || ""} ${u.last_name || ""}`.trim(), email: u.email, mobile: u.mobile_number } : null,
          beneficiary: beneficiaryRes.data,
          gateway: gw ?? null,
          merchant_kyc: onboardingRes.data,
        };
      })
    );

    function getSettlementDays(t: string | null | undefined): number {
      if (!t) return 0;
      const s = t.trim().toLowerCase();
      if (s === "instant" || s === "t+0") return 0;
      const m = s.match(/^t\+(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    }

    function priorityTier(days: number): number {
      if (days === 0) return 0;
      if (days === 1) return 1;
      return 2;
    }

    const sorted = [...enrichedPayouts, ...enrichedFromPayments].sort((a: any, b: any) => {
      const daysA = getSettlementDays(a.settlement_time);
      const daysB = getSettlementDays(b.settlement_time);
      const tierA = priorityTier(daysA);
      const tierB = priorityTier(daysB);
      if (tierA !== tierB) return tierA - tierB;
      const dueA = new Date(a.created_at).getTime() + daysA * 86400000;
      const dueB = new Date(b.created_at).getTime() + daysB * 86400000;
      if (dueA !== dueB) return dueA - dueB;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    return new Response(
      JSON.stringify({ payouts: sorted }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
