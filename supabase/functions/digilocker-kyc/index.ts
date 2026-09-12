import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { withSignedKycUrls } from "../_shared/kycUrls.ts";
import { getKycPolicyAttachment } from "../_shared/kycPolicyAttachment.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface DigiLockerKycRequest {
  userId: string;
  action: 'get_auth_url' | 'check_status' | 'auto_approve';
  authCode?: string;
  verificationId?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeVerifier?: string;
  ipAddress?: string;
  platform?: 'web' | 'mobile';
}

type AddressProofType = 'aadhar' | 'passport' | 'voter_id' | 'driving_license';

interface KycData {
  pan_number: string;
  full_name: string;
  dob: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  id_number: string;
  address_proof_type: AddressProofType;
  pan_photo_url?: string;
  aadhaar_front_url?: string;
  aadhaar_back_url?: string;
}

// ── Name matching ─────────────────────────────────────────────────────────────
function normalizeName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function wordInName(word: string, kycWords: string[]): boolean {
  const nw = normalizeName(word);
  return nw.length > 0 && kycWords.includes(nw);
}

interface NameMatchResult {
  matches: boolean;
  firstMatch: boolean;
  middleMatch: boolean;
  lastMatch: boolean;
  registeredName: string;
  kycName: string;
}

function checkNameMatch(firstName: string, middleName: string, lastName: string, kycFullName: string): NameMatchResult {
  const kycNorm = normalizeName(kycFullName);
  const kycWords = kycNorm.split(' ').filter(Boolean);
  const registeredName = [firstName, middleName, lastName].filter(Boolean).join(' ');
  const regNorm = normalizeName(registeredName);

  if (regNorm === kycNorm) {
    return { matches: true, firstMatch: true, middleMatch: true, lastMatch: true, registeredName, kycName: kycFullName };
  }

  const firstMatch = wordInName(firstName, kycWords);
  const middleMatch = !middleName.trim() || wordInName(middleName, kycWords);
  const lastMatch = wordInName(lastName, kycWords);
  const regWords = regNorm.split(' ').filter(Boolean);
  const allWordsPresent = regWords.length > 0 && regWords.every(w => kycWords.includes(w));
  const matches = (firstMatch && lastMatch) || allWordsPresent;

  return { matches, firstMatch, middleMatch, lastMatch, registeredName, kycName: kycFullName };
}

// ── Base URLs ─────────────────────────────────────────────────────────────────
function cashFreeBaseUrl(environment: string): string {
  return environment === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

const DIGILOCKER_API = 'https://api.digitallocker.gov.in/public';

// ── CashFree 2FA signature ────────────────────────────────────────────────────
async function generateCashFree2FASignature(apiKey: string, publicKeyPem: string): Promise<string> {
  const epochSeconds = Math.floor(Date.now() / 1000);
  const payload = `${apiKey}.${epochSeconds}`;

  const pemBody = publicKeyPem
    .replace(/-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/g, '')
    .replace(/-----END (CERTIFICATE|PUBLIC KEY)-----/g, '')
    .replace(/\s+/g, '');

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'spki', binaryDer.buffer,
      { name: 'RSA-OAEP', hash: 'SHA-1' }, false, ['encrypt'],
    );
  } catch {
    throw new Error('2FA public key must be in SPKI/PEM format.');
  }

  const encoded = new TextEncoder().encode(payload);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, cryptoKey, encoded);
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

async function cashFreeHeaders(
  apiKey: string, apiSecret: string, publicKey: string,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-client-id': apiKey,
    'x-client-secret': apiSecret,
    ...extra,
  };
  if (publicKey.trim()) {
    try {
      headers['x-cf-signature'] = await generateCashFree2FASignature(apiKey, publicKey);
    } catch (e) {
      console.warn('2FA signature generation failed:', (e as Error).message);
    }
  }
  return headers;
}

// ── CashFree: create verification session ────────────────────────────────────
async function createCashFreeVerification(
  apiKey: string, apiSecret: string, publicKey: string,
  environment: string, userId: string, redirectUrl: string,
): Promise<{ url: string; verificationId: string }> {
  const baseUrl = cashFreeBaseUrl(environment);
  const userSuffix = userId.replace(/-/g, '').slice(-8);
  const verificationId = `kyc_${userSuffix}_${Math.floor(Date.now() / 1000)}`;

  const headers = await cashFreeHeaders(apiKey, apiSecret, publicKey);
  const reqBody = {
    verification_id: verificationId,
    document_requested: ['AADHAAR', 'PAN'],
    redirect_url: redirectUrl,
    user_flow: 'signin',
  };

  const res = await fetch(`${baseUrl}/verification/digilocker`, {
    method: 'POST', headers, body: JSON.stringify(reqBody),
  });

  let data: any;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    const msg: string = data.message || data.error_msg || JSON.stringify(data);
    if (msg.toLowerCase().includes('ip not whitelisted') || msg.toLowerCase().includes('ip whitelisting')) {
      const ipMatch = msg.match(/[\d.]+\.\d+/);
      const ip = ipMatch ? ipMatch[0] : 'unknown';
      throw new Error(
        `IP_WHITELIST_ERROR:${ip}:CashFree requires the server IP (${ip}) to be whitelisted. ` +
        `Add this IP in your CashFree dashboard under Settings → IP Whitelist.`
      );
    }
    throw new Error(msg || 'CashFree DigiLocker session creation failed');
  }

  const url = data.url || data.digilocker_url || data.redirect_url;
  if (!url) throw new Error('CashFree did not return a consent URL');
  return { url, verificationId };
}

// ── CashFree: get verification status ────────────────────────────────────────
async function getCashFreeVerificationStatus(
  apiKey: string, apiSecret: string, publicKey: string,
  environment: string, verificationId: string,
): Promise<any> {
  const baseUrl = cashFreeBaseUrl(environment);
  const headers = await cashFreeHeaders(apiKey, apiSecret, publicKey);
  delete headers['Content-Type'];

  const res = await fetch(
    `${baseUrl}/verification/digilocker?verification_id=${encodeURIComponent(verificationId)}`,
    { method: 'GET', headers },
  );

  let data: any;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    throw new Error(data.message || data.error_msg || 'CashFree DigiLocker status check failed');
  }
  return data;
}

// ── CashFree: fetch a single document ────────────────────────────────────────
async function getCashFreeDocument(
  apiKey: string, apiSecret: string, publicKey: string,
  environment: string, verificationId: string, docType: 'AADHAAR' | 'PAN',
): Promise<any> {
  const baseUrl = cashFreeBaseUrl(environment);
  const headers = await cashFreeHeaders(apiKey, apiSecret, publicKey);
  delete headers['Content-Type'];

  const res = await fetch(
    `${baseUrl}/verification/digilocker/document/${docType}?verification_id=${encodeURIComponent(verificationId)}`,
    { method: 'GET', headers },
  );

  let data: any;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    throw new Error(data.message || data.error_msg || `CashFree DigiLocker ${docType} document fetch failed`);
  }
  return data;
}

// ── SMS helper ────────────────────────────────────────────────────────────────
async function sendSms(supabaseUrl: string, supabaseKey: string, mobile: string, messageType: 'kyc_approved' | 'kyc_rejected') {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
      body: JSON.stringify({ mobile, message: '', message_type: messageType, variables: {} }),
    });
  } catch (_) {}
}

