import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { withSignedKycUrls } from "../_shared/kycUrls.ts";
import { getKycPolicyAttachment } from "../_shared/kycPolicyAttachment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TABLE_LABELS: Record<string, string> = {
  kyc_pan_verification: "PAN Verification",
  kyc_address_proof: "Address Proof",
  kyc_business_info: "Business Documents",
};

async function sendKycEmail(
  supabaseUrl: string,
  supabaseKey: string,
  to: string,
  subject: string,
  body: string,
  attachment?: { attachment_base64: string; attachment_filename: string; attachment_content_type: string },
) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        to,
        subject,
        body,
        body_type: "html",
        use_template: true,
        ...(attachment ?? {}),
      }),
    });
  } catch (e) {
    console.error("Failed to send KYC email:", e);
  }
}

async function sendSms(
  supabaseUrl: string,
  supabaseKey: string,
  mobile: string,
  messageType: string,
  variables: Record<string, string>,
) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ mobile, message: "", message_type: messageType, variables }),
    });
  } catch (_) {}
}

function buildApprovalEmailBody(documentType: string): string {
  return `
    <p>Dear User,</p>
    <p>We are pleased to inform you that your <strong>${documentType}</strong> has been <span style="color: #16a34a; font-weight: 700;">approved</span> successfully.</p>
    <p>Your verification documents have been reviewed and found to be in order.</p>
    <p style="margin-top: 20px; padding: 16px; background-color: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
      <strong>Status:</strong> Verified<br/>
      <strong>Document:</strong> ${documentType}
    </p>
    <p>If you have any questions, please don't hesitate to contact our support team.</p>
  `;
}

function buildRejectionEmailBody(documentType: string, reason: string): string {
  return `
    <p>Dear User,</p>
    <p>We regret to inform you that your <strong>${documentType}</strong> has been <span style="color: #dc2626; font-weight: 700;">rejected</span>.</p>
    <p style="margin-top: 20px; padding: 16px; background-color: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
      <strong>Status:</strong> Rejected<br/>
      <strong>Document:</strong> ${documentType}<br/>
      <strong>Reason:</strong> ${reason || "Not specified"}
    </p>
    <p>Please review the reason above and re-submit correct documents at your earliest convenience.</p>
    <p>If you believe this was an error or need assistance, please contact our support team.</p>
  `;
}

