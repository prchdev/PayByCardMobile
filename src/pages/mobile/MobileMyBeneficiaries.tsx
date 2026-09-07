import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Users, Plus, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Power, X, User, Landmark, Search } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { fetchIfscDetails, isValidIfscFormat } from '../../utils/ifsc';

interface Beneficiary {
  id: string;
  full_name: string;
  bank_name: string;
  bank_account: string;
  ifsc: string;
  branch_name: string;
  account_type: string;
  email: string;
  mobile: string;
  status: string;
}

export default function MobileMyBeneficiaries() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Beneficiary | null>(null);
  const [toggling, setToggling] = useState(false);
  const [kycVerified, setKycVerified] = useState(false);
  const [ifscFetching, setIfscFetching] = useState(false);
  const [ifscError, setIfscError] = useState('');
  const [formData, setFormData] = useState({
    full_name: '',
    bank_account: '',
    ifsc: '',
    bank_name: '',
    branch_name: '',
    account_type: 'Saving',
    email: '',
    mobile: '',
  });

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchBeneficiaries();
    checkKyc();
  }, [userId]);

  const fetchBeneficiaries = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-beneficiaries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setBeneficiaries(data.beneficiaries || []);
    } catch {} finally { setLoading(false); }
  };

  const checkKyc = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setKycVerified(data.isVerified);
    } catch {}
  };

  const handleIfscFetch = async () => {
    setIfscError('');
    const ifsc = formData.ifsc.trim().toUpperCase();
    if (!ifsc) { setIfscError('Enter IFSC code first'); return; }
    if (!isValidIfscFormat(ifsc)) { setIfscError('IFSC format: 4 letters + 0 + 6 alphanumeric (e.g. HDFC0001234)'); return; }
    setIfscFetching(true);
    try {
      const result = await fetchIfscDetails(ifsc);
      setFormData(prev => ({ ...prev, ifsc, bank_name: result.bank, branch_name: result.branch }));
    } catch (err) {
      setIfscError(err instanceof Error ? err.message : 'Invalid IFSC code');
      setFormData(prev => ({ ...prev, bank_name: '', branch_name: '' }));
    } finally { setIfscFetching(false); }
  };

  const validate = (): string | null => {
    if (!formData.full_name.trim()) return 'Full Name is required';
    if (!/^[A-Za-z ]{2,100}$/.test(formData.full_name.trim())) return 'Name must contain only letters (2-100 chars)';
    if (!formData.bank_account.trim()) return 'Account Number is required';
    if (!/^\d{6,20}$/.test(formData.bank_account.trim())) return 'Account number must be 6-20 digits';
    if (!formData.ifsc.trim()) return 'IFSC Code is required';
    if (!isValidIfscFormat(formData.ifsc)) return 'Invalid IFSC format (e.g. HDFC0001234)';
    if (!formData.bank_name.trim()) return 'Click "Fetch" to auto-fill bank details from IFSC';
    if (!formData.branch_name.trim()) return 'Branch name is required (auto-filled from IFSC)';
    if (!formData.account_type) return 'Account type is required';
    if (!formData.email.trim()) return 'Email is required';
    if (!/^[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,255}\.[a-zA-Z]{2,}$/.test(formData.email.trim())) return 'Invalid email format';
    if (!formData.mobile.trim()) return 'Mobile number is required';
    if (!/^\d{10}$/.test(formData.mobile.replace(/\D/g, '').slice(-10))) return 'Mobile number must be 10 digits';
    return null;
  };

  const handleSubmit = async () => {
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/save-beneficiary`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          full_name: formData.full_name.trim(),
          bank_account: formData.bank_account.trim(),
          ifsc: formData.ifsc.trim().toUpperCase(),
          bank_name: formData.bank_name.trim(),
          branch_name: formData.branch_name.trim(),
          account_type: formData.account_type,
          email: formData.email.trim(),
          mobile: formData.mobile.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.self_transfer) {
          setError(data.error || 'Self-transfer not allowed');
        } else if (data.credit_card) {
          setError(data.error || 'Credit card accounts not allowed');
        } else {
          setError(data.error || 'Failed to save beneficiary');
        }
        return;
      }
      setShowModal(false);
      setFormData({ full_name: '', bank_account: '', ifsc: '', bank_name: '', branch_name: '', account_type: 'Saving', email: '', mobile: '' });
      setIfscError('');
      fetchBeneficiaries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save beneficiary');
    } finally { setSubmitting(false); }
  };

  const handleToggleStatus = async () => {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      const newStatus = toggleTarget.status === 'Active' ? 'Inactive' : 'Active';
      const res = await fetch(`${SUPABASE_URL}/functions/v1/toggle-beneficiary-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiary_id: toggleTarget.id, status: newStatus, userId }),
      });
      if (res.ok) {
        setBeneficiaries(prev => prev.map(b => b.id === toggleTarget.id ? { ...b, status: newStatus } : b));
        setToggleTarget(null);
      }
    } catch {} finally { setToggling(false); }
  };

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const openModal = () => {
    setFormData({ full_name: '', bank_account: '', ifsc: '', bank_name: '', branch_name: '', account_type: 'Saving', email: '', mobile: '' });
    setError('');
    setIfscError('');
    setShowModal(true);
  };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-4 gap-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-gray-900">My Payees</Text>
          <TouchableOpacity
            onPress={() => {
              if (!kycVerified) { Alert.alert('KYC Required', 'Please complete KYC before adding payees.'); return; }
              openModal();
            }}
            className="flex-row items-center gap-2 px-4 py-2.5 bg-[#8c76f0] rounded-xl"
            activeOpacity={0.7}
          >
            <Plus size={18} color="white" />
            <Text className="text-white text-sm font-semibold">Add Payee</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#8c76f0" />
            <Text className="text-base text-gray-500 mt-2">Loading payees...</Text>
          </View>
        ) : beneficiaries.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Users size={40} color="#d1d5db" />
            </View>
            <Text className="text-base font-semibold text-gray-700">No payees yet</Text>
            <Text className="text-sm text-gray-400 mt-1">Add a payee to start making payments.</Text>
          </View>
        ) : (
          <View className="gap-3">
            {beneficiaries.map((b) => {
              const isExpanded = expandedId === b.id;
              const isActive = b.status === 'Active';
              return (
                <View key={b.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                  <TouchableOpacity
                    onPress={() => setExpandedId(isExpanded ? null : b.id)}
                    className="flex-row items-center gap-3"
                    activeOpacity={0.7}
                  >
                    <View className="w-11 h-11 rounded-xl bg-[#f3f0fe] items-center justify-center">
                      <User size={22} color="#8c76f0" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-gray-900">{b.full_name}</Text>
                      <Text className="text-sm text-gray-500">{b.bank_name} - ****{(b.bank_account || '').slice(-4)}</Text>
                    </View>
                    {!isActive && <View className="px-2.5 py-1 bg-gray-100 rounded-md"><Text className="text-xs text-gray-500 font-medium">Inactive</Text></View>}
                    {isExpanded ? <ChevronUp size={18} color="#9ca3af" /> : <ChevronDown size={18} color="#9ca3af" />}
                  </TouchableOpacity>
                  {isExpanded && (
                    <View className="mt-3 pt-3 border-t border-gray-100 gap-2">
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-gray-500">Account Number</Text>
                        <Text className="text-sm font-medium text-gray-900">{b.bank_account}</Text>
                      </View>
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-gray-500">IFSC Code</Text>
                        <Text className="text-sm font-medium text-gray-900">{b.ifsc}</Text>
                      </View>
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-gray-500">Bank Name</Text>
                        <Text className="text-sm font-medium text-gray-900">{b.bank_name}</Text>
                      </View>
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-gray-500">Branch</Text>
                        <Text className="text-sm font-medium text-gray-900">{b.branch_name}</Text>
                      </View>
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-gray-500">Account Type</Text>
                        <Text className="text-sm font-medium text-gray-900">{b.account_type}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setToggleTarget(b)}
                        className="flex-row items-center gap-2 mt-2 self-start"
                        activeOpacity={0.7}
                      >
                        <Power size={16} color={isActive ? '#dc2626' : '#16a34a'} />
                        <Text className={`text-sm font-medium ${isActive ? 'text-red-600' : 'text-green-600'}`}>{isActive ? 'Deactivate Payee' : 'Activate Payee'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <Modal visible={showModal} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-2xl max-h-[90%]">
            <View className="flex-row items-center justify-between p-4 border-b border-gray-100">
              <Text className="text-lg font-bold text-gray-900">Add New Payee</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} className="p-2" activeOpacity={0.7}>
                <X size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ flex: 1 }}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
            >
            <ScrollView className="px-4 pt-3" keyboardShouldPersistTaps="handled" keyboardShouldDismissOnDrag="always">
              {error ? (
                <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2 mb-3">
                  <AlertCircle size={18} color="#dc2626" />
                  <Text className="text-sm text-red-700 flex-1">{error}</Text>
                </View>
              ) : null}

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Full Name *</Text>
                <TextInput
                  value={formData.full_name}
                  onChangeText={(v) => setFormData({ ...formData, full_name: v })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                  placeholder="Amit Jha"
                  autoCapitalize="words"
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Account Number *</Text>
                <TextInput
                  value={formData.bank_account}
                  onChangeText={(v) => setFormData({ ...formData, bank_account: v.replace(/[^\d]/g, '') })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                  placeholder="1234567890"
                  keyboardType="number-pad"
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">IFSC Code *</Text>
                <View className="flex-row gap-2">
                  <TextInput
                    value={formData.ifsc}
                    onChangeText={(v) => setFormData({ ...formData, ifsc: v.toUpperCase().slice(0, 11) })}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-base"
                    placeholder="HDFC0001234"
                    autoCapitalize="characters"
                    maxLength={11}
                  />
                  <TouchableOpacity
                    onPress={handleIfscFetch}
                    disabled={ifscFetching}
                    className="px-4 py-3 bg-[#8c76f0] rounded-xl flex-row items-center gap-1.5"
                    activeOpacity={0.7}
                    style={{ opacity: ifscFetching ? 0.5 : 1 }}
                  >
                    {ifscFetching ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Search size={18} color="white" />
                    )}
                    <Text className="text-white text-sm font-semibold">Fetch</Text>
                  </TouchableOpacity>
                </View>
                {ifscError ? (
                  <Text className="text-sm text-red-600 mt-1.5">{ifscError}</Text>
                ) : null}
              </View>

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Bank Name</Text>
                <View className="flex-row items-center px-4 py-3 border border-gray-200 rounded-xl bg-gray-50">
                  <Landmark size={18} color="#9ca3af" />
                  <Text className={`text-base ml-2 ${formData.bank_name ? 'text-gray-900' : 'text-gray-400'}`}>
                    {formData.bank_name || 'Auto-filled from IFSC'}
                  </Text>
                </View>
              </View>

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Branch Name</Text>
                <View className="flex-row items-center px-4 py-3 border border-gray-200 rounded-xl bg-gray-50">
                  <Text className={`text-base ${formData.branch_name ? 'text-gray-900' : 'text-gray-400'}`}>
                    {formData.branch_name || 'Auto-filled from IFSC'}
                  </Text>
                </View>
              </View>

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Account Type *</Text>
                <View className="flex-row gap-2">
                  {['Saving', 'Current'].map((type) => (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setFormData({ ...formData, account_type: type })}
                      className={`flex-1 py-3 rounded-xl border ${formData.account_type === type ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300 bg-white'}`}
                      activeOpacity={0.7}
                    >
                      <Text className={`text-center text-sm font-semibold ${formData.account_type === type ? 'text-white' : 'text-gray-700'}`}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Email *</Text>
                <TextInput
                  value={formData.email}
                  onChangeText={(v) => setFormData({ ...formData, email: v })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                  placeholder="amit@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Mobile *</Text>
                <TextInput
                  value={formData.mobile}
                  onChangeText={(v) => setFormData({ ...formData, mobile: v.replace(/[^\d]/g, '').slice(0, 10) })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                  placeholder="9999999999"
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>

              <Pressable
                onPress={handleSubmit}
                disabled={submitting}
                className="w-full bg-[#8c76f0] rounded-xl py-3.5 mb-10"
                style={{ opacity: submitting ? 0.5 : 1 }}
              >
                <Text className="text-white font-semibold text-center text-base">{submitting ? 'Saving...' : 'Save Payee'}</Text>
              </Pressable>
            </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </Modal>

      <Modal visible={toggleTarget !== null} animationType="fade" transparent>
        <View className="flex-1 bg-black/60 justify-center items-center p-4">
          <View className="bg-white rounded-2xl p-5 w-full max-w-sm gap-3">
            <Text className="text-lg font-bold text-gray-900">{toggleTarget?.status === 'Active' ? 'Deactivate Payee?' : 'Activate Payee?'}</Text>
            <Text className="text-base text-gray-600">{toggleTarget?.status === 'Active'
              ? `Are you sure you want to deactivate ${toggleTarget?.full_name}? They will not appear in Make Payment.`
              : `Are you sure you want to activate ${toggleTarget?.full_name}? They will appear in Make Payment.`}</Text>
            <View className="flex-row gap-3 mt-2">
              <TouchableOpacity onPress={() => setToggleTarget(null)} className="flex-1 px-4 py-3 border border-gray-300 rounded-xl" activeOpacity={0.7}>
                <Text className="text-base text-gray-700 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleToggleStatus}
                disabled={toggling}
                className={`flex-1 px-4 py-3 rounded-xl ${toggleTarget?.status === 'Active' ? 'bg-red-600' : 'bg-green-600'}`}
                style={{ opacity: toggling ? 0.5 : 1 }}
                activeOpacity={0.7}
              >
                <Text className="text-base text-white font-semibold text-center">{toggling ? 'Processing...' : toggleTarget?.status === 'Active' ? 'Deactivate' : 'Activate'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
