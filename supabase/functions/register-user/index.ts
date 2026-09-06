import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import bcrypt from "npm:bcryptjs@2.4.3";
import { validatePassword } from '../_shared/passwordValidation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface RegisterRequest {
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName?: string;
  mobileNumber: string;
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

    const requestData: RegisterRequest = await req.json();
    const { firstName, middleName, lastName, fullName, mobileNumber, email, password } = requestData;

    if (!firstName || !lastName || !mobileNumber || !email || !password) {
      return new Response(
        JSON.stringify({ error: 'All fields are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ── Length limits ──────────────────────────────────────────────────────────
    if (firstName.length < 1 || firstName.length > 50) {
      return new Response(JSON.stringify({ error: 'First name must be 1–50 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (lastName.length < 1 || lastName.length > 50) {
      return new Response(JSON.stringify({ error: 'Last name must be 1–50 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (middleName && middleName.length > 50) {
      return new Response(JSON.stringify({ error: 'Middle name must be ≤50 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (email.length > 254) {
      return new Response(JSON.stringify({ error: 'Email address too long' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const emailRegex = /^[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,255}\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const mobileRegex = /^\+?91?\d{10}$/;
    if (!mobileRegex.test(mobileNumber.replace(/\s/g, ''))) {
      return new Response(
        JSON.stringify({ error: 'Mobile number must be a valid 10-digit Indian number' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return new Response(
        JSON.stringify({ error: passwordValidation.error }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: existingByEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    const { data: existingByMobile } = await supabase
      .from('users')
      .select('id')
      .eq('mobile_number', mobileNumber)
      .maybeSingle();

    const existingUser = existingByEmail || existingByMobile;

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: 'Email or mobile number already registered' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const passwordHash = await bcrypt.hash(password, 8);

    const computedFullName = fullName || [firstName, middleName, lastName].filter(Boolean).join(' ');

    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        full_name: computedFullName,
        mobile_number: mobileNumber,
        email: email,
        password_hash: passwordHash,
      })
      .select()
      .single();

    if (userError) {
      throw userError;
    }

    const mobileOTP = generateOTP();
    const emailOTP = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { error: otpError } = await supabase
      .from('otp_verification')
      .insert({
        user_id: newUser.id,
        mobile_otp: mobileOTP,
        email_otp: emailOTP,
        mobile_otp_expires_at: expiresAt.toISOString(),
        email_otp_expires_at: expiresAt.toISOString(),
      });

    if (otpError) {
      throw otpError;
    }

    const sendNotifications = async () => {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mobile: mobileNumber,
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
            to: email,
            subject: 'Welcome to PayByCard - Verify Your Email',
            body: `
              <div style="margin-bottom: 24px;">
                <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                  Welcome to PayByCard, ${firstName}!
                </h2>
                <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                  Thank you for choosing PayByCard as your trusted payment gateway solution. We're excited to have you on board!
                </p>
                <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                  To get started and complete your registration, please verify your email address using the One-Time Password (OTP) below:
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

              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                <h3 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 16px 0;">
                  What's Next?
                </h3>
                <ul style="color: #4b5563; font-size: 15px; line-height: 1.8; padding-left: 20px; margin: 0;">
                  <li>Enter the OTP to verify your email address</li>
                  <li>Complete your KYC verification</li>
                  <li>Add your beneficiaries</li>
                  <li>Start accepting payments seamlessly</li>
                </ul>
              </div>

              <div style="margin-top: 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px; text-align: center;">
                <p style="color: #6b7280; font-size: 14px; margin: 0;">
                  If you didn't create this account, please ignore this email or contact our support team immediately.
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

    EdgeRuntime.waitUntil(sendNotifications());

    return new Response(
      JSON.stringify({
        success: true,
        userId: newUser.id,
        message: 'Registration successful. OTPs sent to mobile and email.',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Registration failed',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// redeploy
