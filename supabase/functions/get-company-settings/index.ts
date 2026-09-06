import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    const { data: settings } = await supabase
      .from("master_settings")
      .select("company_name, address, cin, gst_number, pan, tan, company_logo_url, website_url, support_email, phone_number")
      .limit(1)
      .maybeSingle();

    // If logo is in a private Supabase storage bucket, generate a signed URL
    if (settings?.company_logo_url) {
      const bucketMatch = settings.company_logo_url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.*)/);
      if (bucketMatch) {
        const [, bucket, filePath] = bucketMatch;
        const { data: signedData } = await supabase.storage
          .from(bucket)
          .createSignedUrl(filePath, 3600);
        if (signedData?.signedUrl) {
          settings.company_logo_url = signedData.signedUrl;
        }
      }
    }

    return new Response(
      JSON.stringify({ settings: settings || {} }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
