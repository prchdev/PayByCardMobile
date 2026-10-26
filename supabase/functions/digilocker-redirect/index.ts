import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-pbc-session, x-pbc-admin-session",
};

/**
 * DigiLocker Redirect Bridge
 *
 * DigiLocker redirects to this HTTPS URL after the user authorizes.
 *
 * Mobile: The state starts with "um" (encoded by digilocker-kyc for mobile
 *   callers). Returns an HTML page that does a JavaScript redirect to the
 *   paybycard:// custom scheme. Chrome Custom Tabs (opened via
 *   openAuthSessionAsync) intercept JS-initiated navigations to custom
 *   schemes, closing the tab and returning the URL to the app. A bare 302
 *   redirect does NOT work reliably for chained redirects (DigiLocker →
 *   bridge → app) because Chrome Custom Tabs may not follow the second hop.
 *
 * Web: The state starts with "uw" (or "m" for merchant). Returns an HTML page
 *   that sends postMessage to the opener window with { code, state } and then
 *   closes the popup. If no opener, falls back to redirecting to the app URL
 *   with code/state as query params (the website's KYCVerification page
 *   captures these from URL params).
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error") || "";
  const verificationId = url.searchParams.get("verification_id") || "";
  const platformParam = url.searchParams.get("platform") || "";

  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (state) params.set("state", state);
  if (error) params.set("error", error);
  if (verificationId && !code) params.set("code", verificationId);

  // Mobile detection: state prefixed with "um" (DigiLocker direct) or
  // platform=mobile query param (CashFree, which may not pass state back).
  // Also handle pre-authorized DigiLocker sessions where the consent step
  // is skipped and state may not be echoed back — if we have a code but no
  // state, treat it as mobile (web flow always includes state from get_auth_url).
  const isMobile = state.startsWith("um") || platformParam === "mobile" || (!state && code && !verificationId);

  // Mobile: return an HTML page that does a JS redirect to the paybycard://
  // custom scheme. Chrome Custom Tabs intercept JS-initiated navigations to
  // custom schemes, which closes the tab and returns the URL to
  // openAuthSessionAsync. A bare 302 does not work for chained redirects.
  if (isMobile) {
    const appScheme = `paybycard://digilocker-callback?${params.toString()}`;
    const mobileHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Completing...</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
  .card { text-align: center; padding: 2rem; }
  .spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #8c76f0; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { color: #6b7280; font-size: 0.875rem; }
</style>
</head>
<body>
<div class="card">
  <div class="spinner"></div>
  <p>Completing DigiLocker authorization...</p>
</div>
<script>
(function() {
  var appScheme = ${JSON.stringify(appScheme)};
  window.location.replace(appScheme);
})();
</script>
</body>
</html>`;
    return new Response(mobileHtml, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  // Web: return HTML that sends postMessage to the opener popup window.
  // Matches the website's develop-branch approach: if no opener, fall back
  // to redirecting to the app URL with code/state as query params.
  const isMerchant = state.startsWith("m");
  const fallbackPath = isMerchant ? "/merchant-onboarding" : "/kyc-verification";

  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  let appUrl = "https://paybycard.in";
  if (origin) {
    try { appUrl = new URL(origin).origin; } catch { /* keep default */ }
  }
  if (appUrl.includes("supabase")) appUrl = "https://paybycard.in";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DigiLocker Redirect</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
  .card { text-align: center; padding: 2rem; }
  .spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #8c76f0; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { color: #6b7280; font-size: 0.875rem; }
</style>
</head>
<body>
<div class="card">
  <div class="spinner"></div>
  <p>Completing DigiLocker authorization…</p>
</div>
<script>
(function() {
  var code = ${JSON.stringify(code)};
  var error = ${JSON.stringify(error)};
  var state = ${JSON.stringify(state)};
  var fallbackPath = ${JSON.stringify(fallbackPath)};
  var appUrl = ${JSON.stringify(appUrl)};

  function redirectFallback() {
    var sep = fallbackPath.indexOf('?') >= 0 ? '&' : '?';
    var params = [];
    if (code) params.push('code=' + encodeURIComponent(code));
    if (state) params.push('state=' + encodeURIComponent(state));
    if (error) params.push('error=' + encodeURIComponent(error));
    window.location.href = appUrl + fallbackPath + sep + params.join('&');
  }

  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage({ type: 'digilocker_callback', code: code, state: state, error: error }, '*');
      setTimeout(function() {
        try { window.close(); } catch (e) {}
        setTimeout(function() {
          if (!window.closed) redirectFallback();
        }, 300);
      }, 200);
      return;
    } catch (e) {
      redirectFallback();
      return;
    }
  }

  redirectFallback();
})();
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
