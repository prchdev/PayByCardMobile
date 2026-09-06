import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function generateTicketNumber(): string {
  const num = Math.floor(Math.random() * 1000000);
  return "TKT-" + String(num).padStart(6, "0");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { userId, category, sub_category, description, ip } = body;

    if (!userId || !category || !sub_category || !description) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user exists in the users table
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (userError || !user) {
      console.error("User not found:", userId, userError);
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a unique ticket number in JS to avoid relying solely on the DB trigger
    let ticketNumber = generateTicketNumber();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabase
        .from("support_tickets")
        .select("id")
        .eq("ticket_number", ticketNumber)
        .maybeSingle();
      if (!existing) break;
      ticketNumber = generateTicketNumber();
      attempts++;
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: userId,
        ticket_number: ticketNumber,
        category,
        sub_category,
        description,
        status: "Open",
        priority: "Medium",
        created_by: userId,
        created_ip: ip || null,
      })
      .select()
      .single();

    if (ticketError) {
      console.error("Error creating ticket:", JSON.stringify(ticketError));
      return new Response(
        JSON.stringify({ error: ticketError.message || "Failed to create support ticket" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Support ticket created successfully", ticket }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Exception in create-support-ticket:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
