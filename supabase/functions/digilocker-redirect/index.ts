import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * DigiLocker Redirect Bridge
 *
 * DigiLocker redirects to this HTTPS URL after the user authorizes.
 *
 * Mobile: The state starts with "um" (encoded by digilocker-kyc for mobile
 *   callers). Returns an HTTP 302 redirect to the paybycard:// custom scheme.
 *   Android's Chrome Custom Tab (opened via openAuthSessionAsync) intercepts
 *   HTTP redirects to custom schemes — it does NOT intercept JS redirects.
 *
 * Web: The state starts with "uw". Returns an HTML page that sends postMessage
 *   to the opener window with { code, state } and then closes the popup.
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error") || "";

  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (state) params.set("state", state);
  if (error) params.set("error", error);

  const isMobile = state.startsWith("um");

  if (isMobile) {
    // HTTP 302 redirect to the paybycard:// custom scheme.
    // Chrome Custom Tab intercepts this at the OS level via intent filters,
    // causing openAuthSessionAsync to capture the URL and return it to the app.
    const appScheme = `paybycard://digilocker-callback?${params.toString()}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        "Location": appScheme,
      },
    });
  }

  // Web: return HTML that sends postMessage to the opener popup window.
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirecting...</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
  .container { text-align: center; }
  .spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { color: #6b7280; font-size: 14px; }
</style>
</head>
<body>
<div class="container">
  <div class="spinner"></div>
  <p>Completing DigiLocker authorization...</p>
</div>
<script>
  var code = ${JSON.stringify(code)};
  var state = ${JSON.stringify(state)};
  var error = ${JSON.stringify(error)};

  if (window.opener && !window.opener.closed) {
    var msg = { type: 'digilocker_callback' };
    if (code) msg.code = code;
    if (state) msg.state = state;
    if (error) msg.error = error;
    window.opener.postMessage(msg, '*');
    setTimeout(function() { window.close(); }, 500);
  } else {
    document.querySelector('p').textContent = 'Authorization complete. You may close this window.';
  }
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
});
