import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { SESSION_HEADER, readSessionToken } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-pbc-session",
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_PHOTO_SIDES = new Set(["front", "back"]);

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

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const cardId = formData.get("cardId") as string;
    const photoSide = formData.get("photoSide") as string;

    if (!file || !cardId || !photoSide) {
      return new Response(
        JSON.stringify({ error: "file, cardId, and photoSide are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!ALLOWED_PHOTO_SIDES.has(photoSide)) {
      return new Response(
        JSON.stringify({ error: "photoSide must be 'front' or 'back'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: "File exceeds 5 MB limit" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const detectedType = file.type || "";
    if (!ALLOWED_MIME_TYPES.has(detectedType)) {
      return new Response(
        JSON.stringify({ error: "Only JPEG, PNG, and WebP images are accepted" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the card belongs to the user
    const { data: card, error: cardErr } = await supabase
      .from("user_cards")
      .select("id, status, user_id")
      .eq("id", cardId)
      .eq("user_id", userId)
      .maybeSingle();

    if (cardErr || !card) {
      return new Response(
        JSON.stringify({ error: "Card not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only allow uploading photos when status is not_submitted or rejected
    if (card.status !== "not_submitted" && card.status !== "rejected") {
      return new Response(
        JSON.stringify({ error: "Photos cannot be uploaded for this card at this time" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${cardId}_${photoSide}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("card-photos")
      .upload(path, arrayBuffer, {
        contentType: detectedType,
        upsert: true,
      });

    if (uploadError) {
      return new Response(
        JSON.stringify({ error: "Failed to upload photo" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const canonicalUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/card-photos/${path}`;

    const updateField = photoSide === "front" ? "front_photo_url" : "back_photo_url";

    // Update the card record with the photo URL
    const updateData: Record<string, any> = { [updateField]: canonicalUrl, updated_at: new Date().toISOString() };

    // If both photos are now uploaded, set status to pending_verification
    const { data: currentCard } = await supabase
      .from("user_cards")
      .select("front_photo_url, back_photo_url")
      .eq("id", cardId)
      .maybeSingle();

    const otherField = photoSide === "front" ? "back_photo_url" : "front_photo_url";
    if (currentCard && currentCard[otherField]) {
      updateData.status = "pending_verification";
      updateData.admin_rejection_reason = null;
    }

    const { error: updateError } = await supabase
      .from("user_cards")
      .update(updateData)
      .eq("id", cardId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update card record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a signed URL for immediate use
    const { data: urlData } = await supabase.storage
      .from("card-photos")
      .createSignedUrl(path, 3600);

    return new Response(
      JSON.stringify({
        url: canonicalUrl,
        signedUrl: urlData.signedUrl,
        photoSide,
        status: updateData.status || card.status,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
