import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface VerifyOTPRequest {
  userId: string;
  mobileOTP: string;
  emailOTP: string;
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

    const requestData: VerifyOTPRequest = await req.json();
    const { userId, mobileOTP, emailOTP } = requestData;

    if (!userId || !mobileOTP || !emailOTP) {
      return new Response(
        JSON.stringify({ error: 'User ID and both OTPs are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: otpRecord, error: otpFetchError } = await supabase
      .from('otp_verification')
      .select('*')
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

    // F20: Reject after 5 failed attempts.
    if (otpRecord.attempts >= 5) {
      return new Response(
        JSON.stringify({ error: 'Too many incorrect attempts. Please request a new OTP.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date();
    const mobileExpiry = new Date(otpRecord.mobile_otp_expires_at);
    const emailExpiry = new Date(otpRecord.email_otp_expires_at);

    if (now > mobileExpiry) {
      return new Response(
        JSON.stringify({ error: 'Mobile OTP has expired. Please request a new one.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (now > emailExpiry) {
      return new Response(
        JSON.stringify({ error: 'Email OTP has expired. Please request a new one.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (otpRecord.mobile_otp !== mobileOTP) {
      await supabase.from('otp_verification').update({ attempts: otpRecord.attempts + 1 }).eq('id', otpRecord.id);
      return new Response(
        JSON.stringify({ error: 'Invalid mobile OTP' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (otpRecord.email_otp !== emailOTP) {
      await supabase.from('otp_verification').update({ attempts: otpRecord.attempts + 1 }).eq('id', otpRecord.id);
      return new Response(
        JSON.stringify({ error: 'Invalid email OTP' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { error: otpUpdateError } = await supabase
      .from('otp_verification')
      .update({
        mobile_verified: true,
        email_verified: true,
      })
      .eq('id', otpRecord.id);

    if (otpUpdateError) {
      throw otpUpdateError;
    }

    const loginIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null;

    const { error: userUpdateError } = await supabase
      .from('users')
      .update({
        is_mobile_verified: true,
        is_email_verified: true,
        last_login_at: new Date().toISOString(),
        ...(loginIp ? { last_login_ip: loginIp } : {}),
      })
      .eq('id', userId);

    if (userUpdateError) {
      throw userUpdateError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'OTP verification successful',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('OTP verification error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'OTP verification failed',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// redeploy
