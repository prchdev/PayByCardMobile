import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = () => Deno.env.get("SUPABASE_ANON_KEY")!;

async function generateInvoicePdf(paymentId: string, invoiceType: "settlement" | "refund"): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL()}/functions/v1/generate-invoice-html`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payment_id: paymentId, invoice_type: invoiceType }),
    });
    const data = await res.json();
    return data.html_base64 ?? null;
  } catch (err) {
    console.error("Invoice generation error:", err);
    return null;
  }
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  buttonText?: string,
  buttonLink?: string,
  attachmentBase64?: string | null,
  attachmentFilename?: string,
  attachmentContentType?: string,
) {
  try {
    await fetch(`${SUPABASE_URL()}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to, subject, body, body_type: "html", use_template: true,
        ...(buttonText && buttonLink ? { button_text: buttonText, button_link: buttonLink } : {}),
        ...(attachmentBase64 ? {
          attachment_base64: attachmentBase64,
          attachment_filename: attachmentFilename || "invoice.html",
          attachment_content_type: attachmentContentType || "text/html",
        } : {}),
      }),
    });
  } catch (err) {
    console.error("Email send error:", err);
  }
}

function formatCurrency(amount: number | string): string {
  return `₹${parseFloat(String(amount)).toFixed(2)}`;
}

function receiptTable(rows: [string, string][]): string {
  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;font-size:14px;text-align:right;">${value}</td>
    </tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin:16px 0;">${rowsHtml}</table>`;
}

const STATUS_EMAIL_CONFIG: Record<string, { senderSubject: string; senderTitle: string; receiverSubject: string; receiverTitle: string; sendToReceiver: boolean }> = {
  settlement_pending: {
    senderSubject: "Payment Successful – Settlement In Progress",
    senderTitle: "Your payment was received and settlement is in progress.",
    receiverSubject: "Payment Incoming – Settlement In Progress",
    receiverTitle: "A payment has been initiated to your bank account and settlement is in progress.",
    sendToReceiver: true,
  },
  kyc_pending: {
    senderSubject: "Payment Successful – Awaiting Beneficiary KYC",
    senderTitle: "Your payment was received. Settlement is on hold pending beneficiary KYC verification.",
    receiverSubject: "Action Required: Complete KYC to Receive Payment",
    receiverTitle: "A payment is waiting to be released to your account. Please complete KYC verification.",
    sendToReceiver: false, // handled separately via sendKycRequestEmails
  },
  completed: {
    senderSubject: "Transaction Completed Successfully",
    senderTitle: "Your payment has been completed and funds have been transferred to the beneficiary.",
    receiverSubject: "Payment Received – Funds Transferred",
    receiverTitle: "The payment to your bank account has been completed successfully.",
    sendToReceiver: true,
  },
  failed: {
    senderSubject: "Payment Failed",
    senderTitle: "Your payment could not be processed. No amount has been debited.",
    receiverSubject: "",
    receiverTitle: "",
    sendToReceiver: false,
  },
  cancelled: {
    senderSubject: "Payment Cancelled",
    senderTitle: "Your payment was cancelled.",
    receiverSubject: "",
    receiverTitle: "",
    sendToReceiver: false,
  },
  refunded: {
    senderSubject: "Refund Processed – Payment Returned",
    senderTitle: "The payment has been refunded. The amount will be returned to your source account.",
    receiverSubject: "Payment Cancelled – KYC Not Completed",
    receiverTitle: "The payment to your account has been cancelled as KYC verification was not completed within the required timeframe.",
    sendToReceiver: true,
  },
  refund_pending: {
    senderSubject: "Refund Initiated – Processing",
    senderTitle: "A refund has been initiated for your payment. The amount will be returned shortly.",
    receiverSubject: "",
    receiverTitle: "",
    sendToReceiver: false,
  },
};

