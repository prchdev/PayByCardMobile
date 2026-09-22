import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId, beneficiaryId, categoryId } = await req.json();

    if (!userId || !beneficiaryId || !categoryId) {
      return new Response(
        JSON.stringify({ error: "userId, beneficiaryId, and categoryId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: category, error: catError } = await supabase
      .from("payment_categories")
      .select("max_payment_per_beneficiary")
      .eq("id", categoryId)
      .maybeSingle();

    if (catError || !category) {
      return new Response(
        JSON.stringify({ error: "Category not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const maxPerBeneficiary = Number(category.max_payment_per_beneficiary) || 0;

    if (maxPerBeneficiary <= 0) {
      return new Response(
        JSON.stringify({ maxPerBeneficiary: 0, totalThisMonth: 0, limitExceeded: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const { data, error } = await supabase
      .from("payments")
      .select("amount")
      .eq("user_id", userId)
      .eq("beneficiary_id", beneficiaryId)
      .eq("business_category_id", categoryId)
      .gte("created_at", monthStart.toISOString())
      .in("status", [
        "completed",
        "settlement_pending",
        "processing",
        "kyc_pending",
        "merchant_kyc_review",
        "settlement_in_progress",
        "auto_payout_failed",
      ]);

    if (error) {
      return new Response(
        JSON.stringify({ error: "Failed to check monthly limit" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalThisMonth = (data || []).reduce(
      (sum: number, row: any) => sum + Number(row.amount),
      0
    );

    const limitExceeded = totalThisMonth >= maxPerBeneficiary;

    return new Response(
      JSON.stringify({ maxPerBeneficiary, totalThisMonth, limitExceeded }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
