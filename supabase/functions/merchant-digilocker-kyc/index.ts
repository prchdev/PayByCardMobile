import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { withSignedKycUrls } from "../_shared/kycUrls.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface MerchantDigiLockerRequest {
  token: string;
  action: 'get_auth_url' | 'check_status' | 'auto_approve';
  authCode?: string;
  verificationId?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeVerifier?: string;
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

// ── Name / PAN normalization ──────────────────────────────────────────────────
function normalizePan(pan: string): string {
  return (pan || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Base URLs ─────────────────────────────────────────────────────────────────
function cashFreeBaseUrl(env: string): string {
  return env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
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

  const cryptoKey = await crypto.subtle.importKey(
    'spki', binaryDer.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-1' }, false, ['encrypt'],
  );

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

// ── CashFree: create verification session ────────────────────────────────────
async function createCashFreeVerification(
  apiKey: string, apiSecret: string, publicKey: string,
  environment: string, recordId: string, redirectUrl: string,
): Promise<{ url: string; verificationId: string }> {
  const baseUrl = cashFreeBaseUrl(environment);
  const suffix = recordId.replace(/-/g, '').slice(-8);
  const verificationId = `mo_${suffix}_${Math.floor(Date.now() / 1000)}`;

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
      throw new Error(`IP_WHITELIST_ERROR:${ip}:CashFree requires IP (${ip}) to be whitelisted.`);
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
    const msg = data.message || data.error_msg || JSON.stringify(data);
    throw new Error(msg || 'CashFree status check failed');
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
    const msg = data.message || data.error_msg || JSON.stringify(data);
    throw new Error(msg || `CashFree ${docType} fetch failed`);
  }

  return data;
}

// ── CashFree: fetch both docs ─────────────────────────────────────────────────
async function fetchCashFreeDocuments(
  supabase: ReturnType<typeof createClient>,
  apiKey: string, apiSecret: string, publicKey: string,
  environment: string, verificationId: string,
  merchantId: string,
): Promise<KycData> {
  const [aadhaarData, panData] = await Promise.all([
    getCashFreeDocument(apiKey, apiSecret, publicKey, environment, verificationId, 'AADHAAR'),
    getCashFreeDocument(apiKey, apiSecret, publicKey, environment, verificationId, 'PAN'),
  ]);

  const sa = aadhaarData?.split_address || {};
  const addressParts = [aadhaarData?.care_of, sa.house, sa.street, sa.landmark].filter(Boolean);

  const storeJson = async (data: any, fileKey: string): Promise<string | null> => {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
      const storagePath = `merchant_${merchantId}/${fileKey}.json`;
      const { error } = await supabase.storage
        .from('kyc-documents')
        .upload(storagePath, bytes.buffer, { contentType: 'application/json', upsert: true });
      if (error) return null;
      const { data: urlData } = supabase.storage.from('kyc-documents').getPublicUrl(storagePath);
      return urlData?.publicUrl || null;
    } catch { return null; }
  };

  const [aadhaarUrl, panUrl] = await Promise.all([
    aadhaarData ? storeJson(aadhaarData, 'aadhaar_data') : Promise.resolve(null),
    panData ? storeJson(panData, 'pan_data') : Promise.resolve(null),
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
    aadhaar_front_url: aadhaarUrl || undefined,
    pan_photo_url: panUrl || undefined,
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
    const errorMsg = data.error_description || data.error || `DigiLocker token exchange failed (HTTP ${res.status})`;
    throw new Error(errorMsg);
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
    const msg = data.error || data.message || JSON.stringify(data);
    throw new Error(msg || 'Failed to fetch issued documents from DigiLocker');
  }

  return items;
}

// ── DigiLocker direct: fetch a document XML by URI ───────────────────────────
async function fetchDocumentXml(accessToken: string, uri: string, label: string): Promise<string> {
  const res = await fetch(`${DIGILOCKER_API}/oauth2/1/xml/${encodeURIComponent(uri)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch ${label} document (${uri}): ${errText}`);
  }

  const outerXml = await res.text();

  const dataContentMatch = outerXml.match(/<DataContent[^>]*>([\s\S]*?)<\/DataContent>/i);
  let innerXml = outerXml;
  if (dataContentMatch) {
    try {
      innerXml = atob(dataContentMatch[1].trim());
    } catch {
      innerXml = outerXml;
    }
  }

  return innerXml;
}

// ── DigiLocker direct: store XML string to Supabase Storage ─────────────────
async function storeXmlFile(
  supabase: ReturnType<typeof createClient>,
  xmlContent: string,
  merchantId: string,
  fileKey: string,
): Promise<string | null> {
  try {
    const xmlBytes = new TextEncoder().encode(xmlContent);
    const storagePath = `merchant_${merchantId}/${fileKey}.xml`;
    const { error } = await supabase.storage
      .from('kyc-documents')
      .upload(storagePath, xmlBytes.buffer, { contentType: 'application/xml', upsert: true });
    if (error) {
      console.error(`storeXmlFile ${fileKey} failed:`, error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('kyc-documents').getPublicUrl(storagePath);
    return urlData?.publicUrl || null;
  } catch (e) {
    console.error(`storeXmlFile ${fileKey} exception:`, (e as Error).message);
    return null;
  }
}

// ── DigiLocker direct: fetch eAadhaar XML ────────────────────────────────────
async function fetchEAadhaarXml(accessToken: string): Promise<string> {
  const res = await fetch(`${DIGILOCKER_API}/oauth2/3/xml/eaadhaar`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch eAadhaar: ${errText}`);
  }

  return await res.text();
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

function extractFromLine1(line1: string): { address: string; pincode: string } {
  const pinMatch = line1.match(/\b(\d{6})\b/);
  const pincode = pinMatch ? pinMatch[1] : '';
  const address = line1.replace(/,\s*$/, '').trim();
  return { address, pincode };
}

function parseAddressElement(xml: string): {
  house: string; street: string; locality: string; vtc: string; district: string; state: string; pincode: string; line1: string;
} {
  const permanentRe = /<Address[\s\S]*?type=["'](permanent|present)[\s\S]*?>/i;
  const anyRe = /<Address[\s\S]*?>/i;
  const addrMatch = xml.match(permanentRe) || xml.match(anyRe);
  const addrTag = addrMatch ? addrMatch[0] : '';

  const ga = (attr: string) => {
    const re = new RegExp(`\\b${attr}=["']([^"']*)["']`, 'i');
    const m = addrTag.match(re);
    return m ? m[1].trim() : '';
  };

  return {
    house:    ga('house'),
    street:   ga('line2')   || ga('street') || ga('landmark'),
    locality: ga('locality') || ga('loc'),
    vtc:      ga('vtc')     || ga('postOffice') || ga('subDistrict'),
    district: ga('district') || ga('dist'),
    state:    ga('state'),
    pincode:  ga('pin')     || ga('pc') || ga('pincode'),
    line1:    ga('line1'),
  };
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

  const addrParsed = (!poaHouse && !poaDistrict) ? parseAddressElement(xml) : null;

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
  const name = attrInTag(xml, 'Person', 'name') || '';
  const dob  = attrInTag(xml, 'Person', 'dob')  || '';
  const addr = parseAddressElement(xml);

  const hasStructured = addr.district || addr.state || addr.pincode;
  if (!hasStructured && addr.line1) {
    const { address, pincode } = extractFromLine1(addr.line1);
    return { name, dob, house: address, street: '', locality: '', vtc: '', district: '', state: '', pincode };
  }

  return { name, dob, ...addr };
}

function parsePanXml(xml: string) {
  const panName   = attrInTag(xml, 'PAN', 'name') || attrInTag(xml, 'Person', 'name') || '';
  const panNumber = attrInTag(xml, 'PAN', 'number')
    || attrInTag(xml, 'CertificateData', 'number')
    || xmlAttr(xml, 'number');
  const dob = attrInTag(xml, 'PAN', 'dob') || attrInTag(xml, 'Person', 'dob') || xmlAttr(xml, 'dob');
  return { panNumber, name: panName, dob };
}

// ── DigiLocker direct: fetch user details ──────────────────────────────────
async function fetchUserDetails(accessToken: string): Promise<{ name: string; dob: string; gender: string }> {
  const res = await fetch(`${DIGILOCKER_API}/oauth2/1/user`, {
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

// ── DigiLocker direct: fetch both Aadhaar and PAN data ───────────────────────
async function fetchDigiLockerData(
  supabase: ReturnType<typeof createClient>,
  apiKey: string, apiSecret: string, authCode: string, redirectUri: string,
  merchantId: string,
  codeVerifier?: string,
): Promise<KycData> {
  const tokenData = await digiLockerTokenExchange(apiKey, apiSecret, authCode, redirectUri, codeVerifier);
  const { access_token: accessToken, eaadhaar: eaadhaarFlag } = tokenData;

  const tokenName = tokenData.name || '';
  const tokenDob = normalizeDob(tokenData.dob || '');

  const scopeUris = (tokenData.scope || '').split(/\s+/)
    .filter((s: string) => s.startsWith('issued/'))
    .map((s: string) => s.replace('issued/', ''));

  const docs = await fetchIssuedDocuments(accessToken);

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

  const isAadhaarDoc  = (d: any) => AADHAAR_DOCTYPES.has(d.doctype)  || AADHAAR_ISSUERS.has(d.issuerid);
  const isPanDoc      = (d: any) => PAN_DOCTYPES.has(d.doctype)       || PAN_ISSUERS.has(d.issuerid);
  const isPassportDoc = (d: any) => PASSPORT_DOCTYPES.has(d.doctype)  || PASSPORT_ISSUERS.has(d.issuerid);
  const isVoterDoc    = (d: any) => VOTERID_DOCTYPES.has(d.doctype)   || VOTERID_ISSUERS.has(d.issuerid);
  const isDlDoc       = (d: any) => DL_DOCTYPES.has(d.doctype)        || DL_ISSUERS.has(d.issuerid);

  const aadhaarDoc =
    docs.find((d: any) => d.doctype === 'EAADHAAR') ||
    docs.find((d: any) => isAadhaarDoc(d)) ||
    (eaadhaarFlag === 'Y' ? { uri: '', doctype: 'EAADHAAR', issuerid: 'in.gov.uidai' } : undefined);
  const panDoc      = docs.find((d: any) => isPanDoc(d));
  const passportDoc = docs.find((d: any) => isPassportDoc(d));
  const voterDoc    = docs.find((d: any) => isVoterDoc(d));
  const dlDoc       = docs.find((d: any) => isDlDoc(d));

  let aadhaarParsed: ReturnType<typeof parseAadhaarXml> | null = null;
  let aadhaarRawXml: string | null = null;

  try {
    const xml = await fetchEAadhaarXml(accessToken);
    aadhaarRawXml = xml;
    aadhaarParsed = parseAadhaarXml(xml);
  } catch { /* requires special partner privilege or eaadhaar not authorised */ }

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
  let addrParsed: ReturnType<typeof parseCertificateAddressXml> | ReturnType<typeof parseAadhaarXml> | null = null;

  const aadhaarHasAddress = !!(aadhaarParsed?.district || aadhaarParsed?.state || aadhaarParsed?.pincode || aadhaarParsed?.house);
  if (aadhaarParsed && aadhaarHasAddress) {
    addrProofType = 'aadhar';
    addrIdNumber = aadhaarParsed.aadhaarUid || '';
    addrRawXml = aadhaarRawXml;
    addrParsed = aadhaarParsed;
  }

  if (!addrParsed && passportDoc?.uri) {
    try {
      const xml = await fetchDocumentXml(accessToken, passportDoc.uri, 'passport');
      const parsed = parseCertificateAddressXml(xml);
      if (parsed.district || parsed.state || parsed.pincode || parsed.house) {
        addrProofType = 'passport';
        addrIdNumber = attrInTag(xml, 'Certificate', 'number') || '';
        addrRawXml = xml;
        addrParsed = parsed;
      }
    } catch { /* ignore */ }
  }

  if (!addrParsed && dlDoc?.uri) {
    try {
      const xml = await fetchDocumentXml(accessToken, dlDoc.uri, 'dl');
      const parsed = parseCertificateAddressXml(xml);
      if (parsed.district || parsed.state || parsed.pincode || parsed.house) {
        addrProofType = 'driving_license';
        addrIdNumber = attrInTag(xml, 'Certificate', 'number') || '';
        addrRawXml = xml;
        addrParsed = parsed;
      }
    } catch { /* ignore */ }
  }

  if (!addrParsed && voterDoc?.uri) {
    try {
      const xml = await fetchDocumentXml(accessToken, voterDoc.uri, 'voterid');
      const parsed = parseCertificateAddressXml(xml);
      if (parsed.district || parsed.state || parsed.pincode || parsed.house) {
        addrProofType = 'voter_id';
        addrIdNumber = attrInTag(xml, 'CertificateData', 'epicno')
          || attrInTag(xml, 'Person', 'epicno')
          || xmlAttr(xml, 'epicno')
          || attrInTag(xml, 'Certificate', 'number')
          || '';
        addrRawXml = xml;
        addrParsed = parsed;
      }
    } catch { /* ignore */ }
  }

  const addrFileKey = addrProofType === 'passport' ? 'passport'
    : addrProofType === 'driving_license' ? 'dl'
    : addrProofType === 'voter_id' ? 'voter_id'
    : 'aadhar';
  const [panPhotoUrl, addrFrontUrl, addrBackUrl] = await Promise.all([
    panRawXml
      ? storeXmlFile(supabase, panRawXml, merchantId, 'pan_photo')
      : Promise.resolve(null),
    addrRawXml
      ? storeXmlFile(supabase, addrRawXml, merchantId, `${addrFileKey}_front`)
      : Promise.resolve(null),
    addrRawXml
      ? storeXmlFile(supabase, addrRawXml, merchantId, `${addrFileKey}_back`)
      : Promise.resolve(null),
  ]);

  const addressParts = [
    (addrParsed as any)?.house,
    (addrParsed as any)?.street,
    (addrParsed as any)?.locality,
  ].filter(Boolean);

  return {
    pan_number:         panParsed?.panNumber || '',
    full_name:          panParsed?.name || aadhaarParsed?.name || userDetailsName || tokenName,
    dob:                panParsed?.dob  || aadhaarParsed?.dob  || userDetailsDob  || tokenDob,
    address:            addressParts.join(', '),
    city:               (addrParsed as any)?.district || (addrParsed as any)?.vtc || '',
    state:              (addrParsed as any)?.state    || '',
    pincode:            (addrParsed as any)?.pincode  || '',
    id_number:          addrIdNumber,
    address_proof_type: addrProofType,
    pan_photo_url:      panPhotoUrl   || undefined,
    aadhaar_front_url:  addrFrontUrl  || undefined,
    aadhaar_back_url:   addrBackUrl   || undefined,
  };
}

// ── Write verified KYC to merchant_onboarding ────────────────────────────────
async function writeMerchantKyc(
  supabase: ReturnType<typeof createClient>,
  record: any, kycData: KycData, providerName: string, ipAddress?: string,
) {
  const now = new Date().toISOString();

  const merchantUpdate: Record<string, unknown> = {
    pan_number: kycData.pan_number.toUpperCase(),
    full_name: kycData.full_name,
    dob: kycData.dob,
    id_number: kycData.id_number || null,
    address_proof_type: kycData.address_proof_type || 'aadhar',
    address: kycData.address,
    city: kycData.city,
    state: kycData.state,
    pincode: kycData.pincode,
    digilocker_verified: true,
    digilocker_provider: providerName,
    kyc_method: 'digilocker',
    status: 'verified',
    updated_at: now,
    kyc_completed_at: now,
  };
  if (ipAddress) merchantUpdate.ip_address = ipAddress;
  if (kycData.pan_photo_url)     merchantUpdate.pan_photo_url     = kycData.pan_photo_url;
  if (kycData.aadhaar_front_url) merchantUpdate.aadhaar_front_url = kycData.aadhaar_front_url;
  if (kycData.aadhaar_back_url)  merchantUpdate.aadhaar_back_url  = kycData.aadhaar_back_url;

  await supabase
    .from('merchant_onboarding')
    .update(merchantUpdate)
    .eq('id', record.id);

  if (record.payment_id) {
    await supabase
      .from('payments')
      .update({ status: 'settlement_pending', updated_at: now })
      .eq('id', record.payment_id)
      .in('status', ['kyc_pending', 'merchant_kyc_review']);

    await supabase.from('payment_logs').insert({
      payment_id: record.payment_id,
      status: 'settlement_pending',
      message: `Merchant KYC auto-verified via ${providerName}. PAN matches.`,
      metadata: { merchant_onboarding_id: record.id, pan_number: kycData.pan_number },
    });
  }
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
    const body: MerchantDigiLockerRequest = await req.json();
    const { token, action, authCode, verificationId: bodyVerificationId, redirectUri: bodyRedirectUri, codeChallenge, codeVerifier } = body;

    if (!token) throw new Error('Missing token');

    const { data: record, error: recordError } = await supabase
      .from('merchant_onboarding')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (recordError || !record) throw new Error('Invalid merchant token');
    if (record.status !== 'pending') throw new Error('This KYC form has already been completed or expired');

    const now = new Date();
    if (now > new Date(record.expires_at)) throw new Error('This link has expired');

    const { data: providers, error: providerError } = await supabase
      .from('kyc_method_settings')
      .select('*')
      .eq('is_enabled', true)
      .order('is_default', { ascending: false })
      .limit(1);

    if (providerError || !providers || providers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No DigiLocker provider is currently enabled.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = providers[0];
    const isProduction = provider.environment === 'production';
    const apiKey = isProduction ? provider.production_api_key : provider.test_api_key;
    const apiSecret = isProduction ? provider.production_api_secret : provider.test_api_secret;
    const publicKey = isProduction ? (provider.production_public_key || '') : (provider.test_public_key || '');
    const savedRedirectUri = isProduction ? (provider.production_redirect_uri || '') : (provider.test_redirect_uri || '');

    if (!apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({ error: 'DigiLocker API credentials are not configured.' }),
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
        const redirectUrl = `${appOrigin}/merchant-onboarding?token=${encodeURIComponent(token)}`;

        const { url, verificationId } = await createCashFreeVerification(
          apiKey, apiSecret, publicKey, provider.environment, record.id, redirectUrl,
        );
        return new Response(
          JSON.stringify({ authUrl: url, verificationId, provider_name: provider.provider_name }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        let redirectUri = savedRedirectUri;
        if (!redirectUri) {
          const originHeader = req.headers.get('origin') || req.headers.get('referer') || '';
          let appOrigin = '';
          try { appOrigin = originHeader ? new URL(originHeader).origin : ''; } catch { /* ignore */ }
          if (!appOrigin || appOrigin.includes('supabase')) appOrigin = 'https://paybycard.in';
          redirectUri = `${appOrigin}/digilocker-callback`;
        }
        const state = 'm' + record.id.replace(/-/g, '');
        const pkceParams = codeChallenge
          ? `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`
          : '';
        const authUrl =
          `${DIGILOCKER_API}/oauth2/1/authorize` +
          `?response_type=code&client_id=${apiKey}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}` +
          pkceParams;

        return new Response(
          JSON.stringify({ authUrl, redirectUri, provider_name: provider.provider_name }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ── check_status (CashFree only) ──────────────────────────────────────────
    if (action === 'check_status') {
      const vid = bodyVerificationId || authCode;
      if (!vid) throw new Error('Missing verificationId');

      const result = await getCashFreeVerificationStatus(
        apiKey, apiSecret, publicKey, provider.environment, vid,
      );
      const status = result?.status || 'PENDING';
      return new Response(
        JSON.stringify({ status, raw: result }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── auto_approve ──────────────────────────────────────────────────────────
    if (action === 'auto_approve') {
      const code = authCode;
      if (!code) throw new Error('Authorization code / verification ID is required');

      let kycData: KycData;

      if (provider.provider_name === 'CashFree DigiLocker') {
        const statusData = await getCashFreeVerificationStatus(
          apiKey, apiSecret, publicKey, provider.environment, code,
        );
        const consentStatus = statusData?.status || '';

        if (!['AUTHENTICATED', 'COMPLETED', 'SUCCESS'].includes(consentStatus.toUpperCase())) {
          if (record.mobile) await sendSms(supabaseUrl, supabaseKey, record.mobile, 'kyc_rejected');
          return new Response(
            JSON.stringify({ success: false, autoApproved: false, error: `DigiLocker consent not yet granted (status: ${consentStatus}).` }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        kycData = await fetchCashFreeDocuments(supabase, apiKey, apiSecret, publicKey, provider.environment, code, record.id);
      } else {
        const redirectUri = bodyRedirectUri || savedRedirectUri || '';
        kycData = await fetchDigiLockerData(supabase, apiKey, apiSecret, code, redirectUri, record.id, codeVerifier);
      }

      if (!kycData.pan_number) {
        if (record.mobile) await sendSms(supabaseUrl, supabaseKey, record.mobile, 'kyc_rejected');
        return new Response(
          JSON.stringify({ success: false, autoApproved: false, error: 'Could not retrieve PAN from DigiLocker. Please use Manual KYC.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const expectedPan = normalizePan(record.pan_number);
      const fetchedPan = normalizePan(kycData.pan_number);
      const panMatches = !expectedPan || expectedPan === fetchedPan;

      if (!panMatches) {
        if (record.mobile) await sendSms(supabaseUrl, supabaseKey, record.mobile, 'kyc_rejected');
        return new Response(
          JSON.stringify({
            success: false, autoApproved: false, panMismatch: true,
            expectedPan, fetchedPan, kycData,
            error: `PAN mismatch: expected ${expectedPan}, got ${fetchedPan}. Please use Manual KYC.`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ── Self-transfer check: merchant must not be the same person as the sender ──
      const normalize = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const merchantFullName = normalize(kycData.full_name || record.full_name || '');
      const merchantPan = normalizePan(kycData.pan_number);
      const merchantEmail = normalize(record.email || '');
      const merchantMobile = (record.mobile || '').replace(/\D/g, '').slice(-10);

      let senderUser: { full_name: string | null; first_name: string | null; last_name: string | null; email: string | null; mobile_number: string | null } | null = null;
      let senderUserId: string | null = null;
      if (record.payment_id) {
        const { data: payment } = await supabase
          .from('payments')
          .select('user_id')
          .eq('id', record.payment_id)
          .maybeSingle();
        if (payment?.user_id) {
          senderUserId = payment.user_id;
          const { data: sender } = await supabase
            .from('users')
            .select('full_name, first_name, last_name, email, mobile_number')
            .eq('id', payment.user_id)
            .maybeSingle();
          senderUser = sender;
        }
      }

      let senderPan: string | null = null;
      if (senderUserId) {
        const { data: senderKyc } = await supabase
          .from('kyc_pan_verification')
          .select('pan_number')
          .eq('user_id', senderUserId)
          .maybeSingle();
        senderPan = senderKyc?.pan_number || null;
      }

      const senderFullName = senderUser
        ? normalize(senderUser.full_name || `${senderUser.first_name || ''} ${senderUser.last_name || ''}`.trim())
        : normalize(record.sender_name || '');
      const senderEmail = senderUser ? normalize(senderUser.email || '') : '';
      const senderMobile = senderUser ? (senderUser.mobile_number || '').replace(/\D/g, '').slice(-10) : '';
      const senderPanNorm = senderPan ? senderPan.trim().toUpperCase() : '';

      const nameMatch = merchantFullName && senderFullName && merchantFullName === senderFullName;
      const emailMatch = senderEmail && merchantEmail && senderEmail === merchantEmail;
      const mobileMatch = senderMobile && merchantMobile && senderMobile === merchantMobile;
      const panMatch = senderPanNorm && merchantPan && senderPanNorm === merchantPan;

      if (nameMatch || emailMatch || mobileMatch || panMatch) {
        const matchedField = panMatch ? 'PAN number'
          : nameMatch ? 'name'
          : emailMatch ? 'email address'
          : 'mobile number';
        if (record.mobile) await sendSms(supabaseUrl, supabaseKey, record.mobile, 'kyc_rejected');
        return new Response(
          JSON.stringify({
            success: false, autoApproved: false,
            error: `Self-funds transfer is not allowed. The merchant ${matchedField} matches the sender's details. You cannot send money to yourself.`,
            self_transfer: true,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const ipAddress =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        undefined;
      await writeMerchantKyc(supabase, record, kycData, provider.provider_name, ipAddress);

      if (record.mobile) await sendSms(supabaseUrl, supabaseKey, record.mobile, 'kyc_approved');

      return new Response(
        JSON.stringify({ success: true, autoApproved: true, panMatches: true, kycData }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'An error occurred';
    console.error('Merchant DigiLocker KYC error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


// redeploy
