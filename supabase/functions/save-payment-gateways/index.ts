import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { admin_id, gateways, ip_address } = await req.json();

    if (!admin_id) {
      return new Response(
        JSON.stringify({ error: 'Admin ID is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!gateways || !Array.isArray(gateways)) {
      return new Response(
        JSON.stringify({ error: 'Invalid gateways data' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
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
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const clientIp = ip_address || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'Unknown';

    for (const gateway of gateways) {
      const { error: updateError } = await supabase
        .from('payment_gateway_settings')
        .update({
          environment: gateway.environment,
          is_enabled: gateway.is_enabled,
          app_id: gateway.app_id,
          secret_key: gateway.secret_key,
          test_api_key: gateway.test_api_key,
          test_api_secret: gateway.test_api_secret,
          production_api_key: gateway.production_api_key,
          production_api_secret: gateway.production_api_secret,
          supported_cards: gateway.supported_cards,
          instant_settlement_cards: gateway.instant_settlement_cards,
          default_payment_cards: gateway.default_payment_cards,
          gst_percentage: gateway.gst_percentage,
          payout_mode: gateway.payout_mode,
          registered_name: gateway.registered_name,
          gst_number: gateway.gst_number,
          test_payout_client_id: gateway.test_payout_client_id,
          test_payout_client_secret: gateway.test_payout_client_secret,
          production_payout_client_id: gateway.production_payout_client_id,
          production_payout_client_secret: gateway.production_payout_client_secret,
          test_payout_account_number: gateway.test_payout_account_number,
          production_payout_account_number: gateway.production_payout_account_number,
          test_cashfree_2fa_public_key: gateway.test_cashfree_2fa_public_key,
          production_cashfree_2fa_public_key: gateway.production_cashfree_2fa_public_key,
          updated_at: new Date().toISOString(),
          updated_by: admin_id,
          updated_ip: clientIp,
        })
        .eq('id', gateway.id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: updateError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Payment gateways updated successfully' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});


// redeploy
