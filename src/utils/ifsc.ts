import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

export interface IfscResult {
  ifsc: string;
  bank: string;
  branch: string;
  address: string;
  city: string;
  district: string;
  state: string;
}

export async function fetchIfscDetails(ifsc: string): Promise<IfscResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-ifsc`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ifsc }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Invalid IFSC code');
  return data as IfscResult;
}

export function isValidIfscFormat(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase().trim());
}
