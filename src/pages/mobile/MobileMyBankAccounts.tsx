import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable, Alert } from 'react-native';
import { Landmark, Plus, CircleAlert as AlertCircle, X, CircleCheck as CheckCircle, Star } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface BankAccount {
  id: string; account_number: string; ifsc_code: string;
  bank_name: string; account_holder_name: string;
  is_default: boolean; is_verified: boolean;
}

export default function MobileMyBankAccounts() {
  const { navigate } = useNav();
  const { route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    account_holder_name: '', account_number: '', ifsc_code: '', bank_name: '',
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

  const handleSubmit = async () => {
    setError('');
    if (!formData.account_holder_name.trim()) { setError('Account holder name is required'); return; }
    if (!formData.account_number.trim()) { setError('Account number is required'); return; }
    if (!formData.ifsc_code.trim()) { setError('IFSC code is required'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/save-user-bank-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...formData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save account');
      setShowModal(false);
      setFormData({ account_holder_name: '', account_number: '', ifsc_code: '', bank_name: '' });
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

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-3 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-gray-900">My Bank Accounts</Text>
          <TouchableOpacity
            onPress={() => setShowModal(true)}
            className="flex-row items-center gap-1.5 px-3 py-1.5 bg-[#8c76f0] rounded-lg"
            activeOpacity={0.7}
          >
            <Plus size={14} color="white" />
            <Text className="text-white text-xs font-semibold">Add Account</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading accounts...</Text>
          </View>
        ) : accounts.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Landmark size={32} color="#d1d5db" />
            </View>
            <Text className="text-sm font-semibold text-gray-700">No bank accounts yet</Text>
            <Text className="text-xs text-gray-400 mt-1">Add a bank account for payouts.</Text>
          </View>
        ) : (
          <View className="gap-2">
            {accounts.map((a) => (
              <View key={a.id} className="bg-white rounded-xl border border-gray-200 p-3">
                <View className="flex-row items-center gap-3">
                  <View className="w-9 h-9 rounded-lg bg-blue-50 items-center justify-center">
                    <Landmark size={18} color="#2563eb" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-gray-900">{a.bank_name || 'Bank'}</Text>
                    <Text className="text-xs text-gray-500">{a.account_number}</Text>
                  </View>
                  {a.is_default && (
                    <View className="flex-row items-center gap-1 px-2 py-0.5 bg-amber-50 rounded-md">
                      <Star size={10} color="#d97706" />
                      <Text className="text-[10px] text-amber-700 font-bold">Default</Text>
                    </View>
                  )}
                </View>
                <View className="mt-2 pt-2 border-t border-gray-100">
                  <Text className="text-xs text-gray-500">{a.account_holder_name} - {a.ifsc_code}</Text>
                  {!a.is_default && (
                    <TouchableOpacity onPress={() => setDefault(a.id)} className="mt-1.5" activeOpacity={0.7}>
                      <Text className="text-xs text-[#8c76f0] font-semibold">Set as Default</Text>
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
          <View className="bg-white rounded-t-2xl p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">Add Bank Account</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} className="p-1.5" activeOpacity={0.7}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {error ? (
              <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
                <AlertCircle size={14} color="#dc2626" />
                <Text className="text-xs text-red-700 flex-1">{error}</Text>
              </View>
            ) : null}
            {[
              { key: 'account_holder_name', label: 'Account Holder Name *', placeholder: 'Amit Jha' },
              { key: 'account_number', label: 'Account Number *', placeholder: '1234567890', keyboardType: 'number-pad' },
              { key: 'ifsc_code', label: 'IFSC Code *', placeholder: 'HDFC0001234' },
              { key: 'bank_name', label: 'Bank Name', placeholder: 'HDFC Bank' },
            ].map(f => (
              <View key={f.key}>
                <Text className="text-xs font-semibold text-gray-700 mb-1">{f.label}</Text>
                <TextInput
                  value={formData[f.key as keyof typeof formData]}
                  onChangeText={(v) => setFormData({ ...formData, [f.key]: v })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                  placeholder={f.placeholder}
                  keyboardType={(f as any).keyboardType || 'default'}
                  autoCapitalize={f.key === 'ifsc_code' ? 'none' : 'words'}
                />
              </View>
            ))}
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3 mb-4"
              style={{ opacity: submitting ? 0.5 : 1 }}
            >
              <Text className="text-white font-semibold text-center">{submitting ? 'Saving...' : 'Save Account'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
