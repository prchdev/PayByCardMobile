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
    const { token } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: record, error: fetchError } = await supabase
      .from("merchant_onboarding")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (fetchError || !record) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (record.status === "verified") {
      return new Response(
        JSON.stringify({ status: "verified", message: "KYC already completed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (record.status === "refunded") {
      return new Response(
        JSON.stringify({ status: "refunded", message: "This payment has been refunded" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (record.status === "rejected") {
      const now = new Date();
      const expiresAt = new Date(record.expires_at);
      const expired = now > expiresAt;

      if (expired) {
        return new Response(
          JSON.stringify({ status: "expired", message: "This link has expired" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          status: "rejected",
          message: "KYC was rejected. Please re-submit.",
          data: {
            id: record.id,
            sender_name: record.sender_name,
            category_name: record.category_name,
            beneficiary_name: record.beneficiary_name,
            email: record.email,
            mobile: record.mobile,
            pan_number: record.pan_number,
            pan_photo_url: record.pan_photo_url,
            expires_at: record.expires_at,
            rejection_reason: record.rejection_reason || null,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const expiresAt = new Date(record.expires_at);

    if (now > expiresAt) {
      return new Response(
        JSON.stringify({ status: "expired", message: "This link has expired" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: "pending",
        data: {
          id: record.id,
          sender_name: record.sender_name,
          category_name: record.category_name,
          beneficiary_name: record.beneficiary_name,
          email: record.email,
          mobile: record.mobile,
          pan_number: record.pan_number,
          pan_photo_url: record.pan_photo_url,
          expires_at: record.expires_at,
        },
      }),
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
