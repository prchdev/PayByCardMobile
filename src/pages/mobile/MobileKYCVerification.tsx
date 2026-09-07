import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Linking, Platform } from 'react-native';
import {
  ShieldCheck, CircleAlert as AlertCircle, CircleCheck as CheckCircle, Clock, Circle as XCircle,
  FileText, MapPin, Building2, User, Upload, ChevronRight, Smartphone, FileCheck, Save, Lock,
} from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as DocumentPicker from 'expo-document-picker';
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
  { value: 'aadhar', label: 'Aadhar' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
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
  const [kycSettings, setKycSettings] = useState<{ digilocker_enabled: boolean; manual_enabled: boolean }>({ digilocker_enabled: false, manual_enabled: true });
  const [personalForm, setPersonalForm] = useState({ first_name: '', middle_name: '', last_name: '' });
  const [personalSaving, setPersonalSaving] = useState(false);
  const [personalSuccess, setPersonalSuccess] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  const [panForm, setPanForm] = useState({ pan_number: '', pan_photo_url: '' });
  const [addressForm, setAddressForm] = useState({
    proof_type: 'aadhar', id_number: '', address: '', city: '', state: '', pincode: '',
    front_photo_url: '', back_photo_url: '',
  });
  const [businessForm, setBusinessForm] = useState({
    company_type: '', business_name: '', incorporation_number: '', business_pan: '',
    gst_number: '', business_address: '', business_email: '', business_phone: '',
    incorporation_certificate_url: '', company_pan_photo_url: '', gst_certificate_url: '', loa_url: '',
  });

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchKycStatus();
    fetchKycSettings();
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
          proof_type: data.address.proof_type || 'aadhar',
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

  // ── File Upload via Document Picker ──────────────────────────────────────────
  const uploadFile = async (fileKey: string): Promise<string | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return null;

      const file = result.assets[0];
      setUploadingField(fileKey);

      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'image/jpeg',
      } as any);
      formData.append('fileKey', fileKey);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-kyc-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data.url;
    } catch (err) {
      Alert.alert('Upload Failed', err instanceof Error ? err.message : 'Failed to upload file');
      return null;
    } finally { setUploadingField(null); }
  };

  // ── DigiLocker KYC via WebBrowser ───────────────────────────────────────────
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
        await WebBrowser.openBrowserAsync(data.url, {
          toolbarColor: '#8c76f0',
          controlsColor: '#8c76f0',
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
    submitSection('pan', { pan_number: panForm.pan_number.trim().toUpperCase(), pan_photo_url: panForm.pan_photo_url });
  };

  const handleAddressSubmit = () => {
    setError('');
    if (!addressForm.proof_type) { setError('Select proof type'); return; }
    if (!addressForm.id_number.trim()) { setError('ID number is required'); return; }
    if (!addressForm.address.trim()) { setError('Address is required'); return; }
    if (!addressForm.city.trim()) { setError('City is required'); return; }
    if (!addressForm.state) { setError('State is required'); return; }
    if (!/^\d{6}$/.test(addressForm.pincode.trim())) { setError('Valid 6-digit pincode is required'); return; }
    submitSection('address', {
      proof_type: addressForm.proof_type,
      id_number: addressForm.id_number.trim(),
      address: addressForm.address.trim(),
      city: addressForm.city.trim(),
      state: addressForm.state,
      pincode: addressForm.pincode.trim(),
      front_photo_url: addressForm.front_photo_url,
      back_photo_url: addressForm.back_photo_url,
    });
  };

  const handleBusinessSubmit = () => {
    setError('');
    if (businessForm.business_name && businessForm.business_name.length > 200) { setError('Business name too long'); return; }
    if (businessForm.business_pan && !PAN_REGEX.test(businessForm.business_pan.trim().toUpperCase())) { setError('Invalid business PAN format'); return; }
    submitSection('business', {
      company_type: businessForm.company_type,
      business_name: businessForm.business_name.trim(),
      incorporation_number: businessForm.incorporation_number.trim(),
      business_pan: businessForm.business_pan.trim().toUpperCase(),
      gst_number: businessForm.gst_number.trim().toUpperCase(),
      business_address: businessForm.business_address.trim(),
      business_email: businessForm.business_email.trim(),
      business_phone: businessForm.business_phone.trim(),
      incorporation_certificate_url: businessForm.incorporation_certificate_url,
      company_pan_photo_url: businessForm.company_pan_photo_url,
      gst_certificate_url: businessForm.gst_certificate_url,
      loa_url: businessForm.loa_url,
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

  // ── File Upload Button ─────────────────────────────────────────────────────
  const renderFileUpload = (label: string, fieldKey: string, value: string, onUpload: (url: string) => void) => (
    <View>
      <Text className="text-sm font-semibold text-gray-700 mb-1.5">{label}</Text>
      <TouchableOpacity
        onPress={async () => {
          const url = await uploadFile(fieldKey);
          if (url) onUpload(url);
        }}
        className="flex-row items-center justify-center gap-2 w-full px-4 py-3 border border-dashed border-gray-300 rounded-xl bg-gray-50"
        activeOpacity={0.7} delayPressIn={0}
        disabled={uploadingField === fieldKey}
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

  // ── Personal Details Save ──────────────────────────────────────────────────
  const handlePersonalSave = async () => {
    setError('');
    if (!personalForm.first_name.trim()) { setError('First name is required'); return; }
    if (!personalForm.last_name.trim()) { setError('Last name is required'); return; }
    setPersonalSaving(true);
    setPersonalSuccess(false);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-user-profile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          first_name: personalForm.first_name.trim(),
          middle_name: personalForm.middle_name.trim(),
          last_name: personalForm.last_name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setPersonalSuccess(true);
      setTimeout(() => setPersonalSuccess(false), 3000);
      fetchKycData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setPersonalSaving(false); }
  };

  // ── User Profile Info (Editable) ───────────────────────────────────────────
  const renderUserProfile = () => {
    if (!kycData?.userProfile) return null;
    const p = kycData.userProfile;
    const kycLocked = kycStatus === 'verified' || kycStatus === 'pending';
    return (
      <View className="bg-white rounded-2xl border border-gray-200 p-4 gap-3">
        <View className="flex-row items-center gap-2">
          <User size={18} color="#8c76f0" />
          <Text className="text-base font-semibold text-gray-900">Personal Details</Text>
          {kycLocked && (
            <View className="flex-row items-center ml-auto bg-gray-100 px-2 py-0.5 rounded-md">
              <Lock size={12} color="#6b7280" />
              <Text className="text-xs text-gray-500 font-medium ml-1">Locked</Text>
            </View>
          )}
        </View>
        {personalSuccess && (
          <View className="bg-green-50 border border-green-300 rounded-xl p-2.5 flex-row items-center gap-2">
            <CheckCircle size={16} color="#16a34a" />
            <Text className="text-sm text-green-700 flex-1">Personal details saved successfully!</Text>
          </View>
        )}
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-1.5">First Name *</Text>
          <TextInput
            value={personalForm.first_name}
            onChangeText={(v) => setPersonalForm({ ...personalForm, first_name: v })}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
            placeholder="First name"
            placeholderTextColor="#9ca3af"
            editable={!kycLocked && !personalSaving}
            autoCapitalize="words"
          />
        </View>
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-1.5">Middle Name</Text>
          <TextInput
            value={personalForm.middle_name}
            onChangeText={(v) => setPersonalForm({ ...personalForm, middle_name: v })}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
            placeholder="Middle name (optional)"
            placeholderTextColor="#9ca3af"
            editable={!kycLocked && !personalSaving}
            autoCapitalize="words"
          />
        </View>
        <View>
          <Text className="text-sm font-semibold text-gray-700 mb-1.5">Last Name *</Text>
          <TextInput
            value={personalForm.last_name}
            onChangeText={(v) => setPersonalForm({ ...personalForm, last_name: v })}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
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
            className="w-full flex-row items-center justify-center gap-2 bg-[#8c76f0] rounded-xl py-3"
            style={{ opacity: personalSaving ? 0.5 : 1 }}
            activeOpacity={0.7} delayPressIn={0}
          >
            <Save size={18} color="white" />
            <Text className="text-white font-semibold text-base">{personalSaving ? 'Saving...' : 'Save Personal Details'}</Text>
          </TouchableOpacity>
        )}
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
            {renderDataRow('Address', kycData.address.address)}
            {renderDataRow('City', kycData.address.city)}
            {renderDataRow('State', kycData.address.state)}
            {renderDataRow('Pincode', kycData.address.pincode)}
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
            {kycData.business.business_pan ? renderDataRow('Business PAN', kycData.business.business_pan) : null}
            {kycData.business.gst_number ? renderDataRow('GST Number', kycData.business.gst_number) : null}
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
        ) : kycMethod === 'digilocker' ? (
          <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">DigiLocker KYC</Text>
              <TouchableOpacity onPress={() => { setKycMethod('select'); setError(''); }} activeOpacity={0.7} delayPressIn={0}>
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
                Tap "Start DigiLocker" to open DigiLocker in a secure browser. After authentication, your PAN and Aadhaar will be automatically verified.
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleDigiLocker}
              disabled={digilockerLoading}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5 flex-row items-center justify-center gap-2"
              style={{ opacity: digilockerLoading ? 0.5 : 1 }}
              activeOpacity={0.7} delayPressIn={0}
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
            {kycSettings.manual_enabled && (
            <TouchableOpacity
              onPress={() => { setKycMethod('manual'); setError(''); }}
              activeOpacity={0.7} delayPressIn={0}
            >
              <Text className="text-sm text-gray-500 text-center">Prefer manual upload? Tap here</Text>
            </TouchableOpacity>
            )}
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
          <TouchableOpacity onPress={() => { setKycMethod('select'); setActiveSection(null); setError(''); }} activeOpacity={0.7} delayPressIn={0}>
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
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <View className="w-10 h-10 bg-white rounded-lg items-center justify-center">
                    <item.icon size={20} color={item.color} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-gray-900">{item.label}</Text>
                    <Text className="text-sm text-gray-500">{item.desc}</Text>
                  </View>
                  {isDone ? <CheckCircle size={18} color="#16a34a" /> : <ChevronRight size={18} color="#9ca3af" />}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : activeSection === 'pan' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">PAN Card Details</Text>
              <TouchableOpacity onPress={() => { setActiveSection(null); setError(''); }} activeOpacity={0.7} delayPressIn={0}>
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
            {renderFileUpload('PAN Card Photo', 'pan_photo', panForm.pan_photo_url, (url) => setPanForm({ ...panForm, pan_photo_url: url }))}
            <TouchableOpacity
              onPress={handlePanSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7} delayPressIn={0}
            >
              <Text className="text-white font-semibold text-center text-base">{submitting ? 'Saving...' : 'Save PAN Details'}</Text>
            </TouchableOpacity>
          </View>
        ) : activeSection === 'address' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">Address Proof</Text>
              <TouchableOpacity onPress={() => { setActiveSection(null); setError(''); }} activeOpacity={0.7} delayPressIn={0}>
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
                    activeOpacity={0.7} delayPressIn={0}
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
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Address *</Text>
              <TextInput
                value={addressForm.address}
                onChangeText={(v) => setAddressForm({ ...addressForm, address: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="House/Flat, Street, Area"
                placeholderTextColor="#9ca3af"
                multiline
                textAlignVertical="top"
                style={{ minHeight: 70 }}
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">City *</Text>
              <TextInput
                value={addressForm.city}
                onChangeText={(v) => setAddressForm({ ...addressForm, city: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Enter city"
                placeholderTextColor="#9ca3af"
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">State *</Text>
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                <View className="flex-row flex-wrap gap-2">
                  {INDIAN_STATES.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setAddressForm({ ...addressForm, state: s })}
                      className={`px-3 py-2 rounded-lg border ${addressForm.state === s ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                      activeOpacity={0.7} delayPressIn={0}
                    >
                      <Text className={`text-xs font-medium ${addressForm.state === s ? 'text-white' : 'text-gray-700'}`}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Pincode *</Text>
              <TextInput
                value={addressForm.pincode}
                onChangeText={(v) => setAddressForm({ ...addressForm, pincode: v.replace(/[^\d]/g, '').slice(0, 6) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="6-digit pincode"
                placeholderTextColor="#9ca3af"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            {renderFileUpload('Address Proof Front Photo', 'address_proof_front', addressForm.front_photo_url, (url) => setAddressForm({ ...addressForm, front_photo_url: url }))}
            {renderFileUpload('Address Proof Back Photo', 'address_proof_back', addressForm.back_photo_url, (url) => setAddressForm({ ...addressForm, back_photo_url: url }))}
            <TouchableOpacity
              onPress={handleAddressSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7} delayPressIn={0}
            >
              <Text className="text-white font-semibold text-center text-base">{submitting ? 'Saving...' : 'Save Address Proof'}</Text>
            </TouchableOpacity>
          </View>
        ) : activeSection === 'business' ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">Business Details (Optional)</Text>
              <TouchableOpacity onPress={() => { setActiveSection(null); setError(''); }} activeOpacity={0.7} delayPressIn={0}>
                <Text className="text-sm text-[#8c76f0] font-semibold">Back</Text>
              </TouchableOpacity>
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Company Type</Text>
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                <View className="flex-row flex-wrap gap-2">
                  {COMPANY_TYPES.map((t) => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => setBusinessForm({ ...businessForm, company_type: t })}
                      className={`px-3 py-2 rounded-lg border ${businessForm.company_type === t ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                      activeOpacity={0.7} delayPressIn={0}
                    >
                      <Text className={`text-xs font-medium ${businessForm.company_type === t ? 'text-white' : 'text-gray-700'}`}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
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
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Incorporation Number</Text>
              <TextInput
                value={businessForm.incorporation_number}
                onChangeText={(v) => setBusinessForm({ ...businessForm, incorporation_number: v.slice(0, 50) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Incorporation number"
                placeholderTextColor="#9ca3af"
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Business PAN</Text>
              <TextInput
                value={businessForm.business_pan}
                onChangeText={(v) => setBusinessForm({ ...businessForm, business_pan: v.toUpperCase().slice(0, 10) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="ABCDE1234F"
                placeholderTextColor="#9ca3af"
                autoCapitalize="characters"
                maxLength={10}
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">GST Number</Text>
              <TextInput
                value={businessForm.gst_number}
                onChangeText={(v) => setBusinessForm({ ...businessForm, gst_number: v.toUpperCase().slice(0, 15) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="22AAAAA0000A1Z5"
                placeholderTextColor="#9ca3af"
                autoCapitalize="characters"
                maxLength={15}
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Business Address</Text>
              <TextInput
                value={businessForm.business_address}
                onChangeText={(v) => setBusinessForm({ ...businessForm, business_address: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Business address"
                placeholderTextColor="#9ca3af"
                multiline
                textAlignVertical="top"
                style={{ minHeight: 70 }}
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Business Email</Text>
              <TextInput
                value={businessForm.business_email}
                onChangeText={(v) => setBusinessForm({ ...businessForm, business_email: v })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="business@example.com"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Business Phone</Text>
              <TextInput
                value={businessForm.business_phone}
                onChangeText={(v) => setBusinessForm({ ...businessForm, business_phone: v.replace(/[^\d]/g, '').slice(0, 10) })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="9999999999"
                placeholderTextColor="#9ca3af"
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
            {renderFileUpload('Incorporation Certificate', 'business_pan_photo', businessForm.incorporation_certificate_url, (url) => setBusinessForm({ ...businessForm, incorporation_certificate_url: url }))}
            {renderFileUpload('GST Certificate', 'gst_certificate', businessForm.gst_certificate_url, (url) => setBusinessForm({ ...businessForm, gst_certificate_url: url }))}
            {renderFileUpload('Letter of Authority', 'additional_document', businessForm.loa_url, (url) => setBusinessForm({ ...businessForm, loa_url: url }))}
            <TouchableOpacity
              onPress={handleBusinessSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7} delayPressIn={0}
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
