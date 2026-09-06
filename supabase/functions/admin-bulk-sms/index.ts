import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CRON_INTERVAL_MINUTES = 5;
const MINUTES_PER_HOUR = 60;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { admin_id, action } = body;

    // Cron entry point — no admin auth required
    if (action === "process_scheduled") {
      const now = new Date().toISOString();

      // Pick up scheduled campaigns whose time has arrived
      const { data: dueCampaigns } = await supabase
        .from("bulk_sms_campaigns")
        .select("*")
        .eq("status", "scheduled")
        .not("scheduled_at", "is", null)
        .lte("scheduled_at", now);

      for (const c of (dueCampaigns || [])) {
        await supabase.from("bulk_sms_campaigns")
          .update({ status: "sending", started_at: new Date().toISOString() })
          .eq("id", c.id);
      }

      // Pick up all campaigns in "sending" status (includes just-activated "Send Now" + due scheduled)
      const { data: sendingCampaigns } = await supabase
        .from("bulk_sms_campaigns")
        .select("*")
        .eq("status", "sending");

      let totalProcessed = 0;
      for (const c of (sendingCampaigns || [])) {
        const processed = await processSmsCampaignBatch(supabaseUrl, supabaseKey, supabase, c);
        totalProcessed += processed;
      }

      return new Response(JSON.stringify({ processed: totalProcessed }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!admin_id) {
      return new Response(JSON.stringify({ error: "Admin ID is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users").select("id, email, is_active").eq("id", admin_id).maybeSingle();
    if (adminError || !admin || !admin.is_active) {
      return new Response(JSON.stringify({ error: "Unauthorized access" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list" || !action) {
      const { data: campaigns, error } = await supabase
        .from("bulk_sms_campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ campaigns }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "preview_recipients") {
      const { recipient_filter, filter_days } = body;
      const recipients = await fetchRecipients(supabase, recipient_filter, filter_days || 0);
      return new Response(JSON.stringify({ count: recipients.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_recipients") {
      const { campaign_id, page, per_page } = body;
      const pageNum = page || 1;
      const perPage = per_page || 50;
      const offset = (pageNum - 1) * perPage;
      const { data: recipients, error, count } = await supabase
        .from("bulk_campaign_recipients")
        .select("id, email_or_phone, status, sent_at, error_message", { count: "exact" })
        .eq("campaign_type", "sms")
        .eq("campaign_id", campaign_id)
        .order("created_at", { ascending: true })
        .range(offset, offset + perPage - 1);
      if (error) {
        return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ recipients: recipients || [], total: count || 0, page: pageNum, per_page: perPage }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create" || action === "update") {
      const { campaign_name, message, recipient_filter, filter_days, hourly_rate, scheduled_at, status, campaign_id, dlt_template_id } = body;

      if (!campaign_name || !message) {
        return new Response(JSON.stringify({ error: "Campaign name and message are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recipients = await fetchRecipients(supabase, recipient_filter || "all_users", filter_days || 0);

      if (action === "create") {
        const { data, error } = await supabase
          .from("bulk_sms_campaigns")
          .insert({
            campaign_name, message: message || "",
            recipient_filter: recipient_filter || "all_users",
            filter_days: filter_days || 0,
            hourly_rate: hourly_rate || 100,
            status: status || "draft",
            scheduled_at: scheduled_at || null,
            total_recipients: recipients.length,
            dlt_template_id: dlt_template_id || "",
            created_by_admin_id: admin_id,
            ...(status === "sending" ? { started_at: new Date().toISOString() } : {}),
          })
          .select().single();
        if (error) {
          return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await insertRecipientRecords(supabase, "sms", data.id, recipients);

        return new Response(JSON.stringify({ campaign: data }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        const { data, error } = await supabase
          .from("bulk_sms_campaigns")
          .update({
            campaign_name, message: message || "",
            recipient_filter: recipient_filter || "all_users",
            filter_days: filter_days || 0,
            hourly_rate: hourly_rate || 100,
            status: status || "draft",
            scheduled_at: scheduled_at || null,
            total_recipients: recipients.length,
            dlt_template_id: dlt_template_id || "",
            updated_at: new Date().toISOString(),
            ...(status === "sending" ? { started_at: new Date().toISOString() } : {}),
          })
          .eq("id", campaign_id)
          .select().single();
        if (error) {
          return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ campaign: data }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "cancel") {
      const { campaign_id } = body;
      const { error } = await supabase
        .from("bulk_sms_campaigns")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", campaign_id);
      if (error) {
        return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { campaign_id } = body;
      await supabase.from("bulk_campaign_recipients").delete().eq("campaign_id", campaign_id);
      const { error } = await supabase.from("bulk_sms_campaigns").delete().eq("id", campaign_id);
      if (error) {
        return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

interface Recipient {
  id: string;
  mobile_number: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
}

async function fetchRecipients(supabase: any, filter: string, filterDays: number): Promise<Recipient[]> {
  let query = supabase.from("users").select("id, mobile_number, first_name, middle_name, last_name, kyc_completed, created_at");

  if (filter === "all_users") {
    // No additional filter
  } else if (filter === "kyced_users") {
    query = query.eq("kyc_completed", true);
  } else if (filter === "non_kyced_users") {
    query = query.eq("kyc_completed", false);
  } else if (filter === "kyced_no_payment") {
    const { data: kycedUsers } = await supabase.from("users").select("id, mobile_number, first_name, middle_name, last_name").eq("kyc_completed", true);
    if (!kycedUsers) return [];
    const userIds = kycedUsers.map((u: any) => u.id);
    const { data: payingUsers } = await supabase.from("payments").select("user_id").in("user_id", userIds);
    const payingIds = new Set((payingUsers || []).map((p: any) => p.user_id));
    return kycedUsers.filter((u: any) => !payingIds.has(u.id));
  } else if (filter === "kyced_no_payment_x_days") {
    const daysAgo = new Date(Date.now() - filterDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: kycedUsers } = await supabase.from("users").select("id, mobile_number, first_name, middle_name, last_name").eq("kyc_completed", true);
    if (!kycedUsers) return [];
    const userIds = kycedUsers.map((u: any) => u.id);
    const { data: recentPayments } = await supabase.from("payments").select("user_id").in("user_id", userIds).gte("created_at", daysAgo);
    const recentPayingIds = new Set((recentPayments || []).map((p: any) => p.user_id));
    return kycedUsers.filter((u: any) => !recentPayingIds.has(u.id));
  }

  const { data, error } = await query.eq("is_disabled", false).not("mobile_number", "is", null);
  if (error || !data) return [];
  return data;
}

async function insertRecipientRecords(supabase: any, campaignType: string, campaignId: string, recipients: Recipient[]) {
  const rows = recipients.map((r) => ({
    campaign_type: campaignType,
    campaign_id: campaignId,
    user_id: r.id,
    email_or_phone: r.mobile_number,
    status: "pending",
  }));
  if (rows.length === 0) return;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    await supabase.from("bulk_campaign_recipients").insert(rows.slice(i, i + batchSize));
  }
}

/**
 * Process one batch of an SMS campaign, respecting the hourly_rate limit.
 * Sends at most floor(hourly_rate * CRON_INTERVAL_MINUTES / 60) SMS per cycle.
 * Returns the number of SMS attempted this cycle.
 */
async function processSmsCampaignBatch(
  supabaseUrl: string,
  supabaseKey: string,
  supabase: any,
  campaign: any,
): Promise<number> {
  const hourlyRate = campaign.hourly_rate || 100;
  const perCycle = Math.max(1, Math.floor(hourlyRate * CRON_INTERVAL_MINUTES / MINUTES_PER_HOUR));

  const { data: batch, error } = await supabase
    .from("bulk_campaign_recipients")
    .select("id, user_id, email_or_phone")
    .eq("campaign_type", "sms")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(perCycle);

  if (error || !batch || batch.length === 0) {
    await supabase.from("bulk_sms_campaigns")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        last_batch_sent_at: new Date().toISOString(),
      })
      .eq("id", campaign.id);
    return 0;
  }

  let sentThisCycle = 0;
  let failedThisCycle = 0;

  for (const recipient of batch) {
    try {
      const { data: user } = await supabase
        .from("users")
        .select("first_name, middle_name, last_name")
        .eq("id", recipient.user_id)
        .maybeSingle();

      const firstName = user?.first_name || "";
      const middleName = user?.middle_name || "";
      const lastName = user?.last_name || "";

      let personalizedMessage = (campaign.message || "").replace(/\{first_name\}/g, firstName).replace(/\{middle_name\}/g, middleName).replace(/\{last_name\}/g, lastName);

      const smsPayload: any = {
        mobile: recipient.email_or_phone,
        message: personalizedMessage,
        message_type: "transactional",
        template_id: campaign.dlt_template_id || undefined,
      };

      const smsResponse = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
        body: JSON.stringify(smsPayload),
      });

      if (smsResponse.ok) {
        sentThisCycle++;
        await supabase.from("bulk_campaign_recipients")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", recipient.id);
      } else {
        failedThisCycle++;
        const errData = await smsResponse.json().catch(() => ({}));
        await supabase.from("bulk_campaign_recipients")
          .update({ status: "failed", error_message: (errData.error || "SMS send failed").substring(0, 500) })
          .eq("id", recipient.id);
      }
    } catch (err) {
      failedThisCycle++;
      await supabase.from("bulk_campaign_recipients")
        .update({ status: "failed", error_message: (err instanceof Error ? err.message : "Unknown error").substring(0, 500) })
        .eq("id", recipient.id);
    }
  }

  // Count actual sent/failed from the database to avoid stale accumulation
  const { count: actualSent } = await supabase
    .from("bulk_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_type", "sms")
    .eq("campaign_id", campaign.id)
    .eq("status", "sent");

  const { count: actualFailed } = await supabase
    .from("bulk_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_type", "sms")
    .eq("campaign_id", campaign.id)
    .eq("status", "failed");

  const { count: remainingPending } = await supabase
    .from("bulk_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_type", "sms")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending");

  const isComplete = !remainingPending || remainingPending === 0;

  await supabase.from("bulk_sms_campaigns")
    .update({
      sent_count: actualSent || 0,
      failed_count: actualFailed || 0,
      last_batch_sent_at: new Date().toISOString(),
      ...(isComplete ? { status: "completed", completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", campaign.id);

  return sentThisCycle + failedThisCycle;
}
