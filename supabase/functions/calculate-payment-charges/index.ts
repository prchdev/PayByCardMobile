import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { amount, categoryId, gatewayId, isBusiness = false, userId } = await req.json();

    if (!amount || !categoryId || !gatewayId) {
      return new Response(
        JSON.stringify({ error: "Amount, category ID, and gateway ID are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const paymentAmount = parseFloat(amount);
    if (paymentAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Amount must be greater than 0" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: limits } = await supabase
      .from("payment_limits")
      .select("minimum_amount, maximum_amount")
      .maybeSingle();

    if (limits) {
      if (paymentAmount < parseFloat(limits.minimum_amount)) {
        return new Response(
          JSON.stringify({ error: `Amount must be at least ₹${limits.minimum_amount}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (paymentAmount > parseFloat(limits.maximum_amount)) {
        return new Response(
          JSON.stringify({ error: `Amount cannot exceed ₹${limits.maximum_amount}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: gateway, error: gatewayError } = await supabase
      .from("payment_gateway_settings")
      .select("id, gateway_name, registered_name, gst_number, gst_percentage, payout_mode, visa_charges, mastercard_charges, rupay_charges, amex_charges, diners_charges")
      .eq("id", gatewayId)
      .eq("is_enabled", true)
      .maybeSingle();

    if (gatewayError || !gateway) {
      return new Response(
        JSON.stringify({ error: "Payment gateway not found or inactive" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: category, error: categoryError } = await supabase
      .from("payment_options")
      .select("*")
      .eq("id", categoryId)
      .eq("is_enabled", true)
      .maybeSingle();

    if (categoryError || !category) {
      return new Response(
        JSON.stringify({ error: "Payment category not found or inactive" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Base charges percentage — apply discount if available
    let baseChargesPercentage = parseFloat(category.charges_percentage || 0);
    let discount = 0;
    let discountApplied = false;

    if (category.show_discount && category.discounted_charges_percentage !== null) {
      const normal = (paymentAmount * baseChargesPercentage) / 100;
      const discounted = (paymentAmount * parseFloat(category.discounted_charges_percentage)) / 100;
      discount = normal - discounted;
      discountApplied = true;
      baseChargesPercentage = parseFloat(category.discounted_charges_percentage);
    }

    // Surge charge: look up per-user surge charge from kyc_business_info
    let surchargePercentage = 0;
    if (userId) {
      const { data: kycBusiness } = await supabase
        .from("kyc_business_info")
        .select("business_category_surge_charge")
        .eq("user_id", userId)
        .maybeSingle();
      surchargePercentage = parseFloat(kycBusiness?.business_category_surge_charge || 0);
    }
    const effectiveChargesPercentage = baseChargesPercentage + surchargePercentage;

    const charges = (paymentAmount * effectiveChargesPercentage) / 100;
    const gst = (charges * parseFloat(category.gst_percentage || 0) / 100);
    const totalAmount = paymentAmount + charges + gst;

    const gatewayChargesInfo = {
      visa: parseFloat(gateway.visa_charges || 0),
      mastercard: parseFloat(gateway.mastercard_charges || 0),
      rupay: parseFloat(gateway.rupay_charges || 0),
      amex: parseFloat(gateway.amex_charges || 0),
      diners: parseFloat(gateway.diners_charges || 0),
      gst_percentage: parseFloat(gateway.gst_percentage || 18),
    };

    return new Response(
      JSON.stringify({
        amount: paymentAmount,
        charges: charges.toFixed(2),
        gst: gst.toFixed(2),
        discount: discount.toFixed(2),
        discountApplied,
        totalAmount: totalAmount.toFixed(2),
        isBusiness,
        baseChargesPercentage,
        surchargePercentage,
        effectiveChargesPercentage,
        category: {
          id: category.id,
          name: category.category_name,
          gstPercentage: parseFloat(category.gst_percentage || 0),
          receiverKycRequired: category.receiver_kyc_required || false,
        },
        gateway: {
          id: gateway.id,
          name: gateway.gateway_name,
          registeredName: gateway.registered_name || '',
          gstNumber: gateway.gst_number || '',
          payoutMode: gateway.payout_mode || 'manual',
          chargesInfo: gatewayChargesInfo,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Exception in calculate-payment-charges:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
