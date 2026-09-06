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
    const { email, emailOtp, mobileOtp } = await req.json();

    if (!email || !emailOtp || !mobileOtp) {
      return new Response(
        JSON.stringify({ error: "Email, email OTP, and mobile OTP are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date().toISOString();

    const { data: record } = await supabase
      .from("user_password_reset_otps")
      .select("id, otp, mobile_otp")
      .eq("email", String(email).trim())
      .eq("is_verified", false)
      .gt("expires_at", now)
      .maybeSingle();

    if (!record) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired OTP. Please request a new one." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (record.otp !== String(emailOtp).trim()) {
      return new Response(
        JSON.stringify({ error: "Invalid email OTP" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (record.mobile_otp !== String(mobileOtp).trim()) {
      return new Response(
        JSON.stringify({ error: "Invalid mobile OTP" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("user_password_reset_otps")
      .update({ is_verified: true, verified_at: now, mobile_otp_verified: true })
      .eq("id", record.id);

    return new Response(
      JSON.stringify({ success: true, message: "OTPs verified successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