async function sendInitiatedSms(supabase: any, payment: any) {
  try {
    const supabaseUrl = SUPABASE_URL();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const { data: senderUser } = await supabase
      .from("users")
      .select("mobile_number, first_name, last_name")
      .eq("id", payment.user_id)
      .maybeSingle();
    const mobile = senderUser?.mobile_number;
    if (!mobile) return;
    const senderName = senderUser
      ? `${senderUser.first_name || ""} ${senderUser.last_name || ""}`.trim()
      : "Customer";
    const categoryName = payment.category_details?.category_name ||
      payment.selected_payment_option?.card_type || "Payment";
    await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mobile,
        message: "",
        message_type: "payment_initiated",
        variables: {
          var1: categoryName,
          var2: parseFloat(String(payment.amount)).toFixed(2),
          var3: senderName,
        },
      }),
    });
  } catch (_) {}
}

async function sendSettledSms(supabase: any, payment: any) {
  try {
    const supabaseUrl = SUPABASE_URL();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const { data: senderUser } = await supabase
      .from("users")
      .select("mobile_number, first_name, last_name")
      .eq("id", payment.user_id)
      .maybeSingle();
    const mobile = senderUser?.mobile_number;
    if (!mobile) return;
    const senderName = senderUser
      ? `${senderUser.first_name || ""} ${senderUser.last_name || ""}`.trim()
      : "Customer";
    const categoryName = payment.category_details?.category_name ||
      payment.selected_payment_option?.card_type || "Payment";
    const beneficiaryDetails = payment.beneficiary_details || {};
    const beneficiaryName = beneficiaryDetails.full_name || "Beneficiary";
    await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mobile,
        message: "",
        message_type: "payment_settled",
        variables: {
          var1: categoryName,
          var2: parseFloat(String(payment.amount)).toFixed(2),
          var3: senderName,
          var4: beneficiaryName,
        },
      }),
    });
  } catch (_) {}
}

// Statuses that should have an HTML invoice attached (NOT settlement_pending / Payment Successful)
const ATTACH_INVOICE_STATUSES = new Set(["completed", "refunded"]);

