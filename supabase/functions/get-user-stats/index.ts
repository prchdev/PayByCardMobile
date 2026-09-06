import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("payments")
      .select("total_amount, amount, status")
      .eq("user_id", userId);

    if (error) throw new Error(error.message);

    const payments = data || [];

    let amountProcessed = 0;
    let amountInSettlement = 0;
    const totalTransactions = payments.length;

    for (const p of payments) {
      const amt = parseFloat(p.total_amount || p.amount || "0");
      if (p.status === "completed" || p.status === "settlement_pending") {
        amountProcessed += amt;
      }
      if (p.status === "settlement_pending") {
        amountInSettlement += amt;
      }
    }

    return new Response(
      JSON.stringify({
        amount_processed: amountProcessed,
        amount_in_settlement: amountInSettlement,
        total_transactions: totalTransactions,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-user-stats error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
