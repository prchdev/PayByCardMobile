import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CreditCard, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Info, ArrowUpRight,
  Landmark, FileText, Wallet, Calculator, CheckCircle, Search, Clock, Circle as XCircle,
  X, Upload,
} from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { impact, selection } from '../../utils/haptics';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { getErrorMessage } from '../../utils/errorMessage';
import { getDeviceId } from '../../utils/deviceId';

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
  pan_number?: string;
  status: string;
  is_verified_merchant?: boolean;
}

interface PaymentCategory {
  id: string;
  category_name: string;
  is_enabled: boolean;
  display_order: number;
  receiver_kyc_required: boolean;
  new_card_payment_delay_hours?: number;
  refund_after_hours?: number;
  settlement_time?: string;
}

interface PaymentOption {
  id: string;
  gateway_id: string;
  category_id: string;
  category_name: string;
  card_type: string;
  charges_percentage: number;
  discounted_charges_percentage: number;
  show_discount: boolean;
  gst_percentage: number;
  gateway_name: string;
  gateway_registered_name: string;
  gateway_gst_number: string;
  gateway_gst_percentage: number;
  payout_mode: string;
  settlement_time: string;
  is_instant_settlement: boolean;
  terms_and_conditions: string;
  business_surcharge_percentage: number;
  receiver_kyc_required: boolean;
}

interface ChargeBreakdown {
  amount: number;
  charges: string;
  gst: string;
  discount: string;
  discountApplied: boolean;
  totalAmount: string;
  effectiveChargesPercentage: number;
  baseChargesPercentage: number;
  surchargePercentage: number;
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
  const [kycStatus, setKycStatus] = useState<{ isVerified: boolean; status: string; isRestricted?: boolean; businessCategorySurgeCharge?: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showBeneficiaryList, setShowBeneficiaryList] = useState(false);
  const [showCategoryList, setShowCategoryList] = useState(false);
  const [showOptionList, setShowOptionList] = useState(false);
  const [paymentLimits, setPaymentLimits] = useState<{ minimum_amount: number; maximum_amount: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [chargeBreakdown, setChargeBreakdown] = useState<ChargeBreakdown | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ success: boolean; reference: string; totalAmount: string; message: string } | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [billFile, setBillFile] = useState<{ uri: string; name: string; size: number; mimeType: string } | null>(null);
  const [billFileUrl, setBillFileUrl] = useState<string>('');
  const [uploadingBill, setUploadingBill] = useState(false);
  const webViewRef = useRef<any>(null);

