// The kyc-documents bucket is private. Identity documents are still stored with
// their canonical public-style URL, so this helper rewrites any such URL found in
// a response into a short-lived signed URL. It runs as a response post-processor
// so that every page that already renders a stored document URL keeps working
// without the bucket being readable by the world.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const BUCKET = "kyc-documents";
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const SIGN_MARKER = `/storage/v1/object/sign/${BUCKET}/`;
const SIGN_TTL_SECONDS = 3600;

const URL_PATTERN = new RegExp(
  `https?://[^"'\\\\\\s)<>]+/storage/v1/object/(?:public|sign)/${BUCKET}/[^"'\\\\\\s)<>]+`,
  "g",
);

export async function signKycUrlsInText(text: string): Promise<string> {
  if (!text || (!text.includes(PUBLIC_MARKER) && !text.includes(SIGN_MARKER))) return text;

  const found = Array.from(new Set(text.match(URL_PATTERN) || []));
  if (found.length === 0) return text;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let out = text;
  for (const fullUrl of found) {
    let path: string | null = null;
    if (fullUrl.includes(PUBLIC_MARKER)) {
      const rawPath = fullUrl.split(PUBLIC_MARKER)[1];
      if (!rawPath) continue;
      path = rawPath.split("?")[0];
    } else if (fullUrl.includes(SIGN_MARKER)) {
      const rawPath = fullUrl.split(SIGN_MARKER)[1];
      if (!rawPath) continue;
      path = rawPath.split("?")[0];
    }
    if (!path) continue;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the raw form
    }
    try {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
      if (data?.signedUrl) out = out.split(fullUrl).join(data.signedUrl);
    } catch {
      // if signing fails the original (non-working) URL is left in place
    }
  }
  return out;
}

type Handler = (req: Request) => Promise<Response> | Response;

export function withSignedKycUrls(handler: Handler): Handler {
  return async (req: Request): Promise<Response> => {
    const res = await handler(req);
    try {
      if (req.method === "OPTIONS") return res;
      const contentType = res.headers.get("content-type") || "";
      if (!/json|text|html/i.test(contentType)) return res;
      const text = await res.text();
      const signed = await signKycUrlsInText(text);
      if (signed === text) {
        const passthrough = new Headers(res.headers);
        passthrough.delete("content-length");
        return new Response(text, { status: res.status, headers: passthrough });
      }
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      return new Response(signed, { status: res.status, headers });
    } catch {
      return res;
    }
  };
}
