// Server-issued session tokens.
//
// This application uses its own authentication rather than Supabase Auth, so no
// JWT is ever issued for a signed-in customer or administrator. Before this
// module existed, every edge function established identity from an `adminId` /
// `userId` value supplied in the request body, which means possession of an id
// (a value that leaks into the browser, into logs and previously into public
// tables) was enough to act as that principal.
//
// A session token is a stateless HMAC over `kind.id.expiry`, signed with the
// project service-role key, which never leaves the server. The client stores the
// token it receives at login and sends it in the `x-pbc-session` header on every
// request; the guards below verify it and refuse any request whose claimed
// identifier does not match the token.

const encoder = new TextEncoder();

export const SESSION_HEADER = "x-pbc-session";
export const ADMIN_SESSION_HEADER = "x-pbc-admin-session";
export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches "remember me"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-pbc-session, x-pbc-admin-session",
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(new Uint8Array(sig));
}

export async function issueSessionToken(
  kind: "admin" | "user",
  id: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${kind}.${id}.${exp}`;
  return `${payload}.${await sign(payload)}`;
}

export async function readSessionToken(
  token: string | null,
): Promise<{ kind: string; id: string } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [kind, id, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0 || exp * 1000 < Date.now()) return null;
  const expected = await sign(`${kind}.${id}.${exp}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  return { kind, id };
}

// Internal function-to-function calls carry the service-role key and are trusted.
export function isInternalCall(req: Request): boolean {
  const auth = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return false;
  return auth === `Bearer ${serviceKey}` || auth === serviceKey;
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      error: "Your session is no longer valid. Please sign in again.",
      code: "SESSION_INVALID",
    }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

type Handler = (req: Request) => Promise<Response> | Response;

/**
 * Wraps an edge function handler so that the request must carry a valid session
 * token of the given kind, and so that any identifier claimed in the request
 * body (or query string) must belong to that session.
 */
export function withSession(kind: "admin" | "user", idFields: string[]) {
  return (handler: Handler): Handler => {
    return async (req: Request): Promise<Response> => {
      if (req.method === "OPTIONS") return handler(req);
      if (isInternalCall(req)) return handler(req);

      const header = kind === "admin" ? ADMIN_SESSION_HEADER : SESSION_HEADER;
      const session = await readSessionToken(req.headers.get(header));
      if (!session || session.kind !== kind) return unauthorized();

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      let raw = "";
      if (hasBody) {
        try {
          raw = await req.text();
        } catch {
          raw = "";
        }
      }

      let claimed: string | null = null;
      if (raw) {
        try {
          const body = JSON.parse(raw);
          for (const field of idFields) {
            if (body && body[field]) {
              claimed = String(body[field]);
              break;
            }
          }
          // When the caller did not name an identifier, supply the one from the
          // session so a handler can never fall back to an unauthenticated value.
          if (!claimed && body && typeof body === "object" && !Array.isArray(body)) {
            body[idFields[0]] = session.id;
            raw = JSON.stringify(body);
          }
        } catch {
          // non-JSON body (e.g. multipart) — identity is checked inside the handler
        }
      }
      if (!claimed) {
        try {
          const url = new URL(req.url);
          for (const field of idFields) {
            const value = url.searchParams.get(field);
            if (value) {
              claimed = value;
              break;
            }
          }
        } catch {
          // ignore
        }
      }

      if (claimed && claimed !== session.id) return unauthorized();

      const forwarded = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: hasBody && raw ? raw : undefined,
      });
      return handler(forwarded);
    };
  };
}

export const withAdminSession = withSession("admin", ["adminId", "admin_id"]);
export const withUserSession = withSession("user", ["userId", "user_id"]);
