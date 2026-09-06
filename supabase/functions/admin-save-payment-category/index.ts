import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const {
      adminId,
      id,
      category_name,
      receiver_kyc_required,
      new_card_payment_delay_hours,
      refund_after_hours,
      settlement_time,
      is_enabled,
      display_order,
    } = await req.json();

    if (!adminId) {
      return new Response(
        JSON.stringify({ error: "Missing adminId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!category_name || typeof category_name !== "string" || !category_name.trim()) {
      return new Response(
        JSON.stringify({ error: "Category name is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: admin } = await supabase
      .from("admin_users")
      .select("id")
      .eq("id", adminId)
      .maybeSingle();

    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const delayHours = Math.max(0, Math.floor(Number(new_card_payment_delay_hours) || 0));
    const refundHours = Math.max(0, Math.floor(Number(refund_after_hours) || 0));

    if (id) {
      const { data: updated, error: updateError } = await supabase
        .from("payment_categories")
        .update({
          category_name: category_name.trim(),
          receiver_kyc_required: !!receiver_kyc_required,
          new_card_payment_delay_hours: delayHours,
          refund_after_hours: receiver_kyc_required ? refundHours : 0,
          settlement_time: settlement_time || 'instant',
          is_enabled: !!is_enabled,
          display_order: Number(display_order) || 0,
          updated_by_admin_id: adminId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (updateError) {
        console.error("Update error:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update category" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, category: updated }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: maxOrder } = await supabase
      .from("payment_categories")
      .select("display_order")
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = (maxOrder?.display_order || 0) + 1;

    const { data: created, error: insertError } = await supabase
      .from("payment_categories")
      .insert({
        category_name: category_name.trim(),
        receiver_kyc_required: !!receiver_kyc_required,
        new_card_payment_delay_hours: delayHours,
        refund_after_hours: receiver_kyc_required ? refundHours : 0,
        settlement_time: settlement_time || 'instant',
        is_enabled: !!is_enabled,
        display_order: Number(display_order) || nextOrder,
        created_by_admin_id: adminId,
        updated_by_admin_id: adminId,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create category" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, category: created }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
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
