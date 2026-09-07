import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { CreditCard, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Info, ArrowUpRight, Landmark, FileText } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface Beneficiary {
  id: string;
  full_name: string;
  bank_name: string;
  bank_account: string;
  ifsc: string;
  branch_name: string;
  account_type: string;
  status: string;
}

interface PaymentCategory {
  id: string;
  category_name: string;
  receiver_kyc_required: boolean;
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
  const [paymentLimits, setPaymentLimits] = useState<{ minimum_amount: number; maximum_amount: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    Promise.all([fetchBeneficiaries(), fetchCategories(), fetchPaymentLimits()]).finally(() => setLoading(false));
  }, [userId]);

  const fetchBeneficiaries = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-beneficiaries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setBeneficiaries((data.beneficiaries || []).filter((b: Beneficiary) => b.status === 'Active'));
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

  const fetchPaymentLimits = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-payment-limits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setPaymentLimits({ minimum_amount: data.minimum_amount, maximum_amount: data.maximum_amount });
    } catch {}
  };

  const handleLogout = () => { logout(); navigate('/mobile/login'); };

  const validate = (): string | null => {
    if (!selectedBeneficiary) return 'Please select a beneficiary';
    if (!selectedCategory) return 'Please select a payment category';
    const amt = parseFloat(amount);
    if (!amt || isNaN(amt)) return 'Enter a valid amount';
    if (paymentLimits) {
      if (amt < paymentLimits.minimum_amount) return `Minimum amount is \u20B9${fmtAmt(paymentLimits.minimum_amount)}`;
      if (amt > paymentLimits.maximum_amount) return `Maximum amount is \u20B9${fmtAmt(paymentLimits.maximum_amount)}`;
    } else if (amt < 1) {
      return 'Enter a valid amount (minimum \u20B91)';
    }
    return null;
  };

  const handleConfirm = () => {
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/initiate-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, beneficiaryId: selectedBeneficiary,
          categoryId: selectedCategory, amount: parseFloat(amount),
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
  const selectedCat = categories.find(c => c.id === selectedCategory);

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-4 gap-4">
        <Text className="text-xl font-bold text-gray-900">Make Payment</Text>

        {error ? (
          <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
            <AlertCircle size={18} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#8c76f0" />
            <Text className="text-base text-gray-500 mt-2">Loading...</Text>
          </View>
        ) : (
          <View className="gap-4">
            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-2">Select Beneficiary *</Text>
              <TouchableOpacity
                onPress={() => { setShowBeneficiaryList(!showBeneficiaryList); setShowCategoryList(false); }}
                className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                activeOpacity={0.7}
              >
                <Text className={`text-base ${selectedBen ? 'text-gray-900' : 'text-gray-400'}`}>
                  {selectedBen ? `${selectedBen.full_name} (****${(selectedBen.bank_account || '').slice(-4)})` : 'Choose beneficiary...'}
                </Text>
                {showBeneficiaryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
              </TouchableOpacity>
              {showBeneficiaryList && (
                <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm max-h-72">
                  <ScrollView className="max-h-72">
                    {beneficiaries.length === 0 ? (
                      <View className="p-4 items-center">
                        <Text className="text-base text-gray-500">No active beneficiaries yet</Text>
                        <TouchableOpacity onPress={() => navigate('/mobile/my-beneficiaries', { state: { userId, userEmail } })} activeOpacity={0.7}>
                          <Text className="text-sm text-[#8c76f0] font-semibold mt-1.5">Add Payee</Text>
                        </TouchableOpacity>
                      </View>
                    ) : beneficiaries.map((b) => (
                      <TouchableOpacity
                        key={b.id}
                        onPress={() => { setSelectedBeneficiary(b.id); setShowBeneficiaryList(false); }}
                        className={`p-3.5 border-b border-gray-100 ${selectedBeneficiary === b.id ? 'bg-[#f3f0fe]' : ''}`}
                        activeOpacity={0.7}
                      >
                        <Text className="text-base font-medium text-gray-900">{b.full_name}</Text>
                        <View className="flex-row items-center gap-2 mt-0.5">
                          <Landmark size={12} color="#9ca3af" />
                          <Text className="text-sm text-gray-500">{b.bank_name} - ****{(b.bank_account || '').slice(-4)}</Text>
                        </View>
                        <Text className="text-xs text-gray-400 mt-0.5">{b.ifsc} - {b.branch_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {selectedBen && (
              <View className="bg-blue-50 border border-blue-200 rounded-xl p-3 gap-1.5">
                <View className="flex-row items-center gap-2">
                  <Landmark size={16} color="#2563eb" />
                  <Text className="text-sm font-semibold text-blue-900">Beneficiary Bank Details</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-blue-700">Account</Text>
                  <Text className="text-sm font-medium text-blue-900">{selectedBen.bank_account}</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-blue-700">IFSC</Text>
                  <Text className="text-sm font-medium text-blue-900">{selectedBen.ifsc}</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-blue-700">Bank</Text>
                  <Text className="text-sm font-medium text-blue-900">{selectedBen.bank_name}</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-blue-700">Branch</Text>
                  <Text className="text-sm font-medium text-blue-900">{selectedBen.branch_name}</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-blue-700">Type</Text>
                  <Text className="text-sm font-medium text-blue-900">{selectedBen.account_type}</Text>
                </View>
              </View>
            )}

            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-2">Payment Category *</Text>
              <TouchableOpacity
                onPress={() => { setShowCategoryList(!showCategoryList); setShowBeneficiaryList(false); }}
                className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                activeOpacity={0.7}
              >
                <Text className={`text-base ${selectedCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                  {selectedCat?.category_name || 'Choose category...'}
                </Text>
                {showCategoryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
              </TouchableOpacity>
              {showCategoryList && (
                <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                  <ScrollView className="max-h-56">
                    {categories.length === 0 ? (
                      <View className="p-4 items-center">
                        <Text className="text-base text-gray-500">No categories available</Text>
                      </View>
                    ) : categories.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        onPress={() => { setSelectedCategory(c.id); setShowCategoryList(false); }}
                        className={`p-3.5 border-b border-gray-100 ${selectedCategory === c.id ? 'bg-[#f3f0fe]' : ''}`}
                        activeOpacity={0.7}
                      >
                        <View className="flex-row items-center gap-2">
                          <FileText size={16} color="#8c76f0" />
                          <Text className="text-base font-medium text-gray-900">{c.category_name}</Text>
                        </View>
                        {c.receiver_kyc_required && (
                          <Text className="text-xs text-amber-600 mt-0.5 ml-6">KYC required</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View>
              <Text className="text-sm font-semibold text-gray-700 mb-2">Amount *</Text>
              <View className="flex-row items-center px-4 py-3 border border-gray-300 rounded-xl bg-white">
                <Text className="text-base text-gray-600 mr-1.5">{`\u20B9`}</Text>
                <TextInput
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))}
                  className="flex-1 text-base text-gray-900"
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
              {paymentLimits && (
                <Text className="text-sm text-gray-500 mt-1.5">
                  Min: {`\u20B9${fmtAmt(paymentLimits.minimum_amount)}`} - Max: {`\u20B9${fmtAmt(paymentLimits.maximum_amount)}`}
                </Text>
              )}
            </View>

            <TouchableOpacity
              onPress={handleConfirm}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              style={{ opacity: submitting ? 0.5 : 1 }}
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold text-center text-base">
                {submitting ? 'Processing...' : 'Pay Now'}
              </Text>
            </TouchableOpacity>

            <View className="flex-row items-start gap-2 bg-blue-50 rounded-xl p-3">
              <Info size={16} color="#2563eb" />
              <Text className="text-sm text-blue-700 flex-1">
                Payment processing will redirect to the gateway. After payment, you can track the status in Transaction History.
              </Text>
            </View>
          </View>
        )}
      </View>

      <Modal visible={showConfirm} animationType="fade" transparent>
        <View className="flex-1 bg-black/60 justify-center items-center p-4">
          <View className="bg-white rounded-2xl p-5 w-full max-w-sm gap-4">
            <View className="flex-row items-center gap-2">
              <ArrowUpRight size={22} color="#8c76f0" />
              <Text className="text-lg font-bold text-gray-900">Confirm Payment</Text>
            </View>
            <View className="gap-2">
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-500">Beneficiary</Text>
                <Text className="text-sm font-medium text-gray-900">{selectedBen?.full_name}</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-500">Account</Text>
                <Text className="text-sm font-medium text-gray-900">****{(selectedBen?.bank_account || '').slice(-4)}</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-500">Category</Text>
                <Text className="text-sm font-medium text-gray-900">{selectedCat?.category_name}</Text>
              </View>
              <View className="flex-row justify-between pt-2 border-t border-gray-100">
                <Text className="text-base font-semibold text-gray-900">Amount</Text>
                <Text className="text-base font-bold text-[#8c76f0]">{`\u20B9${fmtAmt(amount)}`}</Text>
              </View>
            </View>
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={() => setShowConfirm(false)} className="flex-1 px-4 py-3 border border-gray-300 rounded-xl" activeOpacity={0.7}>
                <Text className="text-base text-gray-700 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSubmit} className="flex-1 px-4 py-3 bg-[#8c76f0] rounded-xl" activeOpacity={0.7}>
                <Text className="text-base text-white font-semibold text-center">Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
