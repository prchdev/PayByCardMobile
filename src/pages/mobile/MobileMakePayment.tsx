import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal } from 'react-native';
import {
  CreditCard, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Info, ArrowUpRight,
  Landmark, FileText, Wallet, Calculator, CheckCircle, Search,
} from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { impact, selection } from '../../utils/haptics';
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

interface PaymentOption {
  id: string;
  category_name: string;
  description: string;
  normal_charges: number;
  discount_charges: number;
  discount_applicable: boolean;
  gst_percentage: number;
  status: string;
  gateway_id: string | null;
  card_type: string | null;
}

interface ChargeBreakdown {
  amount: number;
  charges: string;
  gst: string;
  discount: string;
  discountApplied: boolean;
  totalAmount: string;
  effectiveChargesPercentage: number;
  category: { id: string; name: string; gstPercentage: number; receiverKycRequired: boolean };
  gateway: { id: string; name: string; registeredName: string; gstNumber: string; payoutMode: string };
}

function fmtAmt(v: string | number) {
  return parseFloat(String(v || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MobileMakePayment() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [categories, setCategories] = useState<PaymentCategory[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showBeneficiaryList, setShowBeneficiaryList] = useState(false);
  const [showCategoryList, setShowCategoryList] = useState(false);
  const [showOptionList, setShowOptionList] = useState(false);
  const [paymentLimits, setPaymentLimits] = useState<{ minimum_amount: number; maximum_amount: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [chargeBreakdown, setChargeBreakdown] = useState<ChargeBreakdown | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ success: boolean; reference: string; totalAmount: string } | null>(null);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    Promise.all([fetchBeneficiaries(), fetchCategories(), fetchPaymentOptions(), fetchPaymentLimits()]).finally(() => setLoading(false));
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

  const fetchPaymentOptions = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-payment-options`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) setPaymentOptions(data.categories || []);
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

  const selectedOpt = paymentOptions.find(o => o.id === selectedOption);

  const calculateCharges = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amt || isNaN(amt) || !selectedOption || !selectedOpt?.gateway_id) {
      setChargeBreakdown(null);
      return;
    }
    setCalculating(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calculate-payment-charges`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, categoryId: selectedOption, gatewayId: selectedOpt.gateway_id }),
      });
      const data = await res.json();
      if (res.ok) setChargeBreakdown(data);
      else setChargeBreakdown(null);
    } catch { setChargeBreakdown(null); }
    finally { setCalculating(false); }
  }, [amount, selectedOption, selectedOpt]);

  useEffect(() => {
    const timeout = setTimeout(() => { if (amount && selectedOption && selectedOpt?.gateway_id) calculateCharges(); }, 500);
    return () => clearTimeout(timeout);
  }, [amount, selectedOption, selectedOpt, calculateCharges]);

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const selectedBen = beneficiaries.find(b => b.id === selectedBeneficiary);
  const selectedCat = categories.find(c => c.id === selectedCategory);

  const validate = (): string | null => {
    if (!selectedBeneficiary) return 'Please select a beneficiary';
    if (!selectedCategory) return 'Please select a payment category';
    if (!selectedOption) return 'Please select a payment option';
    if (!selectedOpt?.gateway_id) return 'This payment option does not have a gateway configured';
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
    setError('');
    try {
      const amt = parseFloat(amount);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/initiate-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          beneficiaryId: selectedBeneficiary,
          businessCategoryId: selectedCategory,
          paymentOptionId: selectedOption,
          gatewayId: selectedOpt?.gateway_id,
          cardType: selectedOpt?.card_type,
          amount: amt,
          charges: chargeBreakdown ? parseFloat(chargeBreakdown.charges) : 0,
          gst: chargeBreakdown ? parseFloat(chargeBreakdown.gst) : 0,
          discount: chargeBreakdown ? parseFloat(chargeBreakdown.discount) : 0,
          totalAmount: chargeBreakdown ? parseFloat(chargeBreakdown.totalAmount) : amt,
          beneficiaryDetails: selectedBen ? {
            full_name: selectedBen.full_name,
            bank_name: selectedBen.bank_name,
            bank_account: selectedBen.bank_account,
            ifsc: selectedBen.ifsc,
            branch_name: selectedBen.branch_name,
            account_type: selectedBen.account_type,
          } : {},
          categoryDetails: selectedCat ? {
            category_name: selectedCat.category_name,
            receiver_kyc_required: selectedCat.receiver_kyc_required,
          } : {},
          paymentOptionDetails: selectedOpt ? {
            category_name: selectedOpt.category_name,
            normal_charges: selectedOpt.normal_charges,
            gst_percentage: selectedOpt.gst_percentage,
          } : {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate payment');
      setPaymentResult({
        success: true,
        reference: data.payment?.reference || '',
        totalAmount: data.payment?.totalAmount ? String(data.payment.totalAmount) : (chargeBreakdown?.totalAmount || amount),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate payment');
    } finally { setSubmitting(false); }
  };

  const resetForm = () => {
    setPaymentResult(null);
    setSelectedBeneficiary('');
    setSelectedCategory('');
    setSelectedOption('');
    setAmount('');
    setChargeBreakdown(null);
    setError('');
  };

  if (paymentResult) {
    return (
      <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
        <View className="px-4 py-6 items-center">
          <View className="w-20 h-20 rounded-full bg-green-50 items-center justify-center mb-4">
            <CheckCircle size={48} color="#16a34a" />
          </View>
          <Text className="text-xl font-bold text-gray-900">Payment Initiated!</Text>
          <Text className="text-base text-gray-500 mt-1.5 text-center">
            Your payment of {`\u20B9${fmtAmt(paymentResult.totalAmount)}`} has been initiated successfully.
          </Text>
          <View className="bg-white rounded-xl border border-gray-200 p-4 w-full mt-4 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-sm text-gray-500">Reference</Text>
              <Text className="text-sm font-semibold text-gray-900">{paymentResult.reference}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sm text-gray-500">Amount</Text>
              <Text className="text-sm font-semibold text-gray-900">{`\u20B9${fmtAmt(paymentResult.totalAmount)}`}</Text>
            </View>
          </View>
          <View className="flex-row gap-3 mt-5 w-full">
            <TouchableOpacity onPress={resetForm} className="flex-1 px-4 py-3 border border-gray-300 rounded-xl" activeOpacity={0.7}>
              <Text className="text-base text-gray-700 font-medium text-center">New Payment</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigate('/mobile/my-transactions', { state: { userId, userEmail } })} className="flex-1 px-4 py-3 bg-[#8c76f0] rounded-xl" activeOpacity={0.7}>
              <Text className="text-base text-white font-semibold text-center">View Transactions</Text>
            </TouchableOpacity>
          </View>
        </View>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
              <Text className="text-base text-gray-500 mt-2">Loading payment details...</Text>
            </View>
          ) : (
            <View className="gap-4">
              {/* Step 1: Beneficiary */}
              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-2">1. Select Beneficiary *</Text>
                <TouchableOpacity
                  onPress={() => { setShowBeneficiaryList(!showBeneficiaryList); setShowCategoryList(false); setShowOptionList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7}
                >
                  <Text className={`text-base ${selectedBen ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedBen ? `${selectedBen.full_name} (****${(selectedBen.bank_account || '').slice(-4)})` : 'Choose beneficiary...'}
                  </Text>
                  {showBeneficiaryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                {showBeneficiaryList && (
                  <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
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
                          onPress={() => { selection(); setSelectedBeneficiary(b.id); setShowBeneficiaryList(false); }}
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

              {/* Beneficiary details */}
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

              {/* Step 2: Payment Category */}
              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-2">2. Payment Category *</Text>
                <TouchableOpacity
                  onPress={() => { setShowCategoryList(!showCategoryList); setShowBeneficiaryList(false); setShowOptionList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7}
                >
                  <Text className={`text-base ${selectedCat ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedCat?.category_name || 'Choose category...'}
                  </Text>
                  {showCategoryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                {showCategoryList && (
                  <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {categories.length === 0 ? (
                        <View className="p-4 items-center">
                          <Text className="text-base text-gray-500">No categories available</Text>
                        </View>
                      ) : categories.map((c) => (
                        <TouchableOpacity
                          key={c.id}
                          onPress={() => { selection(); setSelectedCategory(c.id); setShowCategoryList(false); }}
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

              {/* Step 3: Payment Option */}
              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-2">3. Payment Option *</Text>
                <TouchableOpacity
                  onPress={() => { setShowOptionList(!showOptionList); setShowBeneficiaryList(false); setShowCategoryList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7}
                >
                  <Text className={`text-base ${selectedOpt ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedOpt?.category_name || 'Choose payment option...'}
                  </Text>
                  {showOptionList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                {showOptionList && (
                  <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {paymentOptions.length === 0 ? (
                        <View className="p-4 items-center">
                          <Text className="text-base text-gray-500">No payment options available</Text>
                        </View>
                      ) : paymentOptions.map((o) => (
                        <TouchableOpacity
                          key={o.id}
                          onPress={() => { selection(); setSelectedOption(o.id); setShowOptionList(false); }}
                          className={`p-3.5 border-b border-gray-100 ${selectedOption === o.id ? 'bg-[#f3f0fe]' : ''}`}
                          activeOpacity={0.7}
                        >
                          <View className="flex-row items-center gap-2">
                            <Wallet size={16} color="#8c76f0" />
                            <Text className="text-base font-medium text-gray-900">{o.category_name}</Text>
                          </View>
                          <Text className="text-xs text-gray-500 mt-0.5 ml-6">
                            Charges: {o.normal_charges}%{o.discount_applicable ? ` (Discount: ${o.discount_charges}%)` : ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Step 4: Amount */}
              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-2">4. Amount *</Text>
                <View className="flex-row items-center w-full px-4 py-3 border border-gray-300 rounded-xl bg-white">
                  <Text className="text-base text-gray-500 mr-2">{`\u20B9`}</Text>
                  <TextInput
                    value={amount}
                    onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))}
                    className="flex-1 text-base text-gray-900"
                    placeholder="0.00"
                    placeholderTextColor="#9ca3af"
                    keyboardType="decimal-pad"
                  />
                </View>
                {paymentLimits && (
                  <Text className="text-sm text-gray-500 mt-1.5">
                    Min: {`\u20B9${fmtAmt(paymentLimits.minimum_amount)}`} - Max: {`\u20B9${fmtAmt(paymentLimits.maximum_amount)}`}
                  </Text>
                )}
              </View>

              {/* Charge breakdown */}
              {calculating ? (
                <View className="bg-gray-50 rounded-xl p-3 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#8c76f0" />
                  <Text className="text-sm text-gray-500">Calculating charges...</Text>
                </View>
              ) : chargeBreakdown ? (
                <View className="bg-[#f3f0fe] border border-[#8c76f0]/20 rounded-xl p-4 gap-2">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Calculator size={18} color="#8c76f0" />
                    <Text className="text-base font-semibold text-gray-900">Charge Breakdown</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-600">Amount</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.amount)}`}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-600">Charges ({chargeBreakdown.effectiveChargesPercentage}%)</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.charges)}`}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-600">GST</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.gst)}`}</Text>
                  </View>
                  {chargeBreakdown.discountApplied && parseFloat(chargeBreakdown.discount) > 0 && (
                    <View className="flex-row justify-between">
                      <Text className="text-sm text-green-600">Discount</Text>
                      <Text className="text-sm font-medium text-green-600">- {`\u20B9${fmtAmt(chargeBreakdown.discount)}`}</Text>
                    </View>
                  )}
                  <View className="flex-row justify-between pt-2 border-t border-gray-200">
                    <Text className="text-base font-bold text-gray-900">Total Payable</Text>
                    <Text className="text-base font-bold text-[#8c76f0]">{`\u20B9${fmtAmt(chargeBreakdown.totalAmount)}`}</Text>
                  </View>
                </View>
              ) : null}

              {/* Submit */}
              <TouchableOpacity
                onPress={handleConfirm}
                disabled={submitting || calculating}
                className="w-full bg-[#8c76f0] rounded-xl py-3.5"
                style={{ opacity: submitting || calculating ? 0.5 : 1 }}
                activeOpacity={0.7}
              >
                <Text className="text-white font-semibold text-center text-base">
                  {submitting ? 'Processing...' : 'Pay Now'}
                </Text>
              </TouchableOpacity>

              <View className="flex-row items-start gap-2 bg-blue-50 rounded-xl p-3">
                <Info size={16} color="#2563eb" />
                <Text className="text-sm text-blue-700 flex-1">
                  Charges are calculated server-side. After payment, track status in Transaction History.
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Confirm Modal */}
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
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-500">Option</Text>
                <Text className="text-sm font-medium text-gray-900">{selectedOpt?.category_name}</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-gray-500">Amount</Text>
                <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(amount)}`}</Text>
              </View>
              {chargeBreakdown && (
                <>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">Charges + GST</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(parseFloat(chargeBreakdown.charges) + parseFloat(chargeBreakdown.gst))}`}</Text>
                  </View>
                  <View className="flex-row justify-between pt-2 border-t border-gray-100">
                    <Text className="text-base font-semibold text-gray-900">Total Payable</Text>
                    <Text className="text-base font-bold text-[#8c76f0]">{`\u20B9${fmtAmt(chargeBreakdown.totalAmount)}`}</Text>
                  </View>
                </>
              )}
            </View>
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={() => setShowConfirm(false)} className="flex-1 px-4 py-3 border border-gray-300 rounded-xl" activeOpacity={0.7}>
                <Text className="text-base text-gray-700 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSubmit} className="flex-1 px-4 py-3 bg-[#8c76f0] rounded-xl" activeOpacity={0.7}>
                <Text className="text-base text-white font-semibold text-center">Confirm & Pay</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
