import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: userData } = await supabase
      .from('users')
      .select('is_restricted')
      .eq('id', userId)
      .maybeSingle();

    const { data: panData, error: panError } = await supabase
      .from('kyc_pan_verification')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle();

    if (panError) {
      throw panError;
    }

    const { data: addressData, error: addressError } = await supabase
      .from('kyc_address_proof')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle();

    if (addressError) {
      throw addressError;
    }

    const { data: businessData, error: businessError } = await supabase
      .from('kyc_business_info')
      .select('status, business_category_surge_charge')
      .eq('user_id', userId)
      .maybeSingle();

    if (businessError) {
      throw businessError;
    }

    const hasPan = panData !== null;
    const hasAddress = addressData !== null;
    const hasBusiness = businessData !== null;

    const panStatus = panData?.status || 'not_submitted';
    const addressStatus = addressData?.status || 'not_submitted';
    const businessStatus = businessData?.status || 'not_submitted';

    const isPanVerified = panStatus === 'verified';
    const isAddressVerified = addressStatus === 'verified';
    const isBusinessVerified = businessStatus === 'verified' || !hasBusiness;

    const isFullyVerified = isPanVerified && isAddressVerified && isBusinessVerified;

    const isPending =
      (hasPan && (panStatus === 'pending' || panStatus === 'verification_pending')) ||
      (hasAddress && (addressStatus === 'pending' || addressStatus === 'verification_pending')) ||
      (hasBusiness && (businessStatus === 'pending' || businessStatus === 'verification_pending'));

    const isRejected =
      (hasPan && panStatus === 'rejected') ||
      (hasAddress && addressStatus === 'rejected') ||
      (hasBusiness && businessStatus === 'rejected');

    let overallStatus = 'not_submitted';
    if (isFullyVerified) {
      overallStatus = 'verified';
    } else if (isRejected) {
      overallStatus = 'rejected';
    } else if (isPending) {
      overallStatus = 'pending';
    } else if (hasPan || hasAddress || hasBusiness) {
      overallStatus = 'incomplete';
    }

    return new Response(
      JSON.stringify({
        isVerified: isFullyVerified,
        status: overallStatus,
        isRestricted: userData?.is_restricted || false,
        businessCategorySurgeCharge: parseFloat(businessData?.business_category_surge_charge || 0),
        details: {
          pan: { status: panStatus, verified: isPanVerified },
          address: { status: addressStatus, verified: isAddressVerified },
          business: { status: businessStatus, verified: isBusinessVerified }
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error checking KYC status:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to check KYC status' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});


// redeploy
