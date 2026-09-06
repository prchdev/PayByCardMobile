import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";

    // GET ?action=list  — returns all notifications (for admin)
    // GET ?action=active — returns only active notifications (for user dashboard)
    if (req.method === "GET") {
      if (action === "active") {
        const { data, error } = await supabase
          .from("dashboard_notifications")
          .select("id, title, message, notification_type, display_order, created_at")
          .eq("is_active", true)
          .order("display_order", { ascending: true })
          .order("created_at", { ascending: false });

        if (error) throw new Error(error.message);
        return new Response(JSON.stringify({ notifications: data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // admin list — return all
      const { data, error } = await supabase
        .from("dashboard_notifications")
        .select("*")
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ notifications: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST — create a new notification
    if (req.method === "POST") {
      const { adminId, title, message, notification_type, display_order } = await req.json();

      if (!adminId) {
        return new Response(JSON.stringify({ error: "Admin ID is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: admin } = await supabase
        .from("admin_users")
        .select("id")
        .eq("id", adminId)
        .maybeSingle();

      if (!admin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!title?.trim() || !message?.trim()) {
        return new Response(JSON.stringify({ error: "Title and message are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const validType = ["information", "warning", "error"].includes(notification_type)
        ? notification_type
        : "information";

      const { data, error } = await supabase
        .from("dashboard_notifications")
        .insert({
          title: title.trim(),
          message: message.trim(),
          notification_type: validType,
          display_order: display_order ?? 0,
          created_by: adminId,
          updated_by: adminId,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ notification: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PUT — update an existing notification
    if (req.method === "PUT") {
      const { adminId, id, title, message, notification_type, is_active, display_order } = await req.json();

      if (!adminId || !id) {
        return new Response(JSON.stringify({ error: "Admin ID and notification ID are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: admin } = await supabase
        .from("admin_users")
        .select("id")
        .eq("id", adminId)
        .maybeSingle();

      if (!admin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, any> = { updated_by: adminId, updated_at: new Date().toISOString() };
      if (title !== undefined) updates.title = title.trim();
      if (message !== undefined) updates.message = message.trim();
      if (notification_type !== undefined) {
        updates.notification_type = ["information", "warning", "error"].includes(notification_type)
          ? notification_type
          : "information";
      }
      if (is_active !== undefined) updates.is_active = is_active;
      if (display_order !== undefined) updates.display_order = display_order;

      const { data, error } = await supabase
        .from("dashboard_notifications")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ notification: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE — delete a notification
    if (req.method === "DELETE") {
      const { adminId, id } = await req.json();

      if (!adminId || !id) {
        return new Response(JSON.stringify({ error: "Admin ID and notification ID are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: admin } = await supabase
        .from("admin_users")
        .select("id")
        .eq("id", adminId)
        .maybeSingle();

      if (!admin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabase
        .from("dashboard_notifications")
        .delete()
        .eq("id", id);

      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
