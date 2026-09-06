import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PaymentCategoryUpdate {
  id: string;
  category_name?: string;
  is_enabled: boolean;
  terms_and_conditions: string;
  charges_percentage: number;
  show_discount: boolean;
  discounted_charges_percentage: number;
  gst_percentage: number;
  settlement_time?: string;
  created_at?: string;
  updated_at?: string;
  updated_by_admin_id?: string;
  updated_by_ip?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { admin_id, categories } = await req.json() as { admin_id: string; categories: PaymentCategoryUpdate[] };

    if (!admin_id) {
      return new Response(
        JSON.stringify({ error: "Missing admin_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("id")
      .eq("id", admin_id)
      .maybeSingle();

    if (adminError || !admin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";

    if (!categories || !Array.isArray(categories)) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const updates = categories.map(async (category) => {
      try {
        const { error } = await supabase
          .from("payment_options")
          .update({
            is_enabled: category.is_enabled,
            terms_and_conditions: category.terms_and_conditions || '',
            charges_percentage: Number(category.charges_percentage) || 0,
            show_discount: category.show_discount,
            discounted_charges_percentage: Number(category.discounted_charges_percentage) || 0,
            gst_percentage: Number(category.gst_percentage) || 0,
            settlement_time: category.settlement_time || 'instant',
            updated_by_admin_id: admin_id,
            updated_by_ip: clientIp,
            updated_at: new Date().toISOString(),
          })
          .eq("id", category.id);

        if (error) {
          console.error('Update error for category', category.id, ':', JSON.stringify(error));
          return { categoryId: category.id, error: error.message, details: error };
        }

        return null;
      } catch (err) {
        console.error('Exception updating category', category.id, ':', err);
        return { categoryId: category.id, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const results = await Promise.all(updates);
    const errors = results.filter((error) => error !== null);

    if (errors.length > 0) {
      return new Response(
        JSON.stringify({ error: "Failed to update some categories", details: errors }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Payment categories updated successfully" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
