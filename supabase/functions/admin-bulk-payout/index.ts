import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = () => Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Statuses that are valid targets for manual payout confirmation
const PROCESSABLE_STATUSES = new Set([
  "settlement_pending",
  "settlement_in_progress",
  "kyc_pending",
  "merchant_kyc_review",
]);

interface BulkRow {
  reference: string;
  payout_date: string;   // MM/DD/YYYY
  utr_reference: string;
  confirmed_amount: string;
}

interface RowResult {
  row_number: number;
  reference: string;
  success: boolean;
  error?: string;
  payment_reference?: string;
}

// Convert MM/DD/YYYY → YYYY-MM-DD; returns null on invalid
function parseDate(mmddyyyy: string): string | null {
  const parts = mmddyyyy.trim().split("/");
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts;
  if (!mm || !dd || !yyyy) return null;
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  const year = parseInt(yyyy, 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) return null;
  return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmt(amount: number | string): string {
  return `₹${parseFloat(String(amount)).toFixed(2)}`;
}

async function generateInvoicePdf(paymentId: string): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL()}/functions/v1/generate-invoice-html`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payment_id: paymentId, invoice_type: "settlement" }),
    });
    const data = await res.json();
    return data.html_base64 ?? null;
  } catch { return null; }
}

async function sendEmail(to: string, subject: string, body: string, attachmentBase64?: string | null, attachmentFilename?: string) {
  try {
    await fetch(`${SUPABASE_URL()}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to, subject, body, body_type: "html", use_template: true,
        ...(attachmentBase64 ? { attachment_base64: attachmentBase64, attachment_filename: attachmentFilename || "invoice.html", attachment_content_type: "text/html" } : {}),
      }),
    });
  } catch (_) {}
}

async function sendSettledSms(supabase: any, payment: any, confirmedAmount: number | string) {
  try {
    const { data: senderUser } = await supabase
      .from("users").select("mobile_number, first_name, last_name").eq("id", payment.user_id).maybeSingle();
    const mobile = senderUser?.mobile_number;
    if (!mobile) return;
    const senderName = senderUser ? `${senderUser.first_name || ""} ${senderUser.last_name || ""}`.trim() : "Customer";
    const categoryName = payment.category_details?.category_name || "Payment";
    const beneficiaryName = (payment.beneficiaries?.full_name) || "Beneficiary";
    await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mobile, message: "", message_type: "payment_settled",
        variables: {
          var1: categoryName,
          var2: parseFloat(String(confirmedAmount)).toFixed(2),
          var3: senderName,
          var4: beneficiaryName,
        },
      }),
    });
  } catch (_) {}
}

