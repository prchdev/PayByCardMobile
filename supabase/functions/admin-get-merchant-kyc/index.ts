import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(withSignedKycUrls(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { adminId, statusFilter } = await req.json();

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

    let query = supabase
      .from("merchant_onboarding")
      .select(`
        id, token, payment_id, beneficiary_id, full_name, email, mobile,
        pan_number, pan_photo_url, aadhaar_front_url, aadhaar_back_url,
        sender_name, category_name,
        bank_account_number, bank_ifsc, bank_name, bank_branch,
        status, expires_at, verified_at, created_at, updated_at,
        kyc_method, digilocker_verified, digilocker_provider,
        address_proof_type, ip_address, kyc_completed_at,
        rejection_reason
      `)
      .order("created_at", { ascending: false });

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data: records, error } = await query;

    if (error) {
      return new Response(
        JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enrich with payment reference
    const enriched = await Promise.all((records || []).map(async (rec: any) => {
      let payment_reference = null;
      let amount = null;
      if (rec.payment_id) {
        const { data: payment } = await supabase
          .from("payments")
          .select("payment_reference, amount")
          .eq("id", rec.payment_id)
          .maybeSingle();
        payment_reference = payment?.payment_reference ?? null;
        amount = payment?.amount ?? null;
      }
      return { ...rec, payment_reference, amount };
    }));

    return new Response(
      JSON.stringify({ records: enriched }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));


// redeploy
