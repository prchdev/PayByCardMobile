import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { adminId, targetUserId, isActive } = await req.json();

    if (!adminId || !targetUserId || typeof isActive !== 'boolean') {
      return new Response(
        JSON.stringify({ error: "Admin ID, target user ID, and active status are required" }),
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
        JSON.stringify({ error: "Only super admins can modify admin user status" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Prevent admin from disabling themselves
    if (adminId === targetUserId && !isActive) {
      return new Response(
        JSON.stringify({ error: "You cannot disable your own account" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update admin user status
    const { data: updatedAdmin, error: updateError } = await supabase
      .from("admin_users")
      .update({
        is_active: isActive,
        updated_by: adminId,
      })
      .eq("id", targetUserId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating admin user status:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update admin user status" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        message: `Admin user ${isActive ? 'enabled' : 'disabled'} successfully`,
        admin: {
          id: updatedAdmin.id,
          email: updatedAdmin.email,
          full_name: updatedAdmin.full_name,
          is_active: updatedAdmin.is_active,
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in admin-toggle-user-status:", error);
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
