import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ProviderPayload {
  id?: string;
  provider_name: string;
  environment: 'testing' | 'production';
  is_enabled: boolean;
  is_default: boolean;
  test_api_key: string;
  test_api_secret: string;
  test_redirect_uri: string;
  test_public_key: string;
  test_public_key_password: string;
  production_api_key: string;
  production_api_secret: string;
  production_redirect_uri: string;
  production_public_key: string;
  production_public_key_password: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: { admin_id?: string; providers?: ProviderPayload[] } = await req.json();
    const { admin_id, providers } = body;

    if (!admin_id) {
      return new Response(
        JSON.stringify({ error: 'Missing admin_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: admin, error: adminError } = await supabase
      .from('admin_users')
      .select('id, is_active, role')
      .eq('id', admin_id)
      .maybeSingle();

    if (adminError || !admin || !admin.is_active) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized access' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No providers data provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const errors: string[] = [];

    for (const provider of providers) {
      const upsertData = {
        provider_name: provider.provider_name,
        environment: provider.environment,
        is_enabled: provider.is_enabled,
        is_default: provider.is_default,
        test_api_key: provider.test_api_key || '',
        test_api_secret: provider.test_api_secret || '',
        test_redirect_uri: provider.test_redirect_uri || '',
        test_public_key: provider.test_public_key || '',
        test_public_key_password: provider.test_public_key_password || '',
        production_api_key: provider.production_api_key || '',
        production_api_secret: provider.production_api_secret || '',
        production_redirect_uri: provider.production_redirect_uri || '',
        production_public_key: provider.production_public_key || '',
        production_public_key_password: provider.production_public_key_password || '',
        updated_by_admin_id: admin_id,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from('kyc_method_settings')
        .upsert(upsertData, { onConflict: 'provider_name' });

      if (upsertError) {
        errors.push(`${provider.provider_name}: ${upsertError.message}`);
      }
    }

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: errors.join('; ') }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'KYC method settings saved successfully' }),
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
