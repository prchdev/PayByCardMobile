import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// message_type values and their enabled-flag + DLT template ID column mapping
const MESSAGE_TYPE_MAP: Record<string, { flag: 'send_otp_sms' | 'send_transactional_sms'; providerField: string }> = {
  otp:                  { flag: 'send_otp_sms',            providerField: 'otp_template_id' },
  merchant_onboarding:  { flag: 'send_otp_sms',            providerField: 'transactional_template_id' },
  kyc_approved:         { flag: 'send_transactional_sms',  providerField: 'dlt_kyc_approved' },
  kyc_rejected:         { flag: 'send_transactional_sms',  providerField: 'dlt_kyc_rejected' },
  payment_initiated:    { flag: 'send_transactional_sms',  providerField: 'dlt_payment_initiated' },
  payment_settled:      { flag: 'send_transactional_sms',  providerField: 'dlt_payment_settled' },
  payment_refund:       { flag: 'send_transactional_sms',  providerField: 'dlt_payment_refund' },
  // legacy fallback
  transactional:        { flag: 'send_transactional_sms',  providerField: 'transactional_template_id' },
};

interface SendSMSRequest {
  mobile: string;
  message: string;
  message_type: string;
  template_id?: string;
  variables?: Record<string, string>;
}

interface SMSSettings {
  send_otp_sms: boolean;
  send_transactional_sms: boolean;
  sender_id: string;
  dlt_entity_id: string;
  tpl_otp: string;
  tpl_merchant_onboarding: string;
  tpl_kyc_approved: string;
  tpl_kyc_rejected: string;
  tpl_payment_settled: string;
  tpl_payment_refund: string;
  tpl_payment_initiated: string;
}

interface SMSProvider {
  provider_name: string;
  is_enabled: boolean;
  is_default: boolean;
  api_key: string;
  otp_template_id: string;
  transactional_template_id: string;
  dlt_kyc_approved: string;
  dlt_kyc_rejected: string;
  dlt_payment_initiated: string;
  dlt_payment_settled: string;
  dlt_payment_refund: string;
}

async function sendFast2SMS(
  mobile: string,
  message: string,
  apiKey: string,
  senderId: string,
  dltEntityId: string,
  templateId: string,
  variables?: Record<string, string>
): Promise<{ success: boolean; response?: any; error?: string }> {
  try {
    const cleanMobile = mobile.replace(/^\+91/, '').replace(/\D/g, '');

    const params = new URLSearchParams();
    params.append('authorization', apiKey);
    params.append('route', 'dlt');
    params.append('sender_id', senderId);
    params.append('message', templateId);
    params.append('numbers', cleanMobile);
    params.append('flash', '0');

    if (variables) {
      params.append('variables_values', Object.values(variables).join('|'));
    }

    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-cache',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (response.ok && data.return === true) {
      return { success: true, response: data };
    } else {
      return { success: false, error: data.message || JSON.stringify(data) || 'Fast2SMS error' };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Fast2SMS request failed' };
  }
}

async function sendMSG91(
  mobile: string,
  message: string,
  apiKey: string,
  senderId: string,
  dltEntityId: string,
  templateId: string,
  variables?: Record<string, string>
): Promise<{ success: boolean; response?: any; error?: string }> {
  try {
    const cleanMobile = mobile.replace(/^\+/, '').replace(/\D/g, '');
    const mobileWithCountry = cleanMobile.startsWith('91') ? cleanMobile : `91${cleanMobile}`;

    const recipient: Record<string, string> = { mobiles: mobileWithCountry };
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        recipient[key] = value;
      }
    }

    const payload: Record<string, any> = {
      template_id: templateId,
      short_url: '0',
      realTimeResponse: '1',
      recipients: [recipient],
    };

    if (dltEntityId) {
      payload.DLT_TE_ID = dltEntityId;
    }

    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        'authkey': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (response.ok && (data.type === 'success' || data.type === 'pending')) {
      return { success: true, response: data };
    } else {
      return { success: false, error: data.message || JSON.stringify(data) || 'MSG91 error' };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'MSG91 request failed' };
  }
}

