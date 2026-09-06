import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { validatePassword } from '../_shared/passwordValidation.ts';
import bcrypt from "npm:bcryptjs@2.4.3";

function isLegacySha256(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

async function verifyLegacySha256(password: string, hash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const computed = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return computed === hash;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface RequestBody {
  admin_id: string;
  current_password: string;
  new_password: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
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

    const { admin_id, current_password, new_password }: RequestBody = await req.json();

    if (!admin_id || !current_password || !new_password) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const passwordValidation = validatePassword(new_password);
    if (!passwordValidation.isValid) {
      return new Response(
        JSON.stringify({ error: passwordValidation.error }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: admin, error: adminError } = await supabase
      .from('admin_users')
      .select('id, password_hash')
      .eq('id', admin_id)
      .maybeSingle();

    if (adminError || !admin) {
      return new Response(
        JSON.stringify({ error: 'Admin not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // F18: Verify current password with bcrypt or legacy SHA-256, then store new as bcrypt.
    const storedHash = admin.password_hash;
    const currentPasswordValid = isLegacySha256(storedHash)
      ? await verifyLegacySha256(current_password, storedHash)
      : bcrypt.compareSync(current_password, storedHash);

    if (!currentPasswordValid) {
      return new Response(
        JSON.stringify({ error: 'Current password is incorrect' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const newPasswordHash = bcrypt.hashSync(new_password, 10);

    const { error: updateError } = await supabase
      .from('admin_users')
      .update({
        password_hash: newPasswordHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', admin_id);

    if (updateError) {
      console.error('Error updating password:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update password' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Password updated successfully' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in admin-change-password function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});


// redeploy
