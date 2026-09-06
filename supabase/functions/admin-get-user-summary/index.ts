import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function deriveDisplayStatus(payment: any, payout: any): string {
  const s = payment.status;
  if (s === "failed") return "failed";
  if (s === "cancelled") return "cancelled";
  if (s === "kyc_pending") return "kyc_pending";
  if (s === "refund_pending") return "refund_pending";
  if (s === "refunded") return "refunded";
  if (s === "completed") return "completed";
  if (s === "settlement_pending") {
    if (payout && payout.status === "completed") return "completed";
    return "settlement_pending";
  }
  return "processing";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { adminId, query, userId: selectedUserId } = await req.json();

    if (!adminId) {
      return new Response(JSON.stringify({ error: "adminId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify adminId
    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("id, role, is_active")
      .eq("id", adminId)
      .maybeSingle();

    if (adminError || !admin || !admin.is_active) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase 1: search — return list of matching users
    if (!selectedUserId) {
      if (!query || String(query).trim() === "") {
        return new Response(JSON.stringify({ error: "query is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const term = `%${String(query).trim()}%`;

      // Search across first_name, last_name, email, mobile_number using ILIKE
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, mobile_number, is_restricted, is_disabled, created_at")
        .or(
          `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},mobile_number.ilike.${term}`
        )
        .order("created_at", { ascending: false })
        .limit(20);

      if (usersError) {
        console.error("Error searching users:", usersError);
        return new Response(JSON.stringify({ error: "Failed to search users" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Return empty array (not 404) when no users found — let frontend show empty state
      const normalised = (users || []).map((u: any) => ({
        ...u,
        full_name: [u.first_name, u.last_name].filter(Boolean).join(" "),
        mobile: u.mobile_number,
      }));

      return new Response(JSON.stringify({ users: normalised }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase 2: full summary for a selected userId
    const userId = selectedUserId;

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, first_name, last_name, email, mobile_number, is_restricted, is_disabled, kyc_completed, is_mobile_verified, is_email_verified, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle();

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalisedUser = {
      ...user,
      full_name: [user.first_name, user.last_name].filter(Boolean).join(" "),
      mobile: user.mobile_number,
    };

    const [
      panResult,
      addressResult,
      businessResult,
      beneficiariesResult,
      bankAccountsResult,
      paymentsResult,
      supportTicketsResult,
    ] = await Promise.all([
      supabase
        .from("kyc_pan_verification")
        .select("id, pan_number, pan_photo_url, status, rejection_reason, created_at, updated_at, approval_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from("kyc_address_proof")
        .select("id, proof_type, address, city, state, pincode, front_photo_url, back_photo_url, status, rejection_reason, created_at, updated_at, approval_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from("kyc_business_info")
        .select("id, business_name, incorporation_number, gst_number, company_type, status, rejection_reason, loa_url, moa_url, aoa_url, incorporation_certificate_url, gst_certificate_url, created_at, updated_at, approval_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from("beneficiaries")
        .select("id, full_name, bank_account, ifsc, bank_name, branch_name, account_type, email, mobile, pan_number, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),

      supabase
        .from("user_bank_accounts")
        .select("id, bank_account_number, ifsc_code, bank_name, branch_name, account_type, full_name, email, mobile_number, pan_number, is_default, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),

      supabase
        .from("payments")
        .select("id, payment_reference, amount, charges, gst, discount, total_amount, status, card_type, gateway_transaction_id, failure_reason, created_at, completed_at, beneficiary_details, category_details, selected_payment_option, transaction_summary, payment_gateway_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("support_tickets")
        .select("id, ticket_number, category, sub_category, description, status, priority, created_at, updated_at, closed_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ]);

    const payments = paymentsResult.data || [];
    let enrichedPayments: any[] = [];

    if (payments.length > 0) {
      const paymentIds = payments.map((p: any) => p.id);
      const { data: payouts } = await supabase
        .from("payouts")
        .select("id, payment_id, status, completed_at, utr_number, payout_reference, payout_reference_number, failure_reason")
        .in("payment_id", paymentIds)
        .order("created_at", { ascending: false });

      const payoutMap: Record<string, any> = {};
      if (payouts) {
        for (const payout of payouts) {
          if (payout.payment_id && !payoutMap[payout.payment_id]) {
            payoutMap[payout.payment_id] = payout;
          }
        }
      }

      enrichedPayments = payments.map((payment: any) => {
        const payout = payoutMap[payment.id] || null;
        return {
          ...payment,
          display_status: deriveDisplayStatus(payment, payout),
          payout: payout
            ? {
                id: payout.id,
                status: payout.status,
                payout_reference: payout.payout_reference || payout.payout_reference_number,
                completed_at: payout.completed_at,
                utr_number: payout.utr_number,
                failure_reason: payout.failure_reason,
              }
            : null,
        };
      });
    }

    return new Response(
      JSON.stringify({
        user: normalisedUser,
        kyc: {
          pan_info: panResult.data ?? null,
          address_info: addressResult.data ?? null,
          business_info: businessResult.data ?? null,
        },
        beneficiaries: beneficiariesResult.data || [],
        bankAccounts: bankAccountsResult.data || [],
        transactions: enrichedPayments,
        supportTickets: supportTicketsResult.data || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in admin-get-user-summary:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


// redeploy
