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
    const { email } = await req.json();

    if (!email || typeof email !== "string" || !email.trim()) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: user } = await supabase
      .from("users")
      .select("id, email, mobile_number")
      .eq("email", email.trim())
      .maybeSingle();

    if (!user) {
      // F21: Return the same success response whether or not the email exists,
      // so an attacker cannot enumerate accounts.
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists with this email, OTPs have been sent." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // F19: Use crypto.getRandomValues for security-critical codes.
    const emailOtpArr = new Uint32Array(1);
    const mobileOtpArr = new Uint32Array(1);
    crypto.getRandomValues(emailOtpArr);
    crypto.getRandomValues(mobileOtpArr);
    const emailOtp = (100000 + (emailOtpArr[0] % 900000)).toString();
    const mobileOtp = (100000 + (mobileOtpArr[0] % 900000)).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase
      .from("user_password_reset_otps")
      .delete()
      .eq("user_id", user.id);

    const { error: insertError } = await supabase
      .from("user_password_reset_otps")
      .insert({
        user_id: user.id,
        email: email.trim(),
        otp: emailOtp,
        mobile_otp: mobileOtp,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("Failed to insert OTP:", insertError.message);
      return new Response(
        JSON.stringify({ error: "Failed to generate OTP" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sendMessages = async () => {
      // Send email OTP
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: email.trim(),
            subject: "Password Reset OTP - PayByCard",
            body: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a56db;">Password Reset Request</h2>
                <p>You have requested to reset your password. Use the following OTP to verify your identity:</p>
                <div style="background-color: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                  <h1 style="color: #1a56db; font-size: 32px; margin: 0; letter-spacing: 5px;">${emailOtp}</h1>
                </div>
                <p>This OTP will expire in 10 minutes.</p>
                <p>If you did not request this password reset, please ignore this email.</p>
                <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
                  This is an automated message from PayByCard. Please do not reply to this email.
                </p>
              </div>
            `,
            body_type: "html",
            use_template: true,
          }),
        });
      } catch (emailError) {
        console.error("Failed to send email OTP:", emailError);
      }

      // Send mobile OTP via SMS
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mobile: user.mobile_number,
            message: mobileOtp,
            message_type: "otp",
            variables: { otp: mobileOtp },
          }),
        });
      } catch (smsError) {
        console.error("Failed to send SMS OTP:", smsError);
      }
    };

    EdgeRuntime.waitUntil(sendMessages());

    // Mask the mobile number for display (e.g. ******7890)
    const maskedMobile = user.mobile_number
      ? user.mobile_number.slice(-4).padStart(user.mobile_number.length, "*")
      : null;

    return new Response(
      JSON.stringify({
        success: true,
        message: "OTPs sent to your email and mobile number",
        maskedMobile,
      }),
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
