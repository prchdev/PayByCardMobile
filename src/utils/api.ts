import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { getSessionItem } from './secureStorage';

const SESSION_TOKEN_KEY = 'pbc_session';

export interface ApiFetchOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  skipSession?: boolean;
}

export async function apiFetch(
  functionName: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { method = 'POST', body, headers = {}, skipSession = false } = options;

  const finalHeaders: Record<string, string> = {
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...headers,
  };

  if (!skipSession) {
    const token = await getSessionItem(SESSION_TOKEN_KEY);
    if (token) {
      finalHeaders['x-pbc-session'] = token;
    }
  }

  const url = functionName.includes('://') || functionName.includes('/functions/')
    ? functionName
    : `${SUPABASE_URL}/functions/v1/${functionName}`;

  return fetch(url, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiJson<T = any>(
  functionName: string,
  options: ApiFetchOptions = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await apiFetch(functionName, options);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function buildAuthHeaders(skipSession = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
  if (!skipSession) {
    const token = await getSessionItem(SESSION_TOKEN_KEY);
    if (token) {
      headers['x-pbc-session'] = token;
    }
  }
  return headers;
}
