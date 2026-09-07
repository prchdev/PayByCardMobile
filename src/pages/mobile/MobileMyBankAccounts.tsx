import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable } from 'react-native';
import { Landmark, Plus, CircleAlert as AlertCircle, X, Star, Search } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { fetchIfscDetails, isValidIfscFormat } from '../../utils/ifsc';

interface BankAccount {
  id: string;
  bank_account_number: string;
  ifsc_code: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  full_name: string;
  is_default: boolean;
  is_verified: boolean;
}

export default function MobileMyBankAccounts() {
  const { navigate, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [ifscFetching, setIfscFetching] = useState(false);
  const [ifscError, setIfscError] = useState('');
  const [formData, setFormData] = useState({
    full_name: '',
    bank_account_number: '',
    ifsc: '',
    bank_name: '',
    branch_name: '',
    account_type: 'Saving',
    email: '',
    mobile: '',
  });

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchAccounts();
  }, [userId]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-bank-accounts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setAccounts(data.accounts || []);
    } catch {} finally { setLoading(false); }
  };

  const handleIfscFetch = async () => {
    setIfscError('');
    const ifsc = formData.ifsc.trim().toUpperCase();
    if (!ifsc) { setIfscError('Enter IFSC code first'); return; }
    if (!isValidIfscFormat(ifsc)) { setIfscError('IFSC format: 4 letters + 0 + 6 alphanumeric'); return; }
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
    if (!formData.full_name.trim()) return 'Account holder name is required';
    if (!/^[A-Za-z ]{1,90}$/.test(formData.full_name.trim())) return 'Name must contain only letters (max 90 chars)';
    if (!formData.bank_account_number.trim()) return 'Account number is required';
    if (!/^[A-Za-z0-9]{6,20}$/.test(formData.bank_account_number.trim())) return 'Account number must be 6-20 alphanumeric chars';
    if (!formData.ifsc.trim()) return 'IFSC code is required';
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
      const res = await fetch(`${SUPABASE_URL}/functions/v1/save-user-bank-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          full_name: formData.full_name.trim(),
          bank_account_number: formData.bank_account_number.trim(),
          ifsc: formData.ifsc.trim().toUpperCase(),
          bank_name: formData.bank_name.trim(),
          branch_name: formData.branch_name.trim(),
          account_type: formData.account_type,
          email: formData.email.trim(),
          mobile: formData.mobile.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save account'); return; }
      setShowModal(false);
      setFormData({ full_name: '', bank_account_number: '', ifsc: '', bank_name: '', branch_name: '', account_type: 'Saving', email: '', mobile: '' });
      setIfscError('');
      fetchAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account');
    } finally { setSubmitting(false); }
  };

  const setDefault = async (accountId: string) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/set-default-bank-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, accountId }),
      });
      if (res.ok) fetchAccounts();
    } catch {}
  };

  const handleLogout = () => { logout(); navigate('/mobile/login'); };

  const openModal = () => {
    setFormData({ full_name: '', bank_account_number: '', ifsc: '', bank_name: '', branch_name: '', account_type: 'Saving', email: '', mobile: '' });
    setError('');
    setIfscError('');
    setShowModal(true);
  };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-4 gap-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-gray-900">My Bank Accounts</Text>
          <TouchableOpacity
            onPress={openModal}
            className="flex-row items-center gap-2 px-4 py-2.5 bg-[#8c76f0] rounded-xl"
            activeOpacity={0.7}
          >
            <Plus size={18} color="white" />
            <Text className="text-white text-sm font-semibold">Add Account</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#8c76f0" />
            <Text className="text-base text-gray-500 mt-2">Loading accounts...</Text>
          </View>
        ) : accounts.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Landmark size={40} color="#d1d5db" />
            </View>
            <Text className="text-base font-semibold text-gray-700">No bank accounts yet</Text>
            <Text className="text-sm text-gray-400 mt-1">Add a bank account for payouts.</Text>
          </View>
        ) : (
          <View className="gap-3">
            {accounts.map((a) => (
              <View key={a.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <View className="flex-row items-center gap-3">
                  <View className="w-11 h-11 rounded-xl bg-blue-50 items-center justify-center">
                    <Landmark size={22} color="#2563eb" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-gray-900">{a.bank_name || 'Bank'}</Text>
                    <Text className="text-sm text-gray-500">{a.bank_account_number}</Text>
                  </View>
                  {a.is_default && (
                    <View className="flex-row items-center gap-1 px-2.5 py-1 bg-amber-50 rounded-md">
                      <Star size={12} color="#d97706" />
                      <Text className="text-xs text-amber-700 font-bold">Default</Text>
                    </View>
                  )}
                </View>
                <View className="mt-3 pt-3 border-t border-gray-100 gap-1.5">
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">Holder Name</Text>
                    <Text className="text-sm font-medium text-gray-900">{a.full_name}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">IFSC</Text>
                    <Text className="text-sm font-medium text-gray-900">{a.ifsc_code}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">Branch</Text>
                    <Text className="text-sm font-medium text-gray-900">{a.branch_name}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">Type</Text>
                    <Text className="text-sm font-medium text-gray-900">{a.account_type}</Text>
                  </View>
                  {!a.is_default && (
                    <TouchableOpacity onPress={() => setDefault(a.id)} className="mt-2" activeOpacity={0.7}>
                      <Text className="text-sm text-[#8c76f0] font-semibold">Set as Default</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <Modal visible={showModal} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-2xl max-h-[90%]">
            <View className="flex-row items-center justify-between p-4 border-b border-gray-100">
              <Text className="text-lg font-bold text-gray-900">Add Bank Account</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} className="p-2" activeOpacity={0.7}>
                <X size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <ScrollView className="px-4 pt-3" keyboardShouldPersistTaps="handled">
              {error ? (
                <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2 mb-3">
                  <AlertCircle size={18} color="#dc2626" />
                  <Text className="text-sm text-red-700 flex-1">{error}</Text>
                </View>
              ) : null}

              <View className="mb-4">
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Account Holder Name *</Text>
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
                  value={formData.bank_account_number}
                  onChangeText={(v) => setFormData({ ...formData, bank_account_number: v.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                  placeholder="1234567890"
                  keyboardType="default"
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
                    className="px-4 py-3 bg-blue-600 rounded-xl flex-row items-center gap-1.5"
                    activeOpacity={0.7}
                    style={{ opacity: ifscFetching ? 0.5 : 1 }}
                  >
                    {ifscFetching ? <ActivityIndicator size="small" color="white" /> : <Search size={18} color="white" />}
                    <Text className="text-white text-sm font-semibold">Fetch</Text>
                  </TouchableOpacity>
                </View>
                {ifscError ? <Text className="text-sm text-red-600 mt-1.5">{ifscError}</Text> : null}
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
                <View className="px-4 py-3 border border-gray-200 rounded-xl bg-gray-50">
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
                className="w-full bg-[#8c76f0] rounded-xl py-3.5 mb-6"
                style={{ opacity: submitting ? 0.5 : 1 }}
              >
                <Text className="text-white font-semibold text-center text-base">{submitting ? 'Saving...' : 'Save Account'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