function buildFullKycApprovedBody(): string {
  return `
    <p>Dear User,</p>
    <p>Congratulations! We are delighted to inform you that your <strong>KYC verification is now fully approved</strong>.</p>
    <p>All your submitted documents have been reviewed and verified successfully. Your account is now ready for performing transactions.</p>
    <p style="margin-top: 20px; padding: 20px; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 12px; border: 1px solid #bbf7d0; text-align: center;">
      <span style="font-size: 18px; font-weight: 700; color: #16a34a;">Account Fully Verified</span><br/>
      <span style="font-size: 14px; color: #4b5563; margin-top: 8px; display: inline-block;">You can now make and receive payments on PayByCard.</span>
    </p>
    <p>Thank you for completing the verification process. You can now enjoy all the features of our platform.</p>
    <p style="margin-top: 16px; padding: 12px; background-color: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe;">
      <strong>Attached:</strong> Please find the accepted terms and conditions document attached with this email for your reference.
    </p>
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { adminId, recordId, table, action, rejectionReason, businessCategorySurgeCharge } = await req.json();

    if (!adminId || !recordId || !table || !action) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const ALLOWED_KYC_TABLES = [
      "kyc_pan_verification",
      "kyc_address_proof",
      "kyc_business_info",
    ] as const;

    if (!ALLOWED_KYC_TABLES.includes(table)) {
      return new Response(
        JSON.stringify({ error: "Invalid table" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!["verified", "rejected"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    const updateData: Record<string, unknown> = {
      status: action,
      approved_by_admin_id: adminId,
      approval_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (action === "rejected" && rejectionReason) {
      updateData.rejection_reason = rejectionReason;
    } else if (action === "verified") {
      updateData.rejection_reason = null;
    }

    if (table === "kyc_business_info" && action === "verified" && businessCategorySurgeCharge !== undefined) {
      updateData.business_category_surge_charge = Number(businessCategorySurgeCharge) || 0;
    }

    const { data: updatedRecord, error: updateError } = await supabase
      .from(table)
      .update(updateData)
      .eq("id", recordId)
      .select()
      .single();

    if (updateError || !updatedRecord) {
      return new Response(
        JSON.stringify({ error: updateError?.message || "Update failed" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userId = updatedRecord.user_id;

    const [panRes, addressRes, businessRes, userRes] = await Promise.all([
      supabase.from("kyc_pan_verification").select("status, user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("kyc_address_proof").select("status, user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("kyc_business_info").select("status, incorporation_certificate_url, gst_certificate_url, loa_url, user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("users").select("email, mobile_number").eq("id", userId).maybeSingle(),
    ]);

    const panStatus = panRes.data?.status;
    const addressStatus = addressRes.data?.status;
    const businessStatus = businessRes.data?.status;
    const hasBusinessDocs = businessRes.data?.incorporation_certificate_url || businessRes.data?.gst_certificate_url || businessRes.data?.loa_url;
    const userEmail = userRes.data?.email;
    const userMobile = userRes.data?.mobile_number || "";

    let kycCompleted = false;
    if (panStatus === "verified" && addressStatus === "verified") {
      if (hasBusinessDocs) {
        kycCompleted = businessStatus === "verified";
      } else {
        kycCompleted = true;
      }
    }

    await supabase
      .from("users")
      .update({ kyc_completed: kycCompleted })
      .eq("id", userId);

    // Send email + SMS notifications to user in the background (non-blocking)
    const documentType = TABLE_LABELS[table] || table;

    EdgeRuntime.waitUntil((async () => {
      if (userEmail) {
        if (action === "verified") {
          await sendKycEmail(
            supabaseUrl,
            supabaseServiceKey,
            userEmail,
            `KYC ${documentType} Approved`,
            buildApprovalEmailBody(documentType)
          );
        } else if (action === "rejected") {
          await sendKycEmail(
            supabaseUrl,
            supabaseServiceKey,
            userEmail,
            `KYC ${documentType} Rejected`,
            buildRejectionEmailBody(documentType, rejectionReason || "")
          );
        }

        // If all KYC is now complete, send the account-ready email with the terms PDF attached
        if (kycCompleted) {
          let attachment;
          try { attachment = await getKycPolicyAttachment(); } catch (e) {
            console.error("Failed to load KYC policy attachment:", e);
          }
          await sendKycEmail(
            supabaseUrl,
            supabaseServiceKey,
            userEmail,
            "KYC Fully Approved - Account Ready",
            buildFullKycApprovedBody(),
            attachment
          );
        }
      }

      if (userMobile) {
        if (action === "verified") {
          await sendSms(supabaseUrl, supabaseServiceKey, userMobile, "kyc_approved", {});
        } else if (action === "rejected") {
          await sendSms(supabaseUrl, supabaseServiceKey, userMobile, "kyc_rejected", {});
        }
      }

      // ── In-app mobile notifications ──────────────────────────────────────
      const notifType = action === "verified" ? "kyc_approved" : "kyc_rejected";
      const notifTitle = action === "verified"
        ? `${documentType} Approved`
        : `${documentType} Rejected`;
      const notifBody = action === "verified"
        ? `Your ${documentType} document has been approved successfully.`
        : `Your ${documentType} document was rejected. Reason: ${rejectionReason || "Not specified"}`;

      await supabase.rpc("create_mobile_notification", {
        p_user_id: userId,
        p_type: notifType,
        p_title: notifTitle,
        p_body: notifBody,
        p_data: { document_type: documentType, action, rejection_reason: rejectionReason || null },
      });

      await supabase.rpc("send_push_notification", {
        p_user_id: userId, p_title: notifTitle, p_body: notifBody,
        p_data: { type: notifType, document_type: documentType, action },
      });

      if (kycCompleted) {
        await supabase.rpc("create_mobile_notification", {
          p_user_id: userId,
          p_type: "account_active",
          p_title: "Account Fully Verified",
          p_body: "Your KYC verification is complete. Your account is now active for all transactions.",
          p_data: { kyc_completed: true },
        });

        await supabase.rpc("send_push_notification", {
          p_user_id: userId, p_title: "Account Fully Verified",
          p_body: "Your KYC verification is complete. Your account is now active for all transactions.",
          p_data: { type: "account_active", kyc_completed: true },
        });
      }
    })());

    return new Response(
      JSON.stringify({
        success: true,
        kycCompleted,
        record: updatedRecord
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
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
