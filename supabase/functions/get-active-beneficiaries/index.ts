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

    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: beneficiaries, error } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "Active")
      .order("full_name", { ascending: true });

    if (error) {
      console.error("Error fetching beneficiaries:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch beneficiaries" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const list = beneficiaries || [];

    if (list.length === 0) {
      return new Response(
        JSON.stringify({ beneficiaries: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [{ data: bankAccounts }, { data: merchantOnboarding }] = await Promise.all([
      supabase
        .from("user_bank_accounts")
        .select("bank_account_number, ifsc_code"),
      supabase
        .from("merchant_onboarding")
        .select("bank_account_number, bank_ifsc")
        .eq("status", "verified"),
    ]);

    const bankAccountSet = new Set(
      (bankAccounts || []).map((b: any) => `${b.bank_account_number}|${b.ifsc_code}`)
    );
    const merchantSet = new Set(
      (merchantOnboarding || []).map((m: any) => `${m.bank_account_number}|${m.bank_ifsc}`)
    );

    const enriched = list.map((b: any) => {
      const key = `${b.bank_account}|${b.ifsc}`;
      const is_verified_merchant = bankAccountSet.has(key) || merchantSet.has(key);
      return { ...b, is_verified_merchant };
    });

    return new Response(
      JSON.stringify({ beneficiaries: enriched }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Exception in get-active-beneficiaries:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
