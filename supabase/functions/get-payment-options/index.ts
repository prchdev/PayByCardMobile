import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { admin_id } = body;

    if (admin_id) {
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

      const { data: categories, error: categoriesError } = await supabase
        .from("payment_options")
        .select("*, settlement_time")
        .order("category_name", { ascending: true });

      if (categoriesError) {
        return new Response(
          JSON.stringify({ error: categoriesError.message }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ categories }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      const { data: categories, error: categoriesError } = await supabase
        .from("payment_options")
        .select("*")
        .eq("is_enabled", true)
        .order("category_name", { ascending: true });

      if (categoriesError) {
        return new Response(
          JSON.stringify({ error: categoriesError.message }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const cardCategories = [
        'American Express/Diners Club Card',
        'American Express/Diners Club Card - Instant Settlement',
        'Visa/Master/Rupay Card',
        'Visa/Master/Rupay Card - Instant Settlement'
      ];

      const filteredCategories = (categories || []).filter((cat: any) =>
        !cardCategories.includes(cat.category_name)
      );

      const formattedCategories = filteredCategories.map((cat: any) => ({
        id: cat.id,
        category_name: cat.category_name,
        description: cat.terms_and_conditions || '',
        normal_charges: parseFloat(cat.charges_percentage || 0),
        discount_charges: parseFloat(cat.discounted_charges_percentage || 0),
        discount_applicable: cat.show_discount || false,
        gst_percentage: parseFloat(cat.gst_percentage || 18),
        status: cat.is_enabled ? 'active' : 'inactive',
      }));

      return new Response(
        JSON.stringify({ categories: formattedCategories }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// redeploy
// renamed from get-payment-categories
