import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { validatePassword } from '../_shared/passwordValidation.ts';
import bcrypt from "npm:bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { adminId, email, password, fullName, role } = await req.json();

    if (!adminId || !email || !password || !fullName || !role) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return new Response(
        JSON.stringify({ error: passwordValidation.error }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate role
    if (!['super_admin', 'admin', 'moderator'].includes(role)) {
      return new Response(
        JSON.stringify({ error: "Invalid role specified" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify requesting admin is super_admin
    const { data: requestingAdmin, error: adminError } = await supabase
      .from("admin_users")
      .select("id, role, is_active")
      .eq("id", adminId)
      .maybeSingle();

    if (adminError || !requestingAdmin || !requestingAdmin.is_active || requestingAdmin.role !== 'super_admin') {
      return new Response(
        JSON.stringify({ error: "Only super admins can add new admin users" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if email already exists
    const { data: existingAdmin } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingAdmin) {
      return new Response(
        JSON.stringify({ error: "An admin with this email already exists" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Hash password
    const passwordHash = hashPassword(password);

    // Create new admin user
    const { data: newAdmin, error: insertError } = await supabase
      .from("admin_users")
      .insert({
        email,
        password_hash: passwordHash,
        full_name: fullName,
        role,
        is_active: true,
        created_by: adminId,
        updated_by: adminId,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating admin user:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create admin user" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        message: "Admin user created successfully",
        admin: {
          id: newAdmin.id,
          email: newAdmin.email,
          full_name: newAdmin.full_name,
          role: newAdmin.role,
        }
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in admin-add-user:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});


// redeploy
