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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let ticketId: string | null = null;
    let userId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      ticketId = url.searchParams.get("ticketId");
      userId = url.searchParams.get("userId");
    } else if (req.method === "POST") {
      const body = await req.json();
      ticketId = body.ticketId;
      userId = body.userId;
    }

    if (!ticketId) {
      return new Response(
        JSON.stringify({ error: "Ticket ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let ticketQuery = supabase
      .from("support_tickets")
      .select("*")
      .eq("id", ticketId);

    if (userId) {
      ticketQuery = ticketQuery.eq("user_id", userId);
    }

    const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();

    if (ticketError) {
      console.error("Error fetching ticket:", ticketError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch ticket details" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!ticket) {
      return new Response(
        JSON.stringify({ error: "Ticket not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: replies, error: repliesError } = await supabase
      .from("support_ticket_replies")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    if (repliesError) {
      console.error("Error fetching replies:", repliesError);
    }

    const { data: attachments, error: attachmentsError } = await supabase
      .from("support_ticket_attachments")
      .select("*")
      .eq("ticket_id", ticketId)
      .is("reply_id", null);

    if (attachmentsError) {
      console.error("Error fetching attachments:", attachmentsError);
    }

    const repliesWithAttachments = await Promise.all(
      (replies || []).map(async (reply: any) => {
        const { data: replyAttachments } = await supabase
          .from("support_ticket_attachments")
          .select("*")
          .eq("reply_id", reply.id);

        let userName = '';
        let adminName = '';

        if (reply.is_admin_reply) {
          const { data: adminUser } = await supabase
            .from("admin_users")
            .select("name")
            .eq("id", reply.admin_replied_by)
            .maybeSingle();
          adminName = adminUser?.name || 'Admin';
        } else {
          const { data: user } = await supabase
            .from("users")
            .select("first_name, last_name")
            .eq("id", reply.replied_by)
            .maybeSingle();
          userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'User';
        }

        return {
          reply_id: reply.id,
          ticket_id: reply.ticket_id,
          user_type: reply.is_admin_reply ? 'admin' : 'user',
          message: reply.message,
          created_at: reply.created_at,
          user_name: userName,
          admin_name: adminName,
          attachment_url: null,
          attachment_filename: null,
          attachments: replyAttachments || [],
        };
      })
    );

    return new Response(
      JSON.stringify({
        ticket,
        replies: repliesWithAttachments,
        attachments: attachments || [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Exception in get-ticket-details:", error);
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
