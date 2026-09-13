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

    const { userId, action, notificationId, campaignId, campaignAction } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Mark notification as read ──────────────────────────────────────
    if (action === "mark_read" && notificationId) {
      const { error } = await supabase
        .from("mobile_notifications")
        .update({ is_read: true })
        .eq("id", notificationId)
        .eq("user_id", userId);
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

    // ── Mark all as read ────────────────────────────────────────────────
    if (action === "mark_all_read") {
      const { error } = await supabase
        .from("mobile_notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);
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

    // ── Delete a notification ──────────────────────────────────────────
    if (action === "delete" && notificationId) {
      const { error } = await supabase
        .from("mobile_notifications")
        .delete()
        .eq("id", notificationId)
        .eq("user_id", userId);
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

    // ── Log campaign interaction (shown/clicked/dismissed) ──────────────
    if (action === "log_campaign" && campaignId && campaignAction) {
      await supabase.from("mobile_notification_logs").insert({
        campaign_id: campaignId,
        user_id: userId,
        action: campaignAction,
      });
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Fetch user notifications ───────────────────────────────────────
    const { data: notifications, error: notifError } = await supabase
      .from("mobile_notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (notifError) {
      return new Response(
        JSON.stringify({ error: notifError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Fetch active campaigns that user hasn't dismissed yet ───────────
    // Only show campaigns created on or after the user's registration date
    const { data: userRow } = await supabase
      .from("users")
      .select("created_at")
      .eq("id", userId)
      .maybeSingle();

    const userCreatedAt = userRow?.created_at as string | undefined;

    const today = new Date().toISOString().split('T')[0];
    let campaignQuery = supabase
      .from("mobile_notification_campaigns")
      .select("*")
      .eq("status", "active")
      .or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.is.null,end_date.gte.${today}`);

    if (userCreatedAt) {
      campaignQuery = campaignQuery.gte("created_at", userCreatedAt);
    }

    const { data: campaigns } = await campaignQuery.order("created_at", { ascending: false });

    // Filter out campaigns the user already dismissed or clicked
    let activeCampaigns: any[] = [];
    if (campaigns && campaigns.length > 0) {
      const campaignIds = campaigns.map((c: any) => c.id);
      const { data: existingLogs } = await supabase
        .from("mobile_notification_logs")
        .select("campaign_id, action")
        .eq("user_id", userId)
        .in("campaign_id", campaignIds);

      const dismissedOrClicked = new Set(
        (existingLogs || [])
          .filter((l: any) => l.action === "dismissed" || l.action === "clicked")
          .map((l: any) => l.campaign_id)
      );

      activeCampaigns = campaigns.filter((c: any) => !dismissedOrClicked.has(c.id));

      // Auto-create notification rows for campaigns the user hasn't seen yet
      for (const c of activeCampaigns) {
        const alreadyNotified = (existingLogs || []).some(
          (l: any) => l.campaign_id === c.id && l.action === "shown"
        );
        if (!alreadyNotified) {
          await supabase.rpc("create_mobile_notification", {
            p_user_id: userId,
            p_type: "campaign",
            p_title: c.title,
            p_body: c.message || c.body,
            p_data: { campaign_id: c.id, action_url: c.action_url, action_label: c.action_label },
            p_campaign_id: c.id,
            p_image_url: c.image_url || null,
            p_notification_format: c.notification_format || 'text',
          });
          await supabase.from("mobile_notification_logs").insert({
            campaign_id: c.id,
            user_id: userId,
            action: "shown",
          });
        }
      }

      // Re-fetch notifications to include newly created campaign notifications
      const { data: updatedNotifs } = await supabase
        .from("mobile_notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      const unreadCount = (updatedNotifs || []).filter((n: any) => !n.is_read).length;

      return new Response(
        JSON.stringify({
          notifications: updatedNotifs || [],
          unread_count: unreadCount,
          active_campaigns: activeCampaigns,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const unreadCount = (notifications || []).filter((n: any) => !n.is_read).length;

    return new Response(
      JSON.stringify({
        notifications: notifications || [],
        unread_count: unreadCount,
        active_campaigns: activeCampaigns,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Get user notifications error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
