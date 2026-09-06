import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ResendOTPRequest {
  userId: string;
  type: 'mobile' | 'email';
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

    const requestData: ResendOTPRequest = await req.json();
    const { userId, type } = requestData;

    if (!userId || !type) {
      return new Response(
        JSON.stringify({ error: 'User ID and type are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, mobile_number, first_name, last_name')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const newOTP = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { data: otpRecord, error: otpFetchError } = await supabase
      .from('otp_verification')
      .select('id, mobile_resend_count, email_resend_count')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpFetchError || !otpRecord) {
      return new Response(
        JSON.stringify({ error: 'OTP record not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const currentResendCount = type === 'mobile'
      ? otpRecord.mobile_resend_count
      : otpRecord.email_resend_count;

    if (currentResendCount >= 2) {
      return new Response(
        JSON.stringify({
          error: `Maximum resend limit reached. You can only resend ${type} OTP 2 times.`,
          resend_limit_reached: true,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const updateData = type === 'mobile'
      ? {
          mobile_otp: newOTP,
          mobile_otp_expires_at: expiresAt.toISOString(),
          mobile_resend_count: currentResendCount + 1,
        }
      : {
          email_otp: newOTP,
          email_otp_expires_at: expiresAt.toISOString(),
          email_resend_count: currentResendCount + 1,
        };

    const { error: otpUpdateError } = await supabase
      .from('otp_verification')
      .update(updateData)
      .eq('id', otpRecord.id);

    if (otpUpdateError) {
      throw otpUpdateError;
    }

    const remainingResends = 2 - (currentResendCount + 1);

    const sendNotification = async () => {
      if (type === 'mobile') {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              mobile: user.mobile_number,
              message: newOTP,
              message_type: 'otp',
              variables: { otp: newOTP },
            }),
          });
        } catch (smsError) {
          console.error('Error sending SMS:', smsError);
        }
      } else {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: user.email,
              subject: 'Verify Your Email - OTP Resent',
              body: `
                <div style="margin-bottom: 24px;">
                  <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                    Email Verification OTP Resent
                  </h2>
                  <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                    Hello ${user.first_name} ${user.last_name},
                  </p>
                  <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                    You requested to resend your email verification OTP. Please use the code below to complete your email verification:
                  </p>
                </div>

                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #86efac; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                  <p style="color: #16a34a; font-size: 14px; font-weight: 600; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                    Your Verification Code
                  </p>
                  <div style="background-color: #ffffff; border-radius: 8px; padding: 20px; display: inline-block; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
                    <h1 style="color: #8c76f0; margin: 0; font-size: 42px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                      ${newOTP}
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

                <div style="margin-top: 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px; text-align: center;">
                  <p style="color: #6b7280; font-size: 14px; margin: 0;">
                    If you didn't request this OTP resend, please contact our support team immediately.
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
      }
    };

    EdgeRuntime.waitUntil(sendNotification());

    return new Response(
      JSON.stringify({
        success: true,
        message: `OTP has been resent to your ${type}`,
        remaining_resends: remainingResends,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Resend OTP error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to resend OTP',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// redeploy
