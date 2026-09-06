import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(withSignedKycUrls(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await supabase.rpc("set_config", { setting: "app.current_user_id", value: userId });

    const [panResult, addressResult, businessResult, userResult] = await Promise.all([
      supabase
        .from("kyc_pan_verification")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("kyc_address_proof")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("kyc_business_info")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("users")
        .select("kyc_completed, first_name, middle_name, last_name, email, mobile_number")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const queryError = panResult.error || addressResult.error || businessResult.error || userResult.error;
    if (queryError) {
      throw queryError;
    }

    return new Response(
      JSON.stringify({
        pan: panResult.data,
        address: addressResult.data,
        business: businessResult.data,
        kycCompleted: userResult.data?.kyc_completed ?? false,
        userProfile: {
          first_name: userResult.data?.first_name ?? '',
          middle_name: userResult.data?.middle_name ?? '',
          last_name: userResult.data?.last_name ?? '',
          email: userResult.data?.email ?? '',
          mobile_number: userResult.data?.mobile_number ?? '',
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
