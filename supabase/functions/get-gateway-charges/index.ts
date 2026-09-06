import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase configuration');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: paymentOptions, error: optionsError } = await supabase
      .from('payment_options')
      .select('*')
      .eq('is_enabled', true)
      .order('category_name');

    if (optionsError) {
      return new Response(
        JSON.stringify({ error: optionsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: gateways, error: gatewaysError } = await supabase
      .from('payment_gateway_settings')
      .select('id, gateway_name, registered_name, gst_number, payout_mode, gst_percentage, is_enabled')
      .order('gateway_name');

    if (gatewaysError) {
      return new Response(
        JSON.stringify({ error: gatewaysError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gatewayMap = new Map<string, any>();
    for (const g of (gateways || [])) {
      gatewayMap.set(g.id, g);
    }

    const formattedOptions = (paymentOptions || [])
      .filter((option: any) => {
        if (!option.gateway_id) return false;
        const gw = gatewayMap.get(option.gateway_id);
        return gw && gw.is_enabled;
      })
      .map((option: any) => {
        const gw = gatewayMap.get(option.gateway_id);
        return {
          id: option.id,
          gateway_id: gw.id,
          category_id: option.id,
          gateway_name: gw.gateway_name,
          gateway_registered_name: gw.registered_name || '',
          gateway_gst_number: gw.gst_number || '',
          gateway_gst_percentage: parseFloat(gw.gst_percentage || 0),
          payout_mode: gw.payout_mode || 'manual',
          environment: option.environment || 'test',
          category_name: option.category_name,
          card_type: option.category_name,
          charges_percentage: parseFloat(option.charges_percentage || 0),
          discounted_charges_percentage: parseFloat(option.discounted_charges_percentage || 0),
          show_discount: option.show_discount || false,
          gst_percentage: parseFloat(option.gst_percentage || 0),
          business_surcharge_percentage: parseFloat(option.business_surcharge_percentage || 0),
          receiver_kyc_required: option.receiver_kyc_required || false,
          terms_and_conditions: option.terms_and_conditions || '',
          settlement_time: option.settlement_time || 'instant',
          is_instant_settlement: (option.settlement_time || '').toLowerCase() === 'instant',
        };
      });

    return new Response(
      JSON.stringify({ paymentOptions: formattedOptions }),
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
