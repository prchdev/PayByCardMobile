import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { withUserSession, isInternalCall, SESSION_HEADER } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-pbc-session",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId, couponCode, totalAmount } = await req.json();

    if (!couponCode || typeof couponCode !== "string") {
      return json({ valid: false, message: "Please enter a coupon code." }, 400);
    }

    const code = couponCode.trim().toUpperCase();
    if (code.length === 0) {
      return json({ valid: false, message: "Please enter a coupon code." }, 400);
    }

    if (!totalAmount || isNaN(parseFloat(totalAmount)) || parseFloat(totalAmount) <= 0) {
      return json({ valid: false, message: "Please enter a valid amount before applying a coupon." }, 400);
    }

    const paymentTotal = parseFloat(totalAmount);

    // Look up the coupon
    const { data: coupon, error: couponErr } = await supabase
      .from("coupons")
      .select("id, coupon_code, minimum_total, discount_type, discount_value, maximum_discount_value, per_account_limit, total_usage_limit, total_usage_count, start_date, end_date, is_active, is_deleted, applicable_to")
      .eq("coupon_code", code)
      .maybeSingle();

    if (couponErr || !coupon) {
      return json({ valid: false, message: "Invalid coupon code. Please check and try again." }, 400);
    }

    if (coupon.is_deleted || !coupon.is_active) {
      return json({ valid: false, message: "This coupon is no longer active." }, 400);
    }

    const today = new Date().toISOString().split("T")[0];
    if (today < coupon.start_date) {
      return json({ valid: false, message: `This coupon is not yet active. It will be available from ${coupon.start_date}.` }, 400);
    }
    if (today > coupon.end_date) {
      return json({ valid: false, message: "This coupon has expired." }, 400);
    }

    // Minimum total check
    const minTotal = parseFloat(coupon.minimum_total || 0);
    if (paymentTotal < minTotal) {
      return json({
        valid: false,
        message: `This coupon requires a minimum total of ₹${minTotal.toFixed(2)}. Your current total is ₹${paymentTotal.toFixed(2)}.`,
      }, 400);
    }

    // Total usage limit check
    if (coupon.total_usage_limit !== null && coupon.total_usage_count >= coupon.total_usage_limit) {
      return json({ valid: false, message: "This coupon has reached its maximum usage limit." }, 400);
    }

    // Per-account usage check
    if (userId) {
      const { count: userUsageCount } = await supabase
        .from("coupon_usages")
        .select("id", { count: "exact", head: true })
        .eq("coupon_id", coupon.id)
        .eq("user_id", userId);

      if ((userUsageCount || 0) >= coupon.per_account_limit) {
        return json({
          valid: false,
          message: `You have already used this coupon ${coupon.per_account_limit} time${coupon.per_account_limit > 1 ? "s" : ""}. The per-account limit has been reached.`,
        }, 400);
      }
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discount_type === "percentage") {
      discountAmount = (paymentTotal * parseFloat(coupon.discount_value)) / 100;
      if (coupon.maximum_discount_value !== null) {
        const maxDiscount = parseFloat(coupon.maximum_discount_value);
        if (discountAmount > maxDiscount) {
          discountAmount = maxDiscount;
        }
      }
    } else if (coupon.discount_type === "fixed") {
      discountAmount = parseFloat(coupon.discount_value);
    } else {
      return json({ valid: false, message: "Invalid coupon configuration." }, 400);
    }

    // Discount cannot exceed the total
    if (discountAmount > paymentTotal) {
      discountAmount = paymentTotal;
    }

    if (discountAmount <= 0) {
      return json({ valid: false, message: "This coupon does not provide any discount for this amount." }, 400);
    }

    const finalTotal = paymentTotal - discountAmount;

    return json({
      valid: true,
      couponId: coupon.id,
      couponCode: coupon.coupon_code,
      discountType: coupon.discount_type,
      discountValue: parseFloat(coupon.discount_value),
      maximumDiscountValue: coupon.maximum_discount_value !== null ? parseFloat(coupon.maximum_discount_value) : null,
      discountAmount: discountAmount.toFixed(2),
      originalTotal: paymentTotal.toFixed(2),
      finalTotal: finalTotal.toFixed(2),
      message: `Coupon applied successfully! You saved ₹${discountAmount.toFixed(2)}.`,
    });
  } catch (error) {
    console.error("Exception in validate-coupon:", error);
    return json({ valid: false, message: "An error occurred while validating the coupon. Please try again." }, 500);
  }
}

Deno.serve(withUserSession(handler));
