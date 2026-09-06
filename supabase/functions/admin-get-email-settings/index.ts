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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { admin_id } = await req.json() as { admin_id: string };

    if (!admin_id) {
      return new Response(
        JSON.stringify({ error: 'Missing admin_id' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: admin, error: adminError } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', admin_id)
      .maybeSingle();

    if (adminError || !admin) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: settings, error: settingsError } = await supabase
      .from('email_settings')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (settingsError) {
      console.error('Error fetching email settings:', settingsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch email settings' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!settings) {
      return new Response(
        JSON.stringify({
          success: true,
          settings: null,
          message: 'No email settings configured',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const settingsResponse = {
      id: settings.id,
      from_email: settings.from_email,
      from_display_name: settings.from_display_name,
      smtp_username: settings.smtp_username,
      smtp_password: settings.smtp_password,
      smtp_server: settings.smtp_server,
      smtp_port: settings.smtp_port,
      use_tls: settings.use_tls,
      use_ssl: settings.use_ssl || false,
      updated_by_admin_id: settings.updated_by_admin_id,
      updated_by_admin_name: settings.updated_by_admin_name,
      updated_by_ip_address: settings.updated_by_ip_address,
      updated_at: settings.updated_at,
    };

    return new Response(
      JSON.stringify({
        success: true,
        settings: settingsResponse,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});


// redeploy
