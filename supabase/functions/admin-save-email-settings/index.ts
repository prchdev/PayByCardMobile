import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface EmailSettings {
  id?: string;
  from_email: string;
  from_display_name: string;
  smtp_username: string;
  smtp_password: string;
  smtp_server: string;
  smtp_port: number;
  use_tls: boolean;
  use_ssl: boolean;
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

    const { admin_id, settings } = await req.json() as {
      admin_id: string;
      settings: EmailSettings;
    };

    if (!admin_id || !settings) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                     req.headers.get('x-real-ip') ||
                     'unknown';

    const { data: admin, error: adminError } = await supabase
      .from('admin_users')
      .select('id, full_name')
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

    const { data: existingSettings, error: fetchError } = await supabase
      .from('email_settings')
      .select('id')
      .eq('is_active', true)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching existing settings:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch existing settings' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let result;

    if (existingSettings) {
      const { data, error } = await supabase
        .from('email_settings')
        .update({
          from_email: settings.from_email,
          from_display_name: settings.from_display_name,
          smtp_username: settings.smtp_username,
          smtp_password: settings.smtp_password,
          smtp_server: settings.smtp_server,
          smtp_port: settings.smtp_port,
          use_tls: settings.use_tls,
          use_ssl: settings.use_ssl || false,
          updated_by_admin_id: admin_id,
          updated_by_admin_name: admin.full_name,
          updated_by_ip_address: clientIp,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSettings.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating email settings:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to update email settings' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      result = data;
    } else {
      const { data, error } = await supabase
        .from('email_settings')
        .insert({
          from_email: settings.from_email,
          from_display_name: settings.from_display_name,
          smtp_username: settings.smtp_username,
          smtp_password: settings.smtp_password,
          smtp_server: settings.smtp_server,
          smtp_port: settings.smtp_port,
          use_tls: settings.use_tls,
          use_ssl: settings.use_ssl || false,
          is_active: true,
          updated_by_admin_id: admin_id,
          updated_by_admin_name: admin.full_name,
          updated_by_ip_address: clientIp,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating email settings:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to create email settings' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      result = data;
    }

    const settingsResponse = {
      id: result.id,
      from_email: result.from_email,
      from_display_name: result.from_display_name,
      smtp_username: result.smtp_username,
      smtp_password: result.smtp_password,
      smtp_server: result.smtp_server,
      smtp_port: result.smtp_port,
      use_tls: result.use_tls,
      use_ssl: result.use_ssl || false,
      updated_by_admin_id: result.updated_by_admin_id,
      updated_by_admin_name: result.updated_by_admin_name,
      updated_by_ip_address: result.updated_by_ip_address,
      updated_at: result.updated_at,
    };

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Email settings saved successfully',
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
