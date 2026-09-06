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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: userExists, error: userCheckError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (userCheckError || !userExists) {
      return new Response(
        JSON.stringify({ error: 'Invalid user' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: beneficiaries, error } = await supabase
      .from('beneficiaries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return new Response(
        JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const list = beneficiaries || [];

    if (list.length === 0) {
      return new Response(
        JSON.stringify({ beneficiaries: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all user bank accounts and verified merchant onboarding records once
    const [{ data: bankAccounts }, { data: merchantOnboarding }] = await Promise.all([
      supabase
        .from('user_bank_accounts')
        .select('bank_account_number, ifsc_code'),
      supabase
        .from('merchant_onboarding')
        .select('bank_account_number, bank_ifsc')
        .eq('status', 'verified'),
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
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


// redeploy
