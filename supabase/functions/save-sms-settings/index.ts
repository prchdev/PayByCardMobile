import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { admin_id, settings, providers, ip_address } = await req.json();

    if (!admin_id) {
      return new Response(
        JSON.stringify({ error: 'Admin ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: admin, error: adminError } = await supabase
      .from('admin_users')
      .select('id, email, is_active')
      .eq('id', admin_id)
      .maybeSingle();

    if (adminError || !admin || !admin.is_active) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized access' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientIp = ip_address || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'Unknown';

    if (settings) {
      const { error: settingsError } = await supabase
        .from('sms_settings')
        .update({
          send_otp_sms: settings.send_otp_sms,
          send_transactional_sms: settings.send_transactional_sms,
          sender_id: settings.sender_id,
          dlt_entity_id: settings.dlt_entity_id || '',
          tpl_otp: settings.tpl_otp || '',
          tpl_merchant_onboarding: settings.tpl_merchant_onboarding || '',
          tpl_kyc_approved: settings.tpl_kyc_approved || '',
          tpl_kyc_rejected: settings.tpl_kyc_rejected || '',
          tpl_payment_settled: settings.tpl_payment_settled || '',
          tpl_payment_refund: settings.tpl_payment_refund || '',
          tpl_payment_initiated: settings.tpl_payment_initiated || '',
          updated_at: new Date().toISOString(),
          updated_by: admin_id,
          updated_ip: clientIp,
        })
        .eq('id', settings.id);

      if (settingsError) {
        return new Response(
          JSON.stringify({ error: settingsError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (providers && Array.isArray(providers)) {
      for (const provider of providers) {
        const { error: providerError } = await supabase
          .from('sms_provider_settings')
          .update({
            is_enabled: provider.is_enabled,
            is_default: provider.is_default,
            api_key: provider.api_key,
            otp_template_id: provider.otp_template_id,
            transactional_template_id: provider.transactional_template_id,
            dlt_kyc_approved: provider.dlt_kyc_approved || '',
            dlt_kyc_rejected: provider.dlt_kyc_rejected || '',
            dlt_payment_initiated: provider.dlt_payment_initiated || '',
            dlt_payment_settled: provider.dlt_payment_settled || '',
            dlt_payment_refund: provider.dlt_payment_refund || '',
            updated_at: new Date().toISOString(),
            updated_by: admin_id,
            updated_ip: clientIp,
          })
          .eq('id', provider.id);

        if (providerError) {
          return new Response(
            JSON.stringify({ error: providerError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'SMS settings updated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


// redeploy
