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

    const { minimum_amount, maximum_amount, adminId, ip } = await req.json();

    if (!minimum_amount || !maximum_amount) {
      return new Response(
        JSON.stringify({ error: "Minimum and maximum amounts are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const minAmount = parseFloat(minimum_amount);
    const maxAmount = parseFloat(maximum_amount);

    if (minAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Minimum amount must be greater than 0" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (maxAmount <= minAmount) {
      return new Response(
        JSON.stringify({ error: "Maximum amount must be greater than minimum amount" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: existingLimits } = await supabase
      .from("payment_limits")
      .select("id")
      .maybeSingle();

    let result;
    if (existingLimits) {
      const { data, error } = await supabase
        .from("payment_limits")
        .update({
          minimum_amount: minAmount,
          maximum_amount: maxAmount,
          updated_by: adminId,
          updated_ip: ip,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingLimits.id)
        .select()
        .single();

      result = { data, error };
    } else {
      const { data, error } = await supabase
        .from("payment_limits")
        .insert({
          minimum_amount: minAmount,
          maximum_amount: maxAmount,
          created_by: adminId,
          created_ip: ip,
        })
        .select()
        .single();

      result = { data, error };
    }

    if (result.error) {
      console.error("Error saving payment limits:", result.error);
      return new Response(
        JSON.stringify({ error: "Failed to save payment limits" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Payment limits saved successfully",
        data: result.data,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Exception in save-payment-limits:", error);
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
