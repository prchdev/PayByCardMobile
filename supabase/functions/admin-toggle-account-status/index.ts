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
    const { adminId, userId, action, reason } = await req.json();

    if (!adminId || !userId || !action) {
      return new Response(
        JSON.stringify({ error: "adminId, userId, and action are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validActions = ["disable", "enable", "restrict", "unrestrict"];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action. Must be: disable, enable, restrict, or unrestrict" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: admin } = await supabase
      .from("admin_users")
      .select("id, full_name, is_active")
      .eq("id", adminId)
      .maybeSingle();

    if (!admin || !admin.is_active) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, email, first_name, last_name, is_disabled, is_restricted")
      .eq("id", userId)
      .maybeSingle();

    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();
    let updateData: Record<string, unknown> = {};
    let actionLabel = "";

    switch (action) {
      case "disable":
        updateData = {
          is_disabled: true,
          disabled_at: now,
          disabled_by: admin.full_name || adminId,
          disabled_reason: reason || "Account disabled by compliance team",
        };
        actionLabel = "disabled";
        break;
      case "enable":
        updateData = {
          is_disabled: false,
          disabled_at: null,
          disabled_by: null,
          disabled_reason: null,
        };
        actionLabel = "enabled";
        break;
      case "restrict":
        updateData = {
          is_restricted: true,
          restricted_at: now,
          restricted_by: admin.full_name || adminId,
          restricted_reason: reason || "Account restricted by compliance team",
        };
        actionLabel = "restricted";
        break;
      case "unrestrict":
        updateData = {
          is_restricted: false,
          restricted_at: null,
          restricted_by: null,
          restricted_reason: null,
        };
        actionLabel = "unrestricted";
        break;
    }

    const { error: updateError } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", userId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update account status" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sendNotificationEmail = async () => {
      try {
        let emailSubject = "";
        let emailBody = "";

        if (action === "disable") {
          emailSubject = "PayByCard - Account Disabled";
          emailBody = `
            <div style="margin-bottom: 24px;">
              <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                Account Disabled
              </h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                Hello ${user.first_name},
              </p>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Our compliance team has disabled your account. You will not be able to login until the issue is resolved.
              </p>
            </div>
            <div style="background-color: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 24px; margin: 24px 0;">
              <p style="color: #991b1b; font-size: 14px; font-weight: 600; margin: 0 0 8px 0;">
                Reason
              </p>
              <p style="color: #7f1d1d; font-size: 14px; margin: 0;">
                ${reason || "Account disabled by compliance team for security review."}
              </p>
            </div>
            <div style="background-color: #f0f9ff; border-left: 4px solid #0284c7; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="color: #0c4a6e; font-size: 14px; line-height: 1.5; margin: 0;">
                If you believe this was done in error or need assistance, please raise a support ticket through our Help & Support section or contact our support team.
              </p>
            </div>
          `;
        } else if (action === "enable") {
          emailSubject = "PayByCard - Account Enabled";
          emailBody = `
            <div style="margin-bottom: 24px;">
              <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                Account Enabled
              </h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                Hello ${user.first_name},
              </p>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Great news! Our compliance team has re-enabled your account. You can now login and use all features as normal.
              </p>
            </div>
            <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #86efac; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #16a34a; font-size: 16px; font-weight: 600; margin: 0;">
                Your account is now active
              </p>
            </div>
          `;
        } else if (action === "restrict") {
          emailSubject = "PayByCard - Account Restricted";
          emailBody = `
            <div style="margin-bottom: 24px;">
              <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                Account Restricted
              </h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                Hello ${user.first_name},
              </p>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Our compliance team has placed restrictions on your account. While you can still login and view your dashboard, you will not be able to add beneficiaries, add bank accounts, or make payments until the restrictions are lifted.
              </p>
            </div>
            <div style="background-color: #fffbeb; border: 2px solid #fde68a; border-radius: 12px; padding: 24px; margin: 24px 0;">
              <p style="color: #92400e; font-size: 14px; font-weight: 600; margin: 0 0 8px 0;">
                Reason
              </p>
              <p style="color: #78350f; font-size: 14px; margin: 0;">
                ${reason || "Account restricted by compliance team for review."}
              </p>
            </div>
            <div style="background-color: #f0f9ff; border-left: 4px solid #0284c7; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="color: #0c4a6e; font-size: 14px; line-height: 1.5; margin: 0;">
                If you believe this was done in error or need assistance, please raise a support ticket through our Help & Support section or contact our support team.
              </p>
            </div>
          `;
        } else if (action === "unrestrict") {
          emailSubject = "PayByCard - Account Restrictions Removed";
          emailBody = `
            <div style="margin-bottom: 24px;">
              <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0;">
                Account Restrictions Removed
              </h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                Hello ${user.first_name},
              </p>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Great news! Our compliance team has removed the restrictions on your account. You can now add beneficiaries, add bank accounts, and make payments as normal.
              </p>
            </div>
            <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #86efac; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #16a34a; font-size: 16px; font-weight: 600; margin: 0;">
                All restrictions have been removed
              </p>
            </div>
          `;
        }

        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: user.email,
            subject: emailSubject,
            body: emailBody,
            body_type: "html",
            use_template: true,
          }),
        });
      } catch (emailError) {
        console.error("Error sending notification email:", emailError);
      }
    };

    EdgeRuntime.waitUntil(sendNotificationEmail());

    return new Response(
      JSON.stringify({
        success: true,
        message: `Account ${actionLabel} successfully`,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          is_disabled: action === "disable" ? true : action === "enable" ? false : user.is_disabled,
          is_restricted: action === "restrict" ? true : action === "unrestrict" ? false : user.is_restricted,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in admin-toggle-account-status:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
