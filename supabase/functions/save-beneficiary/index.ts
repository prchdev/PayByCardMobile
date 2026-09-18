import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const currentTimestamp = new Date().toISOString();

    const {
      userId,
      full_name,
      bank_account,
      ifsc,
      bank_name,
      branch_name,
      account_type,
      email,
      mobile,
      pan_number,
      ipAddress,
    } = await req.json();

    const resolvedIP = ipAddress || clientIP;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Missing userId' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (!full_name || !bank_account || !ifsc || !bank_name || !branch_name || !account_type || !email || !mobile) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (!['Saving', 'Current'].includes(account_type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid account type' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ── Server-side length and format validation ───────────────────────────────
    if (full_name.trim().length < 2 || full_name.length > 100) {
      return new Response(JSON.stringify({ error: 'Account holder name must be 2–100 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (bank_account.length < 6 || bank_account.length > 20 || !/^\d+$/.test(bank_account)) {
      return new Response(JSON.stringify({ error: 'Bank account number must be 6–20 digits' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (bank_name.length < 2 || bank_name.length > 100) {
      return new Response(JSON.stringify({ error: 'Bank name must be 2–100 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (branch_name.length < 2 || branch_name.length > 100) {
      return new Response(JSON.stringify({ error: 'Branch name must be 2–100 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const emailRegex = /^[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,255}\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const mobileRegex = /^\d{10}$/;
    if (!mobileRegex.test(mobile.replace(/^\+91/, '').replace(/\D/g, ''))) {
      return new Response(JSON.stringify({ error: 'Mobile number must be 10 digits' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (pan_number) {
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(pan_number.toUpperCase())) {
        return new Response(JSON.stringify({ error: 'Invalid PAN format (e.g. ABCDE1234F)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const ifscUpper = ifsc.toUpperCase();
    if (ifscUpper.length !== 11) {
      return new Response(
        JSON.stringify({ error: 'IFSC code must be 11 characters' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // ── Credit card bill payment detection ─────────────────────────────────────
    const CREDIT_CARD_IFSCS = new Set([
      'ICIC0000104', 'ICIC0000105', 'ICIC0000106',
      'HDFC0000207', 'HDFC0000208',
      'SBIN0003833',
      'UTIB0000450',
      'YESB0000001',
      'KKBK0000801', 'KKBK0000802',
      'SCBL0032001',
      'BARB0VIPCARD',
      'CIUB0000001',
    ]);

    if (CREDIT_CARD_IFSCS.has(ifscUpper)) {
      return new Response(
        JSON.stringify({
          error: 'This IFSC code is for credit card bill payments. Adding credit card accounts as beneficiaries is not allowed.',
          credit_card: true,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const accountDigits = bank_account.replace(/[\s-]/g, '');
    if (/^\d{15,16}$/.test(accountDigits)) {
      const first = accountDigits[0];
      const len = accountDigits.length;
      const isCreditCard = first === '4' || (first === '5' && len === 16) || (first === '6' && len === 16);
      if (isCreditCard) {
        return new Response(
          JSON.stringify({
            error: 'The account number entered appears to be a credit card number. Credit card bill payments are not allowed through this platform.',
            credit_card: true,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    try {
      const ifscResponse = await fetch(`https://ifsc.razorpay.com/${ifscUpper}`);
      if (!ifscResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Invalid IFSC code. Please verify the IFSC code before saving.' }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }
    } catch (ifscError) {
      return new Response(
        JSON.stringify({ error: 'Could not validate IFSC code. Please verify the IFSC code before saving.' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const { data: userRecord, error: userCheckError } = await supabase
      .from('users')
      .select('id, first_name, last_name, full_name, email, mobile_number')
      .eq('id', userId)
      .maybeSingle();

    if (userCheckError || !userRecord) {
      return new Response(
        JSON.stringify({ error: 'Invalid user' }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // ── Self-transfer check ────────────────────────────────────────────────
    // Build a canonical name for the registered user
    const normalize = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const userFullName = normalize(
      userRecord.full_name ||
      `${userRecord.first_name || ''} ${userRecord.last_name || ''}`.trim()
    );
    const userEmail    = normalize(userRecord.email || '');
    const userMobile   = (userRecord.mobile_number || '').replace(/\D/g, '').slice(-10);

    const bName   = normalize(full_name);
    const bEmail  = normalize(email);
    const bMobile = (mobile || '').replace(/\D/g, '').slice(-10);

    const emailMatch  = userEmail  && bEmail  && userEmail  === bEmail;
    const mobileMatch = userMobile && bMobile && userMobile === bMobile;

    // Name match: compare full name and also first+last name parts
    const userFirstLast = normalize(
      `${userRecord.first_name || ''} ${userRecord.last_name || ''}`.trim()
    );
    const nameMatch = userFullName && bName && (
      userFullName === bName || userFirstLast === bName
    );

    // Check PAN match against user's own KYC PAN
    let panMatch = false;
    if (pan_number) {
      const { data: panRecord } = await supabase
        .from('kyc_pan_verification')
        .select('pan_number')
        .eq('user_id', userId)
        .maybeSingle();
      if (panRecord?.pan_number) {
        panMatch = panRecord.pan_number.trim().toUpperCase() === pan_number.trim().toUpperCase();
      }
    }

    // Block if any individual identity field matches the logged-in user
    if (nameMatch || emailMatch || mobileMatch || panMatch) {
      const matchedField = nameMatch ? 'name'
        : panMatch ? 'PAN number'
        : emailMatch ? 'email address'
        : 'mobile number';
      return new Response(
        JSON.stringify({
          error:
            `Sending money to your own account using this platform is strictly prohibited as per RBI norms. ` +
            `The beneficiary ${matchedField} matches your registered account.`,
          self_transfer: true,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: existing, error: checkError } = await supabase
      .from('beneficiaries')
      .select('id')
      .eq('user_id', userId)
      .eq('bank_account', bank_account)
      .eq('ifsc', ifscUpper)
      .maybeSingle();

    if (checkError) {
      return new Response(
        JSON.stringify({ error: 'Failed to check existing beneficiary' }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (existing) {
      return new Response(
        JSON.stringify({ error: 'Beneficiary already exists with this account number and IFSC code' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const { data, error } = await supabase
      .from('beneficiaries')
      .insert([{
        user_id: userId,
        full_name,
        bank_account,
        ifsc: ifscUpper,
        bank_name,
        branch_name,
        account_type,
        email,
        mobile,
        pan_number: pan_number || null,
        status: 'Active',
        created_by: userId,
        updated_by: userId,
        created_ip: resolvedIP,
        created_timestamp: currentTimestamp,
        updated_ip: resolvedIP,
        updated_timestamp: currentTimestamp
      }])
      .select()
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // ── In-app mobile notification ──────────────────────────────────────
    await supabase.rpc("create_mobile_notification", {
      p_user_id: userId,
      p_type: "beneficiary_added",
      p_title: "Beneficiary Added",
      p_body: `${full_name} has been added as a beneficiary. Bank: ${bank_name}, Account: ****${bank_account.slice(-4)}.`,
      p_data: { beneficiary_id: data.id, full_name, bank_name, account_last4: bank_account.slice(-4) },
    });

    try {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ userId, title: "Beneficiary Added", body: `${full_name} has been added as a beneficiary. Bank: ${bank_name}, Account: ****${bank_account.slice(-4)}.`, data: { type: "beneficiary_added", beneficiary_id: data.id } }),
      });
    } catch (e) { console.error("Push failed:", e); }

    return new Response(
      JSON.stringify({ success: true, beneficiary: data }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});


// redeploy