async function sendTransactionEmails(supabase: any, payment: any, paymentStatus: string) {
  try {
    const { data: senderUser } = await supabase
      .from("users")
      .select("first_name, last_name, email")
      .eq("id", payment.user_id)
      .maybeSingle();

    const beneficiaryDetails = payment.beneficiary_details || {};
    const senderName = senderUser ? `${senderUser.first_name} ${senderUser.last_name}`.trim() : "Customer";
    const receiverName = beneficiaryDetails.full_name || "Beneficiary";
    const receiverEmail = beneficiaryDetails.email;
    const senderEmail = senderUser?.email;

    const paymentOptionName = payment.selected_payment_option?.card_type || payment.card_type || "Card";

    const txDate = new Date(payment.created_at || new Date()).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
    });

    const statusDisplay = STATUS_EMAIL_CONFIG[paymentStatus];
    const statusLabel = statusDisplay?.senderTitle || paymentStatus;

    const receiptRows: [string, string][] = [
      ["Transaction Reference", payment.payment_reference || "N/A"],
      ["Date & Time", txDate],
      ["Payment Option", paymentOptionName],
      ["Amount", formatCurrency(payment.amount)],
      ["Platform Charges", formatCurrency(payment.charges || 0)],
      ["GST on Charges", formatCurrency(payment.gst || 0)],
      ["Total Charged", formatCurrency(parseFloat(String(payment.charges || 0)) + parseFloat(String(payment.gst || 0)))],
      ["Status", statusLabel],
    ];

    if (payment.gateway_transaction_id) {
      receiptRows.push(["Gateway Reference", payment.gateway_transaction_id]);
    }
    if (beneficiaryDetails.bank_name) {
      receiptRows.push(["Beneficiary Bank", beneficiaryDetails.bank_name]);
    }
    if (beneficiaryDetails.bank_account) {
      receiptRows.push(["Account No.", beneficiaryDetails.bank_account]);
    }

    const receiptHtml = receiptTable(receiptRows);

    // Generate HTML invoice for completed / refunded emails
    let invoiceBase64: string | null = null;
    const attachInvoice = ATTACH_INVOICE_STATUSES.has(paymentStatus);
    if (attachInvoice && payment.id) {
      const isRefund = paymentStatus === "refunded";
      invoiceBase64 = await generateInvoicePdf(payment.id, isRefund ? "refund" : "settlement");
    }

    const invYear = new Date(payment.completed_at || payment.created_at || new Date()).getFullYear();
    const invoiceRef = payment.invoice_number
      ? `PAY-${invYear}-${payment.invoice_number}`
      : (payment.payment_reference || "txn");
    const invoiceFilename = `invoice-${invoiceRef}.html`;

    // Sender email
    if (senderEmail && statusDisplay?.senderSubject) {
      const senderBody = `
        <p>Dear ${senderName},</p>
        <p>${statusDisplay.senderTitle}</p>
        ${receiptHtml}
        <p style="margin-top:16px;"><strong>Sent to:</strong> ${receiverName}${beneficiaryDetails.bank_name ? ` &mdash; ${beneficiaryDetails.bank_name}` : ""}</p>
        ${attachInvoice ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Invoice copy is attached to this email.</p>` : ""}
        <p style="color:#6b7280;font-size:13px;margin-top:12px;">Please keep this for your records. Contact our support team for any queries.</p>
      `;
      await sendEmail(
        senderEmail,
        `${statusDisplay.senderSubject} – Ref: ${payment.payment_reference}`,
        senderBody,
        undefined, undefined,
        invoiceBase64,
        invoiceFilename,
        "text/html",
      );
    }

    // Receiver email
    if (receiverEmail && statusDisplay?.sendToReceiver && statusDisplay?.receiverSubject) {
      const receiverBody = `
        <p>Dear ${receiverName},</p>
        <p>${statusDisplay.receiverTitle}</p>
        ${receiptHtml}
        <p style="margin-top:16px;"><strong>Sent by:</strong> ${senderName}</p>
        ${attachInvoice ? `<p style="color:#6b7280;font-size:13px;margin-top:8px;">Invoice copy is attached to this email.</p>` : ""}
        <p style="color:#6b7280;font-size:13px;margin-top:12px;">Contact our support team if you have any concerns.</p>
      `;
      await sendEmail(
        receiverEmail,
        `${statusDisplay.receiverSubject} – Ref: ${payment.payment_reference}`,
        receiverBody,
        undefined, undefined,
        invoiceBase64,
        invoiceFilename,
        "text/html",
      );
    }
  } catch (err) {
    console.error("Error sending transaction emails:", err);
  }
}

/**
 * Looks up a previously verified merchant_onboarding record for the same beneficiary.
 * Primary match: same beneficiary_id + same email + same mobile.
 * Fallback: same bank_account + same ifsc + same mobile (handles cross-beneficiary
 * cases where the same person was added under a different user account or with
 * a slightly different email spelling).
 */
async function findPreviousVerifiedKyc(supabase: any, beneficiaryId: string | null, currentOnboardingId: string | null): Promise<any | null> {
  if (!beneficiaryId) return null;

  const { data: bene } = await supabase
    .from("beneficiaries")
    .select("email, mobile, bank_account, ifsc")
    .eq("id", beneficiaryId)
    .maybeSingle();

  const email = bene?.email?.trim() || null;
  const mobile = bene?.mobile?.trim() || null;
  const bankAccount = bene?.bank_account?.trim() || null;
  const ifsc = bene?.ifsc?.trim() || null;

  // Primary match: same beneficiary_id + email + mobile
  if (email && mobile) {
    let query = supabase
      .from("merchant_onboarding")
      .select("*")
      .eq("status", "verified")
      .eq("beneficiary_id", beneficiaryId)
      .eq("email", email)
      .eq("mobile", mobile)
      .order("verified_at", { ascending: false })
      .limit(1);

    if (currentOnboardingId) query = query.neq("id", currentOnboardingId);

    const { data: matches } = await query;
    if (matches?.[0]) return matches[0];
  }

  // Fallback: match by bank_account + ifsc + mobile across any beneficiary
  if (bankAccount && ifsc && mobile) {
    const { data: beneMatches } = await supabase
      .from("beneficiaries")
      .select("id")
      .eq("bank_account", bankAccount)
      .eq("ifsc", ifsc)
      .eq("mobile", mobile);

    if (beneMatches && beneMatches.length > 0) {
      const beneIds = beneMatches.map((b: any) => b.id);
      let fallbackQuery = supabase
        .from("merchant_onboarding")
        .select("*")
        .eq("status", "verified")
        .in("beneficiary_id", beneIds)
        .order("verified_at", { ascending: false })
        .limit(1);

      if (currentOnboardingId) fallbackQuery = fallbackQuery.neq("id", currentOnboardingId);

      const { data: fallbackMatches } = await fallbackQuery;
      if (fallbackMatches?.[0]) return fallbackMatches[0];
    }
  }

  return null;
}

async function sendKycRequestEmails(supabase: any, payment: any): Promise<boolean> {
  try {
    const beneficiaryDetails = payment.beneficiary_details || {};
    const receiverName = beneficiaryDetails.full_name || "Beneficiary";
    const receiverEmail = beneficiaryDetails.email;
    const receiverMobile = beneficiaryDetails.mobile || "";

    // ── Auto-reuse: if beneficiary was previously verified, skip KYC flow ──
    const previousKyc = await findPreviousVerifiedKyc(supabase, payment.beneficiary_id || null, null);

    if (previousKyc) {
      const nowIso = new Date().toISOString();

      // Create a pre-verified merchant_onboarding record for this payment
      await supabase.from("merchant_onboarding").insert({
        payment_id: payment.id,
        beneficiary_id: payment.beneficiary_id || null,
        full_name: previousKyc.full_name ?? receiverName,
        email: previousKyc.email ?? receiverEmail ?? "",
        mobile: previousKyc.mobile ?? receiverMobile,
        sender_name: payment.beneficiary_details?.full_name ?? "Sender",
        category_name: payment.category_details?.category_name ?? "Payment",
        token: crypto.randomUUID(),
        status: "verified",
        expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        kyc_completed_at: nowIso,
        verified_at: nowIso,
        updated_at: nowIso,
        pan_number: previousKyc.pan_number ?? null,
        pan_photo_url: previousKyc.pan_photo_url ?? null,
        dob: previousKyc.dob ?? null,
        id_number: previousKyc.id_number ?? null,
        aadhaar_front_url: previousKyc.aadhaar_front_url ?? null,
        aadhaar_back_url: previousKyc.aadhaar_back_url ?? null,
        address: previousKyc.address ?? null,
        city: previousKyc.city ?? null,
        state: previousKyc.state ?? null,
        pincode: previousKyc.pincode ?? null,
        bank_account_number: previousKyc.bank_account_number ?? null,
        bank_ifsc: previousKyc.bank_ifsc ?? null,
        bank_name: previousKyc.bank_name ?? null,
        bank_branch: previousKyc.bank_branch ?? null,
        kyc_method: previousKyc.kyc_method ?? null,
        digilocker_verified: previousKyc.digilocker_verified ?? null,
        digilocker_provider: previousKyc.digilocker_provider ?? null,
        address_proof_type: previousKyc.address_proof_type ?? null,
      });

      // Mark beneficiary as verified merchant
      if (payment.beneficiary_id) {
        await supabase
          .from("beneficiaries")
          .update({ is_verified_merchant: true, updated_at: nowIso })
          .eq("id", payment.beneficiary_id);
      }

      // Advance payment to settlement_pending
      await supabase
        .from("payments")
        .update({ status: "settlement_pending", updated_at: nowIso })
        .eq("id", payment.id);

      await supabase.from("payment_logs").insert({
        payment_id: payment.id,
        status: "settlement_pending",
        message: "Merchant KYC auto-reused from a previous verified submission. Payment queued for settlement.",
        metadata: { previous_merchant_onboarding_id: previousKyc.id },
      });

      // Signal to the caller that KYC was auto-resolved (payment is now settlement_pending)
      return true;
    }
    // ── End auto-reuse ────────────────────────────────────────────────────

    // Fetch sender name from users table
    const { data: senderUser } = await supabase
      .from("users")
      .select("first_name, last_name, middle_name")
      .eq("id", payment.user_id)
      .maybeSingle();
    const senderName = senderUser
      ? [senderUser.first_name, senderUser.middle_name, senderUser.last_name].filter(Boolean).join(" ").trim()
      : "Sender";

    const categoryName = payment.category_details?.category_name ||
      payment.selected_payment_option?.card_type || "Payment";
    const refundHours = payment.category_details?.refund_after_hours ||
      payment.selected_payment_option?.refund_after_hours;

    // Calculate expiry: use refund_after_hours if set, otherwise 72 hours
    const expiryHours = refundHours ? Number(refundHours) : 72;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    // Generate a unique token for this onboarding session
    const token = crypto.randomUUID();

    // Check if a pending record already exists for this payment
    const { data: existing } = await supabase
      .from("merchant_onboarding")
      .select("id, token")
      .eq("payment_id", payment.id)
      .in("status", ["pending", "submitted"])
      .maybeSingle();

    let onboardingToken = token;

    if (existing) {
      // Reuse the existing token (resend email)
      onboardingToken = existing.token;
    } else {
      // Create a new merchant_onboarding record
      const { error: insertErr } = await supabase
        .from("merchant_onboarding")
        .insert({
          payment_id: payment.id,
          beneficiary_id: payment.beneficiary_id || null,
          full_name: receiverName,
          email: receiverEmail || "",
          mobile: receiverMobile,
          sender_name: senderName,
          category_name: categoryName,
          token: token,
          status: "pending",
          expires_at: expiresAt,
        });

      if (insertErr) {
        console.error("Failed to create merchant_onboarding record:", insertErr);
        return false;
      }
    }

    const appUrl = (Deno.env.get("APP_URL") || "https://paybycard.in").trim();
    const onboardingLink = `${appUrl}/merchant-onboarding?token=${onboardingToken}`;

    const refundNote = refundHours
      ? `<p style="color:#d97706;font-weight:600;margin-top:16px;">Note: If KYC is not completed within ${refundHours} hours, the payment will be refunded to the sender after deducting convenience charges.</p>`
      : `<p style="color:#d97706;font-weight:600;margin-top:16px;">Note: If KYC is not completed within the required timeframe, the payment may be refunded to the sender.</p>`;

    if (receiverEmail) {
      const kycBody = `
        <p>Dear ${receiverName},</p>
        <p>A payment of <strong>${formatCurrency(payment.amount)}</strong> has been initiated for you by <strong>${senderName}</strong>. To receive the funds in your bank account, you must complete your <strong>Merchant KYC / Merchant Onboarding</strong> verification.</p>
        ${receiptTable([
          ["Payment Reference", payment.payment_reference || "N/A"],
          ["Amount to Receive", formatCurrency(payment.amount)],
          ["Category", categoryName],
          ["Link Expires", new Date(expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })],
        ])}
        <p>Click the button below to complete your KYC verification and receive your payment.</p>
        <p style="color:#6b7280;font-size:13px;margin-top:8px;">Or copy this link: <a href="${onboardingLink}" style="color:#2563eb;">${onboardingLink}</a></p>
        ${refundNote}
        <p style="color:#6b7280;font-size:13px;margin-top:20px;">If you have already submitted your KYC, please wait for verification. Contact our support team if you need assistance.</p>
      `;
      await sendEmail(
        receiverEmail,
        `Action Required: Complete KYC to Receive Payment – Ref: ${payment.payment_reference || "N/A"}`,
        kycBody,
        "Complete KYC Verification",
        onboardingLink,
      );
    }

    if (receiverMobile) {
      try {
        await fetch(`${SUPABASE_URL()}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mobile: receiverMobile,
            message: "",
            message_type: "merchant_onboarding",
            variables: { var1: onboardingToken },
          }),
        });
      } catch (smsErr) {
        console.error("SMS send error:", smsErr);
      }
    }
  } catch (err) {
    console.error("Error sending KYC request:", err);
    return false;
  }
  return false;
}

