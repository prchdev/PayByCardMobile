import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { userId } = body;

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

    // Check if business info exists and is rejected
    const { data: businessInfo, error: fetchError } = await supabase
      .from("kyc_business_info")
      .select("id, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!businessInfo) {
      return new Response(JSON.stringify({ error: "Business information not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (businessInfo.status !== "rejected") {
      return new Response(JSON.stringify({ error: "Can only remove rejected business information" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete the business information
    const { error: deleteError } = await supabase
      .from("kyc_business_info")
      .delete()
      .eq("user_id", userId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    // Check if PAN and Address are both approved
    const { data: panData } = await supabase
      .from("kyc_pan_verification")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: addressData } = await supabase
      .from("kyc_address_proof")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    // If both PAN and Address are approved, set user KYC as verified
    if (panData?.status === "approved" && addressData?.status === "approved") {
      const { error: updateError } = await supabase
        .from("users")
        .update({ kyc_completed: true })
        .eq("id", userId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      return new Response(JSON.stringify({
        success: true,
        kycVerified: true,
        message: "Business information removed and KYC verified"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      kycVerified: false,
      message: "Business information removed successfully"
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
