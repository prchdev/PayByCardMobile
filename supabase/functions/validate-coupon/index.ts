import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-pbc-session, x-pbc-admin-session",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId, couponCode, totalAmount } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ valid: false, error: "User ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!couponCode || typeof couponCode !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "Coupon code is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const parsedTotal = parseFloat(totalAmount);
    if (isNaN(parsedTotal) || parsedTotal <= 0) {
      return new Response(
        JSON.stringify({ valid: false, error: "Valid total amount is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const code = couponCode.trim().toUpperCase();

    const { data: coupon, error } = await supabase
      .from("coupons")
      .select("*")
      .eq("coupon_code", code)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) {
      console.error("validate-coupon DB error:", error);
      return new Response(
        JSON.stringify({ valid: false, error: "Unable to verify coupon. Please try again." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!coupon) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid coupon code. Please check and try again." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!coupon.is_active) {
      return new Response(
        JSON.stringify({ valid: false, error: "This coupon is currently disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(coupon.start_date);
    const endDate = new Date(coupon.end_date);
    endDate.setHours(23, 59, 59, 999);

    if (today < startDate) {
      return new Response(
        JSON.stringify({ valid: false, error: "This coupon is not yet active" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (today > endDate) {
      return new Response(
        JSON.stringify({ valid: false, error: "This coupon has expired" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (parsedTotal < parseFloat(coupon.minimum_total)) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: `Minimum transaction value of ₹${parseFloat(coupon.minimum_total)} is required for this coupon`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (coupon.total_usage_limit != null) {
      const { count } = await supabase
        .from("coupon_usages")
        .select("id", { count: "exact", head: true })
        .eq("coupon_id", coupon.id);

      if (count != null && count >= coupon.total_usage_limit) {
        return new Response(
          JSON.stringify({ valid: false, error: "This coupon has reached its total usage limit" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { count: userUsageCount } = await supabase
      .from("coupon_usages")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", coupon.id)
      .eq("user_id", userId);

    if (userUsageCount != null && userUsageCount >= coupon.per_account_limit) {
      return new Response(
        JSON.stringify({ valid: false, error: "You have already used this coupon the maximum number of times" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (coupon.applicable_to === "first_transaction" || coupon.applicable_to === "non_first_transaction") {
      const { count: paymentCount } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("status", ["completed", "settlement_pending", "kyc_pending"]);

      const hasPriorPayments = (paymentCount || 0) > 0;

      if (coupon.applicable_to === "first_transaction" && hasPriorPayments) {
        return new Response(
          JSON.stringify({ valid: false, error: "This coupon is only applicable on your first transaction" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (coupon.applicable_to === "non_first_transaction" && !hasPriorPayments) {
        return new Response(
          JSON.stringify({ valid: false, error: "This coupon is only applicable on non-first transactions" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let discountAmount = 0;
    if (coupon.discount_type === "flat") {
      discountAmount = parseFloat(coupon.discount_value);
    } else {
      const pct = parseFloat(coupon.discount_value);
      discountAmount = (parsedTotal * pct) / 100;
      if (coupon.maximum_discount_value != null) {
        const maxDisc = parseFloat(coupon.maximum_discount_value);
        if (discountAmount > maxDisc) {
          discountAmount = maxDisc;
        }
      }
    }

    if (discountAmount > parsedTotal) {
      discountAmount = parsedTotal;
    }

    const newTotal = parsedTotal - discountAmount;

    return new Response(
      JSON.stringify({
        valid: true,
        couponId: coupon.id,
        couponCode: coupon.coupon_code,
        discountType: coupon.discount_type,
        discountValue: parseFloat(coupon.discount_value),
        maximumDiscountValue: coupon.maximum_discount_value != null ? parseFloat(coupon.maximum_discount_value) : null,
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        newTotal: parseFloat(newTotal.toFixed(2)),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("validate-coupon error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