async function triggerPayout(supabase: any, payment: any) {
  try {
    // Delegate to auto-payout which handles both Razorpay and CashFree,
    // applies the correct transfer mode based on settlement_time, and
    // performs idempotency checks.
    await fetch(`${SUPABASE_URL()}/functions/v1/auto-payout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({ payment_id: payment.id }),
    });
  } catch (err) {
    console.error("triggerPayout error:", err);
  }
}

// Internal function-to-function calls carry the service-role key and are trusted.
function isInternalCall(req: Request): boolean {
  const auth = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return false;
  return auth === `Bearer ${serviceKey}` || auth === serviceKey;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL(), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const {
      userId,
      paymentId,
      transactionReference,
      status,
      amount,
      gatewayResponse,
      errorMessage,
      gatewayTransactionId,
      paymentMethod,
      cardType,
      gatewayName,
    } = await req.json();

    // Resolve gateway transaction ID — accept what the client sends, then fall back
    // to well-known field names in the gateway response for each provider.
    const resolvedGatewayTxId: string | null =
      gatewayTransactionId ||
      gatewayResponse?.razorpay_payment_id ||   // RazorPay client callback
      gatewayResponse?.cf_payment_id ||          // CashFree
      gatewayResponse?.mihpayid ||               // PayU
      null;

    if (!userId || !transactionReference || !status || !amount) {
      return new Response(
        JSON.stringify({ error: "Required fields are missing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map incoming status to DB status
    // For gateway success: determine kyc_pending vs settlement_pending after fetching payment
    // F3: Only internal (server-to-server) callers may assert success/completed.
    //     A browser client sending success is redirected to check-payment-status instead.
    const isGatewaySuccess = status === "success" || status === "completed";
    if (isGatewaySuccess && !isInternalCall(req)) {
      return new Response(
        JSON.stringify({ error: "Payment confirmation must go through the payment status verification endpoint." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const rawDbStatus = isGatewaySuccess ? "completed" // temporary, overridden below
      : status === "failed" ? "failed"
      : status === "cancelled" ? "cancelled"
      : status;

    let paymentRecord: any = null;

    if (paymentId) {
      // Fetch full payment to determine KYC requirement
      const { data: fullPayment } = await supabase
        .from("payments")
        .select("*, payment_gateway_settings(payout_mode, gateway_name, id, environment, test_api_key, test_api_secret, production_api_key, production_api_secret, instant_settlement_charges_percentage)")
        .eq("id", paymentId)
        .maybeSingle();

      paymentRecord = fullPayment;

      let resolvedStatus = rawDbStatus;

      if (isGatewaySuccess && fullPayment) {
        const isVerifiedMerchant = fullPayment.beneficiary_details?.is_verified_merchant === true;
        // KYC is required only when EXPLICITLY set to true — undefined/false both mean no KYC required
        const kycRequired = fullPayment.category_details?.receiver_kyc_required === true ||
          fullPayment.selected_payment_option?.receiver_kyc_required === true;
        const isEligibleForPayout = isVerifiedMerchant || !kycRequired;
        const payoutMode = fullPayment.payment_gateway_settings?.payout_mode || "manual";
        const splitConfigured = fullPayment.split_configured === true;

        if (!isEligibleForPayout) {
          resolvedStatus = "kyc_pending";
        } else if (payoutMode === "payment_split" && splitConfigured) {
          // Split was configured at order creation — CashFree/Razorpay handles settlement directly
          resolvedStatus = "completed";
        } else {
          resolvedStatus = "settlement_pending";
        }
      }

      const paymentUpdate: any = {
        status: resolvedStatus,
        updated_at: new Date().toISOString(),
      };
      if (resolvedStatus === "completed") paymentUpdate.completed_at = new Date().toISOString();
      if (resolvedGatewayTxId) paymentUpdate.gateway_transaction_id = resolvedGatewayTxId;
      if (gatewayResponse && Object.keys(gatewayResponse).length > 0) paymentUpdate.gateway_response = gatewayResponse;
      if (errorMessage) paymentUpdate.failure_reason = errorMessage;

      await supabase.from("payments").update(paymentUpdate).eq("id", paymentId).eq("user_id", userId);

      await supabase.from("payment_logs").insert({
        payment_id: paymentId,
        status: resolvedStatus,
        message: `Payment status set to ${resolvedStatus}${errorMessage ? `: ${errorMessage}` : ""}`,
        metadata: gatewayResponse || {},
      });

      // ── In-app mobile notifications for payment status ─────────────────
      const PAYMENT_NOTIFS: Record<string, { type: string; title: string; body: string }> = {
        settlement_pending: {
          type: "payment_captured",
          title: "Payment Captured",
          body: `Your payment of ${formatCurrency(fullPayment.amount)} has been captured. Settlement is in progress.`,
        },
        kyc_pending: {
          type: "merchant_kyc_pending",
          title: "Merchant KYC Pending",
          body: `Payment of ${formatCurrency(fullPayment.amount)} is on hold pending beneficiary KYC verification.`,
        },
        completed: {
          type: "settlement_completed",
          title: "Settlement Completed",
          body: `Your payment of ${formatCurrency(fullPayment.amount)} has been settled to the beneficiary.`,
        },
        failed: {
          type: "payment_failed",
          title: "Payment Failed",
          body: `Your payment of ${formatCurrency(fullPayment.amount)} could not be processed. ${errorMessage || ""}`.trim(),
        },
        refunded: {
          type: "refund_initiated",
          title: "Refund Initiated",
          body: `A refund of ${formatCurrency(fullPayment.amount)} has been initiated for your payment.`,
        },
        refund_pending: {
          type: "refund_initiated",
          title: "Refund Initiated",
          body: `A refund of ${formatCurrency(fullPayment.amount)} has been initiated for your payment.`,
        },
      };

      const notifConfig = PAYMENT_NOTIFS[resolvedStatus];
      if (notifConfig) {
        await supabase.rpc("create_mobile_notification", {
          p_user_id: userId,
          p_type: notifConfig.type,
          p_title: notifConfig.title,
          p_body: notifConfig.body,
          p_data: {
            payment_id: paymentId,
            payment_reference: fullPayment.payment_reference,
            amount: fullPayment.amount,
            status: resolvedStatus,
          },
        });

        await supabase.rpc("send_push_notification", {
          p_user_id: userId, p_title: notifConfig.title, p_body: notifConfig.body,
          p_data: { type: notifConfig.type, payment_id: paymentId, payment_reference: fullPayment.payment_reference, amount: fullPayment.amount, status: resolvedStatus },
        });
      }

      if (isGatewaySuccess && fullPayment) {
        const isVerifiedMerchant = fullPayment.beneficiary_details?.is_verified_merchant === true;
        const kycRequired = fullPayment.category_details?.receiver_kyc_required === true ||
          fullPayment.selected_payment_option?.receiver_kyc_required === true;
        const isEligibleForPayout = isVerifiedMerchant || !kycRequired;
        const payoutMode = fullPayment.payment_gateway_settings?.payout_mode || "manual";

        // Re-fetch with updated status for emails
        const { data: updatedPayment } = await supabase
          .from("payments")
          .select("*")
          .eq("id", paymentId)
          .maybeSingle();

        // Trigger auto-payout for 'payout' mode, and for 'payment_split' only when
        // split was NOT configured at order time (split configured = gateway handles settlement directly)
        const splitConfiguredForPayout = fullPayment.split_configured === true;
        if (isEligibleForPayout && (payoutMode === "payout" || (payoutMode === "payment_split" && !splitConfiguredForPayout))) {
          EdgeRuntime.waitUntil(triggerPayout(supabase, { ...fullPayment, ...updatedPayment }));
        }

        // Only send email here (unconfirmed client-side callback — informational only).
        // SMS (payment_initiated + payment_settled) is sent by poll-stale-payments / auto-payout
        // AFTER the gateway confirms the payment, to avoid premature notifications.
        EdgeRuntime.waitUntil(sendTransactionEmails(supabase, updatedPayment || fullPayment, resolvedStatus));

        if (!isEligibleForPayout) {
          // sendKycRequestEmails returns true when KYC was auto-reused from a previous
          // verified submission (no email/SMS sent to merchant). In that case the payment
          // has already been advanced to settlement_pending, so trigger auto-payout.
          EdgeRuntime.waitUntil(
            sendKycRequestEmails(supabase, fullPayment).then((autoResolved) => {
              if (autoResolved) {
                const payoutModeResolved = fullPayment.payment_gateway_settings?.payout_mode || "manual";
                const splitConfiguredResolved = fullPayment.split_configured === true;
                if (payoutModeResolved === "payout" || (payoutModeResolved === "payment_split" && !splitConfiguredResolved)) {
                  return triggerPayout(supabase, fullPayment);
                }
              }
            })
          );
        }
      }
    }

    // Upsert transaction_status table
    const { data: existingStatus } = await supabase
      .from("transaction_status")
      .select("id")
      .eq("transaction_reference", transactionReference)
      .maybeSingle();

    // Resolve final status for transaction_status table
    const finalStatusForTxTable = isGatewaySuccess && paymentRecord
      ? (() => {
          const isVerifiedMerchant = paymentRecord.beneficiary_details?.is_verified_merchant === true;
          const kycRequired = paymentRecord.category_details?.receiver_kyc_required === true ||
            paymentRecord.selected_payment_option?.receiver_kyc_required === true;
          const isEligible = isVerifiedMerchant || !kycRequired;
          if (!isEligible) return "kyc_pending";
          const pm = paymentRecord.payment_gateway_settings?.payout_mode || "manual";
          if (pm === "payment_split" && paymentRecord.split_configured === true) return "completed";
          return "settlement_pending";
        })()
      : rawDbStatus;

    if (existingStatus) {
      const { data: updatedStatus, error: updateError } = await supabase
        .from("transaction_status")
        .update({
          status: finalStatusForTxTable,
          gateway_response: gatewayResponse || {},
          error_message: errorMessage || null,
          gateway_transaction_id: resolvedGatewayTxId || null,
        })
        .eq("id", existingStatus.id)
        .select()
        .single();

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "Failed to update transaction status", details: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Transaction status updated", transactionStatus: updatedStatus }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: transactionStatus, error: insertError } = await supabase
      .from("transaction_status")
      .insert({
        payment_id: paymentId || null,
        user_id: userId,
        transaction_reference: transactionReference,
        status: finalStatusForTxTable,
        amount: parseFloat(amount),
        gateway_response: gatewayResponse || {},
        error_message: errorMessage || null,
        gateway_transaction_id: resolvedGatewayTxId || null,
        payment_method: paymentMethod || null,
        card_type: cardType || null,
        gateway_name: gatewayName || null,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: "Failed to save transaction status", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Transaction status saved", transactionStatus }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Exception in save-transaction-status:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// redeploy