async function sendSMSGatewayHub(
  mobile: string,
  message: string,
  apiKey: string,
  senderId: string,
  dltEntityId: string,
  templateId: string,
  variables?: Record<string, string>
): Promise<{ success: boolean; response?: any; error?: string }> {
  try {
    const cleanMobile = mobile.replace(/^\+91/, '').replace(/\D/g, '');

    let finalMessage = message;
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        finalMessage = finalMessage.replace(`{#${key}#}`, value);
        finalMessage = finalMessage.replace(`{${key}}`, value);
      }
    }

    const url = new URL('https://www.smsgatewayhub.com/api/mt/SendSMS');
    url.searchParams.append('APIKey', apiKey);
    url.searchParams.append('senderid', senderId);
    url.searchParams.append('channel', '2');
    url.searchParams.append('DCS', '0');
    url.searchParams.append('flashsms', '0');
    url.searchParams.append('number', cleanMobile);
    url.searchParams.append('text', finalMessage);
    url.searchParams.append('route', '1');

    if (templateId) {
      url.searchParams.append('DLTTemplateId', templateId);
    }
    if (dltEntityId) {
      url.searchParams.append('PEID', dltEntityId);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'accept': 'application/json' },
    });

    const data = await response.json();

    if (response.ok && data.ErrorCode === '000') {
      return { success: true, response: data };
    } else {
      return { success: false, error: data.ErrorMessage || JSON.stringify(data) || 'SMSGatewayHub error' };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'SMSGatewayHub request failed' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const requestData: SendSMSRequest = await req.json();
    const { mobile, message, message_type, template_id, variables } = requestData;

    if (!mobile || !message_type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: mobile, message_type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const typeConfig = MESSAGE_TYPE_MAP[message_type];
    if (!typeConfig) {
      return new Response(
        JSON.stringify({ error: `Unknown message_type: ${message_type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: settings, error: settingsError } = await supabase
      .from('sms_settings')
      .select('*')
      .maybeSingle();

    if (settingsError || !settings) {
      return new Response(
        JSON.stringify({ error: 'SMS settings not found' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const smsSettings = settings as SMSSettings;

    // Check the correct enabled flag for this message type
    if (!smsSettings[typeConfig.flag]) {
      const flagLabel = typeConfig.flag === 'send_otp_sms' ? 'Critical Service Messages' : 'Optional Service Messages';
      return new Response(
        JSON.stringify({ error: `${flagLabel} SMS sending is disabled` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: providers, error: providersError } = await supabase
      .from('sms_provider_settings')
      .select('*')
      .eq('is_enabled', true)
      .order('is_default', { ascending: false });

    if (providersError || !providers || providers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No SMS provider is enabled' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const defaultProvider = providers[0] as SMSProvider;

    // Resolve template ID: explicit override > provider DLT column > fall back to empty
    const templateIdToUse = template_id || (defaultProvider as any)[typeConfig.providerField] || '';

    if (!templateIdToUse) {
      return new Response(
        JSON.stringify({ error: `DLT Template ID not configured for "${message_type}" messages on provider ${defaultProvider.provider_name}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const dltEntityId = smsSettings.dlt_entity_id || '';

    // Resolve message body: use stored template if caller didn't provide one
    const templateBodyMap: Record<string, string> = {
      otp:                 smsSettings.tpl_otp,
      merchant_onboarding: smsSettings.tpl_merchant_onboarding,
      kyc_approved:        smsSettings.tpl_kyc_approved,
      kyc_rejected:        smsSettings.tpl_kyc_rejected,
      payment_settled:     smsSettings.tpl_payment_settled,
      payment_refund:      smsSettings.tpl_payment_refund,
      payment_initiated:   smsSettings.tpl_payment_initiated,
    };
    const resolvedMessage = message || templateBodyMap[message_type] || '';

    let result: { success: boolean; response?: any; error?: string };

    switch (defaultProvider.provider_name) {
      case 'Fast2SMS':
        result = await sendFast2SMS(mobile, resolvedMessage, defaultProvider.api_key, smsSettings.sender_id, dltEntityId, templateIdToUse, variables);
        break;
      case 'MSG91':
        result = await sendMSG91(mobile, resolvedMessage, defaultProvider.api_key, smsSettings.sender_id, dltEntityId, templateIdToUse, variables);
        break;
      case 'SMSGatewayHub':
        result = await sendSMSGatewayHub(mobile, resolvedMessage, defaultProvider.api_key, smsSettings.sender_id, dltEntityId, templateIdToUse, variables);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unsupported SMS provider: ${defaultProvider.provider_name}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    if (result.success) {
      return new Response(
        JSON.stringify({ success: true, message: 'SMS sent successfully', provider: defaultProvider.provider_name, response: result.response }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: result.error, provider: defaultProvider.provider_name }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// redeploy
