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

    let body;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { admin_id } = body;

    if (admin_id) {
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

      const { data: gateways, error: gatewaysError } = await supabase
        .from('payment_gateway_settings')
        .select('*')
        .order('gateway_name');

      if (gatewaysError) {
        return new Response(
          JSON.stringify({ error: gatewaysError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({ gateways }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      const { data: gateways, error: gatewaysError } = await supabase
        .from('payment_gateway_settings')
        .select('id, gateway_name, is_enabled, registered_name, gst_number, payout_mode')
        .eq('is_enabled', true)
        .order('gateway_name');

      if (gatewaysError) {
        return new Response(
          JSON.stringify({ error: gatewaysError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const formattedGateways = (gateways || []).map((gateway: any) => ({
        id: gateway.id,
        gateway_name: gateway.gateway_name,
        status: gateway.is_enabled ? 'active' : 'inactive',
        registered_name: gateway.registered_name || '',
        gst_number: gateway.gst_number || '',
        payout_mode: gateway.payout_mode || 'manual',
      }));

      return new Response(
        JSON.stringify({ gateways: formattedGateways }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
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
