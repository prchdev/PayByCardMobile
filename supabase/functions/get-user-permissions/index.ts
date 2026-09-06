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
    const { adminId } = await req.json();

    if (!adminId) {
      return new Response(
        JSON.stringify({ error: "Admin ID is required" }),
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

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("id, role, is_active")
      .eq("id", adminId)
      .maybeSingle();

    if (adminError || !admin || !admin.is_active) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: permissions, error: permissionsError } = await supabase
      .from("role_permissions")
      .select(`
        can_view,
        can_edit,
        admin_pages!inner (
          page_key,
          page_name,
          page_path,
          icon,
          display_order,
          is_active
        )
      `)
      .eq("role", admin.role)
      .eq("can_view", true)
      .eq("admin_pages.is_active", true);

    if (permissionsError) {
      throw permissionsError;
    }

    const allowedPages = permissions?.map((perm: any) => ({
      page_key: perm.admin_pages.page_key,
      page_name: perm.admin_pages.page_name,
      page_path: perm.admin_pages.page_path,
      icon: perm.admin_pages.icon,
      display_order: perm.admin_pages.display_order,
      can_view: perm.can_view,
      can_edit: perm.can_edit,
    })).sort((a: any, b: any) => a.display_order - b.display_order);

    return new Response(
      JSON.stringify({
        role: admin.role,
        permissions: allowedPages || [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching user permissions:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// redeploy Mon Aug 31 18:46:41 UTC 2026
