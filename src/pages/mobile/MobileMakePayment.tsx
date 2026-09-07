import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { CreditCard, ArrowUpRight, CircleAlert as AlertCircle, ChevronDown, ChevronUp, CircleCheck as CheckCircle, Clock, Circle as XCircle, Info } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface Beneficiary {
  id: string; full_name: string; bank_name: string;
  account_number: string; ifsc_code: string;
}

interface PaymentCategory {
  id: string; name: string; code: string;
}

function fmtAmt(v: string | number) {
  return parseFloat(String(v || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MobileMakePayment() {
  const { navigate, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [categories, setCategories] = useState<PaymentCategory[]>([]);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showBeneficiaryList, setShowBeneficiaryList] = useState(false);
  const [showCategoryList, setShowCategoryList] = useState(false);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    Promise.all([fetchBeneficiaries(), fetchCategories()]).finally(() => setLoading(false));
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
    } catch {}
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-payment-categories-list`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setCategories(data.categories || []);
    } catch {}
  };

  const handleLogout = () => { logout(); navigate('/mobile/login'); };

  const handleSubmit = async () => {
    setError('');
    if (!selectedBeneficiary) { setError('Please select a beneficiary'); return; }
    if (!selectedCategory) { setError('Please select a payment category'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt < 1) { setError('Enter a valid amount'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/initiate-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, beneficiaryId: selectedBeneficiary,
          categoryId: selectedCategory, amount: amt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate payment');
      if (data.payment_url) {
        Alert.alert('Payment', 'You will be redirected to the payment gateway. This will open in the web version.');
      } else {
        Alert.alert('Success', 'Payment initiated. Check your transactions for status.');
        navigate('/mobile/my-transactions', { state: { userId, userEmail } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate payment');
    } finally { setSubmitting(false); }
  };

  const selectedBen = beneficiaries.find(b => b.id === selectedBeneficiary);

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-3 gap-3">
        <Text className="text-lg font-bold text-gray-900">Make Payment</Text>

        {error ? (
          <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
            <AlertCircle size={16} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading...</Text>
          </View>
        ) : (
          <View className="gap-3">
            <View>
              <Text className="text-xs font-semibold text-gray-700 mb-1.5">Select Beneficiary *</Text>
              <TouchableOpacity
                onPress={() => { setShowBeneficiaryList(!showBeneficiaryList); setShowCategoryList(false); }}
                className="flex-row items-center justify-between w-full px-3 py-2.5 border border-gray-300 rounded-xl bg-white"
                activeOpacity={0.7}
              >
                <Text className={`text-sm ${selectedBen ? 'text-gray-900' : 'text-gray-400'}`}>
                  {selectedBen ? `${selectedBen.full_name} (${(selectedBen.account_number || '').slice(-4)})` : 'Choose beneficiary...'}
                </Text>
                {showBeneficiaryList ? <ChevronUp size={16} color="#6b7280" /> : <ChevronDown size={16} color="#6b7280" />}
              </TouchableOpacity>
              {showBeneficiaryList && (
                <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm max-h-60">
                  <ScrollView className="max-h-60">
                    {beneficiaries.length === 0 ? (
                      <View className="p-3 items-center">
                        <Text className="text-sm text-gray-500">No beneficiaries yet</Text>
                        <TouchableOpacity onPress={() => navigate('/mobile/my-beneficiaries', { state: { userId, userEmail } })} activeOpacity={0.7}>
                          <Text className="text-sm text-[#8c76f0] font-semibold mt-1">Add Payee</Text>
                        </TouchableOpacity>
                      </View>
                    ) : beneficiaries.map((b) => (
                      <TouchableOpacity
                        key={b.id}
                        onPress={() => { setSelectedBeneficiary(b.id); setShowBeneficiaryList(false); }}
                        className={`p-3 border-b border-gray-100 ${selectedBeneficiary === b.id ? 'bg-[#f3f0fe]' : ''}`}
                        activeOpacity={0.7}
                      >
                        <Text className="text-sm font-medium text-gray-900">{b.full_name}</Text>
                        <Text className="text-xs text-gray-500">{b.bank_name} - {(b.account_number || '').slice(-4)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View>
              <Text className="text-xs font-semibold text-gray-700 mb-1.5">Payment Category *</Text>
              <TouchableOpacity
                onPress={() => { setShowCategoryList(!showCategoryList); setShowBeneficiaryList(false); }}
                className="flex-row items-center justify-between w-full px-3 py-2.5 border border-gray-300 rounded-xl bg-white"
                activeOpacity={0.7}
              >
                <Text className={`text-sm ${selectedCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                  {categories.find(c => c.id === selectedCategory)?.name || 'Choose category...'}
                </Text>
                {showCategoryList ? <ChevronUp size={16} color="#6b7280" /> : <ChevronDown size={16} color="#6b7280" />}
              </TouchableOpacity>
              {showCategoryList && (
                <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                  <ScrollView className="max-h-48">
                    {categories.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        onPress={() => { setSelectedCategory(c.id); setShowCategoryList(false); }}
                        className={`p-3 border-b border-gray-100 ${selectedCategory === c.id ? 'bg-[#f3f0fe]' : ''}`}
                        activeOpacity={0.7}
                      >
                        <Text className="text-sm font-medium text-gray-900">{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View>
              <Text className="text-xs font-semibold text-gray-700 mb-1.5">Amount *</Text>
              <View className="flex-row items-center px-3 py-2 border border-gray-300 rounded-xl bg-white">
                <Text className="text-sm text-gray-600 mr-1">{`\u20B9`}</Text>
                <TextInput
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))}
                  className="flex-1 text-sm text-gray-900"
                  placeholder="0.00" keyboardType="decimal-pad"
                />
              </View>
            </View>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold text-center">
                {submitting ? 'Processing...' : 'Pay Now'}
              </Text>
            </TouchableOpacity>

            <View className="flex-row items-start gap-2 bg-blue-50 rounded-xl p-3">
              <Info size={14} color="#2563eb" />
              <Text className="text-xs text-blue-700 flex-1">
                Payment processing will redirect to the gateway. After payment, you can track the status in Transaction History.
              </Text>
            </View>
          </View>
        )}
      </View>
    </MobileLayout>
  );
}
