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
    const { adminId, targetUserId, email, password, fullName, role, isActive } = await req.json();

    if (!adminId || !targetUserId) {
      return new Response(
        JSON.stringify({ error: "Admin ID and target user ID are required" }),
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
        JSON.stringify({ error: "Only super admins can update admin users" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get target user
    const { data: targetUser, error: targetError } = await supabase
      .from("admin_users")
      .select("id, email")
      .eq("id", targetUserId)
      .maybeSingle();

    if (targetError || !targetUser) {
      return new Response(
        JSON.stringify({ error: "Target admin user not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build update object
    const updateData: any = {
      updated_by: adminId,
    };

    if (email && email !== targetUser.email) {
      // Check if new email already exists
      const { data: existingAdmin } = await supabase
        .from("admin_users")
        .select("id")
        .eq("email", email)
        .neq("id", targetUserId)
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
      updateData.email = email;
    }

    if (password) {
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
      updateData.password_hash = hashPassword(password);
    }

    if (fullName) {
      updateData.full_name = fullName;
    }

    if (role && ['super_admin', 'admin', 'moderator'].includes(role)) {
      updateData.role = role;
    }

    if (typeof isActive === 'boolean') {
      updateData.is_active = isActive;
    }

    // Update admin user
    const { data: updatedAdmin, error: updateError } = await supabase
      .from("admin_users")
      .update(updateData)
      .eq("id", targetUserId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating admin user:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update admin user" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        message: "Admin user updated successfully",
        admin: {
          id: updatedAdmin.id,
          email: updatedAdmin.email,
          full_name: updatedAdmin.full_name,
          role: updatedAdmin.role,
          is_active: updatedAdmin.is_active,
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in admin-update-user:", error);
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
