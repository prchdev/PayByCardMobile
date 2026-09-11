import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, BackHandler } from 'react-native';
import {
  ShieldCheck, CircleAlert as AlertCircle, CircleCheck as CheckCircle, Clock, Circle as XCircle,
  FileText, MapPin, Building2, User, Upload, ChevronRight, Smartphone, FileCheck, Save, Lock,
  ScanFace, RefreshCw as RefreshCwIcon, X, Trash2, CreditCard,
} from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { capitalizeName } from '../../utils/nameFormat';

// ── Constants ──────────────────────────────────────────────────────────────────
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

const ADDRESS_PROOF_TYPES = [
  { value: 'aadhar', label: 'Aadhar Card' },
  { value: 'passport', label: 'Passport' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'driving_license', label: 'Driving License' },
];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const COMPANY_TYPES = [
  'Sole Proprietorship', 'Partnership', 'Limited Liability Partnership (LLP)',
  'Private Limited Company', 'One Person Company (OPC)', 'Public Limited Company',
];

const COMPANY_TYPES_REQUIRING_INC_CERT = [
  'Limited Liability Partnership (LLP)',
  'Private Limited Company', 'One Person Company (OPC)', 'Public Limited Company',
];

const ID_NUMBER_PLACEHOLDERS: Record<string, string> = {
  aadhar: 'Enter 12-digit Aadhaar number',
  passport: 'Enter passport number (e.g. A1234567)',
  voter_id: 'Enter Voter ID number',
  driving_license: 'Enter driving licence number',
};

const POLL_INTERVAL = 3000;
const MAX_POLLS = 100;

// ── Types ──────────────────────────────────────────────────────────────────────
interface KycData {
  pan: PanData | null;
  address: AddressData | null;
  business: BusinessData | null;
  kycCompleted: boolean;
  userProfile: {
    first_name: string;
    middle_name: string;
    last_name: string;
    email: string;
    mobile_number: string;
  };
}

interface PanData {
  pan_number: string;
  pan_photo_url: string | null;
  status: string;
  digilocker_verified: boolean;
  digilocker_provider: string | null;
  rejection_reason: string | null;
  uploaded_at: string | null;
  upload_ip: string | null;
  approved_by_admin_id: string | null;
  approval_at: string | null;
  approval_ip: string | null;
}

interface AddressData {
  id_number: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  proof_type: string;
  front_photo_url: string | null;
  back_photo_url: string | null;
  status: string;
  digilocker_verified: boolean;
  digilocker_provider: string | null;
  rejection_reason: string | null;
  uploaded_at: string | null;
  upload_ip: string | null;
  approved_by_admin_id: string | null;
  approval_at: string | null;
  approval_ip: string | null;
}

interface BusinessData {
  company_type: string;
  business_name: string;
  incorporation_number: string;
  business_pan: string;
  gst_number: string;
  business_address: string;
  business_email: string;
  business_phone: string;
  incorporation_certificate_url: string | null;
  company_pan_photo_url: string | null;
  gst_certificate_url: string | null;
  loa_url: string | null;
  moa_url: string | null;
  aoa_url: string | null;
  status: string;
  rejection_reason: string | null;
  uploaded_at: string | null;
  upload_ip: string | null;
}

type DigiStep = 'idle' | 'loading_url' | 'waiting_popup' | 'polling' | 'verifying' | 'success' | 'error' | 'name_mismatch' | 'dl_unavailable';

interface NameMismatch {
  registeredName: string;
  kycName: string;
  firstMatch: boolean;
  middleMatch: boolean;
  lastMatch: boolean;
  firstName: string;
  middleName: string;
  lastName: string;
}

