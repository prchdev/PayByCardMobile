import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import bcrypt from "npm:bcryptjs@2.4.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

interface LoginRequest {
  email: string;
  password: string;
}

function generateOTP(): string {
  return (() => { const a = new Uint32Array(1); crypto.getRandomValues(a); return (100000 + (a[0] % 900000)).toString(); })();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const requestData: LoginRequest = await req.json();
    const { email, password } = requestData;

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'Email and password are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const emailRegex = /^[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,255}\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(String(email).trim())) {
      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, mobile_number, is_mobile_verified, is_email_verified, kyc_completed, first_name, last_name, password_hash, is_disabled, is_restricted, failed_login_attempts, locked_until')
      .eq('email', email)
      .maybeSingle();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid email or password' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return new Response(
        JSON.stringify({
          error: `Your account is temporarily locked due to too many failed login attempts. Please try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''} or reset your password using Forgot Password.`,
          isLocked: true,
        }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      const newAttempts = (user.failed_login_attempts ?? 0) + 1;
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;

      await supabase
        .from('users')
        .update({
          failed_login_attempts: newAttempts,
          ...(shouldLock ? { locked_until: lockedUntil } : {}),
        })
        .eq('id', user.id);

      if (shouldLock) {
        return new Response(
          JSON.stringify({
            error: `Your account has been locked after ${MAX_FAILED_ATTEMPTS} failed login attempts. Please reset your password using Forgot Password or try again in ${LOCKOUT_MINUTES} minutes.`,
            isLocked: true,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const remaining = MAX_FAILED_ATTEMPTS - newAttempts;
      return new Response(
        JSON.stringify({
          error: `Invalid email or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before account is locked.`,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const loginIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null;

    // Reset failed attempts on successful password match and record login
    await supabase
      .from('users')
      .update({
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
        ...(loginIp ? { last_login_ip: loginIp } : {}),
      })
      .eq('id', user.id);

    if (user.is_disabled) {
      return new Response(
        JSON.stringify({ error: 'Your account has been disabled by our compliance team. Please raise a support ticket for assistance.' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const isFullyVerified = user.is_mobile_verified && user.is_email_verified;

    if (!isFullyVerified) {
      const mobileOTP = generateOTP();
      const emailOTP = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await supabase
        .from('otp_verification')
        .delete()
        .eq('user_id', user.id);

      const { error: otpError } = await supabase
        .from('otp_verification')
        .insert({
          user_id: user.id,
          mobile_otp: mobileOTP,
          email_otp: emailOTP,
          mobile_otp_expires_at: expiresAt.toISOString(),
          email_otp_expires_at: expiresAt.toISOString(),
        });

      if (otpError) {
        throw otpError;
      }

      const sendVerificationMessages = async () => {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              mobile: user.mobile_number,
              message: mobileOTP,
              message_type: 'otp',
              variables: { otp: mobileOTP },
            }),
          });
        } catch (smsError) {
          console.error('Error sending SMS:', smsError);
        }

        try {
          await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: user.email,
              subject: 'PayByCard - Verify Your Account',
              body: `
                <div style="margin-bottom: 24px;">
                  <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                    Verify Your Account
                  </h2>
                  <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                    Hello ${user.first_name},
                  </p>
                  <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                    Your account verification is pending. Please use the OTP below to complete the process:
                  </p>
                </div>

                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #86efac; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                  <p style="color: #16a34a; font-size: 14px; font-weight: 600; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                    Your Verification Code
                  </p>
                  <div style="background-color: #ffffff; border-radius: 8px; padding: 20px; display: inline-block; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
                    <h1 style="color: #8c76f0; margin: 0; font-size: 42px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                      ${emailOTP}
                    </h1>
                  </div>
                  <p style="color: #16a34a; font-size: 13px; margin: 16px 0 0 0;">
                    Valid for 10 minutes
                  </p>
                </div>

                <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 24px 0;">
                  <p style="color: #92400e; font-size: 14px; line-height: 1.5; margin: 0;">
                    <strong>Security Tip:</strong> Never share this OTP with anyone. PayByCard will never ask for your OTP via phone or email.
                  </p>
                </div>
              `,
              body_type: 'html',
              use_template: true,
            }),
          });
        } catch (emailError) {
          console.error('Error sending email:', emailError);
        }
      };

      EdgeRuntime.waitUntil(sendVerificationMessages());

      return new Response(
        JSON.stringify({
          success: true,
          userId: user.id,
          email: user.email,
          mobileNumber: user.mobile_number,
          firstName: user.first_name,
          lastName: user.last_name,
          isVerified: false,
          kycCompleted: user.kyc_completed,
          needsVerification: true,
          message: 'OTPs sent to mobile and email for verification.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId: user.id,
        email: user.email,
        mobileNumber: user.mobile_number,
        firstName: user.first_name,
        lastName: user.last_name,
        isVerified: true,
        kycCompleted: user.kyc_completed,
        needsVerification: false,
        isRestricted: user.is_restricted || false,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Login failed',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// redeploy
