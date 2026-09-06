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

    const { ticketId, userId, userType, message, ip } = await req.json();

    if (!ticketId || !userId) {
      return new Response(
        JSON.stringify({ error: "Ticket ID and User ID are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!message || message.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Message cannot be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isAdminReply = userType === "admin";

    let ticketQuery = supabase
      .from("support_tickets")
      .select("id, user_id, status")
      .eq("id", ticketId);

    if (!isAdminReply) {
      ticketQuery = ticketQuery.eq("user_id", userId);
    }

    const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();

    if (ticketError || !ticket) {
      return new Response(
        JSON.stringify({ error: "Ticket not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (ticket.status === "Closed" && !isAdminReply) {
      return new Response(
        JSON.stringify({ error: "Cannot reply to a closed ticket" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const replyData: any = {
      ticket_id: ticketId,
      is_admin_reply: isAdminReply,
      message: message.trim(),
      created_ip: ip || null,
    };

    if (isAdminReply) {
      replyData.admin_replied_by = userId;
    } else {
      replyData.replied_by = userId;
    }

    const { data: reply, error: replyError } = await supabase
      .from("support_ticket_replies")
      .insert(replyData)
      .select()
      .single();

    if (replyError) {
      console.error("Error creating reply:", JSON.stringify(replyError));
      return new Response(
        JSON.stringify({ error: replyError.message || "Failed to add reply" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Reply added successfully", reply }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Exception in add-ticket-reply:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