// ── Web file picker: uses a hidden HTML <input type="file"> to get a native File ─
function pickFileViaInput(acceptTypes: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptTypes.join(',');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.onchange = () => {
      const f = input.files?.[0];
      document.body.removeChild(input);
      resolve(f || null);
    };
    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = (typeof btoa !== 'undefined')
    ? btoa(binary)
    : (globalThis as any).Buffer?.from(binary, 'binary')?.toString('base64') || '';
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier(): string {
  const random = Crypto.getRandomBytes(48);
  return uint8ToBase64Url(random);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  if (Platform.OS === 'web') {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    let binary = '';
    for (let i = 0; i < hashArray.length; i++) binary += String.fromCharCode(hashArray[i]);
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    Crypto.CryptoEncoding.Base64,
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Event logger ───────────────────────────────────────────────────────────────
const clientIpRef: { current: string | null } = { current: null };

async function getClientIp(): Promise<string | null> {
  if (clientIpRef.current) return clientIpRef.current;
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    if (!res.ok) return null;
    const { ip } = await res.json();
    if (ip) clientIpRef.current = ip;
    return ip || null;
  } catch {
    return null;
  }
}

function logEvent(userId: string, provider: string, action: string, success: boolean, extra?: Record<string, unknown>) {
  fetch(`${SUPABASE_URL}/functions/v1/log-digilocker-event`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId, flow: 'user', action, provider, environment: '', success,
      ...(extra?.error_code ? { error_code: extra.error_code } : {}),
      ...(extra?.error_message ? { error_message: extra.error_message } : {}),
      raw_response: extra ? { ...extra, error_code: undefined, error_message: undefined } : undefined,
    }),
  }).catch(() => {});
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MobileKYCVerification() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout, sessionToken } = useAuth();

  const [kycStatus, setKycStatus] = useState<string>('loading');
  const [loading, setLoading] = useState(true);
  const [kycData, setKycData] = useState<KycData | null>(null);
  const [kycMethod, setKycMethod] = useState<'select' | 'digilocker' | 'manual'>('select');
  const [error, setError] = useState('');
  const [kycSettings, setKycSettings] = useState<{ digilocker_enabled: boolean; manual_enabled: boolean }>({ digilocker_enabled: false, manual_enabled: true });
  const [kycProvider, setKycProvider] = useState<{ provider_name: string } | null>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  // Personal details
  const [personalForm, setPersonalForm] = useState({ first_name: '', middle_name: '', last_name: '' });
  const [personalSaving, setPersonalSaving] = useState(false);
  const [personalSuccess, setPersonalSuccess] = useState(false);
  const [personalError, setPersonalError] = useState('');

  // PAN form
  const [panForm, setPanForm] = useState({ pan_number: '', pan_photo_url: '' });
  const [panSaving, setPanSaving] = useState(false);
  const [panError, setPanError] = useState('');

  // Address form
  const [addressForm, setAddressForm] = useState({
    proof_type: '', id_number: '', address: '', city: '', state: '', pincode: '',
    front_photo_url: '', back_photo_url: '',
  });
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressError, setAddressError] = useState('');

  // Business form
  const [businessForm, setBusinessForm] = useState({
    company_type: '', business_name: '', incorporation_number: '', business_pan: '',
    gst_number: '', business_address: '', business_email: '', business_phone: '',
    incorporation_certificate_url: '', company_pan_photo_url: '', gst_certificate_url: '',
    loa_url: '', moa_url: '', aoa_url: '',
  });
  const [businessSaving, setBusinessSaving] = useState(false);
  const [businessError, setBusinessError] = useState('');
  const [businessSuccess, setBusinessSuccess] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removingBusiness, setRemovingBusiness] = useState(false);
  const [showStatePicker, setShowStatePicker] = useState(false);

  // DigiLocker state
  const [digiStep, setDigiStep] = useState<DigiStep>('idle');
  const [digiError, setDigiError] = useState('');
  const [digiAddrError, setDigiAddrError] = useState<'DRIVING_LICENSE_UNAVAILABLE' | 'ADDRESS_PROOF_UNAVAILABLE' | null>(null);
  const [digiIpWhitelist, setDigiIpWhitelist] = useState('');
  const [digiVerificationId, setDigiVerificationId] = useState('');
  const [digiRedirectUri, setDigiRedirectUri] = useState('');
  const [digiPollCount, setDigiPollCount] = useState(0);
  const [digiNameMismatch, setDigiNameMismatch] = useState<NameMismatch | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(digiStep);
  const verificationIdRef = useRef(digiVerificationId);
  const redirectUriRef = useRef(digiRedirectUri);
  const codeVerifierRef = useRef<string>('');
  const codeReceivedRef = useRef(false);

  useEffect(() => { stepRef.current = digiStep; }, [digiStep]);
  useEffect(() => { verificationIdRef.current = digiVerificationId; }, [digiVerificationId]);
  useEffect(() => { redirectUriRef.current = digiRedirectUri; }, [digiRedirectUri]);
  useEffect(() => () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }, []);

  // ── Data fetching ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchKycStatus();
    fetchKycSettings();
    fetchKycProvider();
  }, [userId]);

  // Handle Android hardware back button — go to Dashboard, not Login
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      navigate('/mobile/dashboard', { state: { userId, userEmail } });
      return true;
    });
    return () => backHandler.remove();
  }, [userId, userEmail]);

  useEffect(() => {
    if (userId && (kycStatus === 'not_started' || kycStatus === 'rejected' || kycStatus === 'pending' || kycStatus === 'incomplete')) {
      fetchKycData();
    }
  }, [userId, kycStatus]);

  const fetchKycStatus = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setKycStatus(data.isVerified ? 'verified' : data.status || 'not_started');
      else setKycStatus('not_started');
    } catch { setKycStatus('not_started'); }
    finally { setLoading(false); }
  };

  const fetchKycSettings = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-kyc-settings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) setKycSettings(data);
    } catch {}
  };

  const fetchKycProvider = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-kyc-provider`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.provider) setKycProvider(data.provider);
    } catch {}
  };

  const fetchKycData = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-kyc-data`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        setKycData(data);
        if (data.userProfile) setPersonalForm({
          first_name: data.userProfile.first_name || '',
          middle_name: data.userProfile.middle_name || '',
          last_name: data.userProfile.last_name || '',
        });
        if (data.pan) setPanForm({ pan_number: data.pan.pan_number || '', pan_photo_url: data.pan.pan_photo_url || '' });
        if (data.address) setAddressForm({
          proof_type: data.address.proof_type || '',
          id_number: data.address.id_number || '',
          address: data.address.address || '',
          city: data.address.city || '',
          state: data.address.state || '',
          pincode: data.address.pincode || '',
          front_photo_url: data.address.front_photo_url || '',
          back_photo_url: data.address.back_photo_url || '',
        });
        if (data.business) setBusinessForm({
          company_type: data.business.company_type || '',
          business_name: data.business.business_name || '',
          incorporation_number: data.business.incorporation_number || '',
          business_pan: data.business.business_pan || '',
          gst_number: data.business.gst_number || '',
          business_address: data.business.business_address || '',
          business_email: data.business.business_email || '',
          business_phone: data.business.business_phone || '',
          incorporation_certificate_url: data.business.incorporation_certificate_url || '',
          company_pan_photo_url: data.business.company_pan_photo_url || '',
          gst_certificate_url: data.business.gst_certificate_url || '',
          loa_url: data.business.loa_url || '',
          moa_url: data.business.moa_url || '',
          aoa_url: data.business.aoa_url || '',
        });
      }
    } catch {}
  };

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  // ── File upload ────────────────────────────────────────────────────────────
  const uploadFile = async (fileKey: string, acceptTypes: string[]): Promise<string | null> => {
    try {
      setUploadingField(fileKey);
      const uploadUrl = `${SUPABASE_URL}/functions/v1/upload-kyc-file`;

      if (Platform.OS === 'web') {
        const fileObj = await pickFileViaInput(acceptTypes);
        if (!fileObj) return null;
        if (fileObj.size > 5 * 1024 * 1024) {
          setError(`File "${fileObj.name}" exceeds the 5 MB limit.`);
          return null;
        }
        const fd = new FormData();
        fd.append('file', fileObj);
        fd.append('fileKey', fileKey);
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'x-pbc-session': sessionToken || '',
          },
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data.url;
      } else {
        // On native, use expo-document-picker and upload via XMLHttpRequest.
        // XHR on React Native natively supports {uri, name, type} in FormData,
        // so we can send the file directly without reading it into memory.
        const result = await DocumentPicker.getDocumentAsync({
          type: acceptTypes,
          copyToCacheDirectory: false,
        });
        if (result.canceled || !result.assets?.length) return null;
        const file = result.assets[0];
        if (file.size > 5 * 1024 * 1024) {
          setError(`File "${file.name}" exceeds the 5 MB limit.`);
          return null;
        }
        const mimeType = file.mimeType || 'image/jpeg';

        const uploadResult = await new Promise<string | null>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', uploadUrl);
          xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
          xhr.setRequestHeader('x-pbc-session', sessionToken || '');

          xhr.onload = () => {
            try {
              const respData = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(respData.url || null);
              } else {
                reject(new Error(respData.error || 'Upload failed'));
              }
            } catch {
              reject(new Error('Upload failed — invalid response'));
            }
          };
          xhr.onerror = () => reject(new Error('Network error during upload'));

          const formData = new FormData();
          formData.append('file', { uri: file.uri, name: file.name, type: mimeType } as any);
          formData.append('fileKey', fileKey);
          xhr.send(formData);
        });
        return uploadResult;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload file');
      return null;
    } finally { setUploadingField(null); }
  };

  // ── DigiLocker flow ────────────────────────────────────────────────────────
  const startDigiLockerAuth = async () => {
    setDigiStep('loading_url');
    setDigiError('');
    setDigiNameMismatch(null);
    setDigiAddrError(null);
    try {
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      codeVerifierRef.current = codeVerifier;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/digilocker-kyc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          action: 'get_auth_url',
          codeChallenge,
          platform: 'web',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get authorization URL');

      const url: string = data.authUrl;
      const vid: string = data.verificationId || '';
      const rUri: string = data.redirectUri || '';

      setDigiVerificationId(vid);
      verificationIdRef.current = vid;
      setDigiRedirectUri(rUri);
      redirectUriRef.current = rUri;
      codeReceivedRef.current = false;

      // Set step to waiting_popup BEFORE opening the browser so the
      // cancel handler can properly detect the state when the browser closes.
      setDigiStep('waiting_popup');
      stepRef.current = 'waiting_popup';

      logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'popup_opened', true, { redirect_uri: rUri });

      // Use openAuthSessionAsync — on Android this opens a Custom Chrome Tab,
      // on iOS it opens ASWebAuthenticationSession.
      // Both intercept the redirect URL and return the full redirect URL with
      // the authorization code — no manual paste needed.
      const redirectUrl = rUri || (Platform.OS === 'web'
        ? `${window.location.origin}/digilocker-callback`
        : 'paybycard://digilocker-callback');

      try {
        await WebBrowser.warmUpAsync(redirectUrl);
      } catch {}

      const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl, {
        toolbarColor: '#8c76f0',
        controlsColor: '#8c76f0',
        showTitle: true,
        enableBarCollapsing: true,
      });

      try {
        WebBrowser.coolDownAsync(redirectUrl);
      } catch {}

      if (result.type === 'success' && result.url) {
        try {
          const code = new URL(result.url).searchParams.get('code');
          const errParam = new URL(result.url).searchParams.get('error');
          if (code && !codeReceivedRef.current) {
            codeReceivedRef.current = true;
            runAutoApprove(code);
          } else if (errParam) {
            setDigiStep('error');
            setDigiError(`DigiLocker authorization failed: ${errParam}`);
          } else {
            // Redirect URL matched but no code — treat as cancel
            if (!codeReceivedRef.current) {
              setDigiStep('error');
              setDigiError('DigiLocker authorization did not return a code. Please try again.');
            }
          }
        } catch {
          if (!codeReceivedRef.current) {
            setDigiStep('error');
            setDigiError('DigiLocker authorization failed. Please try again.');
          }
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // Browser was closed by the user — reset to idle so they can retry
        if (!codeReceivedRef.current) {
          setDigiStep('idle');
          setDigiError('');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to connect to DigiLocker';
      logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'get_auth_url_error', false, {
        error_code: 'GET_AUTH_URL_FAILED', error_message: msg,
      });
      if (msg.startsWith('IP_WHITELIST_ERROR:')) {
        const parts = msg.split(':');
        setDigiIpWhitelist(parts[1] || '');
        setDigiError('ip_whitelist');
      } else {
        setDigiError(msg);
      }
      setDigiStep('error');
    }
  };

  const startPolling = (vid: string) => {
    setDigiStep('polling');
    setDigiPollCount(0);
    schedulePoll(vid, 0);
  };

  const schedulePoll = (vid: string, count: number) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => doPoll(vid, count), POLL_INTERVAL);
  };

  const doPoll = async (vid: string, count: number) => {
    if (count >= MAX_POLLS) {
      logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'poll_timeout', false, {
        error_code: 'POLL_TIMEOUT', error_message: `Timed out after ${count} polls`, poll_count: count,
      });
      setDigiStep('error');
      setDigiError('DigiLocker authorization timed out. Please try again.');
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/digilocker-kyc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'check_status', verificationId: vid }),
      });
      const data = await res.json();
      const status: string = (data.status || '').toUpperCase();
      setDigiPollCount(count + 1);

      if (status === 'AUTHENTICATED' || status === 'COMPLETED' || status === 'SUCCESS') {
        logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'poll_authenticated', true, { status, poll_count: count + 1 });
        runAutoApprove(vid);
      } else if (status === 'CONSENT_DENIED') {
        logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'poll_consent_denied', false, {
          error_code: 'CONSENT_DENIED', error_message: 'User denied consent in DigiLocker', poll_count: count + 1,
        });
        setDigiStep('error');
        setDigiError('You denied consent in DigiLocker. Please try again or use Manual KYC.');
      } else if (status === 'EXPIRED') {
        logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'poll_expired', false, {
          error_code: 'SESSION_EXPIRED', error_message: 'DigiLocker authorization link expired', poll_count: count + 1,
        });
        setDigiStep('error');
        setDigiError('DigiLocker authorization link expired. Please start again.');
      } else {
        schedulePoll(vid, count + 1);
      }
    } catch {
      schedulePoll(vid, count + 1);
    }
  };

  const runAutoApprove = async (code: string) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setDigiStep('verifying');
    setDigiError('');

    const resolvedRedirectUri = redirectUriRef.current || undefined;
    const resolvedCodeVerifier = codeVerifierRef.current || undefined;

    logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'auto_approve_start', true, {
      has_redirect_uri: !!resolvedRedirectUri, has_code_verifier: !!resolvedCodeVerifier,
    });

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/digilocker-kyc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, action: 'auto_approve', authCode: code,
          redirectUri: resolvedRedirectUri, codeVerifier: resolvedCodeVerifier,
          platform: 'web',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'DigiLocker verification failed');

      if (data.autoApproved) {
        logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'auto_approve_success', true, {
          has_pan: !!(data.kycData?.pan_number), has_id: !!(data.kycData?.id_number),
        });
        setDigiStep('success');
        fetchKycStatus();
        fetchKycData();
      } else if (data.error === 'DRIVING_LICENSE_UNAVAILABLE' || data.error === 'ADDRESS_PROOF_UNAVAILABLE') {
        logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'auto_approve_addr_unavailable', false, { error_code: data.error });
        setDigiAddrError(data.error);
        setDigiStep('dl_unavailable');
      } else if (data.nameMismatch) {
        logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'auto_approve_name_mismatch', false, { error_code: 'NAME_MISMATCH' });
        setDigiNameMismatch(data.nameMismatch);
        setDigiStep('name_mismatch');
      } else {
        logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'auto_approve_failed', false, {
          error_code: data.error ? 'BUSINESS_ERROR' : 'UNKNOWN', error_message: data.error || 'No autoApproved flag',
        });
        setDigiStep('error');
        setDigiError(data.error || 'DigiLocker verification could not be completed.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verification failed';
      logEvent(userId!, kycProvider?.provider_name || 'DigiLocker', 'auto_approve_exception', false, {
        error_code: 'FETCH_EXCEPTION', error_message: msg,
      });
      setDigiStep('error');
      setDigiError(msg);
    }
  };

  const retryDigiLocker = () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setDigiStep('idle');
    setDigiError('');
    setDigiAddrError(null);
    setDigiNameMismatch(null);
    setDigiVerificationId('');
    setDigiRedirectUri('');
    redirectUriRef.current = '';
    setDigiPollCount(0);
    codeReceivedRef.current = false;
    codeVerifierRef.current = '';
  };

  // ── Save KYC sections ──────────────────────────────────────────────────────
  const saveKycSection = async (section: 'pan' | 'address' | 'business', data: Record<string, unknown>, ipAddress?: string | null): Promise<boolean> => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/save-kyc-data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, section, data, ipAddress }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Save failed');
    return true;
  };

  // ── Personal details save ──────────────────────────────────────────────────
  const handlePersonalSave = async () => {
    setPersonalError('');
    if (!personalForm.first_name.trim()) { setPersonalError('First name is required.'); return; }
    if (!personalForm.last_name.trim()) { setPersonalError('Last name is required.'); return; }

    setPersonalSaving(true);
    setPersonalSuccess(false);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-user-profile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          first_name: capitalizeName(personalForm.first_name),
          middle_name: capitalizeName(personalForm.middle_name),
          last_name: capitalizeName(personalForm.last_name),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setPersonalError(data.error || 'Failed to save.'); return; }
      setPersonalSuccess(true);
      setTimeout(() => setPersonalSuccess(false), 3000);
      fetchKycData();
    } catch {
      setPersonalError('Failed to save profile.');
    } finally { setPersonalSaving(false); }
  };

  // ── PAN submit ─────────────────────────────────────────────────────────────
  const handlePanSubmit = async () => {
    setPanError('');
    if (!panForm.pan_number.trim()) { setPanError('PAN number is required.'); return; }
    const panClean = panForm.pan_number.toUpperCase();
    if (!/^[A-Z0-9]+$/.test(panClean)) { setPanError('PAN number must contain only letters (A-Z) and numbers.'); return; }
    if (panClean.length !== 10) { setPanError('PAN number must be exactly 10 characters.'); return; }
    if (!PAN_REGEX.test(panClean)) { setPanError('Please enter a valid PAN number (e.g., ABCDE1234F).'); return; }

    const panChanged = panClean !== (kycData?.pan?.pan_number ?? '');
    if (panChanged && !panForm.pan_photo_url && !kycData?.pan?.pan_photo_url) { setPanError('PAN card photo is required when updating PAN number.'); return; }
    if (panChanged && !panForm.pan_photo_url) { setPanError('Please upload a new PAN card photo when changing the PAN number.'); return; }

    setPanSaving(true);
    try {
      const ip = await getClientIp();
      await saveKycSection('pan', {
        pan_number: panClean,
        pan_photo_url: panForm.pan_photo_url || kycData?.pan?.pan_photo_url || null,
      }, ip);
      fetchKycData();
      fetchKycStatus();
    } catch (e) {
      setPanError(e instanceof Error ? e.message : 'Failed to save PAN details.');
    } finally { setPanSaving(false); }
  };

  // ── Address submit ─────────────────────────────────────────────────────────
  const handleAddressSubmit = async () => {
    setAddressError('');
    const proofLabel = ADDRESS_PROOF_TYPES.find(p => p.value === addressForm.proof_type)?.label ?? 'Document';
    const idNumberLabel = addressForm.proof_type ? `${proofLabel} Number` : 'ID Number';

    if (!addressForm.id_number.trim()) { setAddressError(`${idNumberLabel} is required.`); return; }
    if (addressForm.proof_type === 'aadhar' && !/^\d{12}$/.test(addressForm.id_number.replace(/\s/g, ''))) {
      setAddressError('Enter a valid 12-digit Aadhaar number.'); return;
    }
    if (!addressForm.address.trim()) { setAddressError('Address is required.'); return; }
    if (!/^[A-Za-z0-9 \-.,()]+$/.test(addressForm.address)) {
      setAddressError('Address may only contain letters, numbers, spaces, and - . , ( )'); return;
    }
    if (addressForm.address.length > 500) { setAddressError('Address must not exceed 500 characters.'); return; }
    if (!addressForm.city.trim()) { setAddressError('City is required.'); return; }
    if (!/^[A-Za-z ]+$/.test(addressForm.city)) { setAddressError('City must contain only letters and spaces.'); return; }
    if (addressForm.city.length > 20) { setAddressError('City must not exceed 20 characters.'); return; }
    if (!addressForm.state) { setAddressError('State is required.'); return; }
    if (!addressForm.pincode.trim() || !/^\d{6}$/.test(addressForm.pincode)) { setAddressError('Enter a valid 6-digit pincode.'); return; }
    if (!addressForm.proof_type) { setAddressError('Please select a proof document type.'); return; }

    const isDigiLocker = !!(kycData?.address?.digilocker_verified);
    if (!isDigiLocker) {
      if (!addressForm.front_photo_url && !kycData?.address?.front_photo_url) { setAddressError('Front photo of proof document is required.'); return; }
      if (!addressForm.back_photo_url && !kycData?.address?.back_photo_url) { setAddressError('Back photo of proof document is required.'); return; }
    }

    setAddressSaving(true);
    try {
      const ip = await getClientIp();
      await saveKycSection('address', {
        id_number: addressForm.id_number.trim(),
        address: addressForm.address,
        city: addressForm.city,
        state: addressForm.state,
        pincode: addressForm.pincode,
        proof_type: addressForm.proof_type,
        front_photo_url: addressForm.front_photo_url || kycData?.address?.front_photo_url || null,
        back_photo_url: addressForm.back_photo_url || kycData?.address?.back_photo_url || null,
      }, ip);
      fetchKycData();
      fetchKycStatus();
    } catch (e) {
      setAddressError(e instanceof Error ? e.message : 'Failed to save address details.');
    } finally { setAddressSaving(false); }
  };

  // ── Business submit ───────────────────────────────────────────────────────
  const handleBusinessSubmit = async () => {
    setBusinessError('');
    setBusinessSuccess(false);

    if (!businessForm.company_type) { setBusinessError('Please select a Company Type.'); return; }
    if (!businessForm.business_name.trim()) { setBusinessError('Business / Company Registration Name is required.'); return; }
    if (!/^[A-Za-z0-9&.\- ]+$/.test(businessForm.business_name)) { setBusinessError('Company Name may only contain letters, numbers, &, ., -, and spaces.'); return; }
    if (businessForm.business_name.length > 150) { setBusinessError('Company Name must not exceed 150 characters.'); return; }
    if (!businessForm.incorporation_number.trim()) { setBusinessError('Business / Company Incorporation Number is required.'); return; }
    if (!/^[A-Za-z0-9]+$/.test(businessForm.incorporation_number)) { setBusinessError('Incorporation Number (CIN) may only contain letters and numbers.'); return; }
    if (businessForm.incorporation_number.length > 21) { setBusinessError('Incorporation Number (CIN) must not exceed 21 characters.'); return; }
    if (!businessForm.business_pan.trim()) { setBusinessError('Business PAN is required.'); return; }
    if (!PAN_REGEX.test(businessForm.business_pan)) { setBusinessError('Business PAN must be in the format AAAAA9999A (10 characters).'); return; }
    if (businessForm.gst_number.trim()) {
      if (!/^[A-Za-z0-9]+$/.test(businessForm.gst_number)) { setBusinessError('GST Number may only contain letters and numbers.'); return; }
      if (businessForm.gst_number.length !== 15) { setBusinessError('GST Number must be exactly 15 characters.'); return; }
    }
    if (!businessForm.business_address.trim()) { setBusinessError('Business Address is required.'); return; }
    if (businessForm.business_address.trim().length < 10) { setBusinessError('Business Address must be at least 10 characters.'); return; }
    if (businessForm.business_address.length > 500) { setBusinessError('Business Address must not exceed 500 characters.'); return; }
    if (!businessForm.business_email.trim()) { setBusinessError('Business Email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessForm.business_email)) { setBusinessError('Please enter a valid Business Email address.'); return; }
    if (!businessForm.business_phone.trim()) { setBusinessError('Business Phone Number is required.'); return; }
    if (!/^[0-9]{10}$/.test(businessForm.business_phone)) { setBusinessError('Business Phone Number must be exactly 10 digits.'); return; }

    const requiresIncCert = COMPANY_TYPES_REQUIRING_INC_CERT.includes(businessForm.company_type);
    const requiresGstCert = businessForm.gst_number.trim().length > 0;
    const requiresMoaAoa = businessForm.company_type === 'Private Limited Company' || businessForm.company_type === 'One Person Company (OPC)';

    if (requiresIncCert && !businessForm.incorporation_certificate_url && !kycData?.business?.incorporation_certificate_url) {
      setBusinessError('Business / Company Incorporation Certificate is required for ' + businessForm.company_type + '.'); return;
    }
    if (!businessForm.company_pan_photo_url && !kycData?.business?.company_pan_photo_url) {
      setBusinessError('Company PAN Photo is required.'); return;
    }
    if (requiresGstCert && !businessForm.gst_certificate_url && !kycData?.business?.gst_certificate_url) {
      setBusinessError('GST Certificate is required when a GST Number is provided.'); return;
    }
    if (!businessForm.loa_url && !kycData?.business?.loa_url) {
      setBusinessError('Letter of Authorization (LoA) is mandatory for business info submission.'); return;
    }
    if (requiresMoaAoa) {
      if (!businessForm.moa_url && !kycData?.business?.moa_url) { setBusinessError('Memorandum of Association (MoA) is required for ' + businessForm.company_type + '.'); return; }
      if (!businessForm.aoa_url && !kycData?.business?.aoa_url) { setBusinessError('Articles of Association (AoA) is required for ' + businessForm.company_type + '.'); return; }
    }

    setBusinessSaving(true);
    try {
      const ip = await getClientIp();
      await saveKycSection('business', {
        company_type: businessForm.company_type,
        business_name: businessForm.business_name,
        incorporation_number: businessForm.incorporation_number,
        business_pan: businessForm.business_pan,
        gst_number: businessForm.gst_number,
        business_address: businessForm.business_address,
        business_email: businessForm.business_email,
        business_phone: businessForm.business_phone,
        incorporation_certificate_url: businessForm.incorporation_certificate_url || kycData?.business?.incorporation_certificate_url || null,
        company_pan_photo_url: businessForm.company_pan_photo_url || kycData?.business?.company_pan_photo_url || null,
        gst_certificate_url: businessForm.gst_certificate_url || kycData?.business?.gst_certificate_url || null,
        loa_url: businessForm.loa_url || kycData?.business?.loa_url || null,
        moa_url: requiresMoaAoa ? (businessForm.moa_url || kycData?.business?.moa_url || null) : null,
        aoa_url: requiresMoaAoa ? (businessForm.aoa_url || kycData?.business?.aoa_url || null) : null,
      }, ip);
      setBusinessSuccess(true);
      fetchKycData();
      fetchKycStatus();
    } catch (e) {
      setBusinessError(e instanceof Error ? e.message : 'Failed to save business details.');
    } finally { setBusinessSaving(false); }
  };

  const handleRemoveBusiness = async () => {
    setBusinessError('');
    setRemovingBusiness(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/remove-business-info`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove business information');
      setBusinessSuccess(true);
      setShowRemoveConfirm(false);
      fetchKycData();
      fetchKycStatus();
    } catch (e) {
      setBusinessError(e instanceof Error ? e.message : 'Failed to remove business information.');
    } finally { setRemovingBusiness(false); }
  };

  // ── Status config ──────────────────────────────────────────────────────────
  const statusConfig: Record<string, { icon: any; color: string; bg: string; title: string; message: string }> = {
    verified: { icon: CheckCircle, color: '#16a34a', bg: 'bg-green-50', title: 'KYC Verified', message: 'Your KYC is complete. You can now make payments.' },
    pending: { icon: Clock, color: '#d97706', bg: 'bg-amber-50', title: 'KYC Under Review', message: 'Your documents are being reviewed. This usually takes 1-2 business days.' },
    rejected: { icon: XCircle, color: '#dc2626', bg: 'bg-red-50', title: 'KYC Rejected', message: 'Your KYC was rejected. Please review and resubmit your documents.' },
    not_started: { icon: AlertCircle, color: '#d97706', bg: 'bg-yellow-50', title: 'Submit Your KYC', message: 'KYC verification is required to make payments. Choose a method below.' },
    loading: { icon: Clock, color: '#6b7280', bg: 'bg-gray-100', title: 'Checking Status...', message: 'Please wait while we check your KYC status.' },
  };
  const cfg = statusConfig[kycStatus] || statusConfig.not_started;
  const StatusIcon = cfg.icon;

  const panLocked = kycData?.pan?.status === 'verified' || kycData?.pan?.status === 'verification_pending';
  const panRejected = kycData?.pan?.status === 'rejected';
  const addressLocked = kycData?.address?.status === 'verified' || kycData?.address?.status === 'verification_pending';
  const addressRejected = kycData?.address?.status === 'rejected';
  const businessLocked = kycData?.business?.status === 'verified' || kycData?.business?.status === 'verification_pending';
  const businessRejected = kycData?.business?.status === 'rejected';
  const kycLocked = panLocked || addressLocked;

  const renderDataRow = (label: string, value: string) => (
    <View className="flex-row justify-between py-1.5">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm font-medium text-gray-900 flex-1 text-right ml-2" numberOfLines={2}>{value || '-'}</Text>
    </View>
  );

  const renderStatusBadge = (status: string) => {
    const configs: Record<string, { bg: string; text: string; label: string; icon: typeof CheckCircle }> = {
      verified: { bg: 'bg-green-100', text: 'text-green-700', label: 'Verified', icon: CheckCircle },
      verification_pending: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Verification Pending', icon: Clock },
      rejected: { bg: 'bg-red-100', text: 'text-red-700', label: 'Rejected', icon: XCircle },
      pending: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Not Submitted', icon: AlertCircle },
    };
    const c = configs[status] || configs.pending;
    const Icon = c.icon;
    return (
      <View className={`flex-row items-center gap-1.5 px-2.5 py-1 rounded-full ${c.bg}`}>
        <Icon size={12} color="currentColor" />
        <Text className={`text-xs font-medium ${c.text}`}>{c.label}</Text>
      </View>
    );
  };

  // ── File Upload Button ─────────────────────────────────────────────────────
  const renderFileUpload = (label: string, fieldKey: string, value: string, onUpload: (url: string) => void, acceptTypes: string[], required?: boolean, locked?: boolean) => (
    <View>
      <Text className="text-sm font-medium text-gray-700 mb-1.5">{label}{required ? ' *' : ''}</Text>
      <TouchableOpacity
        onPress={async () => {
          const url = await uploadFile(fieldKey, acceptTypes);
          if (url) onUpload(url);
        }}
        className="flex-row items-center justify-center gap-2 w-full px-4 py-3.5 border border-dashed border-gray-300 rounded-xl bg-gray-50"
        activeOpacity={0.7} delayPressIn={0}
        disabled={uploadingField === fieldKey || locked}
        style={{ opacity: locked ? 0.5 : 1 }}
      >
        {uploadingField === fieldKey ? (
          <ActivityIndicator size="small" color="#8c76f0" />
        ) : (
          <Upload size={18} color="#8c76f0" />
        )}
        <Text className="text-sm text-gray-600 font-medium">
          {uploadingField === fieldKey ? 'Uploading...' : value ? 'Uploaded (tap to replace)' : 'Tap to upload'}
        </Text>
      </TouchableOpacity>
      {value ? <Text className="text-xs text-green-600 mt-1">File uploaded successfully</Text> : null}
    </View>
  );

  // ── Personal Details ───────────────────────────────────────────────────────
  const renderUserProfile = () => {
    if (!kycData?.userProfile) return null;
    const p = kycData.userProfile;
    return (
      <View className="bg-white rounded-2xl border-2 border-gray-200 p-4 gap-4">
        {renderSectionHeader(User, '#8c76f0', '#f3f0fe', 'Personal Details', 'Your registration information', undefined, kycLocked ? (
          <View className="flex-row items-center bg-gray-100 px-2 py-1 rounded-full">
            <Lock size={12} color="#6b7280" />
            <Text className="text-xs text-gray-500 font-medium ml-1">Read Only</Text>
          </View>
        ) : undefined)}
        {kycLocked && (
          <View className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <Text className="text-sm text-amber-700">Personal details cannot be changed while KYC is under review or verified.</Text>
          </View>
        )}
        {personalSuccess && (
          <View className="bg-green-50 border border-green-300 rounded-xl p-3 flex-row items-center gap-2">
            <CheckCircle size={18} color="#16a34a" />
            <Text className="text-sm text-green-700 flex-1">Personal details saved successfully!</Text>
          </View>
        )}
        {personalError ? (
          <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
            <AlertCircle size={18} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{personalError}</Text>
          </View>
        ) : null}
        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1.5">First Name *</Text>
          <TextInput
            value={personalForm.first_name}
            onChangeText={(v) => setPersonalForm({ ...personalForm, first_name: v })}
            className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${kycLocked ? 'bg-gray-50 text-gray-500' : ''}`}
            placeholder="First name"
            placeholderTextColor="#9ca3af"
            editable={!kycLocked && !personalSaving}
            autoCapitalize="words"
          />
        </View>
        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1.5">Middle Name</Text>
          <TextInput
            value={personalForm.middle_name}
            onChangeText={(v) => setPersonalForm({ ...personalForm, middle_name: v })}
            className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${kycLocked ? 'bg-gray-50 text-gray-500' : ''}`}
            placeholder="Middle name (optional)"
            placeholderTextColor="#9ca3af"
            editable={!kycLocked && !personalSaving}
            autoCapitalize="words"
          />
        </View>
        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1.5">Last Name *</Text>
          <TextInput
            value={personalForm.last_name}
            onChangeText={(v) => setPersonalForm({ ...personalForm, last_name: v })}
            className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${kycLocked ? 'bg-gray-50 text-gray-500' : ''}`}
            placeholder="Last name"
            placeholderTextColor="#9ca3af"
            editable={!kycLocked && !personalSaving}
            autoCapitalize="words"
          />
        </View>
        <View className="gap-1.5 pt-2 border-t border-gray-100">
          {renderDataRow('Email', p.email)}
          {renderDataRow('Mobile', p.mobile_number)}
        </View>
        {!kycLocked && (
          <TouchableOpacity
            onPress={handlePersonalSave}
            disabled={personalSaving}
            className="w-full flex-row items-center justify-center gap-2 bg-[#8c76f0] rounded-xl py-3.5"
            style={{ opacity: personalSaving ? 0.5 : 1 }}
            activeOpacity={0.7} delayPressIn={0}
          >
            <Save size={18} color="white" />
            <Text className="text-white font-semibold text-center text-base">{personalSaving ? 'Saving...' : 'Save Details'}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ── DigiLocker flow UI ──────────────────────────────────────────────────────
  const renderDigiLockerFlow = () => {
    if (kycStatus === 'verified' || kycMethod !== 'digilocker') return null;
    const providerName = kycProvider?.provider_name || 'DigiLocker';
    const isCashFree = providerName === 'CashFree DigiLocker';

    // DL unavailable
    if (digiStep === 'dl_unavailable') {
      const isDlSpecific = digiAddrError === 'DRIVING_LICENSE_UNAVAILABLE';
      return (
        <View className="bg-white rounded-2xl border-2 border-amber-200 p-4 gap-4">
          <View className="flex-row items-start gap-3">
            <View className="w-9 h-9 bg-amber-100 rounded-xl items-center justify-center">
              <AlertCircle size={20} color="#d97706" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-amber-800">{isDlSpecific ? 'Driving License Unavailable' : 'Address Proof Unavailable'}</Text>
              <Text className="text-xs text-amber-600 mt-0.5">{isDlSpecific ? 'Your Driving License could not be retrieved from DigiLocker.' : 'Address proof documents could not be retrieved from DigiLocker.'}</Text>
            </View>
          </View>
          <Text className="text-sm text-gray-700">
            {isDlSpecific ? 'Driver License is not available in DigiLocker. Please proceed with uploading address proof manually or connect your driving license with DigiLocker and verify again.' : 'Address proof documents are not available in your DigiLocker account. Please upload your address proof manually or ensure your documents are linked to DigiLocker and try again.'}
          </Text>
          <TouchableOpacity onPress={() => { setKycMethod('manual'); retryDigiLocker(); }} className="w-full py-3 bg-blue-600 rounded-xl" activeOpacity={0.7} delayPressIn={0}>
            <Text className="text-white text-sm font-semibold text-center">Upload Address Proof Manually</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={retryDigiLocker} className="w-full py-3 bg-white border-2 border-gray-200 rounded-xl flex-row items-center justify-center gap-2" activeOpacity={0.7} delayPressIn={0}>
            <RefreshCwIcon size={16} color="#6b7280" />
            <Text className="text-gray-700 text-sm font-semibold">{isDlSpecific ? 'Connect DL to DigiLocker & Retry' : 'Link Documents to DigiLocker & Retry'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Name mismatch
    if (digiStep === 'name_mismatch' && digiNameMismatch) {
      const fields = [
        { label: 'First Name', registered: digiNameMismatch.firstName, matched: digiNameMismatch.firstMatch },
        ...(digiNameMismatch.middleName ? [{ label: 'Middle Name', registered: digiNameMismatch.middleName, matched: digiNameMismatch.middleMatch }] : []),
        { label: 'Last Name', registered: digiNameMismatch.lastName, matched: digiNameMismatch.lastMatch },
      ];
      return (
        <View className="bg-white rounded-2xl border-2 border-red-200 p-4 gap-4">
          <View className="flex-row items-start gap-3">
            <View className="w-9 h-9 bg-red-100 rounded-xl items-center justify-center">
              <User size={20} color="#dc2626" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-red-800">Name Mismatch Detected</Text>
              <Text className="text-xs text-red-600 mt-0.5">Your DigiLocker name does not match your registration details.</Text>
            </View>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-3">
              <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Registered Name</Text>
              <Text className="text-sm font-semibold text-gray-900">{digiNameMismatch.registeredName}</Text>
            </View>
            <View className="flex-1 bg-red-50 border border-red-200 rounded-xl p-3">
              <Text className="text-xs font-semibold text-red-500 uppercase mb-1.5">DigiLocker Name</Text>
              <Text className="text-sm font-semibold text-red-800">{digiNameMismatch.kycName || 'Not available'}</Text>
            </View>
          </View>
          <View className="gap-2">
            <Text className="text-xs font-semibold text-gray-500 uppercase">Field Breakdown</Text>
            {fields.map((f) => (
              <View key={f.label} className={`flex-row items-center justify-between px-3 py-2.5 rounded-xl border ${f.matched ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <View className="flex-row items-center gap-2.5">
                  {f.matched ? <CheckCircle size={16} color="#16a34a" /> : <XCircle size={16} color="#dc2626" />}
                  <Text className={`text-sm ${f.matched ? 'text-gray-700' : 'text-red-700'}`}>
                    <Text className="font-medium">{f.label}: </Text>{f.registered}
                  </Text>
                </View>
                <Text className={`text-xs font-semibold ${f.matched ? 'text-green-700' : 'text-red-600'}`}>{f.matched ? 'Matched' : 'Not matched'}</Text>
              </View>
            ))}
          </View>
          <View className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <Text className="text-sm font-medium text-amber-800">What to do next</Text>
            <Text className="text-xs text-amber-700 mt-1">The name in your DigiLocker / Aadhaar or PAN must match the name you registered with. If there is a genuine discrepancy, please submit your KYC manually with supporting documents, or contact support to update your account name.</Text>
          </View>
          <View className="flex-row gap-3">
            <TouchableOpacity onPress={() => { setKycMethod('manual'); retryDigiLocker(); }} className="flex-1 py-3 bg-[#8c76f0] rounded-xl flex-row items-center justify-center gap-2" activeOpacity={0.7} delayPressIn={0}>
              <FileText size={16} color="white" />
              <Text className="text-white text-sm font-semibold">Submit KYC Manually</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={retryDigiLocker} className="px-4 py-3 bg-gray-100 border border-gray-300 rounded-xl flex-row items-center gap-2" activeOpacity={0.7} delayPressIn={0}>
              <RefreshCwIcon size={16} color="#6b7280" />
              <Text className="text-gray-700 text-sm font-medium">Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // Success
    if (digiStep === 'success') {
      return (
        <View className="bg-green-50 border-2 border-green-300 rounded-2xl px-4 py-5 flex-row items-start gap-3">
          <CheckCircle size={24} color="#16a34a" />
          <View className="flex-1">
            <Text className="text-sm font-semibold text-green-800">KYC Verified via {providerName}</Text>
            <Text className="text-sm text-green-700 mt-1">Your identity has been automatically verified using DigiLocker. No further action required.</Text>
          </View>
        </View>
      );
    }

    // Idle / Error / Loading / Waiting / Polling / Verifying
    return (
      <View className="bg-white rounded-2xl border-2 border-gray-200 p-4 gap-4">
        <View className="flex-row items-center gap-3">
          <View className="w-9 h-9 bg-[#8c76f0] rounded-xl items-center justify-center">
            <ScanFace size={20} color="white" />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-gray-900">Verify via {providerName}</Text>
            <Text className="text-xs text-gray-500">Instant, paperless KYC using your DigiLocker documents</Text>
          </View>
        </View>

        {(digiStep === 'idle' || digiStep === 'error') && (
          <>
            {digiStep === 'error' && digiError === 'ip_whitelist' ? (
              <View className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3 gap-2">
                <View className="flex-row items-start gap-2">
                  <AlertCircle size={18} color="#d97706" />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-amber-800">Server IP Not Whitelisted</Text>
                    <Text className="text-sm text-amber-700 mt-1">CashFree requires this server's IP to be whitelisted before it can call the DigiLocker API.</Text>
                  </View>
                </View>
                {digiIpWhitelist ? (
                  <View className="bg-white border border-amber-200 rounded-lg px-3 py-2">
                    <Text className="text-xs text-amber-600 font-medium">Server IP to whitelist</Text>
                    <Text className="text-sm font-bold text-gray-900 mt-0.5">{digiIpWhitelist}</Text>
                  </View>
                ) : null}
                <Text className="text-xs text-amber-600">Add this IP in your CashFree dashboard under Settings → IP Whitelist.</Text>
              </View>
            ) : digiStep === 'error' ? (
              <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
                <AlertCircle size={18} color="#dc2626" />
                <View className="flex-1">
                  <Text className="text-sm font-medium text-red-700">Verification Failed</Text>
                  <Text className="text-sm text-red-600 mt-0.5">{digiError}</Text>
                </View>
              </View>
            ) : null}

            <View className="gap-2">
              {[
                { num: '1', text: 'Tap "Connect DigiLocker" — a secure browser will open.' },
                { num: '2', text: 'Log in to DigiLocker and authorize access to your Aadhaar and PAN.' },
                { num: '3', text: 'Return to the app after authorizing — your KYC will complete automatically.' },
              ].map((item) => (
                <View key={item.num} className="flex-row items-start gap-2">
                  <View className="w-5 h-5 rounded-full bg-purple-100 items-center justify-center mt-0.5">
                    <Text className="text-[#8c76f0] text-xs font-semibold">{item.num}</Text>
                  </View>
                  <Text className="text-sm text-gray-600 flex-1">{item.text}</Text>
                </View>
              ))}
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity onPress={startDigiLockerAuth} className="flex-1 py-3 bg-[#8c76f0] rounded-xl flex-row items-center justify-center gap-2" activeOpacity={0.7} delayPressIn={0}>
                <ScanFace size={18} color="white" />
                <Text className="text-white text-sm font-semibold">Connect DigiLocker</Text>
              </TouchableOpacity>
              {digiStep === 'error' && (
                <TouchableOpacity onPress={() => { setKycMethod('manual'); retryDigiLocker(); }} className="px-4 py-3 bg-amber-100 border-2 border-amber-300 rounded-xl" activeOpacity={0.7} delayPressIn={0}>
                  <Text className="text-amber-800 text-sm font-medium">Manual KYC</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {digiStep === 'loading_url' && (
          <View className="flex-row items-center justify-center gap-3 py-4">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm font-medium text-[#8c76f0]">Opening DigiLocker...</Text>
          </View>
        )}

        {digiStep === 'waiting_popup' && (
          <View className="gap-4">
            <View className="flex-row items-center gap-3 py-2">
              <ActivityIndicator size="small" color="#8c76f0" />
              <View className="flex-1">
                <Text className="text-sm font-medium text-gray-800">Waiting for DigiLocker authorization...</Text>
                <Text className="text-xs text-gray-500 mt-0.5">Complete the authorization in the browser. It will close automatically and your KYC will be verified.</Text>
              </View>
            </View>

            {isCashFree && digiVerificationId ? (
              <TouchableOpacity onPress={() => startPolling(digiVerificationId)} className="w-full py-3 bg-purple-50 border border-[#8c76f0] rounded-xl flex-row items-center justify-center gap-2" activeOpacity={0.7} delayPressIn={0}>
                <ShieldCheck size={16} color="#8c76f0" />
                <Text className="text-sm font-medium text-[#8c76f0]">I've completed authorization — check status now</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity onPress={retryDigiLocker} activeOpacity={0.7} delayPressIn={0}>
              <Text className="text-xs text-gray-400 text-center underline">Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {digiStep === 'polling' && (
          <View className="flex-row items-center gap-3 py-3">
            <ActivityIndicator size="small" color="#8c76f0" />
            <View className="flex-1">
              <Text className="text-sm font-medium text-gray-800">Checking authorization status...</Text>
              <Text className="text-xs text-gray-500 mt-0.5">Waiting for DigiLocker consent confirmation{digiPollCount > 0 ? ` (${digiPollCount})` : ''}</Text>
            </View>
          </View>
        )}

        {digiStep === 'verifying' && (
          <View className="flex-row items-center gap-3 py-3">
            <ActivityIndicator size="small" color="#8c76f0" />
            <View className="flex-1">
              <Text className="text-sm font-medium text-gray-800">Verifying your identity...</Text>
              <Text className="text-xs text-gray-500 mt-0.5">Fetching your Aadhaar and PAN from DigiLocker</Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  // ── KYC Method Selection ───────────────────────────────────────────────────
  const renderKycMethodSelection = () => {
    if (kycStatus === 'verified') return null;
    return (
      <View className="gap-4">
        {kycMethod === 'select' ? (
          <View className="gap-3">
            <Text className="text-base font-bold text-gray-900">Choose KYC Method</Text>
            {kycSettings.digilocker_enabled && (
              <TouchableOpacity
                onPress={() => { setError(''); setKycMethod('digilocker'); }}
                className="flex-row items-center gap-3 p-4 bg-white rounded-2xl border border-gray-200"
                activeOpacity={0.7} delayPressIn={0}
              >
                <View className="w-12 h-12 bg-blue-50 rounded-xl items-center justify-center">
                  <Smartphone size={24} color="#2563eb" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-gray-900">DigiLocker KYC</Text>
                  <Text className="text-sm text-gray-500">Auto-verify PAN & Aadhaar via DigiLocker</Text>
                </View>
                <ChevronRight size={20} color="#9ca3af" />
              </TouchableOpacity>
            )}
            {kycSettings.manual_enabled && (
              <TouchableOpacity
                onPress={() => { setError(''); setKycMethod('manual'); }}
                className="flex-row items-center gap-3 p-4 bg-white rounded-2xl border border-gray-200"
                activeOpacity={0.7} delayPressIn={0}
              >
                <View className="w-12 h-12 bg-[#f3f0fe] rounded-xl items-center justify-center">
                  <FileCheck size={24} color="#8c76f0" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-gray-900">Manual KYC</Text>
                  <Text className="text-sm text-gray-500">Upload PAN, Address Proof & Business docs</Text>
                </View>
                <ChevronRight size={20} color="#9ca3af" />
              </TouchableOpacity>
            )}
            {!kycSettings.digilocker_enabled && !kycSettings.manual_enabled && (
              <View className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <Text className="text-sm text-amber-700">KYC methods are currently unavailable. Please contact support.</Text>
              </View>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  // ── Section Card Header ──────────────────────────────────────────────────
  const renderSectionHeader = (Icon: typeof FileText, iconColor: string, iconBg: string, title: string, desc: string, status?: string, extra?: React.ReactNode) => (
    <View className="flex-row items-center gap-3 pb-4 border-b border-gray-100">
      <View className="w-10 h-10 rounded-xl items-center justify-center" style={{ backgroundColor: iconBg }}>
        <Icon size={20} color={iconColor} />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-gray-900">{title}</Text>
        <Text className="text-sm text-gray-500">{desc}</Text>
      </View>
      {extra}
      {status && <View>{renderStatusBadge(status)}</View>}
    </View>
  );

  // ── Manual KYC Forms ────────────────────────────────────────────────────────
  const renderManualKyc = () => {
    if (kycStatus === 'verified' || kycMethod !== 'manual') return null;

    return (
      <View className="gap-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-bold text-gray-900">Manual KYC Submission</Text>
          <TouchableOpacity onPress={() => { setKycMethod('select'); setError(''); }} activeOpacity={0.7} delayPressIn={0}>
            <Text className="text-sm text-[#8c76f0] font-semibold">Back</Text>
          </TouchableOpacity>
        </View>

        {/* ── PAN Card ── */}
        <View className="bg-white rounded-2xl border-2 border-gray-200 p-4 gap-4">
          {renderSectionHeader(User, '#2563eb', '#eff6ff', 'PAN Verification', 'Permanent Account Number card details', kycData?.pan?.status, kycData?.pan?.digilocker_verified ? (
            <View className="flex-row items-center gap-1.5 px-2.5 py-1 bg-emerald-100 rounded-full">
              <ShieldCheck size={12} color="#16a34a" />
              <Text className="text-xs font-semibold text-emerald-700">e-KYC</Text>
            </View>
          ) : undefined)}

          {kycData?.pan?.status === 'rejected' && kycData.pan.rejection_reason && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3">
              <Text className="text-sm font-medium text-red-700">Rejection Reason</Text>
              <Text className="text-sm text-red-600 mt-1">{kycData.pan.rejection_reason}</Text>
              <Text className="text-sm text-red-700 mt-2 font-medium">Please update your details and resubmit.</Text>
            </View>
          )}

          {kycData?.pan && (kycData.pan.status === 'verified' || kycData.pan.status === 'verification_pending') && kycData.pan.status !== 'rejected' && (
            <View className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <Text className="text-sm text-amber-700">{kycData.pan.status === 'verified' ? 'PAN verification is complete. No changes allowed.' : 'PAN is under review. You cannot make changes until the review is complete.'}</Text>
            </View>
          )}

          {kycData?.pan?.digilocker_verified && (
            <View className="flex-row items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <ShieldCheck size={18} color="#16a34a" />
              <Text className="text-sm text-emerald-700">PAN verified electronically via DigiLocker{kycData.pan.digilocker_provider ? ` (${kycData.pan.digilocker_provider})` : ''}. Document photo is not required.</Text>
            </View>
          )}

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">PAN Card Number *</Text>
            <TextInput
              value={panForm.pan_number}
              onChangeText={(v) => setPanForm({ ...panForm, pan_number: v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base font-mono tracking-widest ${panLocked && !panRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="ABCDE1234F"
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
              maxLength={10}
              editable={!panLocked || panRejected}
            />
          </View>

          {!kycData?.pan?.digilocker_verified && (
            renderFileUpload('PAN Card Photo', 'pan_photo', panForm.pan_photo_url, (url) => setPanForm({ ...panForm, pan_photo_url: url }), ['image/jpeg', 'image/png', 'image/jpg'], false, panLocked)
          )}

          {panError ? (
            <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
              <AlertCircle size={18} color="#dc2626" />
              <Text className="text-sm text-red-700 flex-1">{panError}</Text>
            </View>
          ) : null}

          {(!panLocked || kycData?.pan?.status === 'rejected') && (
            <TouchableOpacity
              onPress={handlePanSubmit}
              disabled={panSaving}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5 flex-row items-center justify-center gap-2"
              style={{ opacity: panSaving ? 0.5 : 1 }}
              activeOpacity={0.7} delayPressIn={0}
            >
              <Save size={18} color="white" />
              <Text className="text-white font-semibold text-center text-base">{panSaving ? 'Saving...' : kycData?.pan?.status === 'rejected' ? 'Resubmit' : 'Save & Submit'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Address Proof ── */}
        <View className="bg-white rounded-2xl border-2 border-gray-200 p-4 gap-4">
          {renderSectionHeader(MapPin, '#16a34a', '#f0fdf4', 'Address Proof', 'Aadhaar, passport, or other ID', kycData?.address?.status, kycData?.address?.digilocker_verified ? (
            <View className="flex-row items-center gap-1.5 px-2.5 py-1 bg-emerald-100 rounded-full">
              <ShieldCheck size={12} color="#16a34a" />
              <Text className="text-xs font-semibold text-emerald-700">e-KYC</Text>
            </View>
          ) : undefined)}

          {kycData?.address?.status === 'rejected' && kycData.address.rejection_reason && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3">
              <Text className="text-sm font-medium text-red-700">Rejection Reason</Text>
              <Text className="text-sm text-red-600 mt-1">{kycData.address.rejection_reason}</Text>
              <Text className="text-sm text-red-700 mt-2 font-medium">Please update your details and resubmit.</Text>
            </View>
          )}

          {kycData?.address && (kycData.address.status === 'verified' || kycData.address.status === 'verification_pending') && kycData.address.status !== 'rejected' && (
            <View className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <Text className="text-sm text-amber-700">{kycData.address.status === 'verified' ? 'Address verification is complete. No changes allowed.' : 'Address proof is under review. You cannot make changes until the review is complete.'}</Text>
            </View>
          )}

          {kycData?.address?.digilocker_verified && (
            <View className="flex-row items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <ShieldCheck size={18} color="#16a34a" />
              <Text className="text-sm text-emerald-700">Address proof verified electronically via DigiLocker{kycData.address.digilocker_provider ? ` (${kycData.address.digilocker_provider})` : ''}. Document photos are not required.</Text>
            </View>
          )}

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5 flex-row items-center gap-1.5">
              <CreditCard size={14} color="#6b7280" /> {addressForm.proof_type ? `${ADDRESS_PROOF_TYPES.find(p => p.value === addressForm.proof_type)?.label ?? 'Document'} Number` : 'ID Number'} *
            </Text>
            <TextInput
              value={addressForm.id_number}
              onChangeText={(v) => {
                if (addressForm.proof_type === 'aadhar') {
                  setAddressForm({ ...addressForm, id_number: v.replace(/\D/g, '').slice(0, 12) });
                } else {
                  setAddressForm({ ...addressForm, id_number: v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) });
                }
              }}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${addressLocked && !addressRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder={ID_NUMBER_PLACEHOLDERS[addressForm.proof_type] ?? 'Enter document ID number'}
              placeholderTextColor="#9ca3af"
              maxLength={addressForm.proof_type === 'aadhar' ? 12 : 20}
              editable={!addressLocked || addressRejected}
            />
            {addressForm.proof_type === 'aadhar' && addressForm.id_number.length > 0 && addressForm.id_number.length < 12 && (
              <Text className="text-xs text-amber-600 mt-1">{12 - addressForm.id_number.length} more digits required</Text>
            )}
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Proof Document Type *</Text>
            <View className="flex-row flex-wrap gap-2">
              {ADDRESS_PROOF_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  onPress={() => setAddressForm({ ...addressForm, proof_type: t.value })}
                  className={`px-4 py-2.5 rounded-xl border ${addressForm.proof_type === t.value ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                  activeOpacity={0.7} delayPressIn={0}
                  disabled={addressLocked && !addressRejected}
                >
                  <Text className={`text-sm font-medium ${addressForm.proof_type === t.value ? 'text-white' : 'text-gray-700'}`}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Full Address *</Text>
            <TextInput
              value={addressForm.address}
              onChangeText={(v) => setAddressForm({ ...addressForm, address: v.replace(/[^A-Za-z0-9 \-.,()]/g, '') })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${addressLocked && !addressRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="House/Flat No., Street, Locality, Landmark"
              placeholderTextColor="#9ca3af"
              multiline
              textAlignVertical="top"
              maxLength={500}
              style={{ minHeight: 70 }}
              editable={!addressLocked || addressRejected}
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">City *</Text>
            <TextInput
              value={addressForm.city}
              onChangeText={(v) => setAddressForm({ ...addressForm, city: v.replace(/[^A-Za-z ]/g, '') })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${addressLocked && !addressRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="e.g. Mumbai"
              placeholderTextColor="#9ca3af"
              maxLength={20}
              editable={!addressLocked || addressRejected}
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">State *</Text>
            <TouchableOpacity
              onPress={() => (!addressLocked || addressRejected) && setShowStatePicker(true)}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl flex-row items-center justify-between ${addressLocked && !addressRejected ? 'bg-gray-50' : 'bg-white'}`}
              activeOpacity={0.7} delayPressIn={0}
              disabled={addressLocked && !addressRejected}
            >
              <Text className={`text-base ${addressForm.state ? 'text-gray-900' : 'text-gray-400'}`}>
                {addressForm.state || 'Select your state'}
              </Text>
              <ChevronRight size={18} color="#9ca3af" style={{ transform: [{ rotate: '90deg' }] }} />
            </TouchableOpacity>
          </View>

          <Modal visible={showStatePicker} animationType="slide" transparent>
            <View className="flex-1 bg-black/50 justify-end">
              <View className="bg-white rounded-t-2xl max-h-[70%]">
                <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
                  <Text className="text-base font-semibold text-gray-900">Select State</Text>
                  <TouchableOpacity onPress={() => setShowStatePicker(false)} activeOpacity={0.7} delayPressIn={0}>
                    <X size={20} color="#6b7280" />
                  </TouchableOpacity>
                </View>
                <ScrollView nestedScrollEnabled>
                  {INDIAN_STATES.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => { setAddressForm({ ...addressForm, state: s }); setShowStatePicker(false); }}
                      className={`px-4 py-3 flex-row items-center justify-between ${addressForm.state === s ? 'bg-[#8c76f0]' : ''}`}
                      activeOpacity={0.7} delayPressIn={0}
                    >
                      <Text className={`text-base ${addressForm.state === s ? 'text-white font-semibold' : 'text-gray-700'}`}>{s}</Text>
                      {addressForm.state === s && <CheckCircle size={18} color="white" />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Pincode *</Text>
            <TextInput
              value={addressForm.pincode}
              onChangeText={(v) => setAddressForm({ ...addressForm, pincode: v.replace(/\D/g, '').slice(0, 6) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${addressLocked && !addressRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="6-digit pincode"
              placeholderTextColor="#9ca3af"
              keyboardType="number-pad"
              maxLength={6}
              editable={!addressLocked || addressRejected}
            />
          </View>

          {!kycData?.address?.digilocker_verified && addressForm.proof_type && (
            <>
              {renderFileUpload(`${ADDRESS_PROOF_TYPES.find(p => p.value === addressForm.proof_type)?.label ?? 'Document'} - Front`, 'address_front', addressForm.front_photo_url, (url) => setAddressForm({ ...addressForm, front_photo_url: url }), ['image/jpeg', 'image/png', 'image/jpg'], true, addressLocked)}
              {renderFileUpload(`${ADDRESS_PROOF_TYPES.find(p => p.value === addressForm.proof_type)?.label ?? 'Document'} - Back`, 'address_back', addressForm.back_photo_url, (url) => setAddressForm({ ...addressForm, back_photo_url: url }), ['image/jpeg', 'image/png', 'image/jpg'], true, addressLocked)}
            </>
          )}

          {addressError ? (
            <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
              <AlertCircle size={18} color="#dc2626" />
              <Text className="text-sm text-red-700 flex-1">{addressError}</Text>
            </View>
          ) : null}

          {(!addressLocked || kycData?.address?.status === 'rejected') && (
            <TouchableOpacity
              onPress={handleAddressSubmit}
              disabled={addressSaving}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5 flex-row items-center justify-center gap-2"
              style={{ opacity: addressSaving ? 0.5 : 1 }}
              activeOpacity={0.7} delayPressIn={0}
            >
              <Save size={18} color="white" />
              <Text className="text-white font-semibold text-center text-base">{addressSaving ? 'Saving...' : kycData?.address?.status === 'rejected' ? 'Resubmit' : 'Save & Submit'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Business Details ── */}
        <View className="bg-white rounded-2xl border-2 border-gray-200 p-4 gap-4">
          {renderSectionHeader(Building2, '#2563eb', '#eff6ff', 'Business Details', 'Optional — for business accounts', kycData?.business?.status)}

          <View className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <Text className="text-sm text-blue-700"><Text className="font-semibold">Note:</Text> Business information is optional. Admin review is required when you upload business documents. Letter of Authorization (LoA) is mandatory for submission.</Text>
          </View>

          {kycData?.business?.status === 'rejected' && kycData.business.rejection_reason && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3">
              <Text className="text-sm font-medium text-red-700">Rejection Reason</Text>
              <Text className="text-sm text-red-600 mt-1">{kycData.business.rejection_reason}</Text>
              <Text className="text-sm text-red-700 mt-2 font-medium">Please update your details and resubmit.</Text>
            </View>
          )}

          {kycData?.business && (kycData.business.status === 'verified' || kycData.business.status === 'verification_pending') && kycData.business.status !== 'rejected' && (
            <View className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <Text className="text-sm text-amber-700">{kycData.business.status === 'verified' ? 'Business information is verified. No changes allowed.' : 'Business information is under review. You cannot make changes until the review is complete.'}</Text>
            </View>
          )}

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Company Type *</Text>
            <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
              <View className="flex-row flex-wrap gap-2">
                {COMPANY_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setBusinessForm({ ...businessForm, company_type: t })}
                    className={`px-3 py-2 rounded-lg border ${businessForm.company_type === t ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                    activeOpacity={0.7} delayPressIn={0}
                    disabled={businessLocked && !businessRejected}
                  >
                    <Text className={`text-xs font-medium ${businessForm.company_type === t ? 'text-white' : 'text-gray-700'}`}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Business / Company Registration Name *</Text>
            <TextInput
              value={businessForm.business_name}
              onChangeText={(v) => setBusinessForm({ ...businessForm, business_name: v.replace(/[^A-Za-z0-9&.\- ]/g, '').slice(0, 150) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${businessLocked && !businessRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="As per registration certificate"
              placeholderTextColor="#9ca3af"
              maxLength={150}
              editable={!businessLocked || businessRejected}
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Business / Company Incorporation Number *</Text>
            <TextInput
              value={businessForm.incorporation_number}
              onChangeText={(v) => setBusinessForm({ ...businessForm, incorporation_number: v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 21) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base font-mono ${businessLocked && !businessRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="CIN / LLP / Firm Number"
              placeholderTextColor="#9ca3af"
              maxLength={21}
              editable={!businessLocked || businessRejected}
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Business PAN *</Text>
            <TextInput
              value={businessForm.business_pan}
              onChangeText={(v) => setBusinessForm({ ...businessForm, business_pan: v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base font-mono tracking-widest ${businessLocked && !businessRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="AAAAA9999A"
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
              maxLength={10}
              editable={!businessLocked || businessRejected}
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">GST Number</Text>
            <TextInput
              value={businessForm.gst_number}
              onChangeText={(v) => setBusinessForm({ ...businessForm, gst_number: v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 15) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base font-mono tracking-wider ${businessLocked && !businessRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="15-character GSTIN"
              placeholderTextColor="#9ca3af"
              maxLength={15}
              editable={!businessLocked || businessRejected}
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Business Address *</Text>
            <TextInput
              value={businessForm.business_address}
              onChangeText={(v) => setBusinessForm({ ...businessForm, business_address: v.slice(0, 500) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${businessLocked && !businessRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="Full registered business address"
              placeholderTextColor="#9ca3af"
              multiline
              textAlignVertical="top"
              maxLength={500}
              style={{ minHeight: 70 }}
              editable={!businessLocked || businessRejected}
            />
            <Text className="text-xs text-gray-400 mt-1 text-right">{businessForm.business_address.length}/500</Text>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Business Email *</Text>
            <TextInput
              value={businessForm.business_email}
              onChangeText={(v) => setBusinessForm({ ...businessForm, business_email: v })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${businessLocked && !businessRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="contact@yourbusiness.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!businessLocked || businessRejected}
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Business Phone Number *</Text>
            <TextInput
              value={businessForm.business_phone}
              onChangeText={(v) => setBusinessForm({ ...businessForm, business_phone: v.replace(/[^0-9]/g, '').slice(0, 10) })}
              className={`w-full px-4 py-3 border border-gray-300 rounded-xl text-base ${businessLocked && !businessRejected ? 'bg-gray-50 text-gray-500' : ''}`}
              placeholder="10-digit number"
              placeholderTextColor="#9ca3af"
              keyboardType="number-pad"
              maxLength={10}
              editable={!businessLocked || businessRejected}
            />
          </View>

          {renderFileUpload('Business / Company Incorporation Certificate', 'inc_certificate', businessForm.incorporation_certificate_url, (url) => setBusinessForm({ ...businessForm, incorporation_certificate_url: url }), ['application/pdf'], COMPANY_TYPES_REQUIRING_INC_CERT.includes(businessForm.company_type), businessLocked)}
          {renderFileUpload('Company PAN Photo', 'company_pan_photo', businessForm.company_pan_photo_url, (url) => setBusinessForm({ ...businessForm, company_pan_photo_url: url }), ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'], true, businessLocked)}
          {renderFileUpload('GST Certificate', 'gst_certificate', businessForm.gst_certificate_url, (url) => setBusinessForm({ ...businessForm, gst_certificate_url: url }), ['application/pdf'], businessForm.gst_number.trim().length > 0, businessLocked)}
          {renderFileUpload('Letter of Authorization (LoA) *', 'loa', businessForm.loa_url, (url) => setBusinessForm({ ...businessForm, loa_url: url }), ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'], false, businessLocked)}

          {(businessForm.company_type === 'Private Limited Company' || businessForm.company_type === 'One Person Company (OPC)') && (
            <>
              {renderFileUpload('Memorandum of Association (MoA) *', 'moa', businessForm.moa_url, (url) => setBusinessForm({ ...businessForm, moa_url: url }), ['application/pdf'], false, businessLocked)}
              {renderFileUpload('Articles of Association (AoA) *', 'aoa', businessForm.aoa_url, (url) => setBusinessForm({ ...businessForm, aoa_url: url }), ['application/pdf'], false, businessLocked)}
            </>
          )}

          {businessError ? (
            <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
              <AlertCircle size={18} color="#dc2626" />
              <Text className="text-sm text-red-700 flex-1">{businessError}</Text>
            </View>
          ) : null}

          {businessSuccess && (
            <View className="bg-green-50 border border-green-300 rounded-xl p-3 flex-row items-center gap-2">
              <CheckCircle size={18} color="#16a34a" />
              <Text className="text-sm text-green-700 flex-1">Business information saved successfully.</Text>
            </View>
          )}

          {(!businessLocked || kycData?.business?.status === 'rejected') && (
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={handleBusinessSubmit}
                disabled={businessSaving || removingBusiness}
                className="flex-1 bg-[#8c76f0] rounded-xl py-3.5 flex-row items-center justify-center gap-2"
                style={{ opacity: businessSaving || removingBusiness ? 0.5 : 1 }}
                activeOpacity={0.7} delayPressIn={0}
              >
                <Save size={18} color="white" />
                <Text className="text-white font-semibold text-center text-base">{businessSaving ? 'Saving...' : kycData?.business?.status === 'rejected' ? 'Resubmit Business Info' : 'Save Business Info'}</Text>
              </TouchableOpacity>

              {kycData?.business?.status === 'rejected' && (
                <TouchableOpacity
                  onPress={() => setShowRemoveConfirm(true)}
                  disabled={businessSaving || removingBusiness}
                  className="px-4 py-3.5 bg-red-600 rounded-xl flex-row items-center justify-center gap-2"
                  style={{ opacity: businessSaving || removingBusiness ? 0.5 : 1 }}
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Trash2 size={18} color="white" />
                  <Text className="text-white font-semibold text-center text-base">Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Remove business confirm modal */}
        <Modal visible={showRemoveConfirm} animationType="fade" transparent>
          <View className="flex-1 bg-black/50 items-center justify-center p-4">
            <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
              <Text className="text-lg font-semibold text-gray-900 mb-2">Remove Business Information?</Text>
              <Text className="text-sm text-gray-600 mb-4">This will permanently delete your business information from the database. If your PAN and Address verifications are both approved, your KYC will be automatically verified.</Text>
              <View className="flex-row gap-3">
                <TouchableOpacity onPress={() => setShowRemoveConfirm(false)} disabled={removingBusiness} className="flex-1 py-3 border-2 border-gray-300 rounded-xl" activeOpacity={0.7} delayPressIn={0}>
                  <Text className="text-gray-700 font-medium text-center">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleRemoveBusiness} disabled={removingBusiness} className="flex-1 py-3 bg-red-600 rounded-xl" activeOpacity={0.7} delayPressIn={0}>
                  <Text className="text-white font-medium text-center">{removingBusiness ? 'Removing...' : 'Yes, Remove'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  // ── Submitted KYC Data ─────────────────────────────────────────────────────
  const renderSubmittedData = () => {
    if (!kycData) return null;
    const hasPan = kycData.pan && kycData.pan.pan_number;
    const hasAddress = kycData.address && kycData.address.id_number;
    const hasBusiness = kycData.business && kycData.business.business_name;
    if (!hasPan && !hasAddress && !hasBusiness) return null;

    return (
      <View className="gap-3">
        <Text className="text-base font-bold text-gray-900">Submitted Documents</Text>
        {hasPan && (
          <View className="bg-white rounded-2xl border border-gray-200 p-4">
            <View className="flex-row items-center gap-2 mb-2">
              <View className="w-9 h-9 bg-blue-50 rounded-xl items-center justify-center">
                <FileText size={18} color="#2563eb" />
              </View>
              <Text className="text-base font-semibold text-gray-900">PAN Card</Text>
              <View className="ml-auto">{renderStatusBadge(kycData.pan.status)}</View>
            </View>
            {renderDataRow('PAN Number', kycData.pan.pan_number)}
          </View>
        )}
        {hasAddress && (
          <View className="bg-white rounded-2xl border border-gray-200 p-4">
            <View className="flex-row items-center gap-2 mb-2">
              <View className="w-9 h-9 bg-green-50 rounded-xl items-center justify-center">
                <MapPin size={18} color="#16a34a" />
              </View>
              <Text className="text-base font-semibold text-gray-900">Address Proof</Text>
              <View className="ml-auto">{renderStatusBadge(kycData.address.status)}</View>
            </View>
            {renderDataRow('Proof Type', ADDRESS_PROOF_TYPES.find(p => p.value === kycData.address.proof_type)?.label || kycData.address.proof_type)}
            {renderDataRow('ID Number', kycData.address.id_number)}
            {renderDataRow('Address', kycData.address.address)}
            {renderDataRow('City', kycData.address.city)}
            {renderDataRow('State', kycData.address.state)}
            {renderDataRow('Pincode', kycData.address.pincode)}
          </View>
        )}
        {hasBusiness && (
          <View className="bg-white rounded-2xl border border-gray-200 p-4">
            <View className="flex-row items-center gap-2 mb-2">
              <View className="w-9 h-9 bg-orange-50 rounded-xl items-center justify-center">
                <Building2 size={18} color="#ea580c" />
              </View>
              <Text className="text-base font-semibold text-gray-900">Business Details</Text>
              <View className="ml-auto">{renderStatusBadge(kycData.business.status)}</View>
            </View>
            {renderDataRow('Business Name', kycData.business.business_name)}
            {kycData.business.business_pan ? renderDataRow('Business PAN', kycData.business.business_pan) : null}
            {kycData.business.gst_number ? renderDataRow('GST Number', kycData.business.gst_number) : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <MobileLayout
      userId={userId}
      userEmail={userEmail}
      onLogout={handleLogout}
      showBack
      onBack={() => navigate('/mobile/dashboard', { state: { userId, userEmail } })}
    >
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View className="px-4 py-4 gap-4">
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 bg-[#8c76f0] rounded-xl items-center justify-center">
              <ShieldCheck size={20} color="white" />
            </View>
            <View>
              <Text className="text-xl font-bold text-gray-900">KYC Verification</Text>
              <Text className="text-sm text-gray-500">Verify your identity to make payments</Text>
            </View>
          </View>

          <View className={`${cfg.bg} rounded-xl p-4 flex-row items-start gap-3`}>
            <StatusIcon size={28} color={cfg.color} />
            <View className="flex-1">
              <Text className="text-base font-bold" style={{ color: cfg.color }}>{cfg.title}</Text>
              <Text className="text-sm text-gray-700 mt-1">{cfg.message}</Text>
            </View>
          </View>

          {error ? (
            <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
              <AlertCircle size={18} color="#dc2626" />
              <Text className="text-sm text-red-700 flex-1">{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#8c76f0" />
              <Text className="text-base text-gray-500 mt-2">Loading KYC details...</Text>
            </View>
          ) : (
            <View className="gap-4">
              {renderUserProfile()}
              {renderSubmittedData()}
              {renderKycMethodSelection()}
              {renderDigiLockerFlow()}
              {renderManualKyc()}
            </View>
          )}
        </View>
      </ScrollView>
    </MobileLayout>
  );
}
