import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Landmark, Plus, CircleAlert as AlertCircle, CircleCheck as CheckCircle, X, Star, FileText, Building2, CreditCard, Mail, Phone, Loader as Loader2 } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { buildAuthHeaders, checkSessionExpired } from '../../utils/api';
import { getErrorMessage } from '../../utils/errorMessage';

interface BankAccount {
  id: string;
  bank_account_number: string;
  ifsc: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  full_name: string;
  email: string;
  mobile: string;
  pan_number: string | null;
  is_default: boolean;
  status: string;
  created_at: string;
}

interface UserProfile {
  full_name: string;
  email: string;
  mobile: string;
  pan_number: string;
  business_name?: string;
}

export default function MobileMyBankAccounts() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isValidatingIFSC, setIsValidatingIFSC] = useState(false);
  const [ifscError, setIfscError] = useState('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [kycStatus, setKycStatus] = useState<{ isVerified: boolean; status: string; isRestricted?: boolean } | null>(null);
  const [isCheckingKyc, setIsCheckingKyc] = useState(true);
  const [isSettingDefault, setIsSettingDefault] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    bank_account_number: '',
    confirm_account_number: '',
    ifsc: '',
    bank_name: '',
    branch_name: '',
    account_type: 'Saving',
    full_name: '',
    mobile: '',
  });

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    checkKycStatus();
  }, [userId]);

  const checkKycStatus = async () => {
    try {
      setIsCheckingKyc(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ userId }),
      });
      await checkSessionExpired(res);
      const result = await res.json();
      if (res.ok) {
        setKycStatus(result);
        if (result.isVerified) fetchAccounts();
      }
    } catch {} finally { setIsCheckingKyc(false); }
  };

  const fetchAccounts = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-bank-accounts`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ userId }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch accounts');
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load bank accounts'));
    } finally { setIsLoading(false); }
  };

  const fetchUserProfile = async () => {
    try {
      setIsLoadingProfile(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-profile-for-bank`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ userId }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (res.ok) {
        setUserProfile(data);
        setFormData(prev => ({
          ...prev,
          full_name: data.full_name || prev.full_name,
          mobile: data.mobile || prev.mobile,
        }));
      }
    } catch {} finally { setIsLoadingProfile(false); }
  };

  const getDisplayName = () => {
    if (formData.account_type === 'Current' && userProfile?.business_name) {
      return userProfile.business_name;
    }
    return userProfile?.full_name || '';
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
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ ifsc: ifscCode }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid IFSC code');
      setFormData(prev => ({ ...prev, bank_name: data.bank, branch_name: data.branch }));
    } catch (err) {
      setIfscError(getErrorMessage(err, 'Failed to validate IFSC code'));
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

    if (!formData.bank_account_number.trim()) { setError('Account Number is required.'); return; }
    if (!/^[A-Za-z0-9\- ]+$/.test(formData.bank_account_number)) { setError('Account Number may only contain letters, numbers, -, and spaces.'); return; }
    if (formData.bank_account_number.length > 20) { setError('Account Number must not exceed 20 characters.'); return; }
    if (formData.bank_account_number !== formData.confirm_account_number) { setError('Account numbers do not match'); return; }
    if (!formData.ifsc.trim() || !/^[A-Z0-9]{11}$/.test(formData.ifsc)) { setError('IFSC Code must be exactly 11 characters (letters A-Z and numbers only).'); return; }
    if (!formData.bank_name || !formData.branch_name) { setError('Please validate IFSC code before submitting'); return; }
    if (ifscError) { setError('Please fix IFSC code errors before submitting'); return; }
    if (!userProfile) { setError('Unable to load user profile. Please try again.'); return; }
    if (!getDisplayName().trim() || !userProfile?.mobile?.trim()) { setError('Full Name and Mobile Number are required. Please complete your profile.'); return; }

    try {
      setIsSubmitting(true);
      const response = await fetch(`${SUPABASE_URL}/functions/v1/save-user-bank-account`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({
          userId,
          bank_account_number: formData.bank_account_number,
          ifsc: formData.ifsc,
          bank_name: formData.bank_name,
          branch_name: formData.branch_name,
          account_type: formData.account_type,
          full_name: getDisplayName(),
          email: userProfile.email,
          mobile: userProfile.mobile,
          pan_number: userProfile.pan_number,
        }),
      });
      await checkSessionExpired(response);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save bank account');
      setSuccess('Bank account added successfully!');
      setTimeout(() => {
        setShowModal(false);
        setSuccess('');
        setFormData({ bank_account_number: '', confirm_account_number: '', ifsc: '', bank_name: '', branch_name: '', account_type: 'Saving', full_name: '', mobile: '' });
        fetchAccounts();
      }, 1500);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add bank account'));
    } finally { setIsSubmitting(false); }
  };

  const handleSetDefault = async (accountId: string) => {
    try {
      setIsSettingDefault(accountId);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/set-default-bank-account`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ userId, accountId }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set default');
      fetchAccounts();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to set default account'));
      setTimeout(() => setError(''), 3000);
    } finally { setIsSettingDefault(null); }
  };

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const openAddModal = () => {
    setFormData({
      bank_account_number: '',
      confirm_account_number: '',
      ifsc: '',
      bank_name: '',
      branch_name: '',
      account_type: 'Saving',
      full_name: userProfile?.full_name || '',
      mobile: userProfile?.mobile || '',
    });
    setError('');
    setSuccess('');
    setIfscError('');
    setShowModal(true);
    if (!userProfile) fetchUserProfile();
  };

  const canSubmit = !(
    isSubmitting ||
    isValidatingIFSC ||
    !formData.bank_name ||
    !formData.bank_account_number ||
    formData.bank_account_number !== formData.confirm_account_number ||
    !userProfile
  );

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
              {kycStatus.status === 'not_submitted' && 'Please complete your KYC verification to manage bank accounts. You need to submit your PAN and Address details.'}
              {kycStatus.status === 'incomplete' && 'Your KYC submission is incomplete. Please complete all required sections to proceed.'}
              {kycStatus.status === 'pending' && 'Your KYC documents are under review. Please wait for admin approval before managing bank accounts.'}
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
              Your account has been restricted by our compliance team. You are unable to manage bank accounts at this time. Please raise a support ticket for assistance.
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
              <Landmark size={20} color="white" />
            </View>
            <Text className="text-xl font-bold text-gray-900">My Bank Accounts</Text>
          </View>
          <TouchableOpacity
            onPress={openAddModal}
            className="flex-row items-center gap-2 px-4 py-2.5 bg-[#8c76f0] rounded-xl"
            activeOpacity={0.7} delayPressIn={0}
          >
            <Plus size={18} color="white" />
            <Text className="text-white text-sm font-semibold">Add Account</Text>
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
            <Text className="text-sm text-gray-500 mt-2">Loading bank accounts...</Text>
          </View>
        ) : accounts.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Landmark size={40} color="#d1d5db" />
            </View>
            <Text className="text-base font-semibold text-gray-700">No bank accounts yet</Text>
            <Text className="text-sm text-gray-400 mt-1 text-center">Add your bank account to receive payments and settlements</Text>
            <TouchableOpacity
              onPress={openAddModal}
              className="flex-row items-center gap-2 px-6 py-3 bg-[#8c76f0] rounded-xl mt-4"
              activeOpacity={0.7} delayPressIn={0}
            >
              <Plus size={18} color="white" />
              <Text className="text-white text-sm font-semibold">Add Bank Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="gap-3">
            {accounts.map((a) => (
              <View key={a.id} className={`bg-white rounded-2xl border-2 p-4 ${a.is_default ? 'border-[#8c76f0]' : 'border-gray-200'}`}>
                <View className="flex-row items-start justify-between mb-3">
                  <View className="w-11 h-11 rounded-xl bg-blue-50 items-center justify-center">
                    <Landmark size={22} color="#2563eb" />
                  </View>
                  <View className="flex-row items-center gap-2">
                    {a.is_default && (
                      <View className="flex-row items-center gap-1 px-2.5 py-1 bg-[#8c76f0] rounded-md">
                        <Star size={12} color="white" />
                        <Text className="text-xs text-white font-bold">Default</Text>
                      </View>
                    )}
                    <View className={`px-2.5 py-1 rounded-md ${a.status === 'Active' ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Text className={`text-xs font-semibold ${a.status === 'Active' ? 'text-green-700' : 'text-gray-700'}`}>{a.status}</Text>
                    </View>
                  </View>
                </View>

                <Text className="text-base font-bold text-gray-900 mb-3">{a.full_name}</Text>

                <View className="gap-2.5 mb-4">
                  <View className="flex-row items-start gap-2.5">
                    <Building2 size={16} color="#9ca3af" />
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-gray-900">{a.bank_name}</Text>
                      <Text className="text-sm text-gray-500">{a.branch_name}</Text>
                    </View>
                  </View>
                  <View className="flex-row items-start gap-2.5">
                    <CreditCard size={16} color="#9ca3af" />
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-gray-900">{a.bank_account_number}</Text>
                      <Text className="text-sm text-gray-500">{a.ifsc} | {a.account_type}</Text>
                    </View>
                  </View>
                  <View className="flex-row items-center gap-2.5">
                    <Mail size={16} color="#9ca3af" />
                    <Text className="text-sm text-gray-900">{a.email}</Text>
                  </View>
                  <View className="flex-row items-center gap-2.5">
                    <Phone size={16} color="#9ca3af" />
                    <Text className="text-sm text-gray-900">{a.mobile}</Text>
                  </View>
                  {a.pan_number ? (
                    <View className="flex-row items-center gap-2.5">
                      <FileText size={16} color="#9ca3af" />
                      <Text className="text-sm text-gray-900">{a.pan_number}</Text>
                    </View>
                  ) : null}
                </View>

                {!a.is_default && (
                  <TouchableOpacity
                    onPress={() => handleSetDefault(a.id)}
                    disabled={isSettingDefault === a.id}
                    className="w-full flex-row items-center justify-center gap-2 py-3 rounded-xl border-2 border-gray-300"
                    activeOpacity={0.7} delayPressIn={0}
                    style={{ opacity: isSettingDefault === a.id ? 0.5 : 1 }}
                  >
                    {isSettingDefault === a.id ? (
                      <ActivityIndicator size="small" color="#8c76f0" />
                    ) : (
                      <Star size={18} color="#6b7280" />
                    )}
                    <Text className="text-sm font-medium text-gray-700">
                      {isSettingDefault === a.id ? 'Setting as default...' : 'Set as Default'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        <View className="bg-[#f3f0fe] border border-[#e0d5fb] rounded-2xl p-4">
          <View className="flex-row items-start gap-3">
            <AlertCircle size={18} color="#8c76f0" />
            <View className="flex-1 gap-2">
              <Text className="text-sm font-semibold text-gray-900">About Bank Accounts</Text>
              <Text className="text-sm text-gray-700">
                Add your own bank accounts for receiving payments and settlements. Your default account will be used for all settlements.
              </Text>
              <Text className="text-sm text-gray-700">
                If any sender transfers money to these accounts through our platform, your account will be treated as KYC-verified merchants without requiring any additional information.
              </Text>
              <View className="bg-white/60 border border-[#e0d5fb] rounded-xl p-3 mt-1">
                <Text className="text-xs text-gray-700 leading-relaxed">
                  Any account added will be treated as whitelisted across the platform, allowing all users to send funds to it on your behalf. Separate KYC verification or vendor onboarding will not be required for individual payment senders to link or use this account.
                </Text>
              </View>
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
              <Text className="text-lg font-bold text-white">Add Bank Account</Text>
            </View>
            <TouchableOpacity
              onPress={() => { setShowModal(false); setError(''); setSuccess(''); }}
              className="p-2"
              activeOpacity={0.7} delayPressIn={0}
            >
              <X size={22} color="white" />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}>
              {error ? (
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

              {/* Account Holder Details */}
              <View className="bg-gray-50 rounded-xl p-4 mb-4">
                <View className="flex-row items-center gap-2 mb-3">
                  <FileText size={16} color="#6b7280" />
                  <Text className="text-sm font-semibold text-gray-900">Account Holder Details</Text>
                </View>

                {isLoadingProfile ? (
                  <View className="flex-row items-center gap-2 py-4">
                    <ActivityIndicator size="small" color="#8c76f0" />
                    <Text className="text-sm text-gray-500">Loading your details...</Text>
                  </View>
                ) : userProfile ? (
                  <View className="gap-3">
                    <View>
                      <Text className="text-xs font-medium text-gray-500 mb-1">Full Name</Text>
                      <TextInput
                        value={getDisplayName()}
                        editable={false}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-700"
                      />
                    </View>
                    <View>
                      <Text className="text-xs font-medium text-gray-500 mb-1">Email Address</Text>
                      <TextInput
                        value={userProfile.email}
                        editable={false}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-700"
                      />
                    </View>
                    <View>
                      <Text className="text-xs font-medium text-gray-500 mb-1">Mobile Number</Text>
                      <TextInput
                        value={userProfile.mobile || ''}
                        editable={false}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-700"
                      />
                    </View>
                    <View>
                      <Text className="text-xs font-medium text-gray-500 mb-1">PAN Number</Text>
                      <TextInput
                        value={userProfile.pan_number || 'Not available'}
                        editable={false}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-700"
                      />
                    </View>
                  </View>
                ) : (
                  <Text className="text-sm text-red-600">Unable to load profile. Please close and try again.</Text>
                )}
              </View>

              {/* Bank Details */}
              <View className="bg-gray-50 rounded-xl p-4 mb-4">
                <View className="flex-row items-center gap-2 mb-3">
                  <Building2 size={16} color="#6b7280" />
                  <Text className="text-sm font-semibold text-gray-900">Bank Details</Text>
                </View>

                <View className="gap-4">
                  {/* IFSC Code */}
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

                  {/* Bank Account Number */}
                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Bank Account Number <Text className="text-red-600">*</Text></Text>
                    <TextInput
                      value={formData.bank_account_number}
                      onChangeText={(v) => setFormData({ ...formData, bank_account_number: v.replace(/[^A-Za-z0-9\- ]/g, '').slice(0, 20) })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Enter account number"
                      maxLength={20}
                    />
                  </View>

                  {/* Confirm Account Number */}
                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Confirm Account Number <Text className="text-red-600">*</Text></Text>
                    <TextInput
                      value={formData.confirm_account_number}
                      onChangeText={(v) => setFormData({ ...formData, confirm_account_number: v.replace(/[^A-Za-z0-9\- ]/g, '').slice(0, 20) })}
                      className={`w-full px-4 py-3 border rounded-xl text-base ${
                        formData.confirm_account_number && formData.bank_account_number !== formData.confirm_account_number
                          ? 'border-red-400'
                          : formData.confirm_account_number && formData.bank_account_number === formData.confirm_account_number
                          ? 'border-green-400'
                          : 'border-gray-300'
                      }`}
                      placeholder="Re-enter account number"
                      maxLength={20}
                    />
                    {formData.confirm_account_number && formData.bank_account_number !== formData.confirm_account_number ? (
                      <View className="flex-row items-center gap-1.5 mt-1.5">
                        <AlertCircle size={14} color="#dc2626" />
                        <Text className="text-xs text-red-600 font-medium">Account numbers do not match</Text>
                      </View>
                    ) : null}
                    {formData.confirm_account_number && formData.bank_account_number === formData.confirm_account_number ? (
                      <View className="flex-row items-center gap-1.5 mt-1.5">
                        <CheckCircle size={14} color="#16a34a" />
                        <Text className="text-xs text-green-600 font-medium">Account numbers match</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Account Type */}
                  <View>
                    <Text className="text-sm font-medium text-gray-700 mb-1.5">Account Type <Text className="text-red-600">*</Text></Text>
                    <View className="flex-row gap-2">
                      {['Saving', 'Current'].map((type) => (
                        <TouchableOpacity
                          key={type}
                          onPress={() => setFormData(prev => ({
                            ...prev,
                            account_type: type,
                            full_name: type === 'Current' && userProfile?.business_name
                              ? userProfile.business_name
                              : userProfile?.full_name || prev.full_name,
                          }))}
                          className={`flex-1 py-3 rounded-xl border ${formData.account_type === type ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                          activeOpacity={0.7} delayPressIn={0}
                        >
                          <Text className={`text-center text-sm font-semibold ${formData.account_type === type ? 'text-white' : 'text-gray-700'}`}>
                            {type === 'Saving' ? 'Saving Account' : 'Current Account'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {formData.account_type === 'Current' && userProfile?.business_name ? (
                      <Text className="text-xs text-[#8c76f0] mt-1.5 font-medium">Business name will be used as account holder name for current accounts</Text>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* Buttons */}
              <View className="flex-row gap-3 pt-4 mt-2 border-t border-gray-200">
                <TouchableOpacity
                  onPress={() => { setShowModal(false); setError(''); setSuccess(''); }}
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
                    {isSubmitting ? 'Adding...' : 'Add Bank Account'}
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
