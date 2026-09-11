import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * DigiLocker Redirect Bridge
 *
 * DigiLocker redirects to an HTTPS URL (e.g. https://paybycard.in/digilocker-callback)
 * after the user authorizes. On the website, a page handles this and extracts the auth code.
 * On the mobile app, the in-app browser (Custom Chrome Tab / ASWebAuthenticationSession)
 * cannot intercept HTTPS redirects — it can only intercept custom URL schemes.
 *
 * This edge function acts as a bridge:
 * 1. DigiLocker redirects to this function's URL with ?code=...&state=...
 * 2. This function returns a minimal HTML page that does a client-side redirect
 *    to paybycard://digilocker-callback?code=...&state=...
 * 3. The mobile app's openAuthSessionAsync intercepts the custom scheme redirect
 *    and extracts the authorization code.
 *
 * The HTML page also tries window.close() as a fallback and shows a
 * "Return to app" link in case the automatic redirect doesn't fire.
 */

function handleOptions(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error") || "";

  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (state) params.set("state", state);
  if (error) params.set("error", error);

  const appScheme = `paybycard://digilocker-callback?${params.toString()}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Returning to PayByCard...</title>
  <style>
    body { margin:0; padding:0; background:#f9fafb; font-family:-apple-system,system-ui,sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; }
    .spinner { width:36px; height:36px; border:3px solid #e5e7eb; border-top-color:#8c76f0; border-radius:50%; animation:spin 0.7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .text { color:#6b7280; font-size:15px; text-align:center; }
    .link { color:#8c76f0; font-size:14px; text-decoration:none; font-weight:600; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="text">Returning to PayByCard app...</div>
  <a class="link" href="${appScheme}">Tap here if you are not redirected automatically</a>
  <script>
    // Redirect to the custom scheme — the mobile app intercepts this
    window.location.href = "${appScheme}";

    // Fallback: try to close the tab/window
    setTimeout(function() {
      try { window.close(); } catch(e) {}
    }, 1500);
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
