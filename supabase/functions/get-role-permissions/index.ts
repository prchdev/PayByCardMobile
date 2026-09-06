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

    const { data: requestingAdmin, error: adminError } = await supabase
      .from("admin_users")
      .select("id, role, is_active")
      .eq("id", adminId)
      .maybeSingle();

    if (adminError || !requestingAdmin || !requestingAdmin.is_active) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: pages, error: pagesError } = await supabase
      .from("admin_pages")
      .select("*")
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (pagesError) {
      throw pagesError;
    }

    const { data: permissions, error: permissionsError } = await supabase
      .from("role_permissions")
      .select("*");

    if (permissionsError) {
      throw permissionsError;
    }

    const permissionsMap: Record<string, any[]> = {
      super_admin: [],
      admin: [],
      moderator: [],
    };

    permissions?.forEach((perm) => {
      const page = pages?.find((p) => p.id === perm.page_id);
      if (page) {
        permissionsMap[perm.role].push({
          ...page,
          can_view: perm.can_view,
          can_edit: perm.can_edit,
          permission_id: perm.id,
        });
      }
    });

    return new Response(
      JSON.stringify({
        pages,
        permissions: permissionsMap,
        roles: ["super_admin", "admin", "moderator"],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching role permissions:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});


// redeploy