  const pickBillFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      if (file.size && file.size > 1024 * 1024) {
        Alert.alert('File Too Large', 'File size must be less than 1 MB');
        return;
      }
      setBillFile({ uri: file.uri, name: file.name, size: file.size || 0, mimeType: file.mimeType || '' });
      setBillFileUrl('');
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err, 'Failed to pick file'));
    }
  };

  const uploadBillFile = async (): Promise<string | null> => {
    if (!billFile || !userId) return null;
    if (billFileUrl) return billFileUrl;
    setUploadingBill(true);
    try {
      const mimeType = billFile.mimeType || (billFile.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const uploadResult = await new Promise<string | null>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${SUPABASE_URL}/functions/v1/upload-bill-file`);
        xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && data.url) {
              resolve(data.url);
            } else {
              reject(new Error(data.error || 'Upload failed'));
            }
          } catch {
            reject(new Error('Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        const formData = new FormData();
        formData.append('file', { uri: billFile.uri, name: billFile.name, type: mimeType } as any);
        formData.append('userId', userId);
        xhr.send(formData);
      });
      if (uploadResult) setBillFileUrl(uploadResult);
      return uploadResult;
    } catch (err) {
      Alert.alert('Upload Failed', getErrorMessage(err, 'Failed to upload bill file'));
      return null;
    } finally { setUploadingBill(false); }
  };

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    Promise.all([fetchBeneficiaries(), fetchCategories(), fetchPaymentOptions(), fetchPaymentLimits(), fetchKycStatus()]).finally(() => setLoading(false));
  }, [userId]);

  const fetchKycStatus = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setKycStatus({ isVerified: data.isVerified === true || data.status === 'verified', status: data.status, isRestricted: data.isRestricted, businessCategorySurgeCharge: data.businessCategorySurgeCharge || 0 });
    } catch {}
  };

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
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-gateway-charges`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) setPaymentOptions(data.paymentOptions || []);
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
  const selectedBen = beneficiaries.find(b => b.id === selectedBeneficiary);
  const isBusiness = selectedBen?.account_type === 'Current';

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
        body: JSON.stringify({ amount: amt, categoryId: selectedOption, gatewayId: selectedOpt.gateway_id, isBusiness, userId }),
      });
      const data = await res.json();
      if (res.ok) setChargeBreakdown(data);
      else setChargeBreakdown(null);
    } catch { setChargeBreakdown(null); }
    finally { setCalculating(false); }
  }, [amount, selectedOption, selectedOpt, isBusiness, userId]);

  useEffect(() => {
    const timeout = setTimeout(() => { if (amount && selectedOption && selectedOpt?.gateway_id) calculateCharges(); }, 500);
    return () => clearTimeout(timeout);
  }, [amount, selectedOption, selectedOpt, calculateCharges, userId]);

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const selectedCat = categories.find(c => c.id === selectedCategory);

  const isBillRequired = !!(selectedCat?.category_name?.toLowerCase().includes('business') ||
    selectedCat?.category_name?.toLowerCase().includes('vendor') ||
    selectedCat?.category_name?.toLowerCase().includes('professional'));

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
    if (isBillRequired && !billFile) return 'Please upload a bill/invoice for this payment category';
    return null;
  };

  const handleConfirm = async () => {
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    if (!chargeBreakdown) {
      await calculateCharges();
    }
    setShowConfirm(true);
  };

  // ── Payment Gateway Checkout ─────────────────────────────────────────────────
  // For ALL gateways, create a self-contained HTML page as a blob URL that loads
  // the gateway SDK and opens checkout. Open this blob URL in expo-web-browser.
  // This avoids script injection issues and works on both web and native.
  const openGatewayCheckout = async (gatewayConfig: any, paymentInfo: any) => {
    const gatewayName = (gatewayConfig.gateway || '').toLowerCase();
    setGatewayLoading(false);

    try {
      const checkoutUrl = buildCheckoutUrl(gatewayConfig, paymentInfo);
      if (checkoutUrl) {
        await WebBrowser.warmUpAsync();
        await WebBrowser.openBrowserAsync(checkoutUrl, {
          toolbarColor: '#8c76f0',
          controlsColor: '#8c76f0',
        });
        WebBrowser.coolDownAsync();
        // After browser closes, check payment status
        await checkPaymentStatus(paymentInfo);
      } else {
        setPaymentResult({
          success: false,
          reference: paymentInfo.reference || '',
          totalAmount: String(paymentInfo.totalAmount || chargeBreakdown?.totalAmount || amount),
          message: 'Unable to open payment gateway. Please try again or contact support.',
        });
      }
    } catch (err) {
      setPaymentResult({
        success: false,
        reference: paymentInfo?.reference || '',
        totalAmount: String(paymentInfo?.totalAmount || chargeBreakdown?.totalAmount || amount),
        message: getErrorMessage(err, 'Failed to open payment gateway'),
      });
    }
  };

  // Build a checkout URL for the gateway. For Razorpay, create a blob URL with
  // an HTML page that loads the SDK and opens checkout automatically.
  // For other gateways that provide a checkoutUrl or sdkUrl, use that directly.
  const buildCheckoutUrl = (gatewayConfig: any, paymentInfo: any): string | null => {
    const gatewayName = (gatewayConfig.gateway || '').toLowerCase();
    const options = gatewayConfig.options || {};

    // If the gateway provides a direct checkout URL, use it
    if (options.checkoutUrl) return options.checkoutUrl;

    if (gatewayName === 'razorpay') {
      // Create a self-contained HTML page that loads Razorpay SDK and opens checkout
      const sdkUrl = gatewayConfig.sdkUrl || 'https://checkout.razorpay.com/v1/checkout.js';
      const razorpayKey = options.key || gatewayConfig.keyId;
      const orderId = options.order_id;
      const amount = options.amount;
      const currency = options.currency || 'INR';
      const name = options.name || 'PayByCard';
      const description = options.description || `Payment: ${paymentInfo.reference || ''}`;
      const prefill = options.prefill || {};
      const theme = options.theme || { color: '#2563eb' };

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Payment</title>
  <style>
    body { margin:0; padding:0; background:#f9fafb; font-family:-apple-system,system-ui,sans-serif; }
    .loading { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; }
    .spinner { width:40px; height:40px; border:4px solid #e5e7eb; border-top-color:#8c76f0; border-radius:50%; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .text { color:#6b7280; font-size:14px; }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <div class="text">Opening payment gateway...</div>
  </div>
  <script src="${sdkUrl}"></script>
  <script>
    (function() {
      function openCheckout() {
        var options = {
          key: ${JSON.stringify(razorpayKey)},
          amount: ${JSON.stringify(amount)},
          currency: ${JSON.stringify(currency)},
          name: ${JSON.stringify(name)},
          description: ${JSON.stringify(description)},
          order_id: ${JSON.stringify(orderId)},
          prefill: ${JSON.stringify(prefill)},
          theme: ${JSON.stringify(theme)},
          handler: function(response) {
            document.title = 'PAYMENT_SUCCESS';
            document.body.innerHTML = '<div class="loading"><div class="text">Payment successful! You can close this window.</div></div>';
          },
          modal: {
            ondismiss: function() {
              document.title = 'PAYMENT_DISMISSED';
              document.body.innerHTML = '<div class="loading"><div class="text">Payment cancelled. You can close this window.</div></div>';
            }
          }
        };
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function(response) {
          document.title = 'PAYMENT_FAILED';
          document.body.innerHTML = '<div class="loading"><div class="text">Payment failed. You can close this window.</div></div>';
        });
        rzp.open();
      }
      if (typeof Razorpay !== 'undefined') {
        openCheckout();
      } else {
        // Wait for SDK to load
        var checkInterval = setInterval(function() {
          if (typeof Razorpay !== 'undefined') {
            clearInterval(checkInterval);
            openCheckout();
          }
        }, 100);
        setTimeout(function() { clearInterval(checkInterval); }, 10000);
      }
    })();
  </script>
</body>
</html>`;
      return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    }

    // For other gateways with an SDK URL, use it directly
    return gatewayConfig.sdkUrl || null;
  };

  const checkPaymentStatus = async (paymentInfo: any) => {
    // Poll a few times in case the gateway webhook hasn't fired yet
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/check-payment-status`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId: paymentInfo.id, userId }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Status check failed');

        const paymentStatus = data.payment?.status || 'pending';

        if (paymentStatus === 'completed') {
          handlePaymentSuccess(data.payment, paymentInfo);
          return;
        }
        if (paymentStatus === 'failed') {
          setPaymentResult({
            success: false,
            reference: paymentInfo.reference || '',
            totalAmount: String(paymentInfo.totalAmount || chargeBreakdown?.totalAmount || amount),
            message: data.payment?.failure_reason || 'Payment failed. Please try again.',
          });
          return;
        }
        // Still pending/processing - wait and retry
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      } catch {
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }
    }

    // After 3 attempts, show as pending (not success)
    setPaymentResult({
      success: false,
      reference: paymentInfo.reference || '',
      totalAmount: String(paymentInfo.totalAmount || chargeBreakdown?.totalAmount || amount),
      message: 'Payment is still being processed. Please check your transaction history for the final status.',
    });
  };

  const handlePaymentSuccess = async (response: any, payment: any) => {
    const payId = payment?.id || '';
    const payRef = payment?.reference || payment?.payment_reference || '';
    const payAmt = String(payment?.totalAmount || payment?.total_amount || chargeBreakdown?.totalAmount || amount);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/save-transaction-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          paymentId: payId,
          transactionReference: payRef,
          status: 'success',
          amount: payAmt,
          gatewayResponse: response || {},
          paymentMethod: 'card',
          cardType: selectedOpt?.category_name || selectedOpt?.card_type || null,
          gatewayName: selectedOpt?.gateway_name || null,
        }),
      });
    } catch {}

    setPaymentResult({
      success: true,
      reference: payRef,
      totalAmount: payAmt,
      message: 'Your payment has been processed successfully!',
    });
  };

  const handlePaymentDismiss = (payment: any) => {
    setPaymentResult({
      success: false,
      reference: payment?.reference || '',
      totalAmount: String(payment?.totalAmount || chargeBreakdown?.totalAmount || amount),
      message: 'Payment was cancelled. You can retry the payment from your transaction history.',
    });
  };

  const handleSubmit = async () => {
    setShowConfirm(false);
    setSubmitting(true);
    setGatewayLoading(true);
    setError('');
    try {
      const amt = parseFloat(amount);
      let uploadedBillUrl: string | null = billFileUrl;
      if (billFile && !uploadedBillUrl) {
        uploadedBillUrl = await uploadBillFile();
        if (!uploadedBillUrl) {
          setSubmitting(false);
          setGatewayLoading(false);
          return;
        }
      }
      const deviceId = await getDeviceId();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/initiate-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          beneficiaryId: selectedBeneficiary,
          businessCategoryId: selectedCategory,
          paymentOptionId: selectedOption,
          gatewayId: selectedOpt?.gateway_id,
          cardType: selectedOpt?.card_type || selectedOpt?.category_name,
          amount: amt,
          charges: chargeBreakdown ? parseFloat(chargeBreakdown.charges) : 0,
          gst: chargeBreakdown ? parseFloat(chargeBreakdown.gst) : 0,
          discount: chargeBreakdown ? parseFloat(chargeBreakdown.discount) : 0,
          totalAmount: chargeBreakdown ? parseFloat(chargeBreakdown.totalAmount) : amt,
          isBusiness,
          deviceId,
          billFileUrl: uploadedBillUrl || null,
          beneficiaryDetails: selectedBen ? {
            full_name: selectedBen.full_name,
            email: selectedBen.email,
            mobile: selectedBen.mobile,
            pan_number: selectedBen.pan_number,
            bank_name: selectedBen.bank_name,
            bank_account: selectedBen.bank_account,
            ifsc: selectedBen.ifsc,
            branch_name: selectedBen.branch_name,
            account_type: selectedBen.account_type,
            is_verified_merchant: selectedBen.is_verified_merchant || false,
          } : {},
          categoryDetails: selectedCat ? {
            category_name: selectedCat.category_name,
            is_enabled: selectedCat.is_enabled,
            display_order: selectedCat.display_order,
            receiver_kyc_required: selectedCat.receiver_kyc_required,
            refund_after_hours: selectedCat.refund_after_hours || 0,
            settlement_time: selectedOpt?.settlement_time || selectedCat.settlement_time || '',
          } : {},
          paymentOptionDetails: selectedOpt ? {
            gateway_name: selectedOpt.gateway_name,
            card_type: selectedOpt.card_type,
            category_name: selectedOpt.category_name,
            charges_percentage: selectedOpt.charges_percentage,
            discounted_charges_percentage: selectedOpt.discounted_charges_percentage,
            show_discount: selectedOpt.show_discount,
            gst_percentage: selectedOpt.gst_percentage,
            business_surcharge_percentage: selectedOpt.business_surcharge_percentage || 0,
            settlement_time: selectedOpt.settlement_time || '',
            is_instant_settlement: selectedOpt.is_instant_settlement,
            terms_and_conditions: selectedOpt.terms_and_conditions,
            receiver_kyc_required: selectedOpt.receiver_kyc_required || false,
          } : {},
          payoutMode: selectedOpt?.payout_mode || 'payment_split',
          receiverKycRequired: selectedCat?.receiver_kyc_required || false,
          refundAfterHours: selectedCat?.refund_after_hours || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate payment');

      // If gateway config is returned, open the gateway checkout before showing result
      if (data.gatewayConfig) {
        await openGatewayCheckout(data.gatewayConfig, data.payment);
      } else {
        // No gateway config - payment is pending/offline
        setPaymentResult({
          success: false,
          reference: data.payment?.reference || data.payment?.payment_reference || '',
          totalAmount: data.payment?.totalAmount ? String(data.payment.totalAmount) : (chargeBreakdown?.totalAmount || amount),
          message: 'Payment initiated but no gateway configured. Please contact support.',
        });
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to initiate payment'));
      setGatewayLoading(false);
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
    setBillFile(null);
    setBillFileUrl('');
  };

  if (paymentResult) {
    const isSuccess = paymentResult.success;
    const isPending = !isSuccess && paymentResult.message.includes('being processed');
    const isKycPending = isSuccess &&
      selectedCat?.receiver_kyc_required === true &&
      selectedBen?.is_verified_merchant !== true;
    return (
      <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
        <View className="px-4 py-6 items-center">
          <View className={`w-20 h-20 rounded-full items-center justify-center mb-4 ${isSuccess ? 'bg-green-50' : isPending ? 'bg-amber-50' : 'bg-red-50'}`}>
            {isSuccess ? <CheckCircle size={48} color="#16a34a" /> : isPending ? <Clock size={48} color="#d97706" /> : <XCircle size={48} color="#dc2626" />}
          </View>
          <Text className="text-xl font-bold text-gray-900">
            {isKycPending ? 'Payment Received - KYC Pending' : isSuccess ? 'Payment Successful!' : isPending ? 'Payment Pending' : 'Payment Failed'}
          </Text>
          <Text className="text-base text-gray-500 mt-1.5 text-center">
            {isKycPending
              ? 'Your payment was received successfully. Payout to the beneficiary will be processed after Merchant KYC / Onboarding is completed by the receiver.'
              : paymentResult.message}
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
          {isKycPending && (
            <View className="bg-amber-50 border border-amber-300 rounded-xl p-4 w-full mt-3 gap-1">
              <Text className="text-sm font-semibold text-amber-800">Awaiting Receiver KYC / Merchant Onboarding</Text>
              <Text className="text-xs text-amber-700 mt-1">
                The receiver has been notified via email and SMS to complete their Merchant KYC verification. Once verified, the payout will be processed automatically.
                {selectedCat?.refund_after_hours ? ` If KYC is not completed within ${selectedCat.refund_after_hours} hours, the payment will be refunded.` : ''}
              </Text>
            </View>
          )}
          <View className="flex-row gap-3 mt-5 w-full">
            <TouchableOpacity onPress={resetForm} className="flex-1 px-4 py-3 border border-gray-300 rounded-xl" activeOpacity={0.7} delayPressIn={0}>
              <Text className="text-base text-gray-700 font-medium text-center">New Payment</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigate('/mobile/my-transactions', { state: { userId, userEmail } })} className="flex-1 px-4 py-3 bg-[#8c76f0] rounded-xl" activeOpacity={0.7} delayPressIn={0}>
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

          {gatewayLoading ? (
            <View className="items-center py-12 gap-3">
              <ActivityIndicator size="large" color="#8c76f0" />
              <Text className="text-base text-gray-600 font-medium">Loading payment gateway...</Text>
              <Text className="text-sm text-gray-400">Please wait while we connect to the payment gateway.</Text>
            </View>
          ) : loading ? (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#8c76f0" />
              <Text className="text-base text-gray-500 mt-2">Loading payment details...</Text>
            </View>
          ) : kycStatus && !kycStatus.isVerified ? (
            <View className="items-center justify-center py-8">
              <View className="bg-white rounded-2xl border-2 border-yellow-300 p-6 items-center w-full max-w-sm">
                <View className="w-16 h-16 bg-yellow-100 rounded-full items-center justify-center mb-4">
                  <AlertCircle size={32} color="#ca8a04" />
                </View>
                <Text className="text-xl font-bold text-gray-900 mb-3 text-center">KYC Verification Required</Text>
                <Text className="text-sm text-gray-700 mb-6 text-center">
                  {kycStatus.status === 'not_submitted' && 'Please complete your KYC verification to make payments. You need to submit your PAN and Address details.'}
                  {kycStatus.status === 'incomplete' && 'Your KYC submission is incomplete. Please complete all required sections to proceed.'}
                  {kycStatus.status === 'pending' && 'Your KYC documents are under review. Please wait for admin approval before making payments.'}
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
          ) : (
            <View className="gap-4 pb-24">
              {/* Step 1: Beneficiary */}
              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-2">1. Select Beneficiary *</Text>
                <TouchableOpacity
                  onPress={() => { setShowBeneficiaryList(!showBeneficiaryList); setShowCategoryList(false); setShowOptionList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className={`text-base ${selectedBen ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedBen ? `${selectedBen.full_name} (****${(selectedBen.bank_account || '').slice(-4)})` : 'Choose beneficiary...'}
                  </Text>
                  {showBeneficiaryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                <Modal visible={showBeneficiaryList} animationType="fade" transparent style={{ zIndex: 100 }}>
                  <View className="flex-1 bg-black/50 justify-center items-center p-4" style={{ zIndex: 100 }}>
                    <View className="bg-white rounded-2xl w-full max-h-[75%]">
                      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
                        <Text className="text-base font-semibold text-gray-900">Select Beneficiary</Text>
                        <TouchableOpacity onPress={() => setShowBeneficiaryList(false)} activeOpacity={0.7} delayPressIn={0}>
                          <X size={20} color="#6b7280" />
                        </TouchableOpacity>
                      </View>
                      <ScrollView nestedScrollEnabled>
                        {beneficiaries.length === 0 ? (
                          <View className="p-4 items-center">
                            <Text className="text-base text-gray-500">No active beneficiaries yet</Text>
                            <TouchableOpacity onPress={() => { setShowBeneficiaryList(false); navigate('/mobile/my-beneficiaries', { state: { userId, userEmail } }); }} activeOpacity={0.7} delayPressIn={0}>
                              <Text className="text-sm text-[#8c76f0] font-semibold mt-1.5">Add Payee</Text>
                            </TouchableOpacity>
                          </View>
                        ) : beneficiaries.map((b) => (
                          <TouchableOpacity
                            key={b.id}
                            onPress={() => { selection(); setSelectedBeneficiary(b.id); setShowBeneficiaryList(false); }}
                            className={`p-3.5 border-b border-gray-100 ${selectedBeneficiary === b.id ? 'bg-[#f3f0fe]' : ''}`}
                            activeOpacity={0.7} delayPressIn={0}
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
                  </View>
                </Modal>
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
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className={`text-base ${selectedCat ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedCat?.category_name || 'Choose category...'}
                  </Text>
                  {showCategoryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                <Modal visible={showCategoryList} animationType="fade" transparent style={{ zIndex: 100 }}>
                  <View className="flex-1 bg-black/50 justify-center items-center p-4" style={{ zIndex: 100 }}>
                    <View className="bg-white rounded-2xl w-full max-h-[75%]">
                      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
                        <Text className="text-base font-semibold text-gray-900">Select Category</Text>
                        <TouchableOpacity onPress={() => setShowCategoryList(false)} activeOpacity={0.7} delayPressIn={0}>
                          <X size={20} color="#6b7280" />
                        </TouchableOpacity>
                      </View>
                      <ScrollView nestedScrollEnabled>
                        {categories.length === 0 ? (
                          <View className="p-4 items-center">
                            <Text className="text-base text-gray-500">No categories available</Text>
                          </View>
                        ) : categories.map((c) => (
                          <TouchableOpacity
                            key={c.id}
                            onPress={() => { selection(); setSelectedCategory(c.id); setShowCategoryList(false); }}
                            className={`p-3.5 border-b border-gray-100 ${selectedCategory === c.id ? 'bg-[#f3f0fe]' : ''}`}
                            activeOpacity={0.7} delayPressIn={0}
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
                  </View>
                </Modal>
              </View>

              {/* KYC / settlement info for selected category (single consolidated message) */}
              {selectedCat && (selectedCat.receiver_kyc_required || (selectedCat.new_card_payment_delay_hours || 0) > 0) && (
                <View className="bg-amber-50 border border-amber-300 rounded-xl p-3 gap-2">
                  <View className="flex-row items-start gap-2">
                    <AlertCircle size={16} color="#d97706" />
                    <View className="flex-1 gap-1.5">
                      {selectedCat.receiver_kyc_required && (
                        <Text className="text-xs text-amber-800 leading-relaxed">
                          A verification link will be sent to the receiver after payment. Settlement will be completed once the receiver verifies their identity.
                        </Text>
                      )}
                      {(selectedCat.new_card_payment_delay_hours || 0) > 0 && (
                        <Text className="text-xs text-amber-800 leading-relaxed">
                          As per RBI guidelines, payments made using a new credit card will be settled after {selectedCat.new_card_payment_delay_hours} hours.
                        </Text>
                      )}
                      {selectedCat.receiver_kyc_required && (selectedCat.refund_after_hours || 0) > 0 && (
                        <Text className="text-xs text-amber-800 leading-relaxed">
                          If KYC is not completed within {selectedCat.refund_after_hours} hours, the payment will be refunded after deducting convenience charges.
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              )}

              {/* Upload Bill */}
              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-2">
                  Upload Bill {isBillRequired ? '*' : '(Optional)'}
                </Text>
                <Text className="text-xs text-gray-500 mb-2">PNG, JPEG, or PDF. Max size: 1 MB</Text>
                {!billFile ? (
                  <TouchableOpacity
                    onPress={pickBillFile}
                    className="border-2 border-dashed border-gray-300 rounded-xl p-6 items-center"
                    activeOpacity={0.7} delayPressIn={0}
                  >
                    <Upload size={28} color="#9ca3af" />
                    <Text className="text-sm text-gray-500 mt-2">Tap to upload bill/invoice</Text>
                  </TouchableOpacity>
                ) : (
                  <View className="border-2 border-gray-300 rounded-xl p-4 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-3 flex-1">
                      <FileText size={24} color="#8c76f0" />
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>{billFile.name}</Text>
                        <Text className="text-xs text-gray-500">{(billFile.size / 1024).toFixed(2)} KB</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => { setBillFile(null); setBillFileUrl(''); }} activeOpacity={0.7} delayPressIn={0}>
                      <X size={20} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                )}
                {isBillRequired && !billFile && (
                  <Text className="text-xs text-amber-600 mt-1.5">Bill/invoice upload is required for this payment category</Text>
                )}
              </View>

              {/* Step 3: Payment Option */}
              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-2">3. Payment Option *</Text>
                <TouchableOpacity
                  onPress={() => { setShowOptionList(!showOptionList); setShowBeneficiaryList(false); setShowCategoryList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className={`text-base ${selectedOpt ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedOpt?.category_name || 'Choose payment option...'}
                  </Text>
                  {showOptionList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                <Modal visible={showOptionList} animationType="fade" transparent style={{ zIndex: 100 }}>
                  <View className="flex-1 bg-black/50 justify-center items-center p-4" style={{ zIndex: 100 }}>
                    <View className="bg-white rounded-2xl w-full max-h-[75%]">
                      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
                        <Text className="text-base font-semibold text-gray-900">Select Payment Option</Text>
                        <TouchableOpacity onPress={() => setShowOptionList(false)} activeOpacity={0.7} delayPressIn={0}>
                          <X size={20} color="#6b7280" />
                        </TouchableOpacity>
                      </View>
                      <ScrollView nestedScrollEnabled>
                        {paymentOptions.length === 0 ? (
                          <View className="p-4 items-center">
                            <Text className="text-base text-gray-500">No payment options available</Text>
                          </View>
                        ) : paymentOptions.map((o) => (
                          <TouchableOpacity
                            key={o.id}
                            onPress={() => { selection(); setSelectedOption(o.id); setShowOptionList(false); }}
                            className={`p-3.5 border-b border-gray-100 ${selectedOption === o.id ? 'bg-[#f3f0fe]' : ''}`}
                            activeOpacity={0.7} delayPressIn={0}
                          >
                            <View className="flex-row items-center gap-2">
                              <Wallet size={16} color="#8c76f0" />
                              <Text className="text-base font-medium text-gray-900">{o.category_name}</Text>
                            </View>
                            <Text className="text-xs text-gray-500 mt-0.5 ml-6">
                              Charges: {o.charges_percentage}% + GST{o.show_discount ? ` (Discount: ${o.discounted_charges_percentage}%)` : ''}
                            </Text>
                            {o.settlement_time ? (
                              <View className="flex-row items-center gap-1 mt-0.5 ml-6">
                                <Clock size={11} color="#9ca3af" />
                                <Text className="text-xs text-gray-400">Settlement: {o.settlement_time}</Text>
                              </View>
                            ) : null}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                </Modal>
              </View>

              {/* Terms & Conditions for selected payment option */}
              {selectedOpt?.terms_and_conditions ? (
                <View className="bg-gray-50 border border-gray-200 rounded-xl p-3 gap-1.5">
                  <Text className="text-xs font-semibold text-gray-900 mb-1">Terms &amp; Conditions</Text>
                  {selectedOpt.terms_and_conditions.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                    <Text key={i} className="text-xs text-gray-600 leading-relaxed">{line}</Text>
                  ))}
                </View>
              ) : null}

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
                    <Text className="text-base font-semibold text-gray-900">Payment Summary</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-600">Amount to Transfer</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.amount)}`}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-600">{chargeBreakdown.surchargePercentage > 0 ? 'Charges & Surcharge' : 'Platform Charges'} ({chargeBreakdown.effectiveChargesPercentage}%)</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.charges)}`}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-600">GST on Charges</Text>
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
                disabled={submitting || calculating || uploadingBill}
                className="w-full bg-[#8c76f0] rounded-xl py-3.5"
                style={{ opacity: submitting || calculating || uploadingBill ? 0.5 : 1 }}
                activeOpacity={0.7} delayPressIn={0}
              >
                <Text className="text-white font-semibold text-center text-base">
                  {submitting ? 'Processing...' : 'Pay Now'}
                </Text>
              </TouchableOpacity>

              <View className="flex-row items-start gap-2 bg-blue-50 rounded-xl p-3">
                <Info size={16} color="#2563eb" />
                <Text className="text-sm text-blue-700 flex-1">
                  You will be redirected to the payment gateway to complete your payment securely.
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Confirm Modal */}
      <Modal visible={showConfirm} animationType="fade" transparent style={{ zIndex: 100 }}>
        <View className="flex-1 bg-black/60 justify-center items-center p-4" style={{ zIndex: 100 }}>
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
              {billFile && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-gray-500">Bill</Text>
                  <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>{billFile.name}</Text>
                </View>
              )}
              {chargeBreakdown && (
                <>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">Amount to Send</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.amount)}`}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">{chargeBreakdown.surchargePercentage > 0 ? 'Charges & Surcharge' : 'Platform Charges'} ({chargeBreakdown.effectiveChargesPercentage}%)</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.charges)}`}</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-gray-500">GST on Charges</Text>
                    <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(chargeBreakdown.gst)}`}</Text>
                  </View>
                  <View className="flex-row justify-between pt-2 border-t border-gray-100">
                    <Text className="text-base font-semibold text-gray-900">Total Amount</Text>
                    <Text className="text-base font-bold text-[#8c76f0]">{`\u20B9${fmtAmt(chargeBreakdown.totalAmount)}`}</Text>
                  </View>
                </>
              )}
              {!chargeBreakdown && selectedOpt && (
                <>
                  {(() => {
                    const baseAmt = parseFloat(amount) || 0;
                    const useDiscounted = selectedOpt.show_discount;
                    const basePct = useDiscounted ? selectedOpt.discounted_charges_percentage : selectedOpt.charges_percentage;
                    const surchargePct = selectedOpt.business_surcharge_percentage || 0;
                    const surgePct = kycStatus?.businessCategorySurgeCharge || 0;
                    const effPct = basePct + surchargePct + surgePct;
                    const charges = (baseAmt * effPct) / 100;
                    const gst = (charges * selectedOpt.gst_percentage) / 100;
                    const total = baseAmt + charges + gst;
                    return (
                      <>
                        <View className="flex-row justify-between">
                          <Text className="text-sm text-gray-500">Amount to Send</Text>
                          <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(baseAmt)}`}</Text>
                        </View>
                        <View className="flex-row justify-between">
                          <Text className="text-sm text-gray-500">{(surchargePct > 0 || surgePct > 0) ? 'Charges & Surcharge' : 'Platform Charges'} ({effPct}%)</Text>
                          <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(charges.toFixed(2))}`}</Text>
                        </View>
                        <View className="flex-row justify-between">
                          <Text className="text-sm text-gray-500">GST on Charges</Text>
                          <Text className="text-sm font-medium text-gray-900">{`\u20B9${fmtAmt(gst.toFixed(2))}`}</Text>
                        </View>
                        <View className="flex-row justify-between pt-2 border-t border-gray-100">
                          <Text className="text-base font-semibold text-gray-900">Total Amount</Text>
                          <Text className="text-base font-bold text-[#8c76f0]">{`\u20B9${fmtAmt(total.toFixed(2))}`}</Text>
                        </View>
                      </>
                    );
                  })()}
                </>
              )}
            </View>
            <Text className="text-sm text-gray-500 text-center">
              You will be redirected to {selectedOpt?.gateway_name || 'the payment gateway'} to complete the payment.
            </Text>
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={() => setShowConfirm(false)} className="flex-1 px-4 py-3 border border-gray-300 rounded-xl" activeOpacity={0.7} delayPressIn={0}>
                <Text className="text-base text-gray-700 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSubmit} disabled={submitting} className="flex-1 px-4 py-3 bg-[#8c76f0] rounded-xl" activeOpacity={0.7} delayPressIn={0} style={{ opacity: submitting ? 0.5 : 1 }}>
                <Text className="text-base text-white font-semibold text-center">{submitting ? 'Processing...' : 'Confirm & Pay'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
