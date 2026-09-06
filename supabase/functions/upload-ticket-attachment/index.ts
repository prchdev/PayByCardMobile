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

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const ticketId = formData.get("ticketId") as string;
    const replyId = formData.get("replyId") as string | null;
    const userId = formData.get("userId") as string;
    const ip = formData.get("ip") as string;
    const isAdmin = formData.get("isAdmin") === "true";

    if (!file || !ticketId || !userId) {
      return new Response(
        JSON.stringify({ error: "File, ticket ID, and user ID are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const maxSize = 1048576;
    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({ error: "File size must be less than 1MB" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: "Only PNG, JPG, JPEG, and PDF files are allowed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let ticketQuery = supabase
      .from("support_tickets")
      .select("id, user_id")
      .eq("id", ticketId);

    if (!isAdmin) {
      ticketQuery = ticketQuery.eq("user_id", userId);
    }

    const { data: ticket } = await ticketQuery.maybeSingle();

    if (!ticket) {
      return new Response(
        JSON.stringify({ error: "Ticket not found or access denied" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const fileExt = file.name.split(".").pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${ticketId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("support-tickets")
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Error uploading file:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload file" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const attachmentData: any = {
      ticket_id: ticketId,
      reply_id: replyId || null,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      file_type: file.type,
      uploaded_ip: ip,
    };

    if (isAdmin) {
      attachmentData.admin_uploaded_by = userId;
    } else {
      attachmentData.uploaded_by = userId;
    }

    const { data: attachment, error: attachmentError } = await supabase
      .from("support_ticket_attachments")
      .insert(attachmentData)
      .select()
      .single();

    if (attachmentError) {
      console.error("Error saving attachment record:", attachmentError);
      await supabase.storage.from("support-tickets").remove([filePath]);
      return new Response(
        JSON.stringify({ error: "Failed to save attachment record" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "File uploaded successfully",
        attachment,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Exception in upload-ticket-attachment:", error);
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
