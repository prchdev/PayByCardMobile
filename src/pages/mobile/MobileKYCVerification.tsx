import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Linking } from 'react-native';
import {
  ShieldCheck, CircleAlert as AlertCircle, CircleCheck as CheckCircle, Clock, Circle as XCircle,
  FileText, MapPin, Building2, User, Upload, ChevronRight, Smartphone, FileCheck, Loader2,
} from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface KycData {
  pan: any;
  address: any;
  business: any;
  kycCompleted: boolean;
  userProfile: {
    first_name: string;
    middle_name: string;
    last_name: string;
    email: string;
    mobile_number: string;
  };
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const ADDRESS_PROOF_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
];

export default function MobileKYCVerification() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [kycStatus, setKycStatus] = useState<string>('loading');
  const [loading, setLoading] = useState(true);
  const [kycData, setKycData] = useState<KycData | null>(null);
  const [kycMethod, setKycMethod] = useState<'select' | 'digilocker' | 'manual'>('select');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [digilockerLoading, setDigilockerLoading] = useState(false);
  const [digilockerUrl, setDigilockerUrl] = useState('');

  const [panForm, setPanForm] = useState({ pan_number: '', pan_photo_url: '' });
  const [addressForm, setAddressForm] = useState({ proof_type: 'aadhaar', id_number: '', address_proof_url_1: '' });
  const [businessForm, setBusinessForm] = useState({
    business_name: '', pan_number: '', incorporation_certificate_url: '', gst_certificate_url: '', loa_url: '',
  });

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchKycStatus();
  }, [userId]);

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
        if (data.pan) setPanForm({ pan_number: data.pan.pan_number || '', pan_photo_url: data.pan.pan_photo_url || '' });
        if (data.address) setAddressForm({
          proof_type: data.address.proof_type || 'aadhaar',
          id_number: data.address.id_number || '',
          address_proof_url_1: data.address.address_proof_url_1 || '',
        });
        if (data.business) setBusinessForm({
          business_name: data.business.business_name || '',
          pan_number: data.business.pan_number || '',
          incorporation_certificate_url: data.business.incorporation_certificate_url || '',
          gst_certificate_url: data.business.gst_certificate_url || '',
          loa_url: data.business.loa_url || '',
        });
      }
    } catch {}
  };

  useEffect(() => {
    if (userId && (kycStatus === 'not_started' || kycStatus === 'rejected' || kycStatus === 'pending')) {
      fetchKycData();
    }
  }, [userId, kycStatus]);

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  // ── DigiLocker KYC ──────────────────────────────────────────────────────────
  const handleDigiLocker = async () => {
    setError('');
    setDigilockerLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/digilocker-kyc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'get_auth_url', redirectUri: `${SUPABASE_URL}/functions/v1/digilocker-kyc` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start DigiLocker KYC');
      if (data.url) {
        setDigilockerUrl(data.url);
        Linking.openURL(data.url).catch(() => {
          Alert.alert('DigiLocker', 'Please visit the URL to complete KYC verification.');
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start DigiLocker KYC');
    } finally { setDigilockerLoading(false); }
  };

  // ── Manual KYC submission ──────────────────────────────────────────────────
  const submitSection = async (section: string, data: Record<string, unknown>) => {
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/save-kyc-data`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, section, data }),
      });
      const result = await res.json();
      if (!res.ok) { setError(result.error || 'Failed to save'); return; }
      Alert.alert('Success', `${section === 'pan' ? 'PAN' : section === 'address' ? 'Address' : 'Business'} details saved successfully.`);
      setActiveSection(null);
      fetchKycData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSubmitting(false); }
  };

  const handlePanSubmit = () => {
    setError('');
    if (!panForm.pan_number.trim()) { setError('PAN number is required'); return; }
    if (!PAN_REGEX.test(panForm.pan_number.trim().toUpperCase())) { setError('Invalid PAN format (e.g. ABCDE1234F)'); return; }
    submitSection('pan', { pan_number: panForm.pan_number.trim().toUpperCase(), pan_photo_url: panForm.pan_photo_url.trim() });
  };

  const handleAddressSubmit = () => {
    setError('');
    if (!addressForm.proof_type) { setError('Select proof type'); return; }
    if (!addressForm.id_number.trim()) { setError('ID number is required'); return; }
    if (addressForm.id_number.length > 30) { setError('ID number must be at most 30 characters'); return; }
    submitSection('address', {
      proof_type: addressForm.proof_type,
      id_number: addressForm.id_number.trim(),
      address_proof_url_1: addressForm.address_proof_url_1.trim(),
    });
  };

  const handleBusinessSubmit = () => {
    setError('');
    if (businessForm.business_name && businessForm.business_name.length > 200) { setError('Business name too long'); return; }
    if (businessForm.pan_number && !PAN_REGEX.test(businessForm.pan_number.trim().toUpperCase())) { setError('Invalid business PAN format'); return; }
    submitSection('business', {
      business_name: businessForm.business_name.trim(),
      pan_number: businessForm.pan_number.trim().toUpperCase(),
      incorporation_certificate_url: businessForm.incorporation_certificate_url.trim(),
      gst_certificate_url: businessForm.gst_certificate_url.trim(),
      loa_url: businessForm.loa_url.trim(),
    });
  };

  const statusConfig: Record<string, { icon: any; color: string; bg: string; title: string; message: string }> = {
    verified: { icon: CheckCircle, color: '#16a34a', bg: 'bg-green-50', title: 'KYC Verified', message: 'Your KYC is complete. You can now make payments.' },
    pending: { icon: Clock, color: '#d97706', bg: 'bg-amber-50', title: 'KYC Under Review', message: 'Your documents are being reviewed. This usually takes 1-2 business days.' },
    rejected: { icon: XCircle, color: '#dc2626', bg: 'bg-red-50', title: 'KYC Rejected', message: 'Your KYC was rejected. Please review and resubmit your documents.' },
    not_started: { icon: AlertCircle, color: '#d97706', bg: 'bg-yellow-50', title: 'Submit Your KYC', message: 'KYC verification is required to make payments. Choose a method below.' },
    loading: { icon: Clock, color: '#6b7280', bg: 'bg-gray-100', title: 'Checking Status...', message: 'Please wait while we check your KYC status.' },
  };

  const cfg = statusConfig[kycStatus] || statusConfig.not_started;
  const Icon = cfg.icon;

  const renderDataRow = (label: string, value: string) => (
    <View className="flex-row justify-between py-1.5">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm font-medium text-gray-900 flex-1 text-right ml-2">{value || '-'}</Text>
    </View>
  );

  // ── User Profile Info ───────────────────────────────────────────────────────
  const renderUserProfile = () => {
    if (!kycData?.userProfile) return null;
    const p = kycData.userProfile;
    const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') || '-';
    return (
      <View className="bg-white rounded-2xl border border-gray-200 p-4">
        <View className="flex-row items-center gap-2 mb-3">
          <User size={18} color="#8c76f0" />
          <Text className="text-base font-semibold text-gray-900">User Information</Text>
        </View>
        {renderDataRow('Full Name', fullName)}
        {renderDataRow('Email', p.email)}
        {renderDataRow('Mobile', p.mobile_number)}
      </View>
    );
  };

  // ── Submitted KYC Data ──────────────────────────────────────────────────────
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
              <FileText size={18} color="#8c76f0" />
              <Text className="text-base font-semibold text-gray-900">PAN Card</Text>
              <View className={`px-2 py-0.5 rounded-md ml-auto ${kycData.pan.status === 'verified' ? 'bg-green-50' : 'bg-amber-50'}`}>
                <Text className={`text-xs font-medium ${kycData.pan.status === 'verified' ? 'text-green-700' : 'text-amber-700'}`}>
                  {kycData.pan.status?.replace('_', ' ') || 'pending'}
                </Text>
              </View>
            </View>
            {renderDataRow('PAN Number', kycData.pan.pan_number)}
          </View>
        )}
        {hasAddress && (
          <View className="bg-white rounded-2xl border border-gray-200 p-4">
            <View className="flex-row items-center gap-2 mb-2">
              <MapPin size={18} color="#16a34a" />
              <Text className="text-base font-semibold text-gray-900">Address Proof</Text>
              <View className={`px-2 py-0.5 rounded-md ml-auto ${kycData.address.status === 'verified' ? 'bg-green-50' : 'bg-amber-50'}`}>
                <Text className={`text-xs font-medium ${kycData.address.status === 'verified' ? 'text-green-700' : 'text-amber-700'}`}>
                  {kycData.address.status?.replace('_', ' ') || 'pending'}
                </Text>
              </View>
            </View>
            {renderDataRow('Proof Type', kycData.address.proof_type)}
            {renderDataRow('ID Number', kycData.address.id_number)}
          </View>
        )}
        {hasBusiness && (
          <View className="bg-white rounded-2xl border border-gray-200 p-4">
            <View className="flex-row items-center gap-2 mb-2">
              <Building2 size={18} color="#2563eb" />
              <Text className="text-base font-semibold text-gray-900">Business Details</Text>
              <View className={`px-2 py-0.5 rounded-md ml-auto ${kycData.business.status === 'verified' ? 'bg-green-50' : 'bg-amber-50'}`}>
                <Text className={`text-xs font-medium ${kycData.business.status === 'verified' ? 'text-green-700' : 'text-amber-700'}`}>
                  {kycData.business.status?.replace('_', ' ') || 'pending'}
                </Text>
              </View>
            </View>
            {renderDataRow('Business Name', kycData.business.business_name)}
            {kycData.business.pan_number ? renderDataRow('Business PAN', kycData.business.pan_number) : null}
          </View>
        )}
      </View>
    );
  };

  // ── KYC Method Selection ───────────────────────────────────────────────────
  const renderKycMethodSelection = () => {
    if (kycStatus === 'verified' || kycStatus === 'pending') return null;

    return (
      <View className="gap-4">
        {kycMethod === 'select' ? (
          <View className="gap-3">
            <Text className="text-base font-bold text-gray-900">Choose KYC Method</Text>
            <TouchableOpacity
              onPress={() => { setError(''); setKycMethod('digilocker'); }}
              className="flex-row items-center gap-3 p-4 bg-white rounded-2xl border border-gray-200"
              activeOpacity={0.7}
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
            <TouchableOpacity
              onPress={() => { setError(''); setKycMethod('manual'); }}
              className="flex-row items-center gap-3 p-4 bg-white rounded-2xl border border-gray-200"
              activeOpacity={0.7}
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
          </View>
        ) : kycMethod === 'digilocker' ? (
          <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">DigiLocker KYC</Text>
              <TouchableOpacity onPress={() => { setKycMethod('select'); setError(''); }} activeOpacity={0.7}>
                <Text className="text-sm text-[#8c76f0] font-semibold">Back</Text>
              </TouchableOpacity>
            </View>
            {error ? (
              <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
                <AlertCircle size={16} color="#dc2626" />
                <Text className="text-sm text-red-700 flex-1">{error}</Text>
              </View>
            ) : null}
            <View className="bg-blue-50 rounded-xl p-4 gap-2">
              <Smartphone size={32} color="#2563eb" />
              <Text className="text-sm text-blue-900 font-medium mt-1">How it works</Text>
              <Text className="text-sm text-blue-700">
                Click "Start DigiLocker" to be redirected to DigiLocker. After authentication, your PAN and Aadhaar will be automatically verified.
              </Text>
            </View>
            {digilockerUrl ? (
              <View className="bg-gray-50 rounded-xl p-3">
                <Text className="text-sm text-gray-600 mb-1">DigiLocker URL ready. Tap to open:</Text>
                <TouchableOpacity onPress={() => Linking.openURL(digilockerUrl)} activeOpacity={0.7}>
                  <Text className="text-sm text-[#8c76f0] font-semibold" numberOfLines={1}>Open DigiLocker</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              onPress={handleDigiLocker}
              disabled={digilockerLoading}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5 flex-row items-center justify-center gap-2"
              style={{ opacity: digilockerLoading ? 0.5 : 1 }}
              activeOpacity={0.7}
            >
              {digilockerLoading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Smartphone size={18} color="white" />
              )}
              <Text className="text-white font-semibold text-base">
                {digilockerLoading ? 'Starting...' : 'Start DigiLocker KYC'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setKycMethod('manual'); setError(''); setDigilockerUrl(''); }}
              activeOpacity={0.7}
            >
              <Text className="text-sm text-gray-500 text-center">Prefer manual upload? Tap here</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  // ── Manual KYC Forms ───────────────────────────────────────────────────────
  const renderManualKyc = () => {
    if (kycStatus === 'verified' || kycStatus === 'pending' || kycMethod !== 'manual') return null;

    const sections = [
      { key: 'pan', icon: FileText, label: 'PAN Card', color: '#8c76f0', desc: 'PAN number and photo' },
      { key: 'address', icon: MapPin, label: 'Address Proof', color: '#16a34a', desc: 'Aadhaar, passport, or other ID' },
      { key: 'business', icon: Building2, label: 'Business Details', color: '#2563eb', desc: 'Optional - for business accounts' },
    ];

    return (
      <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-bold text-gray-900">Manual KYC Submission</Text>
          <TouchableOpacity onPress={() => { setKycMethod('select'); setActiveSection(null); setError(''); }} activeOpacity={0.7}>
            <Text className="text-sm text-[#8c76f0] font-semibold">Back</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-sm text-gray-600">
          Submit your PAN card and address proof. Business details are optional.
        </Text>

        {error ? (
          <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
            <AlertCircle size={16} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{error}</Text>
          </View>
        ) : null}

        {activeSection === null ? (
          <View className="gap-2">
            {sections.map((item) => {
              const isDone = item.key === 'pan' ? kycData?.pan?.pan_number :
                            item.key === 'address' ? kycData?.address?.id_number :
                            kycData?.business?.business_name;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => { setError(''); setActiveSection(item.key); }}
                  className="flex-row items-center gap-3 p-3 bg-gray-50 rounded-xl"
                  activeOpacity={0.7}
                >
                  <View className="w-10 h-10 bg-white rounded-lg items-center justify-center">
                    <item.icon size={20} color={item.color} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-gray-900">{item.label}</Text>
                    <Text className="text-sm text-gray-500">{item.desc}</Text>
                  </View>
                  {isDone ? (
                    <CheckCircle size={18} color="#16a34a" />
                  ) : (
                    <ChevronRight size={18} color="#9ca3af" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : activeSection === 'pan' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">PAN Card Details</Text>
              <TouchableOpacity onPress={() => { setActiveSection(null); setError(''); }} activeOpacity={0.7}>
                <Text className="text-sm text-[#8c76f0] font-semibold">Back</Text>
              </TouchableOpacity>
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">PAN Number *</Text>
              <TextInput
                value={panForm.pan_number}
                onChangeText={(v) => setPanForm({ ...panForm, pan_number: v.toUpperCase().slice(0, 10) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="ABCDE1234F"
                placeholderTextColor="#9ca3af"
                autoCapitalize="characters"
                maxLength={10}
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">PAN Photo URL</Text>
              <TextInput
                value={panForm.pan_photo_url}
                onChangeText={(v) => setPanForm({ ...panForm, pan_photo_url: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="https://..."
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
              <Text className="text-xs text-gray-400 mt-1">Upload your PAN card photo and paste the URL here.</Text>
            </View>
            <TouchableOpacity
              onPress={handlePanSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold text-center text-base">{submitting ? 'Saving...' : 'Save PAN Details'}</Text>
            </TouchableOpacity>
          </View>
        ) : activeSection === 'address' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">Address Proof</Text>
              <TouchableOpacity onPress={() => { setActiveSection(null); setError(''); }} activeOpacity={0.7}>
                <Text className="text-sm text-[#8c76f0] font-semibold">Back</Text>
              </TouchableOpacity>
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Proof Type *</Text>
              <View className="flex-row flex-wrap gap-2">
                {ADDRESS_PROOF_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    onPress={() => setAddressForm({ ...addressForm, proof_type: t.value })}
                    className={`px-4 py-2.5 rounded-xl border ${addressForm.proof_type === t.value ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                    activeOpacity={0.7}
                  >
                    <Text className={`text-sm font-medium ${addressForm.proof_type === t.value ? 'text-white' : 'text-gray-700'}`}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">ID Number *</Text>
              <TextInput
                value={addressForm.id_number}
                onChangeText={(v) => setAddressForm({ ...addressForm, id_number: v.slice(0, 30) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Enter your ID number"
                placeholderTextColor="#9ca3af"
                maxLength={30}
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Address Proof Photo URL</Text>
              <TextInput
                value={addressForm.address_proof_url_1}
                onChangeText={(v) => setAddressForm({ ...addressForm, address_proof_url_1: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="https://..."
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
              <Text className="text-xs text-gray-400 mt-1">Upload your address proof photo and paste the URL here.</Text>
            </View>
            <TouchableOpacity
              onPress={handleAddressSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold text-center text-base">{submitting ? 'Saving...' : 'Save Address Proof'}</Text>
            </TouchableOpacity>
          </View>
        ) : activeSection === 'business' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">Business Details (Optional)</Text>
              <TouchableOpacity onPress={() => { setActiveSection(null); setError(''); }} activeOpacity={0.7}>
                <Text className="text-sm text-[#8c76f0] font-semibold">Back</Text>
              </TouchableOpacity>
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Business Name</Text>
              <TextInput
                value={businessForm.business_name}
                onChangeText={(v) => setBusinessForm({ ...businessForm, business_name: v.slice(0, 200) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Your business name"
                placeholderTextColor="#9ca3af"
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Business PAN</Text>
              <TextInput
                value={businessForm.pan_number}
                onChangeText={(v) => setBusinessForm({ ...businessForm, pan_number: v.toUpperCase().slice(0, 10) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="ABCDE1234F"
                placeholderTextColor="#9ca3af"
                autoCapitalize="characters"
                maxLength={10}
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Incorporation Certificate URL</Text>
              <TextInput
                value={businessForm.incorporation_certificate_url}
                onChangeText={(v) => setBusinessForm({ ...businessForm, incorporation_certificate_url: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="https://..."
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">GST Certificate URL</Text>
              <TextInput
                value={businessForm.gst_certificate_url}
                onChangeText={(v) => setBusinessForm({ ...businessForm, gst_certificate_url: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="https://..."
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Letter of Authority URL</Text>
              <TextInput
                value={businessForm.loa_url}
                onChangeText={(v) => setBusinessForm({ ...businessForm, loa_url: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="https://..."
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
            </View>
            <TouchableOpacity
              onPress={handleBusinessSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold text-center text-base">{submitting ? 'Saving...' : 'Save Business Details'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View className="px-4 py-4 gap-4">
          <Text className="text-xl font-bold text-gray-900">KYC Verification</Text>

          <View className={`${cfg.bg} rounded-xl p-4 flex-row items-start gap-3`}>
            <Icon size={28} color={cfg.color} />
            <View className="flex-1">
              <Text className="text-base font-bold" style={{ color: cfg.color }}>{cfg.title}</Text>
              <Text className="text-sm text-gray-700 mt-1">{cfg.message}</Text>
            </View>
          </View>

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
              {renderManualKyc()}
            </View>
          )}
        </View>
      </ScrollView>
    </MobileLayout>
  );
}
