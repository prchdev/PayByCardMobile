import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function generateOTP(): string {
  return (() => { const a = new Uint32Array(1); crypto.getRandomValues(a); return (100000 + (a[0] % 900000)).toString(); })();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("id, email, full_name")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle();

    if (adminError || !admin) {
      return new Response(
        JSON.stringify({ error: "Admin account not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const otp = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    const { error: otpError } = await supabase
      .from("admin_password_reset_otps")
      .insert({
        admin_id: admin.id,
        email: admin.email,
        otp: otp,
        expires_at: expiresAt.toISOString(),
      });

    if (otpError) {
      console.error("OTP creation error:", otpError);
      return new Response(
        JSON.stringify({ error: "Failed to generate OTP" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`OTP for ${email}: ${otp}`);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      console.log(`Attempting to send password reset email to ${admin.email}`);
      console.log(`Using SUPABASE_URL: ${supabaseUrl}`);

      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: admin.email,
          subject: 'Admin Password Reset - Verification Code',
          body: `
            <div style="margin-bottom: 24px;">
              <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                Password Reset Request
              </h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                Hello ${admin.full_name},
              </p>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                We received a request to reset your admin password. Use the One-Time Password (OTP) below to proceed with password reset:
              </p>
            </div>

            <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #86efac; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #16a34a; font-size: 14px; font-weight: 600; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                Your Verification Code
              </p>
              <div style="background-color: #ffffff; border-radius: 8px; padding: 20px; display: inline-block; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
                <h1 style="color: #8c76f0; margin: 0; font-size: 42px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                  ${otp}
                </h1>
              </div>
              <p style="color: #16a34a; font-size: 13px; margin: 16px 0 0 0;">
                ⏱️ Valid for 10 minutes
              </p>
            </div>

            <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="color: #991b1b; font-size: 14px; line-height: 1.5; margin: 0;">
                <strong>Security Alert:</strong> If you didn't request this password reset, please ignore this email and your password will remain unchanged. Never share this OTP with anyone.
              </p>
            </div>

            <div style="margin-top: 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px; text-align: center;">
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                This is an automated message for admin account security. If you need assistance, please contact the system administrator.
              </p>
            </div>
          `,
          body_type: 'html',
          use_template: true,
        }),
      });

      console.log(`Email API response status: ${emailResponse.status}`);
      const emailData = await emailResponse.json();
      console.log('Email API response data:', JSON.stringify(emailData, null, 2));

      if (!emailResponse.ok) {
        console.error('❌ Email sending failed with status:', emailResponse.status);
        console.error('Error details:', JSON.stringify(emailData, null, 2));
      } else {
        console.log(`✅ Password reset email sent successfully to ${admin.email}`);
      }
    } catch (emailError) {
      console.error('❌ Error sending password reset email:', emailError);
      if (emailError instanceof Error) {
        console.error('Error message:', emailError.message);
        console.error('Error stack:', emailError.stack);
      }
    }

    return new Response(
      JSON.stringify({
        message: "OTP sent successfully",
        email: admin.email,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// redeploy
