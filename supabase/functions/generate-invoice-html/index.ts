import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

function fmt(v: string | number | null | undefined): string {
  return parseFloat(String(v || 0)).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// F23: Escape untrusted beneficiary data before interpolating into invoice HTML.
function escHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusStyle(s: string): { color: string; bg: string; label: string } {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    completed:          { color: "#16a34a", bg: "#dcfce7", label: "Completed" },
    settlement_pending: { color: "#d97706", bg: "#fef3c7", label: "Settlement In Progress" },
    kyc_pending:        { color: "#d97706", bg: "#fef3c7", label: "KYC Pending" },
    failed:             { color: "#dc2626", bg: "#fee2e2", label: "Failed" },
    cancelled:          { color: "#dc2626", bg: "#fee2e2", label: "Transaction Failed" },
    refunded:           { color: "#ea580c", bg: "#ffedd5", label: "Refunded" },
    refund_pending:     { color: "#e11d48", bg: "#ffe4e6", label: "Refund Pending" },
    processing:         { color: "#2563eb", bg: "#dbeafe", label: "Processing" },
  };
  return map[s] || { color: "#475569", bg: "#f1f5f9", label: s };
}

async function fetchLogoAsDataUrl(supabase: any, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    // If it's a Supabase storage URL in a private bucket, create a signed URL
    const bucketMatch = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.*)/);
    if (bucketMatch) {
      const [, bucket, filePath] = bucketMatch;
      const { data: signedData, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(filePath, 3600);
      if (!error && signedData?.signedUrl) {
        const res = await fetch(signedData.signedUrl);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const ct = res.headers.get("content-type") || "image/png";
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return `data:${ct};base64,${btoa(binary)}`;
      }
    }
    // Fallback: try direct fetch (works for public URLs)
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${ct};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function isMaharashtraState(stateText: string | null | undefined): boolean {
  if (!stateText) return false;
  const s = stateText.trim().toLowerCase();
  return s === "maharashtra" || s === "mh";
}

function buildHtml(
  payment: any,
  co: any,
  isRefund: boolean,
  payout: any,
  senderPan: string | null,
  senderAddress: string | null,
  bizKyc: any,
  receiverPan: string | null,
  logoDataUrl: string | null,
): string {
  const ds = isRefund ? "refunded" : (payment.status || "completed");
  const { color: statusColor, bg: statusBg, label: statusLabel } = statusStyle(ds);

  const bene = payment.beneficiary_details || {};
  const option = payment.selected_payment_option?.card_type || payment.card_type || "—";
  const baseAmt = parseFloat(String(payment.amount || 0));
  const charges = parseFloat(String(payment.charges || 0));
  const gst = parseFloat(String(payment.gst || 0));
  const cgst = gst / 2;
  const sgst = gst / 2;
  const igst = gst;
  const totalCharged = charges + cgst + sgst;

  // Determine if payer is in Maharashtra for SGST vs IGST
  const payerState = bizKyc?.business_address || senderAddress || "";
  const isMH = isMaharashtraState(
    // Try to extract state from address string
    payerState.match(/\b(Maharashtra|MH)\b/i)?.[0]
  );
  const businessKycVerified = bizKyc?.status === "verified";

  // Invoice number in PAY-YEAR-N format (only for completed/refunded)
  const invYear = new Date(payment.completed_at || payment.created_at).getFullYear();
  const invoiceNumDisplay = payment.invoice_number ? `PAY-${invYear}-${payment.invoice_number}` : null;
  const categoryName = payment.category_details?.category_name || payment.selected_payment_option?.card_type || "—";
  const settlementTime = payment.category_details?.settlement_time || null;
  const gatewayName = payment.payment_gateway_settings?.gateway_name || null;

  const coName = co.company_name || "PayByCard Technologies Private Limited";
  const logoSrc = logoDataUrl || co.company_logo_url;
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="${coName}" style="height:44px;object-fit:contain;margin-bottom:4px;" />`
    : `<span style="font-size:20px;font-weight:800;color:#1e293b;letter-spacing:-0.5px;">${coName}</span>`;

  const row = (label: string, value: string, mono = false, bold = false) =>
    `<tr>
      <td style="padding:5px 8px;color:#64748b;font-size:11.5px;width:42%;border-bottom:1px solid #f1f5f9;">${label}</td>
      <td style="padding:5px 8px;font-size:11.5px;border-bottom:1px solid #f1f5f9;${mono ? "letter-spacing:0.03em;" : ""}${bold ? "font-weight:700;" : ""}">${value}</td>
    </tr>`;

  let settlementLabel = "";
  if (settlementTime) {
    const s = settlementTime.toUpperCase();
    if (s === "INSTANT" || s === "T+0") settlementLabel = "Instant Settlement";
    else if (s === "T+1") settlementLabel = "Transaction + 1 Day";
    else if (s === "T+2") settlementLabel = "Transaction + 2 Days";
    else settlementLabel = settlementTime;
  }

  const payinRef = payment.gateway_transaction_id || payment.payment_reference || "&#8212;";
  const payinDate = fmtDate(payment.completed_at || payment.created_at);
  const payinGateway = gatewayName || "&#8212;";

  const payoutMode = payment.payout_mode || payout?.transfer_type || "&#8212;";
  const payoutDate = payout?.completed_at ? fmtDate(payout.completed_at) : (payout?.payout_date ? payout.payout_date : "&#8212;");
  const payoutRef = payout?.utr_number || payout?.payout_reference_number || "&#8212;";

  const secondRowLabel = isRefund ? "Refund Transaction" : "PayOut Transaction";
  const secondRowMode = isRefund ? (gatewayName || "&#8212;") : payoutMode;
  const secondRowDate = isRefund
    ? (payout?.completed_at ? fmtDate(payout.completed_at) : "&#8212;")
    : payoutDate;
  const secondRowRef = isRefund
    ? (payout?.utr_number || payout?.payout_reference_number || "&#8212;")
    : payoutRef;

  const additionalSection = `
  <div style="margin-bottom:24px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;">Additional Details</div>
    <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#e2e8f0;">
          <th style="padding:7px 10px;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#475569;width:30%;">Type</th>
          <th style="padding:7px 10px;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#475569;width:20%;">Gateway / Mode</th>
          <th style="padding:7px 10px;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#475569;width:25%;">Date &amp; Time</th>
          <th style="padding:7px 10px;text-align:left;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#475569;">Reference No.</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:7px 10px;font-size:11.5px;font-weight:600;">PayIn Transaction</td>
          <td style="padding:7px 10px;font-size:11.5px;">${payinGateway}</td>
          <td style="padding:7px 10px;font-size:11.5px;">${payinDate}</td>
          <td style="padding:7px 10px;font-size:11.5px;font-family:Courier New,monospace;letter-spacing:0.03em;">${payinRef}</td>
        </tr>
        <tr>
          <td style="padding:7px 10px;font-size:11.5px;font-weight:600;">${secondRowLabel}</td>
          <td style="padding:7px 10px;font-size:11.5px;">${secondRowMode}</td>
          <td style="padding:7px 10px;font-size:11.5px;">${secondRowDate}</td>
          <td style="padding:7px 10px;font-size:11.5px;font-family:Courier New,monospace;letter-spacing:0.03em;">${secondRowRef}</td>
        </tr>
      </tbody>
    </table>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice &#8211; ${payment.payment_reference || ""}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #0f172a; background: #fff; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 0; }
}
</style>
</head>
<body>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#0f172a;max-width:780px;margin:0 auto;padding:32px 36px;">

  <!-- Header: company left, INVOICE right -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
    <tr>
      <td style="vertical-align:top;width:55%;">
        ${logoHtml}
        <div style="margin-top:6px;font-size:11px;color:#64748b;line-height:1.6;">
          ${co.address || ""}<br/>
          ${co.website_url || ""} &nbsp;|&nbsp; ${co.support_email || ""}<br/>
          ${co.phone_number || ""}
        </div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-1px;margin-bottom:8px;">TAX INVOICE</div>
        <table style="border-collapse:collapse;margin-left:auto;font-size:11.5px;">
          ${invoiceNumDisplay ? `<tr>
            <td style="padding:3px 0;color:#64748b;padding-right:12px;">Invoice No.</td>
            <td style="padding:3px 0;font-weight:700;font-family:Courier New,monospace;">${invoiceNumDisplay}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:3px 0;color:#64748b;padding-right:12px;">Order No.</td>
            <td style="padding:3px 0;font-weight:700;font-family:Courier New,monospace;">${payment.payment_reference || "&#8212;"}</td>
          </tr>
          <tr>
            <td style="padding:3px 0;color:#64748b;padding-right:12px;">Invoice Date</td>
            <td style="padding:3px 0;">${fmtDate(payment.created_at)}</td>
          </tr>
          ${payment.completed_at ? `<tr><td style="padding:3px 0;color:#64748b;padding-right:12px;">Completed</td><td style="padding:3px 0;">${fmtDate(payment.completed_at)}</td></tr>` : ""}
          <tr>
            <td style="padding:3px 0;color:#64748b;padding-right:12px;">Status</td>
            <td style="padding:3px 0;"><span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:10.5px;font-weight:700;background:${statusBg};color:${statusColor};">${statusLabel}</span></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Divider -->
  <div style="border-top:2px solid #0f172a;margin-bottom:24px;"></div>

  <!-- Bill From / Bill To -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr>
      <td style="vertical-align:top;width:50%;padding-right:16px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:6px;">Bill From</div>
        <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${coName}</div>
        <div style="font-size:11.5px;color:#475569;line-height:1.7;">
          GST: ${co.gst_number || ""}<br/>
          PAN: ${co.pan || ""}<br/>
          CIN: ${co.cin || ""}
        </div>
      </td>
      <td style="vertical-align:top;padding-left:16px;border-left:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:6px;">Bill To (Payer)</div>
        ${businessKycVerified && bizKyc?.business_name
          ? `<div style="font-weight:700;font-size:13px;margin-bottom:2px;">${bizKyc.business_name}</div>` : ""}
        <div style="font-weight:${businessKycVerified ? "600" : "700"};font-size:${businessKycVerified ? "12" : "13"}px;margin-bottom:4px;">${payment.sender_name || "&#8212;"}</div>
        <div style="font-size:11.5px;color:#475569;line-height:1.7;">
          ${businessKycVerified && bizKyc?.business_address ? `${bizKyc.business_address}<br/>` : ""}
          ${!businessKycVerified && senderAddress ? `${senderAddress}<br/>` : ""}
          ${businessKycVerified && bizKyc?.business_pan ? `Company PAN: ${bizKyc.business_pan}<br/>` : ""}
          ${businessKycVerified && bizKyc?.gst_number ? `GST: ${bizKyc.gst_number}<br/>` : ""}
          ${!businessKycVerified && senderPan ? `PAN: ${senderPan}<br/>` : ""}
          ${payment.sender_email ? `Email: ${payment.sender_email}<br/>` : ""}
          ${payment.sender_mobile ? `Mobile: ${payment.sender_mobile}` : ""}
        </div>
      </td>
    </tr>
  </table>

  <!-- Transaction Details + Beneficiary (side by side) -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <tr>
      <td style="vertical-align:top;width:58%;padding-right:16px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;">Transaction Details</div>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:6px;overflow:hidden;">
          ${row("Category", categoryName)}
          ${settlementLabel ? row("Transaction Settlement Time", settlementLabel) : ""}
          ${row("Payment Option", option)}
          ${row("Gateway", gatewayName || "&#8212;")}
          ${payment.gateway_transaction_id ? row("Gateway Tx ID", payment.gateway_transaction_id, true) : ""}
          ${payment.gateway_environment ? row("Environment", payment.gateway_environment.charAt(0).toUpperCase() + payment.gateway_environment.slice(1)) : ""}
        </table>
      </td>
      <td style="vertical-align:top;padding-left:16px;border-left:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;">Beneficiary Details</div>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:6px;overflow:hidden;">
          ${row("Name", escHtml(bene.full_name) || "&#8212;", false, true)}
          ${row("PAN Number", receiverPan || "&#8212;", true)}
          ${row("Bank", escHtml(bene.bank_name) || "&#8212;")}
          ${row("Account No.", escHtml(String(bene.bank_account || "")) || "&#8212;", true)}
          ${row("IFSC Code", escHtml(String(bene.ifsc || "")) || "&#8212;", true)}
          ${bene.city ? row("City", bene.city) : ""}
        </table>
      </td>
    </tr>
  </table>

  <!-- Amount Breakdown -->
  <div style="margin-bottom:24px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;">Amount Breakdown</div>
    <table style="width:100%;border-collapse:collapse;background:#f8fafc;">
      <thead>
        <tr style="background:#e2e8f0;">
          <th style="padding:7px 8px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#475569;">Description</th>
          <th style="padding:7px 8px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#475569;">Amount (INR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:7px 8px;font-size:12px;border-bottom:1px solid #e2e8f0;">
            Platform Fees &#8212; ${categoryName} &nbsp;<span style="font-size:10px;color:#64748b;font-weight:normal;">HSN/SAC: 998399</span><br/>
            <span style="font-size:10.5px;color:#64748b;">To: ${escHtml(bene.full_name) || "&#8212;"} &middot; ${escHtml(String(bene.bank_account || ""))} &middot; ${escHtml(String(bene.ifsc || ""))}</span><br/>
            <span style="font-size:10.5px;color:#64748b;">Amount: &#8377;${fmt(baseAmt)}</span>
          </td>
          <td style="padding:7px 8px;text-align:right;font-size:12px;border-bottom:1px solid #e2e8f0;">&#8377;${fmt(charges)}</td>
        </tr>
        ${isMH ? `<tr>
          <td style="padding:7px 8px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">CGST (9%)</td>
          <td style="padding:7px 8px;text-align:right;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">&#8377;${fmt(cgst)}</td>
        </tr>
        <tr>
          <td style="padding:7px 8px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">SGST (9%)</td>
          <td style="padding:7px 8px;text-align:right;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">&#8377;${fmt(sgst)}</td>
        </tr>` : `<tr>
          <td style="padding:7px 8px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">IGST (18%)</td>
          <td style="padding:7px 8px;text-align:right;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">&#8377;${fmt(igst)}</td>
        </tr>`}
        <tr style="background:#0f172a;">
          <td style="padding:10px 8px;font-size:13px;font-weight:700;color:#fff;">TOTAL CHARGED</td>
          <td style="padding:10px 8px;text-align:right;font-size:16px;font-weight:800;color:#fff;">&#8377;${fmt(totalCharged)}</td>
        </tr>
        ${isRefund ? `<tr style="background:#fff7ed;">
          <td style="padding:8px 8px;font-size:12px;font-weight:700;color:#9a3412;border-top:1px solid #fed7aa;">Refund Amount</td>
          <td style="padding:8px 8px;text-align:right;font-size:12px;font-weight:700;color:#9a3412;border-top:1px solid #fed7aa;">&#8377;${fmt(baseAmt)}</td>
        </tr>` : ""}
      </tbody>
    </table>
  </div>

  ${additionalSection}

  <!-- Footer -->
  <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:8px;display:table;width:100%;">
    <div style="display:table-cell;vertical-align:bottom;">
      <div style="font-size:10.5px;color:#94a3b8;line-height:1.6;">
        This is a computer-generated invoice. No signature required.<br/>
        For queries: ${co.support_email || ""} &nbsp;|&nbsp; ${co.phone_number || ""}
      </div>
    </div>
    <div style="display:table-cell;vertical-align:bottom;text-align:right;">
      <div style="font-size:10px;color:#cbd5e1;">
        Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { payment_id, invoice_type } = await req.json();

    if (!payment_id) {
      return new Response(
        JSON.stringify({ success: false, error: "payment_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const isRefund = (invoice_type || "settlement") === "refund";

    const { data: payment } = await supabase
      .from("payments")
      .select("*, payment_gateway_settings(gateway_name)")
      .eq("id", payment_id)
      .maybeSingle();

    if (!payment) {
      return new Response(
        JSON.stringify({ success: false, error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = payment.user_id;
    const beneficiaryId = payment.beneficiary_id;

    const [userRes, panRes, bizRes, addrRes, payoutRes, beneRes, merchantRes, companyRes] = await Promise.all([
      supabase.from("users").select("first_name, last_name, email, mobile_number").eq("id", userId).maybeSingle(),
      supabase.from("kyc_pan_verification").select("pan_number").eq("user_id", userId).eq("status", "verified").maybeSingle(),
      supabase.from("kyc_business_info").select("business_name, business_pan, gst_number, business_address, status").eq("user_id", userId).maybeSingle(),
      supabase.from("kyc_address_proof").select("address, city, state, pincode").eq("user_id", userId).eq("status", "verified").maybeSingle(),
      supabase.from("payouts").select("status, transfer_type, payout_reference, utr_number, completed_at, payout_date, payout_reference_number, payout_confirmed_amount").eq("payment_id", payment_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      beneficiaryId ? supabase.from("beneficiaries").select("pan_number").eq("id", beneficiaryId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("merchant_onboarding").select("pan_number").eq("payment_id", payment_id).neq("pan_number", "").limit(1).maybeSingle(),
      supabase.from("master_settings").select("company_name, address, cin, gst_number, pan, company_logo_url, website_url, support_email, phone_number").limit(1).maybeSingle(),
    ]);

    const user = userRes.data;
    const senderPan: string | null = panRes.data?.pan_number ?? null;
    const bizKyc = bizRes.data;
    const addrData = addrRes.data;
    const senderAddress = addrData
      ? [addrData.address, addrData.city, addrData.state, addrData.pincode].filter(Boolean).join(", ")
      : null;
    const payout = payoutRes.data;
    const receiverPan: string | null = beneRes.data?.pan_number || merchantRes.data?.pan_number || null;

    const co = {
      company_name: "PayByCard Technologies Private Limited",
      address: "3701, IRIS, Runwal Bliss, Crompton Greaves Compound, Kanjur Marg East, Mumbai, Maharashtra, India 400 042.",
      gst_number: "27AAQCP4546F1Z2",
      pan: "AAQCP4546F",
      cin: "U62099MH2025PTC462923",
      support_email: "support@paybycard.in",
      phone_number: "+918850144143",
      website_url: "https://paybycard.in",
      company_logo_url: null as string | null,
      ...((companyRes.data) || {}),
    };

    // Embed logo as data URL so it renders in email clients and offline HTML
    const logoDataUrl = await fetchLogoAsDataUrl(supabase, co.company_logo_url);

    const enrichedPayment = {
      ...payment,
      sender_name: user ? `${user.first_name || ""} ${user.last_name || ""}`.trim() : "Customer",
      sender_email: user?.email || null,
      sender_mobile: user?.mobile_number || null,
    };

    const html = buildHtml(enrichedPayment, co, isRefund, payout, senderPan, senderAddress, bizKyc, receiverPan, logoDataUrl);

    const encoder = new TextEncoder();
    const bytes = encoder.encode(html);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const html_base64 = btoa(binary);

    return new Response(
      // Return both names — html_base64 is canonical; pdf_base64 is an alias for callers that haven't migrated
      JSON.stringify({ success: true, html_base64, pdf_base64: html_base64 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("generate-invoice-html error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
