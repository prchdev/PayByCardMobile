import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, Plus, CircleAlert as AlertCircle, CircleCheck as CheckCircle, XCircle, X, User, Building2, CreditCard, Mail, Phone, FileText } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { isCreditCardIfsc, looksLikeCreditCardNumber } from '../../utils/beneficiaryValidation';
import { capitalizeName } from '../../utils/nameFormat';

interface Beneficiary {
  id: string;
  full_name: string;
  bank_account: string;
  ifsc: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  email: string;
  mobile: string;
  pan_number: string | null;
  status: string;
  is_verified_merchant?: boolean;
}

export default function MobileMyBeneficiaries() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route_params() || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSelfTransferError, setIsSelfTransferError] = useState(false);
  const [isValidatingIFSC, setIsValidatingIFSC] = useState(false);
  const [ifscError, setIfscError] = useState('');
  const [kycStatus, setKycStatus] = useState<{ isVerified: boolean; status: string; isRestricted?: boolean } | null>(null);
  const [isCheckingKyc, setIsCheckingKyc] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    full_name: '',
    bank_account: '',
    ifsc: '',
    bank_name: '',
    branch_name: '',
    account_type: 'Saving',
    email: '',
    mobile: '',
    pan_number: '',
  });

  function route_params() {
    return route?.params;
  }

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    checkKycStatus();
  }, [userId]);

  const checkKycStatus = async () => {
    try {
      setIsCheckingKyc(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const result = await res.json();
      if (res.ok) {
        setKycStatus(result);
        if (result.isVerified) fetchBeneficiaries();
      }
    } catch {} finally { setIsCheckingKyc(false); }
  };

  const fetchBeneficiaries = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-beneficiaries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch beneficiaries');
      setBeneficiaries(data.beneficiaries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load beneficiaries');
    } finally { setIsLoading(false); }
  };

  const validateIFSC = async (ifscCode: string) => {
    if (!ifscCode || ifscCode.length !== 11) {
      setIfscError('IFSC code must be 11 characters');
      return;
    }
    try {
      setIsValidatingIFSC(true);
      setIfscError('');
      const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-ifsc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ifsc: ifscCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid IFSC code');
      setFormData(prev => ({ ...prev, bank_name: data.bank, branch_name: data.branch }));
    } catch (err) {
      setIfscError(err instanceof Error ? err.message : 'Failed to validate IFSC code');
      setFormData(prev => ({ ...prev, bank_name: '', branch_name: '' }));
    } finally { setIsValidatingIFSC(false); }
  };

  const handleIFSCChange = (value: string) => {
    const upperValue = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    setFormData(prev => ({ ...prev, ifsc: upperValue }));
    if (upperValue.length === 11) {
      validateIFSC(upperValue);
    } else {
      setIfscError('');
      setFormData(prev => ({ ...prev, bank_name: '', branch_name: '' }));
    }
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    setIsSelfTransferError(false);

    if (!formData.full_name.trim()) { setError('Full Name is required.'); return; }
    if (!/^[A-Za-z ]+$/.test(formData.full_name)) { setError('Full Name must contain only letters and spaces.'); return; }
    if (formData.full_name.trim().split(/\s+/).length < 2) { setError('Please enter beneficiary full name (First Name and Last Name).'); return; }
    if (formData.full_name.length > 90) { setError('Full Name must not exceed 90 characters.'); return; }

    if (!formData.email.trim()) { setError('Email Address is required.'); return; }
    if (!/^[A-Za-z0-9@_.\-]+$/.test(formData.email)) { setError('Email may only contain letters, numbers, @, _, ., and -.'); return; }
    if (formData.email.length > 100) { setError('Email must not exceed 100 characters.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) { setError('Please enter a valid email address.'); return; }

    if (!formData.mobile.trim()) { setError('Mobile Number is required.'); return; }
    if (!/^\d{10}$/.test(formData.mobile)) { setError('Mobile Number must be exactly 10 digits.'); return; }

    if (!formData.ifsc.trim()) { setError('IFSC Code is required.'); return; }
    if (!/^[A-Z0-9]{11}$/.test(formData.ifsc)) { setError('IFSC Code must be exactly 11 characters (letters A-Z and numbers only).'); return; }

    if (!formData.bank_account.trim()) { setError('Account Number is required.'); return; }
    if (!/^[A-Za-z0-9\- ]+$/.test(formData.bank_account)) { setError('Account Number may only contain letters, numbers, -, and spaces.'); return; }
    if (formData.bank_account.length > 20) { setError('Account Number must not exceed 20 characters.'); return; }

    if (!formData.bank_name || !formData.branch_name) { setError('Please validate IFSC code before submitting'); return; }
    if (ifscError) { setError('Please fix IFSC code errors before submitting'); return; }

    if (isCreditCardIfsc(formData.ifsc)) {
      setError('This IFSC code is for credit card bill payments. Adding credit card accounts as beneficiaries is not allowed.');
      return;
    }
    if (looksLikeCreditCardNumber(formData.bank_account)) {
      setError('The account number entered appears to be a credit card number. Credit card bill payments are not allowed through this platform.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/save-beneficiary`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          full_name: capitalizeName(formData.full_name),
          userId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.self_transfer) setIsSelfTransferError(true);
        throw new Error(data.error || 'Failed to save beneficiary');
      }
      setSuccess('Beneficiary added successfully!');
      setFormData({ full_name: '', bank_account: '', ifsc: '', bank_name: '', branch_name: '', account_type: 'Saving', email: '', mobile: '', pan_number: '' });
      setTimeout(() => {
        setShowModal(false);
        setSuccess('');
        fetchBeneficiaries();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add beneficiary');
    } finally { setIsSubmitting(false); }
  };

  const toggleStatus = async (beneficiaryId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    try {
      setTogglingId(beneficiaryId);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/toggle-beneficiary-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiary_id: beneficiaryId, status: newStatus, userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      fetchBeneficiaries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
      setTimeout(() => setError(''), 3000);
    } finally { setTogglingId(null); }
  };

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const openModal = () => {
    setFormData({ full_name: '', bank_account: '', ifsc: '', bank_name: '', branch_name: '', account_type: 'Saving', email: '', mobile: '', pan_number: '' });
    setError('');
    setSuccess('');
    setIsSelfTransferError(false);
    setIfscError('');
    setShowModal(true);
  };

  const canSubmit = !(isSubmitting || isValidatingIFSC || !formData.bank_name);

  if (isCheckingKyc) {
    return (
      <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#8c76f0" />
        </View>
      </MobileLayout>
    );
  }

  if (kycStatus && !kycStatus.isVerified) {
    return (
      <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
        <View className="flex-1 items-center justify-center px-4">
          <View className="bg-white rounded-2xl border-2 border-yellow-300 p-6 items-center w-full max-w-sm">
            <View className="w-16 h-16 bg-yellow-100 rounded-full items-center justify-center mb-4">
              <AlertCircle size={32} color="#ca8a04" />
            </View>
            <Text className="text-xl font-bold text-gray-900 mb-3 text-center">KYC Verification Required</Text>
            <Text className="text-sm text-gray-700 mb-6 text-center">
              {kycStatus.status === 'not_submitted' && 'Please complete your KYC verification to manage beneficiaries. You need to submit your PAN and Address details.'}
              {kycStatus.status === 'incomplete' && 'Your KYC submission is incomplete. Please complete all required sections to proceed.'}
              {kycStatus.status === 'pending' && 'Your KYC documents are under review. Please wait for admin approval before managing beneficiaries.'}
              {kycStatus.status === 'rejected' && 'Your KYC verification was rejected. Please review the feedback and resubmit your documents.'}
            </Text>
            <TouchableOpacity
              onPress={() => navigate('/mobile/kyc-verification', { state: { userId, userEmail } })}
              className="px-6 py-3 bg-[#8c76f0] rounded-xl"
              activeOpacity={0.8}
            >
              <Text className="text-white font-semibold">Go to KYC Verification</Text>
            </TouchableOpacity>
          </View>
        </View>
      </MobileLayout>
    );
  }

  if (kycStatus?.isRestricted) {
    return (
      <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
        <View className="flex-1 items-center justify-center px-4">
          <View className="bg-white rounded-2xl border-2 border-red-300 p-6 items-center w-full max-w-sm">
            <View className="w-16 h-16 bg-red-100 rounded-full items-center justify-center mb-4">
              <AlertCircle size={32} color="#dc2626" />
            </View>
            <Text className="text-xl font-bold text-gray-900 mb-3 text-center">Account Restricted</Text>
            <Text className="text-sm text-gray-700 mb-6 text-center">
              Your account has been restricted by our compliance team. You are unable to add beneficiaries at this time. Please raise a support ticket for assistance.
            </Text>
            <TouchableOpacity
              onPress={() => navigate('/mobile/help-support', { state: { userId, userEmail } })}
              className="px-6 py-3 bg-[#8c76f0] rounded-xl"
              activeOpacity={0.8}
            >
              <Text className="text-white font-semibold">Raise Support Ticket</Text>
            </TouchableOpacity>
          </View>
        </View>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-4 gap-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 bg-[#8c76f0] rounded-xl items-center justify-center">
              <Users size={20} color="white" />
            </View>
            <Text className="text-xl font-bold text-gray-900">My Payees</Text>
          </View>
          <TouchableOpacity
            onPress={openModal}
            className="flex-row items-center gap-2 px-4 py-2.5 bg-[#8c76f0] rounded-xl"
            activeOpacity={0.7} delayPressIn={0}
          >
            <Plus size={18} color="white" />
            <Text className="text-white text-sm font-semibold">Add Payee</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
            <AlertCircle size={18} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{error}</Text>
          </View>
        ) : null}

        {isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading payees...</Text>
          </View>
        ) : beneficiaries.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Users size={40} color="#d1d5db" />
            </View>
            <Text className="text-base font-semibold text-gray-700">No payees yet</Text>
            <Text className="text-sm text-gray-400 mt-1 text-center">Add your first payee to start sending payments quickly and securely</Text>
            <TouchableOpacity
              onPress={openModal}
              className="flex-row items-center gap-2 px-6 py-3 bg-[#8c76f0] rounded-xl mt-4"
              activeOpacity={0.7} delayPressIn={0}
            >
              <Plus size={18} color="white" />
              <Text className="text-white text-sm font-semibold">Add Payee</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="gap-3">
            {beneficiaries.map((b) => (
              <View key={b.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <View className="flex-row items-start justify-between mb-3">
                  <View className="w-11 h-11 rounded-xl bg-[#f3f0fe] items-center justify-center">
                    <Users size={22} color="#8c76f0" />
                  </View>
                  <View className="flex-col items-end gap-1.5">
                    <View className={`px-2.5 py-1 rounded-md ${b.status === 'Active' ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Text className={`text-xs font-semibold ${b.status === 'Active' ? 'text-green-700' : 'text-gray-700'}`}>{b.status}</Text>
                    </View>
                    {b.is_verified_merchant ? (
                      <View className="flex-row items-center gap-1 px-2.5 py-1 bg-green-100 rounded-md">
                        <CheckCircle size={12} color="#16a34a" />
                        <Text className="text-xs text-green-700 font-semibold">Verified Merchant</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <Text className="text-base font-bold text-gray-900 mb-3">{b.full_name}</Text>

                <View className="gap-2.5 mb-4">
                  <View className="flex-row items-start gap-2.5">
                    <Building2 size={16} color="#9ca3af" />
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-gray-900">{b.bank_name}</Text>
                      <Text className="text-sm text-gray-500">{b.branch_name}</Text>
                    </View>
                  </View>
                  <View className="flex-row items-start gap-2.5">
                    <CreditCard size={16} color="#9ca3af" />
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-gray-900">{b.bank_account}</Text>
                      <Text className="text-sm text-gray-500">{b.ifsc} | {b.account_type}</Text>
                    </View>
                  </View>
                  <View className="flex-row items-center gap-2.5">
                    <Mail size={16} color="#9ca3af" />
                    <Text className="text-sm text-gray-900">{b.email}</Text>
                  </View>
                  <View className="flex-row items-center gap-2.5">
                    <Phone size={16} color="#9ca3af" />
                    <Text className="text-sm text-gray-900">{b.mobile}</Text>
                  </View>
                  {b.pan_number ? (
                    <View className="flex-row items-center gap-2.5">
                      <FileText size={16} color="#9ca3af" />
                      <Text className="text-sm text-gray-900">{b.pan_number}</Text>
                    </View>
                  ) : null}
                </View>

                <TouchableOpacity
                  onPress={() => toggleStatus(b.id, b.status)}
                  disabled={togglingId === b.id}
                  className="w-full flex-row items-center justify-center gap-2 py-3 rounded-xl border border-gray-300"
                  activeOpacity={0.7} delayPressIn={0}
                  style={{ opacity: togglingId === b.id ? 0.5 : 1 }}
                >
                  {togglingId === b.id ? (
                    <ActivityIndicator size="small" color="#6b7280" />
                  ) : b.status === 'Active' ? (
                    <XCircle size={18} color="#6b7280" />
                  ) : (
                    <CheckCircle size={18} color="#6b7280" />
                  )}
                  <Text className="text-sm font-medium text-gray-700">
                    {togglingId === b.id ? 'Processing...' : b.status === 'Active' ? 'Deactivate' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View className="bg-[#f3f0fe] border border-[#e0d5fb] rounded-2xl p-4">
          <View className="flex-row items-start gap-3">
            <AlertCircle size={18} color="#8c76f0" />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-gray-900">About Payees</Text>
              <Text className="text-sm text-gray-700 mt-1">
                Save frequently used bank accounts for quick and easy payments. You can activate or deactivate payees at any time. Only active payees will be available for transactions.
              </Text>
            </View>
          </View>
        </View>
      </View>

      <Modal visible={showModal} animationType="slide" transparent={false}>
        <View className="flex-1 bg-gray-50" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View className="flex-row items-center justify-between px-4 py-3 bg-[#8c76f0]">
            <View className="flex-row items-center gap-3">
              <View className="w-9 h-9 bg-white/20 rounded-xl items-center justify-center">
                <Plus size={18} color="white" />
              </View>
              <Text className="text-lg font-bold text-white">Add New Payee</Text>
            </View>
            <TouchableOpacity
              onPress={() => { setShowModal(false); setError(''); setSuccess(''); setIsSelfTransferError(false); }}
              className="p-2"
              activeOpacity={0.7} delayPressIn={0}
            >
              <X size={22} color="white" />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled" keyboardShouldDismissOnDrag="always" contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}>
              {error && isSelfTransferError ? (
                <View className="bg-red-50 border border-red-400 rounded-xl px-4 py-3 mb-4">
                  <View className="flex-row items-start gap-2.5">
                    <View className="w-9 h-9 bg-red-100 rounded-xl items-center justify-center">
                      <AlertCircle size={18} color="#dc2626" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-red-800">Self-Transfer Prohibited</Text>
                      <Text className="text-sm text-red-700 mt-1 leading-relaxed">
                        Sending money to your own account using this platform is strictly prohibited as per RBI norms. Please enter details of a different account holder.
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {error && !isSelfTransferError ? (
                <View className="bg-red-50 border-l-4 border-red-500 rounded-lg px-4 py-3 flex-row items-start gap-2 mb-4">
                  <AlertCircle size={18} color="#dc2626" />
                  <Text className="text-sm text-red-700 font-medium flex-1">{error}</Text>
                </View>
              ) : null}

              {success ? (
                <View className="bg-green-50 border-l-4 border-green-500 rounded-lg px-4 py-3 flex-row items-start gap-2 mb-4">
                  <CheckCircle size={18} color="#16a34a" />
                  <Text className="text-sm text-green-700 font-medium flex-1">{success}</Text>
                </View>
              ) : null}

              {/* Beneficiary Information */}
              <View className="bg-gray-50 rounded-xl p-4 mb-4">
                <View className="flex-row items-center gap-2 mb-3">
                  <Users size={16} color="#6b7280" />
                  <Text className="text-sm font-semibold text-gray-900">Beneficiary Information</Text>
                </View>

                <View className="gap-4">
                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Full Name <Text className="text-red-600">*</Text></Text>
                    <TextInput
                      value={formData.full_name}
                      onChangeText={(v) => setFormData({ ...formData, full_name: v.replace(/[^A-Za-z ]/g, '') })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Enter full name"
                      maxLength={90}
                      autoCapitalize="words"
                    />
                  </View>

                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Email Address <Text className="text-red-600">*</Text></Text>
                    <TextInput
                      value={formData.email}
                      onChangeText={(v) => setFormData({ ...formData, email: v.replace(/[^A-Za-z0-9@_.\-]/g, '') })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Enter email"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      maxLength={100}
                    />
                  </View>

                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Mobile Number <Text className="text-red-600">*</Text></Text>
                    <TextInput
                      value={formData.mobile}
                      onChangeText={(v) => setFormData({ ...formData, mobile: v.replace(/\D/g, '').slice(0, 10) })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Enter 10-digit mobile number"
                      keyboardType="number-pad"
                      maxLength={10}
                    />
                  </View>

                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">PAN Number (Optional)</Text>
                    <TextInput
                      value={formData.pan_number}
                      onChangeText={(v) => setFormData({ ...formData, pan_number: v.toUpperCase() })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Enter PAN number"
                      autoCapitalize="characters"
                      maxLength={10}
                    />
                  </View>
                </View>
              </View>

              {/* Bank Details */}
              <View className="bg-gray-50 rounded-xl p-4 mb-4">
                <View className="flex-row items-center gap-2 mb-3">
                  <Building2 size={16} color="#6b7280" />
                  <Text className="text-sm font-semibold text-gray-900">Bank Details</Text>
                </View>

                <View className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 mb-4">
                  <View className="flex-row items-start gap-2.5">
                    <AlertCircle size={18} color="#d97706" />
                    <Text className="text-sm font-medium text-amber-800 leading-relaxed flex-1">
                      Transfer of Money to Your Own Bank Account and Credit Card Bill Payments Are Not Allowed.
                    </Text>
                  </View>
                </View>

                <View className="gap-4">
                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">IFSC Code <Text className="text-red-600">*</Text></Text>
                    <TextInput
                      value={formData.ifsc}
                      onChangeText={handleIFSCChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Enter IFSC code"
                      autoCapitalize="characters"
                      maxLength={11}
                    />
                    {isValidatingIFSC ? (
                      <View className="flex-row items-center gap-2 mt-2">
                        <ActivityIndicator size="small" color="#8c76f0" />
                        <Text className="text-sm text-[#8c76f0] font-medium">Validating IFSC...</Text>
                      </View>
                    ) : null}
                    {ifscError ? (
                      <View className="flex-row items-center gap-2 mt-2">
                        <AlertCircle size={14} color="#dc2626" />
                        <Text className="text-sm text-red-600 font-medium">{ifscError}</Text>
                      </View>
                    ) : null}
                    {formData.bank_name && formData.branch_name ? (
                      <View className="mt-2 p-3 bg-green-50 border border-green-200 rounded-xl flex-row items-start gap-2">
                        <CheckCircle size={16} color="#16a34a" />
                        <View>
                          <Text className="text-sm font-bold text-green-900">{formData.bank_name}</Text>
                          <Text className="text-sm text-green-700 mt-0.5">{formData.branch_name}</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>

                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Bank Account Number <Text className="text-red-600">*</Text></Text>
                    <TextInput
                      value={formData.bank_account}
                      onChangeText={(v) => setFormData({ ...formData, bank_account: v.replace(/[^A-Za-z0-9\- ]/g, '') })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Enter account number"
                      maxLength={20}
                    />
                  </View>

                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Account Type <Text className="text-red-600">*</Text></Text>
                    <View className="flex-row gap-2">
                      {['Saving', 'Current'].map((type) => (
                        <TouchableOpacity
                          key={type}
                          onPress={() => setFormData({ ...formData, account_type: type })}
                          className={`flex-1 py-3 rounded-xl border ${formData.account_type === type ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                          activeOpacity={0.7} delayPressIn={0}
                        >
                          <Text className={`text-center text-sm font-semibold ${formData.account_type === type ? 'text-white' : 'text-gray-700'}`}>
                            {type === 'Saving' ? 'Saving Account' : 'Current Account'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              </View>

              {/* Buttons */}
              <View className="flex-row gap-3 pt-4 mt-2 border-t border-gray-200">
                <TouchableOpacity
                  onPress={() => { setShowModal(false); setError(''); setSuccess(''); setIsSelfTransferError(false); }}
                  className="flex-1 py-3.5 border border-gray-300 rounded-xl"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className="text-center text-gray-700 font-semibold">Cancel</Text>
                </TouchableOpacity>
                <Pressable
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                  className="flex-1 py-3.5 bg-[#8c76f0] rounded-xl flex-row items-center justify-center gap-2"
                  style={{ opacity: canSubmit ? 1 : 0.5 }}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Plus size={18} color="white" />
                  )}
                  <Text className="text-white font-semibold text-center">
                    {isSubmitting ? 'Adding...' : 'Add Payee'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </MobileLayout>
  );
}
