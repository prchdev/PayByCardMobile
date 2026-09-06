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
    const {
      adminId,
      id,
      campaign_name,
      title,
      message,
      image_url,
      start_date,
      end_date,
      push_time_from,
      push_time_to,
      frequency,
    } = await req.json();

    if (!adminId) {
      return new Response(
        JSON.stringify({ error: "Admin ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    const required: Record<string, any> = {
      campaign_name, title, message, start_date, end_date,
      push_time_from, push_time_to, frequency,
    };
    for (const [key, val] of Object.entries(required)) {
      if (!val || String(val).trim() === "") {
        return new Response(
          JSON.stringify({ error: `${key} is required` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!["once", "daily"].includes(frequency)) {
      return new Response(
        JSON.stringify({ error: "frequency must be 'once' or 'daily'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate date range
    if (new Date(end_date) < new Date(start_date)) {
      return new Response(
        JSON.stringify({ error: "End date cannot be before start date" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate push time range
    if (push_time_from >= push_time_to) {
      return new Response(
        JSON.stringify({ error: "Push time 'from' must be earlier than 'to'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify admin
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id")
      .eq("id", adminId)
      .maybeSingle();

    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = {
      campaign_name: campaign_name.trim(),
      title: title.trim(),
      message: message.trim(),
      image_url: image_url || null,
      start_date,
      end_date,
      push_time_from,
      push_time_to,
      frequency,
      created_by_admin_id: adminId,
    };

    let result;
    if (id) {
      // Update existing campaign
      const { data, error } = await supabase
        .from("mobile_notification_campaigns")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      result = { data, error };
    } else {
      // Create new campaign
      const { data, error } = await supabase
        .from("mobile_notification_campaigns")
        .insert(payload)
        .select()
        .single();
      result = { data, error };
    }

    if (result.error) {
      return new Response(
        JSON.stringify({ error: result.error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ campaign: result.data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
