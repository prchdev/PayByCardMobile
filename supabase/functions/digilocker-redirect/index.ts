import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * DigiLocker Redirect Bridge
 *
 * DigiLocker redirects to an HTTPS URL after the user authorizes. On mobile,
 * the in-app browser (Custom Chrome Tab / ASWebAuthenticationSession) can only
 * intercept custom URL schemes, not HTTPS URLs.
 *
 * This edge function acts as a bridge:
 * 1. DigiLocker redirects to this function's URL with ?code=...&state=...
 * 2. This function returns an HTML page that redirects to
 *    paybycard://digilocker-callback?code=...&state=...
 * 3. The mobile app's openAuthSessionAsync intercepts the custom scheme
 *    and extracts the authorization code.
 *
 * An HTML page with a JavaScript redirect is used because:
 * - Custom Chrome Tabs on Android don't always follow 302 redirects to custom schemes
 * - ASWebAuthenticationSession on iOS handles JavaScript-based redirects reliably
 * - The page also calls window.close() as a fallback
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

  const appScheme = `paybycard://digilocker-callback?${params.toString()}`;

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
  window.location.replace("${appScheme}");
  setTimeout(function() { window.close(); }, 1000);
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