async function processRow(
  supabase: any,
  row: BulkRow,
  rowNumber: number,
  adminId: string,
): Promise<RowResult> {
  const ref = row.reference?.trim();
  const utr = row.utr_reference?.trim();
  const dateRaw = row.payout_date?.trim();
  const amtRaw = row.confirmed_amount?.toString().trim();

  // ── Field-level validation ────────────────────────────────────────────────
  if (!ref) return { row_number: rowNumber, reference: ref || "", success: false, error: "Reference is required" };
  if (!dateRaw) return { row_number: rowNumber, reference: ref, success: false, error: "Payout Date is required" };
  if (!utr) return { row_number: rowNumber, reference: ref, success: false, error: "UTR / Reference Number is required" };
  if (!amtRaw) return { row_number: rowNumber, reference: ref, success: false, error: "Confirmed Amount is required" };

  const payoutDateIso = parseDate(dateRaw);
  if (!payoutDateIso) {
    return { row_number: rowNumber, reference: ref, success: false, error: `Invalid Payout Date "${dateRaw}" — expected MM/DD/YYYY (e.g. 06/15/2026)` };
  }

  const confirmedAmount = parseFloat(amtRaw.replace(/,/g, ""));
  if (isNaN(confirmedAmount) || confirmedAmount <= 0) {
    return { row_number: rowNumber, reference: ref, success: false, error: `Invalid Confirmed Amount "${amtRaw}" — must be a positive number` };
  }

  // ── Look up payment ───────────────────────────────────────────────────────
  const { data: payment, error: fetchErr } = await supabase
    .from("payments")
    .select("*, payment_gateway_settings(*), beneficiaries(*)")
    .ilike("payment_reference", ref)
    .maybeSingle();

  if (fetchErr) return { row_number: rowNumber, reference: ref, success: false, error: `DB error: ${fetchErr.message}` };
  if (!payment) return { row_number: rowNumber, reference: ref, success: false, error: `Payment reference "${ref}" not found` };

  // ── Status check ──────────────────────────────────────────────────────────
  if (payment.status === "completed") {
    return { row_number: rowNumber, reference: ref, success: false, error: `Payment "${ref}" is already completed` };
  }
  if (payment.status === "refunded" || payment.status === "cancelled") {
    return { row_number: rowNumber, reference: ref, success: false, error: `Payment "${ref}" has status "${payment.status}" — cannot process payout` };
  }
  if (!PROCESSABLE_STATUSES.has(payment.status) && !payment.auto_payout_failed) {
    return { row_number: rowNumber, reference: ref, success: false, error: `Payment "${ref}" has status "${payment.status}" — not eligible for manual payout` };
  }

  // ── Duplicate payout check ────────────────────────────────────────────────
  const { data: existingPayout } = await supabase
    .from("payouts")
    .select("id, status")
    .eq("payment_id", payment.id)
    .eq("status", "completed")
    .maybeSingle();

  if (existingPayout) {
    return { row_number: rowNumber, reference: ref, success: false, error: `Payout already completed for payment "${ref}"` };
  }

  // ── Check if a pending payout record exists to update ────────────────────
  const { data: pendingPayout } = await supabase
    .from("payouts")
    .select("id")
    .eq("payment_id", payment.id)
    .in("status", ["pending", "processing", "failed"])
    .maybeSingle();

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  const newPayoutRef = `POUT-${dateStr}-${rand}`;
  const nowIso = now.toISOString();

  if (pendingPayout) {
    await supabase.from("payouts").update({
      status: "completed",
      payout_date: payoutDateIso,
      payout_reference_number: utr,
      payout_confirmed_amount: confirmedAmount,
      payout_confirmed_by: adminId,
      payout_confirmed_at: nowIso,
      completed_at: nowIso,
      utr_number: utr,
      updated_at: nowIso,
    }).eq("id", pendingPayout.id);
  } else {
    const beneficiary = payment.beneficiaries;
    await supabase.from("payouts").insert({
      user_id: payment.user_id,
      payment_id: payment.id,
      beneficiary_id: payment.beneficiary_id,
      payment_gateway_id: payment.payment_gateway_id,
      amount: payment.amount,
      charges: 0,
      gst: 0,
      total_deduction: 0,
      net_amount: payment.amount,
      payout_reference: newPayoutRef,
      transfer_type: "IMPS",
      account_number: beneficiary?.bank_account || "",
      ifsc_code: beneficiary?.ifsc || "",
      account_holder_name: beneficiary?.full_name || "",
      bank_name: beneficiary?.bank_name || "",
      gateway_environment: payment.gateway_environment,
      status: "completed",
      payout_date: payoutDateIso,
      payout_reference_number: utr,
      payout_confirmed_amount: confirmedAmount,
      payout_confirmed_by: adminId,
      payout_confirmed_at: nowIso,
      completed_at: nowIso,
      utr_number: utr,
      ip_address: "admin-bulk",
    });
  }

  await supabase.from("payments").update({
    status: "completed",
    completed_at: nowIso,
    updated_at: nowIso,
  }).eq("id", payment.id);

  await supabase.from("payment_logs").insert({
    payment_id: payment.id,
    status: "completed",
    message: `Bulk manual payout confirmed by admin. UTR: ${utr}, Amount: ${confirmedAmount}`,
    metadata: { admin_id: adminId, payout_date: payoutDateIso, payout_reference_number: utr, payout_confirmed_amount: confirmedAmount, bulk: true },
  });

  // ── Async notifications ───────────────────────────────────────────────────
  EdgeRuntime.waitUntil((async () => {
    const [senderRes] = await Promise.all([
      supabase.from("users").select("first_name, last_name, email").eq("id", payment.user_id).maybeSingle(),
    ]);
    const senderName = senderRes.data ? `${senderRes.data.first_name} ${senderRes.data.last_name}`.trim() : "Customer";
    const senderEmail = senderRes.data?.email;
    const beneficiaryDetails = payment.beneficiaries || {};
    const receiverName = beneficiaryDetails?.full_name || "Beneficiary";
    const receiverEmail = beneficiaryDetails?.email;

    const invoiceBase64 = await generateInvoicePdf(payment.id);
    const invoiceFilename = `invoice-${payment.payment_reference || "txn"}.html`;

    const receiptRows = `
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin:16px 0;">
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Transaction Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payment.payment_reference}</td></tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Amount Transferred</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${fmt(confirmedAmount)}</td></tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">Payout UTR / Reference</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${utr}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b7280;font-size:14px;">Payout Date</td><td style="padding:8px 12px;font-weight:600;color:#111827;font-size:14px;text-align:right;">${payoutDateIso}</td></tr>
      </table>`;

    if (senderEmail) {
      await sendEmail(
        senderEmail,
        `Transaction Completed – Ref: ${payment.payment_reference}`,
        `<p>Dear ${senderName},</p><p>Your payment has been completed and funds have been transferred to the beneficiary.</p>${receiptRows}${invoiceBase64 ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Invoice copy is attached to this email.</p>` : ""}<p style="color:#6b7280;font-size:13px;">Contact support for any queries.</p>`,
        invoiceBase64,
        invoiceFilename,
      );
    }
    if (receiverEmail) {
      await sendEmail(
        receiverEmail,
        `Payment Received – Ref: ${payment.payment_reference}`,
        `<p>Dear ${receiverName},</p><p>The payment to your bank account has been completed successfully.</p>${receiptRows}<p><strong>Sent by:</strong> ${senderName}</p>${invoiceBase64 ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Invoice copy is attached to this email.</p>` : ""}<p style="color:#6b7280;font-size:13px;">Contact support if you have any concerns.</p>`,
        invoiceBase64,
        invoiceFilename,
      );
    }
    await sendSettledSms(supabase, payment, confirmedAmount);
  })());

  return { row_number: rowNumber, reference: ref, success: true, payment_reference: payment.payment_reference };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { adminId, rows } = await req.json();

    if (!adminId) {
      return new Response(JSON.stringify({ error: "Admin ID is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: "No rows provided" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (rows.length > 500) {
      return new Response(JSON.stringify({ error: "Maximum 500 rows allowed per batch" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: admin } = await supabase.from("admin_users").select("id, full_name").eq("id", adminId).maybeSingle();
    if (!admin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: RowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const result = await processRow(supabase, rows[i] as BulkRow, i + 1, adminId);
      results.push(result);
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({ success: true, results, summary: { total: rows.length, succeeded, failed } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
