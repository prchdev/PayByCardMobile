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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { adminId, action } = body;

    // ── Verify admin ────────────────────────────────────────────────────
    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("id, role, is_active")
      .eq("id", adminId)
      .maybeSingle();

    if (adminError || !admin || !admin.is_active) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── List all campaigns ──────────────────────────────────────────────
    if (action === "list") {
      const { data: campaigns, error } = await supabase
        .from("mobile_notification_campaigns")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get log counts per campaign
      const { data: logs } = await supabase
        .from("mobile_notification_logs")
        .select("campaign_id, action");

      const stats: Record<string, { shown: number; clicked: number; dismissed: number }> = {};
      (logs || []).forEach((l: any) => {
        if (!stats[l.campaign_id]) stats[l.campaign_id] = { shown: 0, clicked: 0, dismissed: 0 };
        if (l.action === "shown") stats[l.campaign_id].shown++;
        if (l.action === "clicked") stats[l.campaign_id].clicked++;
        if (l.action === "dismissed") stats[l.campaign_id].dismissed++;
      });

      const campaignsWithStats = (campaigns || []).map((c: any) => ({
        ...c,
        stats: stats[c.id] || { shown: 0, clicked: 0, dismissed: 0 },
      }));

      return new Response(
        JSON.stringify({ campaigns: campaignsWithStats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Create campaign ─────────────────────────────────────────────────
    if (action === "create") {
      const { title, message, image_url, action_url, action_label, target_audience, status, start_date, end_date, push_time_from, push_time_to, frequency, notification_format, action_type, push_enabled } = body;

      if (!title || !message) {
        return new Response(
          JSON.stringify({ error: "Title and message are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase
        .from("mobile_notification_campaigns")
        .insert({
          title,
          message,
          image_url: image_url || null,
          action_url: action_url || null,
          action_label: action_label || null,
          target_audience: target_audience || "all",
          status: status || "draft",
          start_date: start_date || null,
          end_date: end_date || null,
          push_time_from: push_time_from || null,
          push_time_to: push_time_to || null,
          frequency: frequency || "once",
          notification_format: notification_format || "text",
          action_type: action_type || null,
          push_enabled: push_enabled || false,
          created_by_admin_id: adminId,
        })
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, campaign: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Update campaign ─────────────────────────────────────────────────
    if (action === "update") {
      const { campaignId, ...updates } = body;
      if (!campaignId) {
        return new Response(
          JSON.stringify({ error: "Campaign ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const allowedFields = ["title", "message", "image_url", "action_url", "action_label", "target_audience", "status", "start_date", "end_date", "push_time_from", "push_time_to", "frequency", "notification_format", "action_type", "push_enabled"];
      const cleanUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const f of allowedFields) {
        if (f in updates) cleanUpdates[f] = updates[f];
      }

      const { data, error } = await supabase
        .from("mobile_notification_campaigns")
        .update(cleanUpdates)
        .eq("id", campaignId)
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, campaign: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Delete campaign ──────────────────────────────────────────────────
    if (action === "delete") {
      const { campaignId } = body;
      if (!campaignId) {
        return new Response(
          JSON.stringify({ error: "Campaign ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase
        .from("mobile_notification_campaigns")
        .delete()
        .eq("id", campaignId);

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Push campaign to users (create notifications for all matching users) ──
    if (action === "push") {
      const { campaignId } = body;
      if (!campaignId) {
        return new Response(
          JSON.stringify({ error: "Campaign ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: campaign } = await supabase
        .from("mobile_notification_campaigns")
        .select("*")
        .eq("id", campaignId)
        .maybeSingle();

      if (!campaign) {
        return new Response(
          JSON.stringify({ error: "Campaign not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get target users
      let userQuery = supabase.from("users").select("id");
      if (campaign.target_audience === "verified") {
        userQuery = userQuery.eq("kyc_completed", true);
      } else if (campaign.target_audience === "unverified") {
        userQuery = userQuery.eq("kyc_completed", false);
      }

      const { data: users } = await userQuery;
      const targetUsers = users || [];

      let pushedCount = 0;
      for (const u of targetUsers) {
        // Check if already pushed to this user
        const { data: existingLog } = await supabase
          .from("mobile_notification_logs")
          .select("id")
          .eq("campaign_id", campaignId)
          .eq("user_id", u.id)
          .eq("action", "pushed")
          .maybeSingle();

        if (existingLog) continue;

        await supabase.rpc("create_mobile_notification", {
          p_user_id: u.id,
          p_type: "campaign",
          p_title: campaign.title,
          p_body: campaign.message,
          p_data: {
            campaign_id: campaignId,
            action_url: campaign.action_url,
            action_label: campaign.action_label,
          },
          p_campaign_id: campaignId,
          p_image_url: campaign.image_url || null,
          p_notification_format: campaign.notification_format || 'text',
        });

        // Send push notification if enabled
        if (campaign.push_enabled) {
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                userId: u.id,
                title: campaign.title,
                body: campaign.message,
                data: { campaign_id: campaignId, action_url: campaign.action_url, type: "campaign" },
                imageUrl: campaign.image_url || null,
              }),
            });
          } catch (pushErr) {
            console.error("Push failed for user", u.id, pushErr);
          }
        }

        await supabase.from("mobile_notification_logs").insert({
          campaign_id: campaignId,
          user_id: u.id,
          action: "pushed",
        });

        pushedCount++;
      }

      // Update campaign status to active if it was draft
      if (campaign.status === "draft") {
        await supabase
          .from("mobile_notification_campaigns")
          .update({ status: "active", updated_at: new Date().toISOString() })
          .eq("id", campaignId);
      }

      return new Response(
        JSON.stringify({ success: true, pushed_count: pushedCount, total_users: targetUsers.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Admin manage campaign error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
