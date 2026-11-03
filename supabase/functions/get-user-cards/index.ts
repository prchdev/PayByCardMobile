import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { SESSION_HEADER, readSessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-pbc-session",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const session = await readSessionToken(req.headers.get(SESSION_HEADER));
    const userId = session?.kind === "user" ? session.id : null;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user is not disabled or restricted
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("is_disabled, is_restricted")
      .eq("id", userId)
      .maybeSingle();

    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (user.is_disabled || user.is_restricted) {
      return new Response(
        JSON.stringify({ error: "Your account has been disabled. Please contact support." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: cards, error } = await supabase
      .from("user_cards")
      .select(`
        id,
        card_last_four,
        card_network,
        card_type,
        bank_name,
        name_on_card,
        front_photo_url,
        back_photo_url,
        status,
        admin_rejection_reason,
        card_verification_deadline,
        created_at,
        updated_at
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return new Response(
        JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate signed URLs for any uploaded photos (private bucket)
    const enriched = await Promise.all((cards || []).map(async (card: any) => {
      let frontPhotoUrl: string | null = card.front_photo_url;
      let backPhotoUrl: string | null = card.back_photo_url;

      if (card.front_photo_url) {
        const path = extractStoragePath(card.front_photo_url, "card-photos");
        if (path) {
          const { data } = await supabase.storage
            .from("card-photos")
            .createSignedUrl(path, 3600);
          if (data?.signedUrl) frontPhotoUrl = data.signedUrl;
        }
      }

      if (card.back_photo_url) {
        const path = extractStoragePath(card.back_photo_url, "card-photos");
        if (path) {
          const { data } = await supabase.storage
            .from("card-photos")
            .createSignedUrl(path, 3600);
          if (data?.signedUrl) backPhotoUrl = data.signedUrl;
        }
      }

      return {
        ...card,
        front_photo_url: frontPhotoUrl,
        back_photo_url: backPhotoUrl,
      };
    }));

    return new Response(
      JSON.stringify({ cards: enriched }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function extractStoragePath(url: string, bucket: string): string | null {
  try {
    const marker = `/object/public/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx >= 0) return url.substring(idx + marker.length);
    // Already a path (not a full URL)
    if (!url.startsWith("http")) return url;
    return null;
  } catch {
    return null;
  }
}

// redeploy
