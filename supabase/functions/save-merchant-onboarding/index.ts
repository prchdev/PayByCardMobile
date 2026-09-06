import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { token, email, mobile, pan_number, pan_photo_url } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!pan_number || !pan_photo_url) {
      return new Response(
        JSON.stringify({ error: "PAN number and PAN photo are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const panNorm = String(pan_number).trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNorm)) {
      return new Response(
        JSON.stringify({ error: "Invalid PAN number format (e.g. ABCDE1234F)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (String(pan_photo_url).length > 2000) {
      return new Response(
        JSON.stringify({ error: "PAN photo URL too long" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRegex = /^[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,255}\.[a-zA-Z]{2,}$/;
    if (email && !emailRegex.test(String(email).trim())) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (mobile && !/^\d{10}$/.test(String(mobile).replace(/\D/g, "").slice(-10))) {
      return new Response(
        JSON.stringify({ error: "Mobile number must be 10 digits" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: record, error: fetchError } = await supabase
      .from("merchant_onboarding")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (fetchError || !record) {
      return new Response(
        JSON.stringify({ error: "Invalid link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (record.status !== "pending" && record.status !== "rejected") {
      return new Response(
        JSON.stringify({ error: "This form has already been submitted or expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const expiresAt = new Date(record.expires_at);

    if (now > expiresAt) {
      return new Response(
        JSON.stringify({ error: "This link has expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Self-transfer check: merchant must not be the same person as the sender ──
    // The sender is the logged-in user who initiated the payment. The merchant is
    // the beneficiary completing KYC. Self-funds transfer is not allowed.
    const normalize = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // The merchant's name comes from the onboarding record (pre-filled by admin/sender)
    const merchantFullName = normalize(record.full_name || '');
    const recordSenderName = normalize(record.sender_name || '');

    // Also look up the sender's user profile via payment_id → payments.user_id → users
    let senderUserId: string | null = null;
    let senderUser: { full_name: string | null; first_name: string | null; last_name: string | null; email: string | null; mobile_number: string | null } | null = null;
    if (record.payment_id) {
      const { data: payment } = await supabase
        .from('payments')
        .select('user_id')
        .eq('id', record.payment_id)
        .maybeSingle();

      if (payment?.user_id) {
        senderUserId = payment.user_id;
        const { data: sender } = await supabase
          .from('users')
          .select('full_name, first_name, last_name, email, mobile_number')
          .eq('id', payment.user_id)
          .maybeSingle();
        senderUser = sender;
      }
    }

    // Fetch sender's PAN from KYC table
    let senderPan: string | null = null;
    if (senderUserId) {
      const { data: senderKyc } = await supabase
        .from('kyc_pan_verification')
        .select('pan_number')
        .eq('user_id', senderUserId)
        .maybeSingle();
      senderPan = senderKyc?.pan_number || null;
    }

    // Build canonical sender name from user profile or onboarding record
    const senderFullName = senderUser
      ? normalize(senderUser.full_name || `${senderUser.first_name || ''} ${senderUser.last_name || ''}`.trim())
      : recordSenderName;

    const senderEmail = senderUser ? normalize(senderUser.email || '') : '';
    const senderMobile = senderUser ? (senderUser.mobile_number || '').replace(/\D/g, '').slice(-10) : '';
    const senderPanNorm = senderPan ? senderPan.trim().toUpperCase() : '';

    const merchantEmail = normalize(email || record.email || '');
    const merchantMobile = (mobile || record.mobile || '').replace(/\D/g, '').slice(-10);
    const merchantPan = panNorm;

    const nameMatch = merchantFullName && senderFullName && merchantFullName === senderFullName;
    const emailMatch = senderEmail && merchantEmail && senderEmail === merchantEmail;
    const mobileMatch = senderMobile && merchantMobile && senderMobile === merchantMobile;
    const panMatch = senderPanNorm && merchantPan && senderPanNorm === merchantPan;

    if (nameMatch || emailMatch || mobileMatch || panMatch) {
      const matchedField = panMatch ? 'PAN number'
        : nameMatch ? 'name'
        : emailMatch ? 'email address'
        : 'mobile number';
      return new Response(
        JSON.stringify({
          error: `Self-funds transfer is not allowed. The merchant ${matchedField} matches the sender's details. You cannot send money to yourself.`,
          self_transfer: true,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark merchant onboarding as 'submitted' (awaiting admin review)
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      req.headers.get("cf-connecting-ip") ||
      null;

    const { error: updateError } = await supabase
      .from("merchant_onboarding")
      .update({
        email: email || record.email,
        mobile: mobile || record.mobile,
        pan_number,
        pan_photo_url,
        kyc_method: "manual",
        status: "submitted",
        ip_address: ipAddress,
        kyc_completed_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", record.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to save KYC data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send SMS notification to merchant on submission
    const notifyMobile = mobile || record.mobile;
    if (notifyMobile) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            mobile: notifyMobile,
            message: "",
            message_type: "merchant_onboarding",
            variables: { var1: token },
          }),
        });
      } catch (_) {}
    }

    // Update associated payment status to 'merchant_kyc_review'
    if (record.payment_id) {
      await supabase
        .from("payments")
        .update({
          status: "merchant_kyc_review",
          updated_at: now.toISOString(),
        })
        .eq("id", record.payment_id)
        .eq("status", "kyc_pending");

      // Log the status transition
      await supabase.from("payment_logs").insert({
        payment_id: record.payment_id,
        status: "merchant_kyc_review",
        message: "Merchant KYC submitted. Awaiting admin review.",
        metadata: { merchant_onboarding_id: record.id },
      });
    }

    return new Response(
      JSON.stringify({ success: true, message: "KYC submitted successfully. Our team will review your details shortly." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