// ── Upload bytes to Supabase Storage, return public URL ──────────────────────
async function uploadToStorage(
  supabase: ReturnType<typeof createClient>,
  bytes: Uint8Array | ArrayBuffer,
  storagePath: string,
  contentType: string,
): Promise<string | null> {
  const buf = bytes instanceof Uint8Array ? bytes.buffer : bytes;
  const { error } = await supabase.storage
    .from('kyc-documents')
    .upload(storagePath, buf, { contentType, upsert: true });

  if (error) {
    console.error('Storage upload failed:', storagePath, error.message);
    return null;
  }
  const { data: urlData } = supabase.storage.from('kyc-documents').getPublicUrl(storagePath);
  return urlData?.publicUrl || null;
}

// ── CashFree: build XML from structured API response and store it ─────────────
async function buildAndStoreCashFreeXml(
  supabase: ReturnType<typeof createClient>,
  docType: 'AADHAAR' | 'PAN',
  docData: any,
  userId: string,
  fileKey: string,
): Promise<string | null> {
  try {
    const now = new Date().toISOString();
    let xml: string;

    if (docType === 'AADHAAR') {
      const sa = docData?.split_address || {};
      xml = `<?xml version="1.0" encoding="UTF-8"?>
<AadhaarVerification source="CashFree-DigiLocker" verified_at="${now}">
  <PersonalInfo>
    <Name>${escXml(docData?.name || '')}</Name>
    <DateOfBirth>${escXml(docData?.dob || '')}</DateOfBirth>
    <YearOfBirth>${escXml(docData?.yob || '')}</YearOfBirth>
    <Gender>${escXml(docData?.gender || '')}</Gender>
    <UID_Last4>${escXml((docData?.uid || '').slice(-4))}</UID_Last4>
    <CareOf>${escXml(docData?.care_of || '')}</CareOf>
  </PersonalInfo>
  <Address>
    <House>${escXml(sa.house || '')}</House>
    <Street>${escXml(sa.street || '')}</Street>
    <Landmark>${escXml(sa.landmark || '')}</Landmark>
    <Village>${escXml(sa.vtc || sa.subdist || '')}</Village>
    <District>${escXml(sa.dist || '')}</District>
    <State>${escXml(sa.state || '')}</State>
    <Pincode>${escXml(sa.pincode || '')}</Pincode>
    <Country>India</Country>
  </Address>
</AadhaarVerification>`;
    } else {
      xml = `<?xml version="1.0" encoding="UTF-8"?>
<PanVerification source="CashFree-DigiLocker" verified_at="${now}">
  <PersonalInfo>
    <Name>${escXml(docData?.name || '')}</Name>
    <FatherName>${escXml(docData?.father_name || '')}</FatherName>
    <DateOfBirth>${escXml(docData?.dob || '')}</DateOfBirth>
    <PanNumber>${escXml(docData?.pan || '')}</PanNumber>
  </PersonalInfo>
</PanVerification>`;
    }

    const xmlBytes = new TextEncoder().encode(xml);
    const storagePath = `${userId}/${fileKey}.xml`;
    return await uploadToStorage(supabase, xmlBytes, storagePath, 'application/xml');
  } catch (e) {
    console.error('buildAndStoreCashFreeXml failed:', fileKey, (e as Error).message);
    return null;
  }
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── CashFree: fetch both docs ─────────────────────────────────────────────────
async function fetchCashFreeDocuments(
  supabase: ReturnType<typeof createClient>,
  apiKey: string, apiSecret: string, publicKey: string,
  environment: string, verificationId: string, userId: string,
): Promise<KycData> {
  const [aadhaarData, panData] = await Promise.all([
    getCashFreeDocument(apiKey, apiSecret, publicKey, environment, verificationId, 'AADHAAR'),
    getCashFreeDocument(apiKey, apiSecret, publicKey, environment, verificationId, 'PAN'),
  ]);

  const sa = aadhaarData?.split_address || {};
  const addressParts = [aadhaarData?.care_of, sa.house, sa.street, sa.landmark].filter(Boolean);

  const [aadhaarFrontUrl, aadhaarBackUrl, panPhotoUrl] = await Promise.all([
    buildAndStoreCashFreeXml(supabase, 'AADHAAR', aadhaarData, userId, 'address_front'),
    buildAndStoreCashFreeXml(supabase, 'AADHAAR', aadhaarData, userId, 'address_back'),
    buildAndStoreCashFreeXml(supabase, 'PAN', panData, userId, 'pan_photo'),
  ]);

  return {
    pan_number: panData?.pan || '',
    full_name: panData?.name || aadhaarData?.name || '',
    dob: panData?.dob || aadhaarData?.dob || '',
    address: addressParts.join(', '),
    city: sa.dist || sa.vtc || sa.subdist || '',
    state: sa.state || '',
    pincode: sa.pincode || '',
    id_number: aadhaarData?.uid || '',
    address_proof_type: 'aadhar',
    pan_photo_url: panPhotoUrl || undefined,
    aadhaar_front_url: aadhaarFrontUrl || undefined,
    aadhaar_back_url: aadhaarBackUrl || undefined,
  };
}

interface TokenData {
  access_token: string;
  name?: string;
  dob?: string;
  gender?: string;
  eaadhaar?: string;
  scope?: string;
}

// ── DigiLocker direct: OAuth token exchange ───────────────────────────────────
async function digiLockerTokenExchange(
  apiKey: string, apiSecret: string, authCode: string, redirectUri: string,
  codeVerifier?: string,
): Promise<TokenData> {
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: authCode,
    client_id: apiKey,
    client_secret: apiSecret,
  };
  if (redirectUri) params.redirect_uri = redirectUri;
  if (codeVerifier) params.code_verifier = codeVerifier;

  const tokenEndpoint = codeVerifier
    ? `${DIGILOCKER_API}/oauth2/2/token`
    : `${DIGILOCKER_API}/oauth2/1/token`;

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

  let data: any;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `DigiLocker token exchange failed (HTTP ${res.status})`);
  }

  return {
    access_token: data.access_token,
    name: data.name || '',
    dob: data.dob || '',
    gender: data.gender || '',
    eaadhaar: data.eaadhaar || 'N',
    scope: data.scope || '',
  };
}

// ── DigiLocker direct: fetch issued documents list ────────────────────────────
async function fetchIssuedDocuments(accessToken: string): Promise<any[]> {
  const res = await fetch(`${DIGILOCKER_API}/oauth2/2/files/issued`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let data: any;
  try { data = await res.json(); } catch { data = {}; }
  const items: any[] = data.items || data.files || [];

  if (!res.ok) {
    throw new Error(data.error || data.message || 'Failed to fetch issued documents from DigiLocker');
  }
  return items;
}

// ── DigiLocker direct: fetch a document XML by URI ───────────────────────────
async function fetchDocumentXml(accessToken: string, uri: string, label: string): Promise<string> {
  const res = await fetch(`${DIGILOCKER_API}/oauth2/2/xml/${encodeURIComponent(uri)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch ${label} document (${uri}): ${errText}`);
  }

  const outerXml = await res.text();
  console.log(`[fetchDocumentXml] ${label} outer XML length=${outerXml.length} snippet:`, outerXml.slice(0, 300));

  const dataContentMatch = outerXml.match(/<DataContent[^>]*>([\s\S]*?)<\/DataContent>/i);
  let innerXml = outerXml;
  if (dataContentMatch) {
    try {
      innerXml = atob(dataContentMatch[1].trim().replace(/\s+/g, ''));
      console.log(`[fetchDocumentXml] ${label} base64 decode SUCCESS, inner length=${innerXml.length} snippet:`, innerXml.slice(0, 300));
    } catch (e) {
      console.error(`[fetchDocumentXml] ${label} base64 decode FAILED:`, (e as Error).message, 'base64 len=', dataContentMatch[1].length);
      innerXml = outerXml;
    }
  } else {
    console.log(`[fetchDocumentXml] ${label} no DataContent wrapper found, using raw XML`);
  }

  return innerXml;
}

