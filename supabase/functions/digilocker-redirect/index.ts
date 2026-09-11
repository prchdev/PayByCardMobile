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
 * 2. This function returns an HTTP 302 redirect to
 *    paybycard://digilocker-callback?code=...&state=...
 * 3. The mobile app's openAuthSessionAsync intercepts the custom scheme
 *    and extracts the authorization code.
 *
 * An HTTP 302 is used instead of JavaScript because Custom Chrome Tabs on
 * Android follow 302 redirects to custom schemes natively, triggering the
 * intent filter without relying on JavaScript execution.
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

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      "Location": appScheme,
    },
  });
});
