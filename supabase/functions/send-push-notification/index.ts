import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PushPayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: string;
  priority?: string;
  channelId?: string;
  mutableContent?: number;
  imageUrl?: string;
  smallIcon?: string;
  largeIcon?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId, title, body, data, imageUrl } = await req.json();

    if (!userId || !title || !body) {
      return new Response(
        JSON.stringify({ error: "userId, title, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch active push tokens for this user
    const { data: tokens, error: tokenError } = await supabase
      .from("mobile_push_tokens")
      .select("push_token, platform")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (tokenError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch push tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No active push tokens for this user" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Expo push messages
    const messages: PushPayload[] = tokens.map((t: any) => {
      const msg: PushPayload = {
        to: t.push_token,
        title,
        body,
        data: data || {},
        sound: "default",
        priority: "high",
        channelId: "default",
      };

      if (t.platform === "android") {
        msg.smallIcon = "notification_icon";
        msg.largeIcon = "logo";
      }

      if (imageUrl) {
        msg.mutableContent = 1;
        msg.data = { ...msg.data, image_url: imageUrl, image: imageUrl };
        if (t.platform === "android") {
          msg.imageUrl = imageUrl;
        }
      }

      return msg;
    });

    // Send to Expo Push API
    const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const expoData = await expoRes.json();

    if (!expoRes.ok) {
      console.error("Expo Push API error:", JSON.stringify(expoData));
      return new Response(
        JSON.stringify({ error: "Failed to send push notification", details: expoData }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for individual ticket errors
    const failedTickets: string[] = [];
    if (Array.isArray(expoData)) {
      for (const ticket of expoData) {
        if (ticket.status === "error") {
          console.error("Push ticket error:", ticket.message, ticket.details);
          failedTickets.push(ticket.id || "unknown");
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: messages.length - failedTickets.length,
        total: messages.length,
        ...(failedTickets.length > 0 ? { failed: failedTickets.length } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Send push notification error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