// ── DigiLocker direct: store XML string to Supabase Storage ─────────────────
async function storeXmlFile(
  supabase: ReturnType<typeof createClient>,
  xmlContent: string,
  userId: string,
  fileKey: string,
): Promise<string | null> {
  try {
    const xmlBytes = new TextEncoder().encode(xmlContent);
    const storagePath = `${userId}/${fileKey}.xml`;
    return await uploadToStorage(supabase, xmlBytes, storagePath, 'application/xml');
  } catch (e) {
    console.error('storeXmlFile failed:', fileKey, (e as Error).message);
    return null;
  }
}

// ── DigiLocker direct: fetch eAadhaar XML via dedicated endpoint ──────────────
async function fetchEAadhaarXml(accessToken: string): Promise<string> {
  const res = await fetch(`${DIGILOCKER_API}/oauth2/3/xml/eaadhaar`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch eAadhaar: ${errText}`);
  }
  return res.text();
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function xmlAttr(xml: string, attr: string): string {
  const re = new RegExp(`\\b${attr}=["']([^"']*)["']`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function attrInTag(xml: string, tag: string, attr: string): string {
  const tagRe = new RegExp(`<${tag}[\\s/>][\\s\\S]*?\\b${attr}=["']([^"']*)["'][\\s\\S]*?>`, 'i');
  const m = xml.match(tagRe);
  if (m) return m[1].trim();
  const tagRe2 = new RegExp(`<${tag}[\\s/>][\\s\\S]*?\\b${attr}=["']([^"']*)["']`, 'i');
  const m2 = xml.match(tagRe2);
  return m2 ? m2[1].trim() : '';
}

function parseAddressLine1(line1: string): { address: string; locality: string; district: string; state: string; pincode: string } {
  const clean = line1.replace(/,,+/g, ',').replace(/,\s*$/, '').trim();
  const pinMatch = clean.match(/\b(\d{6})\b/);
  const pincode = pinMatch ? pinMatch[1] : '';

  const distMatch = clean.match(/(?:DIST[-.\s]+|DISTRICT[-.\s]+)([A-Z][A-Z\s]+?)(?:,|$)/i);
  const district = distMatch ? distMatch[1].trim() : '';

  const stateMatch = clean.match(/(?:STATE[-.\s]+)([A-Z][A-Z\s]+?)(?:,|$)/i);
  const state = stateMatch ? stateMatch[1].trim() : '';

  const stripped = clean
    .replace(/\b\d{6}\b/, '')
    .replace(/(?:DIST|DISTRICT|TAL|TALUKA|TEHSIL)[-.\s]+[A-Z][A-Z\s]*(?:,|$)/gi, '')
    .replace(/(?:STATE)[-.\s]+[A-Z][A-Z\s]*(?:,|$)/gi, '')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/, '')
    .trim();

  const parts = stripped.split(',').map(p => p.trim()).filter(Boolean);
  const locality = parts.length > 1 ? parts[parts.length - 1] : '';
  const address = parts.slice(0, Math.max(1, parts.length - 1)).join(', ');

  return { address: address || stripped, locality, district, state, pincode };
}

function extractIssuedToBlock(xml: string): string {
  const m = xml.match(/<IssuedTo[\s\S]*?<\/IssuedTo>/i);
  return m ? m[0] : xml;
}

function parseAddressTag(tag: string): { house: string; street: string; locality: string; vtc: string; district: string; state: string; pincode: string } {
  const ga = (attr: string) => {
    const re = new RegExp(`\\b${attr}=["']([^"']*)["']`, 'i');
    const m = tag.match(re);
    return m ? m[1].trim() : '';
  };

  const house    = ga('house') || ga('add1');
  const street   = ga('line2') || ga('street') || ga('landmark') || ga('lm') || ga('add2');
  const locality = ga('locality') || ga('loc') || ga('add3');
  const vtc      = ga('vtc') || ga('postOffice') || ga('subDistrict') || ga('add4');
  const district = ga('district') || ga('dist');
  const state    = ga('state');
  const pincode  = ga('pin') || ga('pc') || ga('pincode');
  const line1    = ga('line1');

  if (!district && !state && !pincode && !house && line1) {
    const parsed = parseAddressLine1(line1);
    return { house: parsed.address, street: '', locality: parsed.locality, vtc: '', district: parsed.district, state: parsed.state, pincode: parsed.pincode };
  }

  return { house, street, locality, vtc, district, state, pincode };
}

function parseAddressElement(xmlBlock: string): {
  house: string; street: string; locality: string; vtc: string; district: string; state: string; pincode: string; line1: string;
} {
  // Match <Address>, <Address2>, or <Poa> tags (Aadhaar-style)
  const addrTagRe = /<(?:Address2?|Poa|POA|poa)[\s\S]*?(?:\/>|>)/gi;
  const tags: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = addrTagRe.exec(xmlBlock)) !== null) {
    tags.push(m[0]);
  }

  if (tags.length === 0) return { house: '', street: '', locality: '', vtc: '', district: '', state: '', pincode: '', line1: '' };

  const score = (tag: string) => {
    let s = 0;
    if (/type=["'](present|permanent)["']/i.test(tag)) s += 10;
    for (const attr of ['district', 'dist', 'state', 'pin', 'pc', 'pincode', 'house', 'line1', 'add1']) {
      const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i');
      if (re.test(tag)) s += 1;
    }
    return s;
  };

  tags.sort((a, b) => score(b) - score(a));
  const best = parseAddressTag(tags[0]);
  const line1 = (() => { const re = /\bline1=["']([^"']*)["']/i; const mm = tags[0].match(re); return mm ? mm[1].trim() : ''; })();
  return { ...best, line1 };
}

function parseAadhaarXml(xml: string) {
  const personName = attrInTag(xml, 'Person', 'name') || attrInTag(xml, 'Poi', 'name') || xmlAttr(xml, 'name');
  const dob = attrInTag(xml, 'Person', 'dob') || attrInTag(xml, 'Poi', 'dob') || xmlAttr(xml, 'dob');
  const uid = attrInTag(xml, 'UidData', 'uid') || attrInTag(xml, 'Person', 'uid') || xmlAttr(xml, 'uid');
  const gender = attrInTag(xml, 'Person', 'gender') || attrInTag(xml, 'Poi', 'gender') || xmlAttr(xml, 'gender');

  const poaHouse    = attrInTag(xml, 'Poa', 'house') || attrInTag(xml, 'Poa', 'co');
  const poaStreet   = attrInTag(xml, 'Poa', 'street') || attrInTag(xml, 'Poa', 'lm');
  const poaLocality = attrInTag(xml, 'Poa', 'loc');
  const poaVtc      = attrInTag(xml, 'Poa', 'vtc') || attrInTag(xml, 'Poa', 'subdist');
  const poaDistrict = attrInTag(xml, 'Poa', 'dist');
  const poaState    = attrInTag(xml, 'Poa', 'state');
  const poaPincode  = attrInTag(xml, 'Poa', 'pc');

  const issuedToBlock = extractIssuedToBlock(xml);
  const addrParsed = (!poaHouse && !poaDistrict) ? parseAddressElement(issuedToBlock) : null;

  return {
    name: personName, dob, gender,
    house:    poaHouse    || addrParsed?.house    || '',
    street:   poaStreet   || addrParsed?.street   || '',
    locality: poaLocality || addrParsed?.locality || '',
    vtc:      poaVtc      || addrParsed?.vtc      || '',
    district: poaDistrict || addrParsed?.district || '',
    state:    poaState    || addrParsed?.state    || '',
    pincode:  poaPincode  || addrParsed?.pincode  || '',
    aadhaarUid: uid,
  };
}

function parseCertificateAddressXml(xml: string): {
  name: string; dob: string; house: string; street: string;
  locality: string; vtc: string; district: string; state: string; pincode: string;
} {
  const issuedToBlock = extractIssuedToBlock(xml);

  // Name — Person element first, then DL/cert element attributes
  const name = attrInTag(issuedToBlock, 'Person', 'name')
    || attrInTag(xml, 'Person', 'name')
    || attrInTag(xml, 'DrivingLicence', 'name')
    || attrInTag(xml, 'EpicDetails', 'name')
    || attrInTag(xml, 'Poi', 'name')
    || '';

  // DOB — same priority chain
  const dob = attrInTag(issuedToBlock, 'Person', 'dob')
    || attrInTag(xml, 'Person', 'dob')
    || attrInTag(xml, 'DrivingLicence', 'dob')
    || attrInTag(xml, 'EpicDetails', 'dob')
    || attrInTag(xml, 'Poi', 'dob')
    || '';

  // Strategy 1: <Address> / <Address2> / <Poa> elements (handled by parseAddressElement)
  const addr = parseAddressElement(issuedToBlock);
  if (addr.district || addr.state || addr.pincode || addr.house) {
    const { line1: _l, ...rest } = addr;
    return { name, dob, ...rest };
  }

  // Strategy 2: full XML fallback (in case IssuedTo wrapper is missing)
  const addrFull = parseAddressElement(xml);
  if (addrFull.district || addrFull.state || addrFull.pincode || addrFull.house) {
    const { line1: _l, ...rest } = addrFull;
    return { name, dob, ...rest };
  }

  // Strategy 3: Aadhaar-style <Poa> attributes (dist/pc etc.)
  const poaBlock = issuedToBlock || xml;
  const poaHouse    = attrInTag(poaBlock, 'Poa', 'house') || attrInTag(poaBlock, 'Poa', 'co');
  const poaStreet   = attrInTag(poaBlock, 'Poa', 'lm') || attrInTag(poaBlock, 'Poa', 'street');
  const poaLocality = attrInTag(poaBlock, 'Poa', 'loc');
  const poaVtc      = attrInTag(poaBlock, 'Poa', 'vtc') || attrInTag(poaBlock, 'Poa', 'subdist');
  const poaDist     = attrInTag(poaBlock, 'Poa', 'dist');
  const poaState    = attrInTag(poaBlock, 'Poa', 'state');
  const poaPin      = attrInTag(poaBlock, 'Poa', 'pc') || attrInTag(poaBlock, 'Poa', 'pincode') || attrInTag(poaBlock, 'Poa', 'pin');
  if (poaDist || poaState || poaPin || poaHouse) {
    return { name, dob, house: poaHouse, street: poaStreet, locality: poaLocality, vtc: poaVtc, district: poaDist, state: poaState, pincode: poaPin };
  }

  // Strategy 4: address attributes on the main certificate element (DrivingLicence, EpicDetails, etc.)
  const ga = (tag: string, attr: string) => attrInTag(xml, tag, attr);
  for (const certTag of ['DrivingLicence', 'EpicDetails', 'PassportDetails', 'RegistrationCertificate']) {
    const tagRe = new RegExp(`<${certTag}[\\s\\S]*?(?:\\/>|>)`, 'i');
    const certMatch = xml.match(tagRe);
    if (!certMatch) continue;
    const el = certMatch[0];
    const gEl = (attr: string) => { const r = new RegExp(`\\b${attr}=["']([^"']*)["']`, 'i'); const mm = el.match(r); return mm ? mm[1].trim() : ''; };
    const house    = gEl('house') || gEl('add1');
    const street   = gEl('line2') || gEl('street') || gEl('landmark') || gEl('lm') || gEl('add2');
    const locality = gEl('locality') || gEl('loc') || gEl('add3');
    const vtc      = gEl('vtc') || gEl('postOffice') || gEl('subDistrict') || gEl('add4');
    const district = gEl('district') || gEl('dist') || ga(certTag, 'district') || ga(certTag, 'dist');
    const state    = gEl('state') || ga(certTag, 'state');
    const pincode  = gEl('pin') || gEl('pc') || gEl('pincode');
    if (district || state || pincode || house) {
      return { name, dob, house, street, locality, vtc, district, state, pincode };
    }
  }

  // Final fallback — return whatever addr had (may be empty)
  const { line1: _line1, ...rest } = addr;
  return { name, dob, ...rest };
}

// ── Dedicated DL XML parser — covers all real-world RTO XML variants ──────────
function parseDlXml(xml: string): {
  name: string; dob: string; dlNumber: string;
  house: string; street: string; locality: string; vtc: string;
  district: string; state: string; pincode: string;
} {
  const ga = (tag: string, attr: string) => attrInTag(xml, tag, attr);
  const gEl = (tagEl: string, attr: string) => {
    const r = new RegExp(`\\b${attr}=["']([^"']*)["']`, 'i');
    const mm = tagEl.match(r);
    return mm ? mm[1].trim() : '';
  };
  const getTextEl = (attr: string) => {
    const r = new RegExp(`<${attr}[^>]*>([^<]+)<\/${attr}>`, 'i');
    const mm = xml.match(r);
    return mm ? mm[1].trim() : '';
  };

  // Name / DOB — Person, POI, or DrivingLicence element
  const name = ga('Person', 'name') || ga('POI', 'name') || ga('Poi', 'name') || ga('DrivingLicence', 'name') || '';
  const dob  = ga('Person', 'dob')  || ga('POI', 'dob')  || ga('Poi', 'dob')  || ga('DrivingLicence', 'dob')  || '';

  // DL number
  const dlNumber = attrInTag(xml, 'Certificate', 'number')
    || ga('DrivingLicence', 'dlno')
    || ga('DrivingLicence', 'number')
    || ga('CertificateData', 'dlno')
    || '';

  // ── Strategy 1: POA element with attributes ──────────────────────────────
  const poaTagRe = /<POA[\s\S]*?(?:\/>|>)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = poaTagRe.exec(xml)) !== null) {
    const t = pm[0];
    const house    = gEl(t, 'house') || gEl(t, 'add1') || gEl(t, 'co');
    const street   = gEl(t, 'street') || gEl(t, 'add2') || gEl(t, 'landmark') || gEl(t, 'lm');
    const locality = gEl(t, 'locality') || gEl(t, 'loc') || gEl(t, 'add3');
    const vtc      = gEl(t, 'vtc') || gEl(t, 'postoffice') || gEl(t, 'subdist') || gEl(t, 'add4');
    const district = gEl(t, 'district') || gEl(t, 'dist');
    const state    = gEl(t, 'state');
    const pincode  = gEl(t, 'pincode') || gEl(t, 'pin') || gEl(t, 'pc');
    if (district || state || pincode || house) {
      return { name, dob, dlNumber, house, street, locality, vtc, district, state, pincode };
    }
  }

  // ── Strategy 2: <Address> / <Poa> attributes (generic element names) ────
  const genericAddrRe = /<(?:Address2?|Poa|poa)[\s\S]*?(?:\/>|>)/gi;
  while ((pm = genericAddrRe.exec(xml)) !== null) {
    const t = pm[0];
    const house    = gEl(t, 'house') || gEl(t, 'add1');
    const street   = gEl(t, 'street') || gEl(t, 'add2') || gEl(t, 'landmark') || gEl(t, 'lm');
    const locality = gEl(t, 'locality') || gEl(t, 'loc') || gEl(t, 'add3');
    const vtc      = gEl(t, 'vtc') || gEl(t, 'postoffice') || gEl(t, 'add4');
    const district = gEl(t, 'district') || gEl(t, 'dist');
    const state    = gEl(t, 'state');
    const pincode  = gEl(t, 'pincode') || gEl(t, 'pin') || gEl(t, 'pc');
    if (district || state || pincode || house) {
      return { name, dob, dlNumber, house, street, locality, vtc, district, state, pincode };
    }
  }

  // ── Strategy 3: address attributes on <DrivingLicence> element itself ────
  const dlTagRe = /<DrivingLicence[\s\S]*?(?:\/>|>)/i;
  const dlMatch = xml.match(dlTagRe);
  if (dlMatch) {
    const el = dlMatch[0];
    const house    = gEl(el, 'house') || gEl(el, 'add1');
    const street   = gEl(el, 'street') || gEl(el, 'add2') || gEl(el, 'landmark');
    const locality = gEl(el, 'locality') || gEl(el, 'loc') || gEl(el, 'add3');
    const vtc      = gEl(el, 'vtc') || gEl(el, 'postoffice') || gEl(el, 'add4');
    const district = gEl(el, 'district') || gEl(el, 'dist');
    const state    = gEl(el, 'state');
    const pincode  = gEl(el, 'pin') || gEl(el, 'pc') || gEl(el, 'pincode');
    if (district || state || pincode || house) {
      return { name, dob, dlNumber, house, street, locality, vtc, district, state, pincode };
    }

    // presentaddress / permanentaddress as unstructured string fallback
    const addrStr = gEl(el, 'presentaddress') || gEl(el, 'permanentaddress');
    if (addrStr) {
      const p = parseAddressLine1(addrStr);
      return { name, dob, dlNumber, house: p.address || addrStr, street: '', locality: p.locality, vtc: '', district: p.district, state: p.state, pincode: p.pincode };
    }
  }

  // ── Strategy 4: child text elements e.g. <District>...</District> ────────
  const txtDistrict = getTextEl('District') || getTextEl('district');
  const txtState    = getTextEl('State')    || getTextEl('state');
  const txtPincode  = getTextEl('Pincode')  || getTextEl('PinCode') || getTextEl('Pin');
  const txtHouse    = getTextEl('House')    || getTextEl('HouseNo') || getTextEl('Address1');
  const txtStreet   = getTextEl('Street')   || getTextEl('Landmark') || getTextEl('Address2');
  const txtLocality = getTextEl('Locality') || getTextEl('Area') || getTextEl('Address3');
  const txtVtc      = getTextEl('VTC')      || getTextEl('PostOffice') || getTextEl('SubDistrict');
  if (txtDistrict || txtState || txtPincode || txtHouse) {
    return { name, dob, dlNumber, house: txtHouse, street: txtStreet, locality: txtLocality, vtc: txtVtc, district: txtDistrict, state: txtState, pincode: txtPincode };
  }

  return { name, dob, dlNumber, house: '', street: '', locality: '', vtc: '', district: '', state: '', pincode: '' };
}

function extractCertIdNumber(xml: string, doctype: 'dl' | 'passport' | 'voter_id'): string {
  const certRootNum = attrInTag(xml, 'Certificate', 'number');
  if (doctype === 'voter_id') {
    return attrInTag(xml, 'CertificateData', 'epicno')
      || attrInTag(xml, 'Person', 'epicno')
      || xmlAttr(xml, 'epicno')
      || certRootNum
      || '';
  }
  if (doctype === 'dl') {
    return certRootNum
      || attrInTag(xml, 'DrivingLicence', 'dlno')
      || attrInTag(xml, 'DrivingLicence', 'number')
      || attrInTag(xml, 'CertificateData', 'dlno')
      || attrInTag(xml, 'CertificateData', 'number')
      || attrInTag(xml, 'Person', 'number')
      || '';
  }
  return certRootNum
    || attrInTag(xml, 'CertificateData', 'number')
    || attrInTag(xml, 'Person', 'number')
    || '';
}

function parsePanXml(xml: string) {
  const panName   = attrInTag(xml, 'PAN', 'name') || attrInTag(xml, 'Person', 'name') || '';
  const panNumber = attrInTag(xml, 'PAN', 'number')
    || attrInTag(xml, 'CertificateData', 'number')
    || xmlAttr(xml, 'number');
  const dob = attrInTag(xml, 'PAN', 'dob') || attrInTag(xml, 'Person', 'dob') || xmlAttr(xml, 'dob');
  return { panNumber, name: panName, dob };
}

// ── DigiLocker direct: fetch user details ────────────────────────────────────
async function fetchUserDetails(accessToken: string): Promise<{ name: string; dob: string; gender: string }> {
  const res = await fetch(`${DIGILOCKER_API}/oauth2/2/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let data: any;
  try { data = await res.json(); } catch { data = {}; }
  return { name: data.name || '', dob: data.dob || '', gender: data.gender || '' };
}

function normalizeDob(dob: string): string {
  if (!dob) return '';
  if (dob.includes('-') || dob.includes('/')) return dob;
  if (dob.length === 8) return `${dob.slice(0, 2)}-${dob.slice(2, 4)}-${dob.slice(4, 8)}`;
  return dob;
}

type AddrResult = { house: string; street: string; locality: string; vtc: string; district: string; state: string; pincode: string; name?: string; dob?: string };
function hasAddress(a: AddrResult | null | undefined): boolean {
  return !!(a?.district || a?.state || a?.pincode || a?.house || a?.locality);
}

// ── DigiLocker direct: fetch KYC data ────────────────────────────────────────
async function fetchDigiLockerData(
  supabase: ReturnType<typeof createClient>,
  apiKey: string, apiSecret: string, authCode: string, redirectUri: string,
  userId: string, codeVerifier?: string,
): Promise<KycData> {
  const tokenData = await digiLockerTokenExchange(apiKey, apiSecret, authCode, redirectUri, codeVerifier);
  const { access_token: accessToken, eaadhaar: eaadhaarFlag } = tokenData;

  const tokenName = tokenData.name || '';
  const tokenDob = normalizeDob(tokenData.dob || '');

  const scopeUris = (tokenData.scope || '').split(/\s+/)
    .filter((s: string) => s.startsWith('issued/'))
    .map((s: string) => s.replace('issued/', ''));

  const docs = await fetchIssuedDocuments(accessToken);
  console.log('[fetchDigiLockerData] issued docs:', JSON.stringify(docs.map((d: any) => ({ uri: d.uri, type: d.type, doctype: d.doctype, issuerid: d.issuerid }))));
  const allUris = new Set(docs.map((d: any) => d.uri).filter(Boolean));
  for (const uri of scopeUris) {
    if (!allUris.has(uri)) {
      const parts = uri.split('-');
      const doctypeIdx = parts.findIndex((p: string) => /^[A-Z]{2,}$/.test(p));
      const doctype = doctypeIdx >= 0 ? parts[doctypeIdx] : '';
      const issuerid = doctypeIdx > 0 ? parts.slice(0, doctypeIdx).join('-') : '';
      docs.push({ uri, doctype, issuerid });
    }
  }

  const AADHAAR_DOCTYPES  = new Set(['EAADHAAR', 'ADHAR']);
  const AADHAAR_ISSUERS   = new Set(['in.gov.uidai']);
  const PAN_DOCTYPES      = new Set(['PANCR']);
  const PAN_ISSUERS       = new Set(['in.gov.pan', 'in.gov.cbdt']);
  const PASSPORT_DOCTYPES = new Set(['PASSIN', 'PASSPORT']);
  const PASSPORT_ISSUERS  = new Set(['in.gov.mea', 'in.gov.passport']);
  const VOTERID_DOCTYPES  = new Set(['VOTERID', 'EPICNO', 'EPIC']);
  const VOTERID_ISSUERS   = new Set(['in.gov.eci']);
  const DL_DOCTYPES       = new Set(['DRVLC', 'DL']);
  const DL_ISSUERS        = new Set(['in.gov.transport', 'in.gov.morth', 'in.gov.rto']);

  const isAadhaarDoc  = (d: any) => AADHAAR_DOCTYPES.has(d.doctype || d.type)  || AADHAAR_ISSUERS.has(d.issuerid);
  const isPanDoc      = (d: any) => PAN_DOCTYPES.has(d.doctype || d.type)       || PAN_ISSUERS.has(d.issuerid);
  const isPassportDoc = (d: any) => PASSPORT_DOCTYPES.has(d.doctype || d.type)  || PASSPORT_ISSUERS.has(d.issuerid);
  const isVoterDoc    = (d: any) => VOTERID_DOCTYPES.has(d.doctype || d.type)   || VOTERID_ISSUERS.has(d.issuerid);
  const isDlDoc       = (d: any) => DL_DOCTYPES.has(d.doctype || d.type) || DL_ISSUERS.has(d.issuerid) ||
    ['in.gov.transport', 'in.gov.morth', 'in.gov.rto'].some(p => (d.issuerid || '').startsWith(p));

  const aadhaarDoc =
    docs.find((d: any) => d.doctype === 'EAADHAAR') ||
    docs.find((d: any) => isAadhaarDoc(d)) ||
    (eaadhaarFlag === 'Y' ? { uri: '', doctype: 'EAADHAAR', issuerid: 'in.gov.uidai' } : undefined);
  const panDoc      = docs.find((d: any) => isPanDoc(d));
  const passportDoc = docs.find((d: any) => isPassportDoc(d));
  const voterDoc    = docs.find((d: any) => isVoterDoc(d));
  const dlDoc       = docs.find((d: any) => isDlDoc(d));
  console.log('[fetchDigiLockerData] dlDoc:', JSON.stringify(dlDoc || null));
  let aadhaarParsed: ReturnType<typeof parseAadhaarXml> | null = null;
  let aadhaarRawXml: string | null = null;

  try {
    const xml = await fetchEAadhaarXml(accessToken);
    aadhaarRawXml = xml;
    aadhaarParsed = parseAadhaarXml(xml);
  } catch { /* requires special partner privilege */ }

  if (!aadhaarParsed && aadhaarDoc?.uri) {
    try {
      const xml = await fetchDocumentXml(accessToken, aadhaarDoc.uri, 'aadhaar');
      aadhaarRawXml = xml;
      aadhaarParsed = parseAadhaarXml(xml);
    } catch { /* ignore */ }
  }

  let userDetailsName = '';
  let userDetailsDob = '';
  if (!aadhaarParsed) {
    try {
      const ud = await fetchUserDetails(accessToken);
      userDetailsName = ud.name;
      userDetailsDob = normalizeDob(ud.dob);
    } catch { /* non-fatal */ }
  }

  let panParsed: ReturnType<typeof parsePanXml> | null = null;
  let panRawXml: string | null = null;
  if (panDoc?.uri) {
    try {
      const xml = await fetchDocumentXml(accessToken, panDoc.uri, 'pan');
      panRawXml = xml;
      panParsed = parsePanXml(xml);
    } catch { /* ignore */ }
  }

  let addrProofType: AddressProofType = 'aadhar';
  let addrIdNumber = '';
  let addrRawXml: string | null = null;
  let addrParsed: AddrResult | null = null;

  if (aadhaarParsed && hasAddress(aadhaarParsed)) {
    addrProofType = 'aadhar';
    addrIdNumber = aadhaarParsed.aadhaarUid || '';
    addrRawXml = aadhaarRawXml;
    addrParsed = aadhaarParsed;
  }

  if (!addrParsed && passportDoc?.uri) {
    try {
      const xml = await fetchDocumentXml(accessToken, passportDoc.uri, 'passport');
      const parsed = parseCertificateAddressXml(xml);
      if (hasAddress(parsed)) {
        addrProofType = 'passport';
        addrIdNumber = extractCertIdNumber(xml, 'passport');
        addrRawXml = xml;
        addrParsed = parsed;
      }
    } catch { /* ignore */ }
  }

  let dlAttemptedButFailed = false;

  if (!addrParsed && dlDoc) {
    if (!dlDoc.uri) {
      dlAttemptedButFailed = true;
    } else {
      try {
        const xml = await fetchDocumentXml(accessToken, dlDoc.uri, 'dl');
        const parsed = parseDlXml(xml);
        console.log('[DL] parseDlXml result:', JSON.stringify({ name: parsed.name, dob: parsed.dob, dlNumber: parsed.dlNumber, district: parsed.district, state: parsed.state, pincode: parsed.pincode, house: parsed.house, locality: parsed.locality }));
        // Accept if we have any address data (house may hold a full address string)
        if (parsed.district || parsed.pincode || parsed.house || parsed.locality) {
          addrProofType = 'driving_license';
          addrIdNumber = parsed.dlNumber || extractCertIdNumber(xml, 'dl');
          addrRawXml = xml;
          addrParsed = parsed;
        } else {
          console.error('DL XML parsed but no address fields found. XML snippet:', xml.slice(0, 500));
          dlAttemptedButFailed = true;
        }
      } catch (e) {
        console.error('DL document fetch/parse error:', (e as Error).message);
        dlAttemptedButFailed = true;
      }
    }
  }

  if (!addrParsed && voterDoc?.uri) {
    try {
      const xml = await fetchDocumentXml(accessToken, voterDoc.uri, 'voterid');
      const parsed = parseCertificateAddressXml(xml);
      if (hasAddress(parsed)) {
        addrProofType = 'voter_id';
        addrIdNumber = extractCertIdNumber(xml, 'voter_id');
        addrRawXml = xml;
        addrParsed = parsed;
      }
    } catch { /* ignore */ }
  }

  if (!addrParsed) {
    throw new Error(dlAttemptedButFailed ? 'DRIVING_LICENSE_UNAVAILABLE' : 'ADDRESS_PROOF_UNAVAILABLE');
  }

  const addrFileKey = addrProofType === 'passport' ? 'passport'
    : addrProofType === 'driving_license' ? 'dl'
    : addrProofType === 'voter_id' ? 'voter_id'
    : 'aadhar';
  const [panPhotoUrl, addrFrontUrl, addrBackUrl] = await Promise.all([
    panRawXml  ? storeXmlFile(supabase, panRawXml,  userId, 'pan_photo')           : Promise.resolve(null),
    addrRawXml ? storeXmlFile(supabase, addrRawXml, userId, `${addrFileKey}_front`) : Promise.resolve(null),
    addrRawXml ? storeXmlFile(supabase, addrRawXml, userId, `${addrFileKey}_back`)  : Promise.resolve(null),
  ]);

  const addressParts = [addrParsed?.house, addrParsed?.street, addrParsed?.locality].filter(Boolean);

  return {
    pan_number:         panParsed?.panNumber      || '',
    full_name:          panParsed?.name || aadhaarParsed?.name || addrParsed?.name || userDetailsName || tokenName,
    dob:                panParsed?.dob  || aadhaarParsed?.dob  || addrParsed?.dob  || userDetailsDob  || tokenDob,
    address:            addressParts.join(', '),
    city:               addrParsed?.district || addrParsed?.vtc || '',
    state:              addrParsed?.state    || '',
    pincode:            addrParsed?.pincode  || '',
    id_number:          addrIdNumber,
    address_proof_type: addrProofType,
    pan_photo_url:      panPhotoUrl  || undefined,
    aadhaar_front_url:  addrFrontUrl || undefined,
    aadhaar_back_url:   addrBackUrl  || undefined,
  };
}

// ── Write KYC records to DB ───────────────────────────────────────────────────
async function writeKycRecords(supabase: ReturnType<typeof createClient>, userId: string, kycData: KycData, providerName: string, uploadIp?: string) {
  const now = new Date().toISOString();

  const panUpsert: Record<string, unknown> = {
    user_id: userId,
    pan_number: kycData.pan_number.toUpperCase(),
    status: 'verified',
    digilocker_verified: true,
    digilocker_provider: providerName,
    uploaded_at: now,
    upload_ip: uploadIp || null,
    approval_at: now,
    updated_at: now,
  };
  if (kycData.pan_photo_url) panUpsert.pan_photo_url = kycData.pan_photo_url;

  const { data: panRecord, error: panError } = await supabase
    .from('kyc_pan_verification')
    .upsert(panUpsert, { onConflict: 'user_id' })
    .select().single();

  if (panError) throw new Error('Failed to save PAN: ' + panError.message);

  let addressRecord = null;
  if (kycData.address || kycData.city || kycData.state || kycData.pincode || kycData.aadhaar_front_url) {
    const addrUpsert: Record<string, unknown> = {
      user_id: userId,
      id_number: kycData.id_number || null,
      address: kycData.address || '',
      city: kycData.city || '',
      state: kycData.state || '',
      pincode: kycData.pincode || '',
      proof_type: kycData.address_proof_type || 'aadhar',
      status: 'verified',
      digilocker_verified: true,
      digilocker_provider: providerName,
      uploaded_at: now,
      upload_ip: uploadIp || null,
      approval_at: now,
      updated_at: now,
    };
    if (kycData.aadhaar_front_url) addrUpsert.front_photo_url = kycData.aadhaar_front_url;
    if (kycData.aadhaar_back_url) addrUpsert.back_photo_url = kycData.aadhaar_back_url;

    const { data: addr, error: addrError } = await supabase
      .from('kyc_address_proof')
      .upsert(addrUpsert, { onConflict: 'user_id' })
      .select().single();

    if (!addrError) addressRecord = addr;
  }

  await supabase.from('users').update({ kyc_completed: true, updated_at: now }).eq('id', userId);
  return { panRecord, addressRecord };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body: DigiLockerKycRequest = await req.json();
    const { userId, action, authCode, verificationId: bodyVerificationId, redirectUri: bodyRedirectUri, codeChallenge, codeVerifier, ipAddress, platform } = body;

    if (!userId) throw new Error('Missing userId');

    const { data: userRow, error: userLookupError } = await supabase
      .from('users')
      .select('id, first_name, middle_name, last_name, email, mobile_number')
      .eq('id', userId)
      .maybeSingle();

    if (userLookupError || !userRow) throw new Error('Unauthorized');

    // For mobile requests, prefer a mobile-specific DigiLocker provider if one exists.
    // This allows a separate DigiLocker client (with the bridge URL registered as a
    // redirect URI) to be used for the mobile app.
    let providerQuery = supabase
      .from('kyc_method_settings')
      .select('*')
      .eq('is_enabled', true);

    if (platform === 'mobile') {
      providerQuery = providerQuery.eq('provider_name', 'DigiLocker Mobile');
    } else {
      providerQuery = providerQuery.neq('provider_name', 'DigiLocker Mobile');
    }
    providerQuery = providerQuery.order('is_default', { ascending: false }).limit(1);

    const { data: providers, error: providerError } = await providerQuery;

    // Fallback to any enabled provider if the platform-specific one isn't found
    if (providerError || !providers || providers.length === 0) {
      const { data: fallbackProviders } = await supabase
        .from('kyc_method_settings')
        .select('*')
        .eq('is_enabled', true)
        .order('is_default', { ascending: false })
        .limit(1);
      if (!fallbackProviders || fallbackProviders.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No DigiLocker provider is currently enabled.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      providers.push(...fallbackProviders);
    }

    const provider = providers[0];
    const isProduction = provider.environment === 'production';
    const apiKey = isProduction ? provider.production_api_key : provider.test_api_key;
    const apiSecret = isProduction ? provider.production_api_secret : provider.test_api_secret;
    const publicKey = isProduction ? (provider.production_public_key || '') : (provider.test_public_key || '');
    const savedRedirectUri = isProduction ? (provider.production_redirect_uri || '') : (provider.test_redirect_uri || '');

    if (!apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({ error: 'DigiLocker API credentials are not configured. Please contact support.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── get_auth_url ──────────────────────────────────────────────────────────
    if (action === 'get_auth_url') {
      if (provider.provider_name === 'CashFree DigiLocker') {
        const originHeader = req.headers.get('origin') || req.headers.get('referer') || '';
        let appOrigin = '';
        try { appOrigin = originHeader ? new URL(originHeader).origin : ''; } catch { /* ignore */ }
        if (!appOrigin || appOrigin.includes('supabase')) appOrigin = 'https://paybycard.in';
        const redirectUrl = `${appOrigin}/kyc-verification`;

        const { url, verificationId } = await createCashFreeVerification(
          apiKey, apiSecret, publicKey, provider.environment, userId, redirectUrl,
        );

        return new Response(
          JSON.stringify({ authUrl: url, verificationId, provider_name: provider.provider_name }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const bridgeUrl = `${supabaseUrl}/functions/v1/digilocker-redirect`;

        // The redirect_uri sent to DigiLocker must match what's registered in
        // the DigiLocker dashboard — that's the saved redirect URI (bridge URL).
        const redirectUri = savedRedirectUri || bridgeUrl;

        // Encode platform in state so the bridge function can choose HTTP vs JS redirect.
        // 'um' prefix = mobile (HTTP 302 redirect to paybycard:// scheme)
        // 'uw' prefix = web (postMessage to popup opener)
        const statePrefix = platform === 'mobile' ? 'um' : 'uw';
        const state = statePrefix + userId.replace(/-/g, '');
        const pkceParams = codeChallenge
          ? `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`
          : '';
        // Use v2 authorize endpoint when PKCE is involved — DigiLocker's v1
        // endpoint does not support code_challenge. The token exchange must
        // use the matching v2 token endpoint (already handled in
        // digiLockerTokenExchange).
        const authorizePath = codeChallenge
          ? '/oauth2/2/authorize'
          : '/oauth2/1/authorize';
        const authUrl =
          `${DIGILOCKER_API}${authorizePath}` +
          `?response_type=code&client_id=${apiKey}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}` +
          pkceParams;

        // Client redirect URI: the URL the app should intercept.
        // On mobile, openAuthSessionAsync should intercept the paybycard://
        // custom scheme (the bridge page redirects to it via JavaScript).
        // On web, the popup listens for postMessage from the bridge page.
        const clientRedirectUri = platform === 'mobile'
          ? 'paybycard://digilocker-callback'
          : redirectUri;

        return new Response(
          JSON.stringify({ authUrl, redirectUri: clientRedirectUri, provider_name: provider.provider_name }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ── check_status (CashFree only) ─────────────────────────────────────────
    if (action === 'check_status') {
      const vid = bodyVerificationId || authCode;
      if (!vid) throw new Error('Missing verificationId');

      if (provider.provider_name !== 'CashFree DigiLocker') {
        return new Response(
          JSON.stringify({ error: 'check_status only supported for CashFree DigiLocker' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await getCashFreeVerificationStatus(apiKey, apiSecret, publicKey, provider.environment, vid);
      return new Response(
        JSON.stringify({ status: result?.status || 'PENDING', raw: result }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── auto_approve ──────────────────────────────────────────────────────────
    if (action === 'auto_approve') {
      const code = authCode;
      if (!code) throw new Error('Authorization code / verification ID is required');

      let kycData: KycData;

      if (provider.provider_name === 'CashFree DigiLocker') {
        const statusData = await getCashFreeVerificationStatus(apiKey, apiSecret, publicKey, provider.environment, code);
        const consentStatus = statusData?.status || '';

        if (!['AUTHENTICATED', 'COMPLETED', 'SUCCESS'].includes(consentStatus.toUpperCase())) {
          if (userRow.mobile_number) await sendSms(supabaseUrl, supabaseKey, userRow.mobile_number, 'kyc_rejected');
          return new Response(
            JSON.stringify({
              success: false, autoApproved: false,
              error: `DigiLocker consent not yet granted (status: ${consentStatus}). Please complete the DigiLocker authorization and try again.`,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        kycData = await fetchCashFreeDocuments(supabase, apiKey, apiSecret, publicKey, provider.environment, code, userId);
      } else {
        // Token exchange must use the same redirect_uri that was sent in the
        // authorize request — the saved redirect URI registered with DigiLocker.
        // The client may send paybycard:// scheme as redirectUri (used for
        // openAuthSessionAsync interception), but DigiLocker's token endpoint
        // requires the actual registered redirect URI.
        let redirectUri = savedRedirectUri || '';
        if (!redirectUri || redirectUri.startsWith('paybycard://')) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
          redirectUri = `${supabaseUrl}/functions/v1/digilocker-redirect`;
        }
        try {
          kycData = await fetchDigiLockerData(supabase, apiKey, apiSecret, code, redirectUri, userId, codeVerifier);
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === 'DRIVING_LICENSE_UNAVAILABLE' || msg === 'ADDRESS_PROOF_UNAVAILABLE') {
            return new Response(
              JSON.stringify({ success: false, autoApproved: false, error: msg }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw e;
        }
      }

      if (!kycData.pan_number) {
        if (userRow.mobile_number) await sendSms(supabaseUrl, supabaseKey, userRow.mobile_number, 'kyc_rejected');
        return new Response(
          JSON.stringify({ success: false, autoApproved: false, error: 'Could not retrieve PAN from DigiLocker. Please use Manual KYC.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const nameResult = checkNameMatch(
        userRow.first_name || '', userRow.middle_name || '', userRow.last_name || '', kycData.full_name,
      );

      if (!nameResult.matches) {
        if (userRow.mobile_number) await sendSms(supabaseUrl, supabaseKey, userRow.mobile_number, 'kyc_rejected');
        return new Response(
          JSON.stringify({
            success: false, autoApproved: false, nameMatches: false,
            nameMismatch: {
              registeredName: nameResult.registeredName,
              kycName: nameResult.kycName,
              firstMatch: nameResult.firstMatch,
              middleMatch: nameResult.middleMatch,
              lastMatch: nameResult.lastMatch,
              firstName: userRow.first_name || '',
              middleName: userRow.middle_name || '',
              lastName: userRow.last_name || '',
            },
            kycData,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existingPan } = await supabase
        .from('kyc_pan_verification')
        .select('user_id')
        .eq('pan_number', kycData.pan_number.toUpperCase())
        .neq('user_id', userId)
        .maybeSingle();

      if (existingPan) {
        if (userRow.mobile_number) await sendSms(supabaseUrl, supabaseKey, userRow.mobile_number, 'kyc_rejected');
        return new Response(
          JSON.stringify({
            success: false, autoApproved: false,
            error: 'This PAN number is already registered with another account. Please use Manual KYC or contact support.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const resolvedIp = ipAddress ||
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip")?.trim() ||
        null;
      const { panRecord, addressRecord } = await writeKycRecords(supabase, userId, kycData, provider.provider_name, resolvedIp);

      try {
        const attachment = await getKycPolicyAttachment();
        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
          body: JSON.stringify({
            to: userRow.email,
            subject: 'KYC Verified via DigiLocker - Account Ready',
            body: `<p>Dear ${nameResult.registeredName},</p><p>Congratulations! Your KYC has been <strong style="color:#16a34a;">automatically verified</strong> via DigiLocker.</p><p>Your account is now fully active and ready for transactions.</p><p>Please find attached the accepted terms and conditions for your reference.</p>`,
            body_type: 'html',
            use_template: true,
            ...attachment,
          }),
        });
      } catch (_) { /* non-critical */ }

      if (userRow.mobile_number) await sendSms(supabaseUrl, supabaseKey, userRow.mobile_number, 'kyc_approved');

      return new Response(
        JSON.stringify({
          success: true, autoApproved: true, nameMatches: true,
          kycData, panRecord, addressRecord,
          message: 'KYC verified automatically via DigiLocker.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'An error occurred';
    console.error('DigiLocker KYC error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


// redeploy
