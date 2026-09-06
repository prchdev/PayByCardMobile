import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

// SQL injection only checked in URLs/query strings — not in body,
// because all DB access uses Supabase's parameterized query client.
const URL_SQL_INJECTION_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter|create|exec|execute)\b.*\b(from|into|table|database|where|set)\b)/i,
  /(\b(or|and)\b\s+[\d'"]+=\s*[\d'"]=)/i,
  /(--;?\s*(drop|alter|truncate|delete|select|insert|update)\s)/i,
  /(\bwaitfor\b\s+\bdelay\b)/i,
  /(\bxp_cmdshell\b)/i,
  /(\bexec\b\s*\()/i,
  /(\bsleep\b\s*\(\s*\d)/i,
  /(\bbenchmark\b\s*\()/i,
  /(\binformation_schema\b)/i,
  /(\bload_file\b\s*\()/i,
  /(\boutfile\b)/i,
  /(\bdumpfile\b)/i,
];

const XSS_PATTERNS = [
  /(<script[\s>])/i,
  /(javascript\s*:)/i,
  /(on\w+\s*=\s*["'])/i,
  /(<\s*iframe)/i,
  /(<\s*object)/i,
  /(<\s*embed)/i,
  /(<\s*applet)/i,
  /(<\s*form[\s>])/i,
  /(eval\s*\()/i,
  /(document\s*\.\s*(cookie|write|location))/i,
  /(window\s*\.\s*location)/i,
  /(<\s*svg[\s>].*\bon\w+\s*=)/i,
  /(expression\s*\()/i,
  /(url\s*\(\s*["']?\s*javascript)/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /(\.\.\/)/,
  /(\.\.\\)/,
  /(%2e%2e[%/\\])/i,
  /(%252e%252e)/i,
  /(\/etc\/passwd)/i,
  /(\/proc\/self)/i,
  /(c:\\windows)/i,
];

const COMMAND_INJECTION_PATTERNS = [
  /([;&|`$]\s*(cat|ls|dir|rm|mv|cp|wget|curl|bash|sh|cmd|powershell))\s/i,
  /(`[^`]{3,}`)/,
  /(\$\([^)]{3,}\))/,
];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getTrustedIps(): string[] {
  const raw = Deno.env.get("WAF_TRUSTED_IPS") || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function checkPatterns(value: string, patterns: RegExp[], category: string): string | null {
  for (const pattern of patterns) {
    if (pattern.test(value)) return category;
  }
  return null;
}

function decodeMultiple(input: string): string {
  let decoded = input;
  try { decoded = decodeURIComponent(decoded); } catch { /* ignore */ }
  decoded = decoded.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return decoded;
}

// Body scanning: XSS, path traversal, command injection only.
// SQL injection excluded — all DB queries go through Supabase's parameterized client.
function scanBodyValue(value: unknown, path: string): string | null {
  if (typeof value === "string") {
    const decoded = decodeMultiple(value);
    let result = checkPatterns(decoded, XSS_PATTERNS, "xss");
    if (result) return `${result} at ${path}`;
    result = checkPatterns(decoded, PATH_TRAVERSAL_PATTERNS, "path_traversal");
    if (result) return `${result} at ${path}`;
    result = checkPatterns(decoded, COMMAND_INJECTION_PATTERNS, "command_injection");
    if (result) return `${result} at ${path}`;
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = scanBodyValue(value[i], `${path}[${i}]`);
      if (r) return r;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = scanBodyValue(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

// URL/query string: full scan including SQL injection.
function scanUrlString(value: string, path: string): string | null {
  const decoded = decodeMultiple(value);
  let result = checkPatterns(decoded, URL_SQL_INJECTION_PATTERNS, "sql_injection");
  if (result) return `${result} at ${path}`;
  result = checkPatterns(decoded, XSS_PATTERNS, "xss");
  if (result) return `${result} at ${path}`;
  result = checkPatterns(decoded, PATH_TRAVERSAL_PATTERNS, "path_traversal");
  if (result) return `${result} at ${path}`;
  result = checkPatterns(decoded, COMMAND_INJECTION_PATTERNS, "command_injection");
  if (result) return `${result} at ${path}`;
  return null;
}

async function logThreat(
  supabaseUrl: string,
  supabaseKey: string,
  ip: string,
  threat: string,
  url: string,
  method: string
): Promise<void> {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from("waf_threat_logs").insert({
      ip_address: ip,
      threat_type: threat,
      request_url: url.substring(0, 2048),
      request_method: method,
      blocked: true,
    });
  } catch {
    // logging failures never block the response
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const ip = getClientIp(req);

    // Trusted IPs bypass all WAF checks (set WAF_TRUSTED_IPS secret as comma-separated IPs)
    const trustedIps = getTrustedIps();
    if (trustedIps.includes(ip)) {
      return new Response(
        JSON.stringify({ blocked: false, message: "Trusted IP — WAF bypassed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ blocked: true, reason: "rate_limit", message: "Too many requests" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: unknown = null;
    const contentType = req.headers.get("content-type") || "";
    if (req.method !== "GET" && contentType.includes("application/json")) {
      const text = await req.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return new Response(
            JSON.stringify({ blocked: true, reason: "malformed_json", message: "Invalid request body" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Scan URL query string (full scan with SQL injection)
    const urlObj = new URL(req.url);
    const urlThreat = scanUrlString(urlObj.search, "query");
    if (urlThreat) {
      EdgeRuntime.waitUntil(logThreat(supabaseUrl, supabaseKey, ip, urlThreat, req.url, req.method));
      return new Response(
        JSON.stringify({ blocked: true, reason: urlThreat.split(" at ")[0], message: "Request blocked by security filter" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Scan body (XSS / path traversal / command injection only)
    if (body) {
      const bodyThreat = scanBodyValue(body, "body");
      if (bodyThreat) {
        EdgeRuntime.waitUntil(logThreat(supabaseUrl, supabaseKey, ip, bodyThreat, req.url, req.method));
        return new Response(
          JSON.stringify({ blocked: true, reason: bodyThreat.split(" at ")[0], message: "Request blocked by security filter" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Scan referer header (full scan)
    const referer = req.headers.get("referer") || "";
    if (referer) {
      const refererThreat = scanUrlString(referer, "header.referer");
      if (refererThreat) {
        EdgeRuntime.waitUntil(logThreat(supabaseUrl, supabaseKey, ip, refererThreat, req.url, req.method));
        return new Response(
          JSON.stringify({ blocked: true, reason: refererThreat.split(" at ")[0], message: "Request blocked by security filter" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ blocked: false, message: "Request passed WAF validation" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("WAF error:", error);
    return new Response(
      JSON.stringify({ blocked: false, message: "WAF check completed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// redeploy
