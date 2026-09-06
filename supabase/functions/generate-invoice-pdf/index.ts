import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

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

function fmtAmt(n: number | string | null | undefined): string {
  return parseFloat(String(n || 0)).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function trunc(s: string | null | undefined, max: number): string {
  const str = String(s || "");
  return str.length > max ? str.slice(0, max) + "..." : str || "—";
}

function safeText(text: string | null | undefined): string {
  return String(text || "")
    .replace(/₹/g, "Rs. ")
    .replace(/[^\x00-\x7F]/g, "?");
}

async function buildInvoicePdf(d: Record<string, any>): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const pg = pdfDoc.addPage([595.28, 841.89]);
  const W = 595.28, H = 841.89;

  const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bld = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const ML = 50, RX = W - 50, CW = RX - ML;
  const isRefund = d.invoice_type === "refund";

  // ── colour palette ─────────────────────────────────────────────────────────
  const DARK       = rgb(0.059, 0.090, 0.161);
  const GRAY       = rgb(0.392, 0.455, 0.545);
  const LGRAY      = rgb(0.886, 0.898, 0.914);
  const BGFAINT    = rgb(0.973, 0.980, 0.992);
  const WHITE      = rgb(1, 1, 1);
  const C_STATUS   = isRefund ? rgb(0.914, 0.353, 0.078) : rgb(0.086, 0.627, 0.310);
  const C_STATUS_BG = isRefund ? rgb(1.0, 0.929, 0.902) : rgb(0.941, 0.996, 0.957);
  const C_POUT_BG  = rgb(0.941, 0.996, 0.957);
  const C_POUT_BD  = rgb(0.733, 0.969, 0.820);
  const TOT_BG     = rgb(0.059, 0.090, 0.161);

  // ── helpers ────────────────────────────────────────────────────────────────
  // pdf-lib origin is bottom-left. topY = distance from top of page.
  const R = (x: number, topY: number, w: number, h: number, fill: any, stroke?: any) =>
    pg.drawRectangle({ x, y: H - topY - h, width: w, height: h, color: fill,
      ...(stroke ? { borderColor: stroke, borderWidth: 0.5 } : {}) });

  const T = (text: string | null | undefined, x: number, baselineFromTop: number, sz: number,
    f = reg, col = DARK) => {
    const s = safeText(text);
    if (s.trim()) pg.drawText(s, { x, y: H - baselineFromTop, size: sz, font: f, color: col });
  };

  const L = (x1: number, y1: number, x2: number, y2: number, thick = 0.5, col = LGRAY) =>
    pg.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: thick, color: col });

  const TW = (text: string | null | undefined, sz: number, f = reg) =>
    f.widthOfTextAtSize(safeText(text), sz);

  // ── company / invoice data ─────────────────────────────────────────────────
  const coName  = d._company_name  || "PayByCard Technologies Pvt Ltd";
  const coAddr  = d._company_address || "";
  const coWeb   = d._company_website || "paybycard.in";
  const coMail  = d._company_email  || "support@paybycard.in";
  const coPhone = d._company_phone  || "";
  const coGst   = d._company_gst   || "";
  const coPan   = d._company_pan   || "";
  const coCin   = d._company_cin   || "";

  const invYear = d.invoice_year || new Date().getFullYear();
  const invoiceNumDisplay = d.invoice_number ? `PAY-${invYear}-${d.invoice_number}` : null;

  let y = 50; // current Y from top of page

  // ── HEADER: company info (left) + INVOICE title (right) ───────────────────
  T(coName, ML, y + 13, 13, bld);
  y += 18;
  if (coAddr) { T(trunc(coAddr, 70), ML, y + 9, 8, reg, GRAY); y += 12; }
  T(`${coWeb}  |  ${coMail}`, ML, y + 9, 8, reg, GRAY);
  y += 12;
  if (coPhone) { T(coPhone, ML, y + 9, 8, reg, GRAY); y += 12; }

  // TAX INVOICE on right
  const invTitleSz = 22;
  T("TAX INVOICE", RX - TW("TAX INVOICE", invTitleSz, bld), 50 + invTitleSz - 2, invTitleSz, bld);

  // Meta rows on right
  let ry = 50 + invTitleSz + 4;
  const metaRows: [string, string][] = [];
  if (invoiceNumDisplay) metaRows.push(["Invoice No.", invoiceNumDisplay]);
  metaRows.push(["Order No.", d.payment_reference || "—"]);
  metaRows.push(["Invoice Date", d.date || "—"]);
  if (d.completed_at) metaRows.push(["Completed", fmtDate(d.completed_at)]);
  for (const [lbl, val] of metaRows) {
    T(lbl, RX - 220, ry + 8, 8, reg, GRAY);
    T(val, RX - TW(val, 8, bld), ry + 8, 8, bld);
    ry += 13;
  }

  // Status badge
  const statusLabel = isRefund ? "Refunded" : "Completed";
  const sbW = TW(statusLabel, 8, bld) + 16;
  R(RX - sbW, ry + 2, sbW, 14, C_STATUS_BG);
  T(statusLabel, RX - sbW + 8, ry + 12, 8, bld, C_STATUS);
  ry += 20;

  y = Math.max(y, ry) + 8;

  // ── DIVIDER ────────────────────────────────────────────────────────────────
  R(ML, y, CW, 2, DARK);
  y += 14;

  // ── BILL FROM / BILL TO ───────────────────────────────────────────────────
  const COL2 = CW / 2;
  T("BILL FROM", ML, y + 8, 7, bld, GRAY);
  T("BILL TO (PAYER)", ML + COL2 + 16, y + 8, 7, bld, GRAY);
  y += 14;

  let fromY = y;
  T(coName, ML, fromY + 10, 10, bld);
  fromY += 14;
  if (coGst) { T(`GST: ${coGst}`, ML, fromY + 9, 8, reg, GRAY); fromY += 12; }
  if (coPan) { T(`PAN: ${coPan}`, ML, fromY + 9, 8, reg, GRAY); fromY += 12; }
  if (coCin) { T(`CIN: ${coCin}`, ML, fromY + 9, 8, reg, GRAY); fromY += 12; }

  let toY = y;
  const toX = ML + COL2 + 16;
  if (d.business_kyc_verified && d.company_name) {
    T(trunc(d.company_name, 32), toX, toY + 10, 10, bld);
    toY += 14;
  }
  const snSz = d.business_kyc_verified ? 9 : 10;
  T(trunc(d.sender_name || "—", 32), toX, toY + snSz, snSz, d.business_kyc_verified ? reg : bld);
  toY += snSz + 4;

  const billToLines: string[] = [];
  if (d.business_kyc_verified && d.company_address) billToLines.push(trunc(d.company_address, 38));
  else if (d.sender_address) billToLines.push(trunc(d.sender_address, 38));
  if (d.business_kyc_verified && d.company_pan) billToLines.push(`Company PAN: ${d.company_pan}`);
  if (d.business_kyc_verified && d.company_gst) billToLines.push(`GST: ${d.company_gst}`);
  if (!d.business_kyc_verified && d.sender_pan) billToLines.push(`PAN: ${d.sender_pan}`);
  if (d.sender_email) billToLines.push(`Email: ${d.sender_email}`);
  if (d.sender_mobile) billToLines.push(`Mobile: ${d.sender_mobile}`);
  for (const line of billToLines) {
    T(line, toX, toY + 9, 8, reg, GRAY);
    toY += 12;
  }

  const colDivTop = y - 4;
  const colDivBot = Math.max(fromY, toY) + 4;
  L(ML + COL2, colDivTop, ML + COL2, colDivBot, 0.5, LGRAY);
  y = colDivBot + 14;

  // ── TRANSACTION DETAILS / BENEFICIARY (2 columns) ─────────────────────────
  T("TRANSACTION DETAILS", ML, y + 8, 7, bld, GRAY);
  T("BENEFICIARY DETAILS", ML + COL2 + 16, y + 8, 7, bld, GRAY);
  y += 14;

  const txRows: [string, string][] = [
    ["Category", trunc(d.category_name || "—", 24)],
  ];
  if (d.settlement_time) txRows.push(["Settlement Time", d.settlement_time]);
  txRows.push(["Payment Option", trunc(d.payment_option || "—", 22)]);
  txRows.push(["Gateway", trunc(d.gateway_name || "—", 22)]);
  if (d.gateway_tx_id) txRows.push(["Gateway Tx ID", trunc(d.gateway_tx_id, 18)]);
  if (d.environment) txRows.push(["Environment",
    d.environment.charAt(0).toUpperCase() + d.environment.slice(1)]);

  const bnRows: [string, string, boolean][] = [
    ["Name", trunc(d.receiver_name || "—", 22), true],
    ["PAN Number", d.receiver_pan || "—", false],
  ];
  bnRows.push(["Bank", trunc(d.receiver_bank || "—", 22), false]);
  bnRows.push(["Account No.", trunc(d.receiver_account || "—", 20), false]);
  bnRows.push(["IFSC Code", trunc(d.receiver_ifsc || "—", 16), false]);

  const RH = 16;
  const txTableH = Math.max(txRows.length, bnRows.length) * RH;

  R(ML, y, COL2 - 4, txTableH, BGFAINT);
  R(ML + COL2 + 4, y, COL2 - 4, txTableH, BGFAINT);

  for (let i = 0; i < txRows.length; i++) {
    const [lbl, val] = txRows[i];
    const base = y + i * RH + RH - 4;
    T(lbl, ML + 6, base, 8, reg, GRAY);
    T(val, ML + COL2 - TW(val, 8) - 6, base, 8, reg, DARK);
    if (i < txRows.length - 1)
      L(ML, y + (i + 1) * RH, ML + COL2 - 4, y + (i + 1) * RH, 0.4, rgb(0.94, 0.95, 0.97));
  }

  for (let i = 0; i < bnRows.length; i++) {
    const [lbl, val, isBold] = bnRows[i];
    const base = y + i * RH + RH - 4;
    const f2 = isBold ? bld : reg;
    T(lbl, ML + COL2 + 10, base, 8, reg, GRAY);
    T(val, RX - TW(val, 8, f2) - 4, base, 8, f2, DARK);
    if (i < bnRows.length - 1)
      L(ML + COL2 + 4, y + (i + 1) * RH, RX, y + (i + 1) * RH, 0.4, rgb(0.94, 0.95, 0.97));
  }

  L(ML + COL2, y, ML + COL2, y + txTableH, 0.5, LGRAY);
  y += txTableH + 16;

  // ── AMOUNT BREAKDOWN ──────────────────────────────────────────────────────
  T("AMOUNT BREAKDOWN", ML, y + 8, 7, bld, GRAY);
  y += 14;

  const baseAmt  = parseFloat(String(d.amount || 0));
  const charges  = parseFloat(String(d.charges || 0));
  const gst      = parseFloat(String(d.gst || 0));
  const cgst     = gst / 2;
  const sgst     = gst / 2;
  const igst     = gst;
  const total    = parseFloat(String(d.total_amount || baseAmt));

  // Determine if payer is in Maharashtra for SGST vs IGST
  const payerStateRaw = d.business_kyc_verified
    ? (d.company_address || d.sender_address || "")
    : (d.sender_address || "");
  const isMH = isMaharashtraState(
    payerStateRaw.match(/\b(Maharashtra|MH)\b/i)?.[0]
  );

  // Table header row
  R(ML, y, CW, 18, rgb(0.886, 0.898, 0.914));
  T("Description", ML + 8, y + 13, 8, bld, GRAY);
  T("Amount (INR)", RX - TW("Amount (INR)", 8, bld) - 8, y + 13, 8, bld, GRAY);
  y += 18;

  // Description line 1: Platform Fees + sub-lines for beneficiary and transfer amount
  const tranDesc = `Platform Fees - ${d.category_name || "Service"}`;
  const tranSub  = `To: ${d.receiver_name || "—"} · ${trunc(d.receiver_account || "", 16)} · ${d.receiver_ifsc || ""}`;
  const tranAmtLine = `Amount: Rs. ${fmtAmt(baseAmt)}`;
  const tranVal  = `Rs. ${fmtAmt(charges)}`;
  R(ML, y, CW, 32, BGFAINT);
  L(ML, y + 32, RX, y + 32, 0.5, LGRAY);
  T(trunc(tranDesc, 55), ML + 8, y + 12, 9, reg, DARK);
  T(trunc(tranSub, 65), ML + 8, y + 21, 7.5, reg, GRAY);
  T(trunc(tranAmtLine, 45), ML + 8, y + 29, 7.5, reg, GRAY);
  T(tranVal, RX - TW(tranVal, 9) - 8, y + 12, 9, reg, GRAY);
  y += 32;

  const simpleRows = isMH
    ? [["CGST (9%)", `Rs. ${fmtAmt(cgst)}`], ["SGST (9%)", `Rs. ${fmtAmt(sgst)}`]]
    : [["IGST (18%)", `Rs. ${fmtAmt(igst)}`]];
  for (const [desc, val] of simpleRows) {
    R(ML, y, CW, 16, BGFAINT);
    L(ML, y + 16, RX, y + 16, 0.5, LGRAY);
    T(desc, ML + 8, y + 12, 9, reg, DARK);
    T(val, RX - TW(val, 9) - 8, y + 12, 9, reg, GRAY);
    y += 16;
  }

  // Total row
  const totalCharged = charges + gst;
  const totalStr = `Rs. ${fmtAmt(totalCharged)}`;
  R(ML, y, CW, 22, TOT_BG);
  T("TOTAL CHARGED", ML + 8, y + 16, 11, bld, WHITE);
  T(totalStr, RX - TW(totalStr, 13, bld) - 8, y + 16, 13, bld, WHITE);
  y += 22;

  if (isRefund) {
    const refStr = `Rs. ${fmtAmt(baseAmt)}`;
    R(ML, y, CW, 16, rgb(1.0, 0.929, 0.902));
    T("Refund Amount", ML + 8, y + 12, 9, bld, DARK);
    T(refStr, RX - TW(refStr, 9, bld) - 8, y + 12, 9, bld, DARK);
    y += 16;
  }

  y += 14;

  // ── PAYOUT / SETTLEMENT ───────────────────────────────────────────────────
  const hasPayoutInfo = d.payout_status || d.utr_number || d.payout_reference ||
                        d.payout_date || d.refund_date || d.gateway_ref;
  if (hasPayoutInfo) {
    T("PAYOUT / SETTLEMENT DETAILS", ML, y + 8, 7, bld, GRAY);
    y += 14;

    const ptRows: [string, string, boolean][] = [];
    if (d.payout_status)    ptRows.push(["Payout Status",         d.payout_status,                         false]);
    if (d.gateway_ref)      ptRows.push(["Gateway Transaction Ref", trunc(d.gateway_ref, 30),              false]);
    if (d.utr_number)       ptRows.push(["UTR / Reference",        trunc(d.utr_number, 30),                false]);
    if (d.payout_reference) ptRows.push(["Payout Reference",       trunc(d.payout_reference, 30),          false]);
    if (d.payout_date && !isRefund) ptRows.push(["Payout Date", d.payout_date,                             false]);
    if (d.refund_date && isRefund)  ptRows.push(["Refund Date & Time", d.refund_date,                      false]);
    if (d.payout_confirmed_amount != null)
      ptRows.push(["Confirmed Amount", `Rs. ${fmtAmt(d.payout_confirmed_amount)}`,                         true]);
    if (isRefund) ptRows.push(["Refund Amount", `Rs. ${fmtAmt(baseAmt)}`,                                  true]);

    const ptH = ptRows.length * 16;
    R(ML, y, CW, ptH, C_POUT_BG, C_POUT_BD);
    for (let i = 0; i < ptRows.length; i++) {
      const [lbl, val, isBold] = ptRows[i];
      const base = y + i * 16 + 12;
      T(lbl, ML + 8, base, 8, reg, GRAY);
      T(val, RX - TW(val, 8, isBold ? bld : reg) - 8, base, 8, isBold ? bld : reg, DARK);
      if (i < ptRows.length - 1) L(ML, y + (i + 1) * 16, RX, y + (i + 1) * 16, 0.5, C_POUT_BD);
    }
    y += ptH + 14;
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  L(ML, y, RX, y, 0.5, LGRAY);
  y += 10;
  T("This is a computer-generated invoice. No signature required.", ML, y + 8, 7.5, reg, GRAY);
  y += 12;
  T(`For queries: ${coMail}${coPhone ? "  |  " + coPhone : ""}`, ML, y + 8, 7.5, reg, GRAY);
  const genStr = `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
  T(genStr, RX - TW(genStr, 7), y + 8, 7, reg, rgb(0.78, 0.82, 0.87));

  return pdfDoc.save();
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (!body.payment_id) {
      return new Response(
        JSON.stringify({ success: false, error: "payment_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const isRefund = (body.invoice_type || "settlement") === "refund";

    // Fetch payment + gateway name
    const { data: payment } = await supabase
      .from("payments")
      .select("*, payment_gateway_settings(gateway_name)")
      .eq("id", body.payment_id)
      .maybeSingle();

    if (!payment) {
      return new Response(
        JSON.stringify({ success: false, error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const [userRes, panRes, bizRes, addrRes, payoutRes, beneRes, merchantRes, companyRes] = await Promise.all([
      supabase.from("users").select("first_name, last_name, middle_name, email, mobile_number").eq("id", payment.user_id).maybeSingle(),
      supabase.from("kyc_pan_verification").select("pan_number").eq("user_id", payment.user_id).eq("status", "verified").maybeSingle(),
      supabase.from("kyc_business_info").select("company_name, company_pan, gst_number, address, status").eq("user_id", payment.user_id).eq("status", "approved").maybeSingle(),
      supabase.from("kyc_address_proof").select("address, city, state, pincode").eq("user_id", payment.user_id).eq("status", "verified").maybeSingle(),
      supabase.from("payouts").select("status, payout_reference, utr_number, completed_at, payout_date, payout_reference_number, payout_confirmed_amount").eq("payment_id", payment.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      payment.beneficiary_id ? supabase.from("beneficiaries").select("pan_number").eq("id", payment.beneficiary_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("merchant_onboarding").select("pan_number").eq("payment_id", payment.id).neq("pan_number", "").limit(1).maybeSingle(),
      supabase.from("master_settings").select("company_name, address, cin, gst_number, pan, company_logo_url, website_url, support_email, phone_number").limit(1).maybeSingle(),
    ]);

    const user   = userRes.data;
    const biz    = bizRes.data;
    const addr   = addrRes.data;
    const payout = payoutRes.data;
    const co     = companyRes.data;

    const senderName = user
      ? [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(" ").trim()
      : "Customer";

    const senderAddress = addr
      ? [addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ")
      : null;

    const bene = payment.beneficiary_details || {};

    const settlementTime = (() => {
      const s = (payment.category_details?.settlement_time || "").toUpperCase();
      if (s === "INSTANT" || s === "T+0") return "Instant Settlement";
      if (s === "T+1") return "Transaction + 1 Day";
      if (s === "T+2") return "Transaction + 2 Days";
      return payment.category_details?.settlement_time || null;
    })();

    const payoutDate = payout?.payout_date
      ? new Date(payout.payout_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
      : (payout?.completed_at && !isRefund ? fmtDate(payout.completed_at) : null);

    const refundDate = isRefund && payout?.completed_at ? fmtDate(payout.completed_at) : null;

    const data: Record<string, any> = {
      invoice_type: body.invoice_type || "settlement",
      // Company info
      _company_name:    co?.company_name    || "PayByCard Technologies Private Limited",
      _company_address: co?.address         || "3701, IRIS, Runwal Bliss, Crompton Greaves Compound, Kanjur Marg East, Mumbai, Maharashtra, India 400 042.",
      _company_website: co?.website_url     || "paybycard.in",
      _company_email:   co?.support_email   || "support@paybycard.in",
      _company_phone:   co?.phone_number    || "+918850144143",
      _company_gst:     co?.gst_number      || "27AAQCP4546F1Z2",
      _company_pan:     co?.pan             || "AAQCP4546F",
      _company_cin:     co?.cin             || "U62099MH2025PTC462923",
      // Invoice meta
      payment_reference: payment.payment_reference,
      invoice_number:    payment.invoice_number ?? null,
      invoice_year:      new Date(payment.completed_at || payment.created_at).getFullYear(),
      date:              fmtDate(payment.created_at),
      completed_at:      payment.completed_at,
      // Sender
      sender_name:         senderName,
      sender_email:        user?.email         || null,
      sender_mobile:       user?.mobile_number || null,
      sender_pan:          panRes.data?.pan_number || null,
      sender_address:      senderAddress,
      business_kyc_verified: !!(biz?.company_name),
      company_name:        biz?.company_name  || null,
      company_pan:         biz?.company_pan   || null,
      company_gst:         biz?.gst_number    || null,
      company_address:     biz?.address       || null,
      // Beneficiary
      receiver_name:    bene.full_name    || "—",
      receiver_pan:     beneRes.data?.pan_number || merchantRes.data?.pan_number || null,
      receiver_bank:    bene.bank_name    || "—",
      receiver_account: bene.bank_account || "—",
      receiver_ifsc:    bene.ifsc         || "—",
      // Payment details
      category_name:  payment.category_details?.category_name || null,
      settlement_time: settlementTime,
      payment_option: payment.selected_payment_option?.card_type || payment.card_type || null,
      gateway_name:   payment.payment_gateway_settings?.gateway_name || null,
      gateway_tx_id:  payment.gateway_transaction_id || null,
      environment:    payment.gateway_environment || null,
      // Amounts
      amount:       payment.amount,
      charges:      payment.charges || 0,
      gst:          payment.gst     || 0,
      total_amount: payment.total_amount || payment.amount,
      // Payout
      payout_status:           payout?.status          || null,
      gateway_ref:             payment.gateway_transaction_id || payment.payment_reference || null,
      utr_number:              payout?.utr_number || payout?.payout_reference_number || null,
      payout_reference:        payout?.payout_reference || null,
      payout_date:             payoutDate,
      payout_confirmed_amount: payout?.payout_confirmed_amount ?? null,
      refund_date:             refundDate,
    };

    const pdfBytes = await buildInvoicePdf(data);

    let binary = "";
    for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
    const pdf_base64 = btoa(binary);

    return new Response(
      JSON.stringify({ success: true, pdf_base64 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("generate-invoice-pdf error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// redeploy
