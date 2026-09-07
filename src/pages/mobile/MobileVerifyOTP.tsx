import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Pressable, ScrollView } from 'react-native';
import { Mail, Smartphone, RefreshCw, CircleAlert as AlertCircle, CircleCheck as CheckCircle } from 'lucide-react-native';
import { useNav } from '../../hooks/useNav';
import { useAuth } from '../../contexts/AuthContext';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

export default function MobileVerifyOTP() {
  const { navigate, route } = useNav();
  const { login } = useAuth();
  const params = (route.params || {}) as { userId?: string; email?: string; mobileNumber?: string; fromLogin?: boolean };
  const userId = params.userId;
  const email = params.email;
  const mobileNumber = params.mobileNumber;
  const fromLogin = params.fromLogin;

  const [mobileOTP, setMobileOTP] = useState(['', '', '', '', '', '']);
  const [emailOTP, setEmailOTP] = useState(['', '', '', '', '', '']);
  const [mobileTimer, setMobileTimer] = useState(30);
  const [emailTimer, setEmailTimer] = useState(30);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errors, setErrors] = useState({ mobile: '', email: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const mobileRefs = useRef<(TextInput | null)[]>([]);
  const emailRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (!userId || !email || !mobileNumber) {
      navigate(fromLogin ? '/mobile/login' : '/mobile/register');
    }
  }, [userId, email, mobileNumber, fromLogin, navigate]);

  useEffect(() => {
    if (mobileTimer > 0) { const t = setTimeout(() => setMobileTimer(mobileTimer - 1), 1000); return () => clearTimeout(t); }
  }, [mobileTimer]);

  useEffect(() => {
    if (emailTimer > 0) { const t = setTimeout(() => setEmailTimer(emailTimer - 1), 1000); return () => clearTimeout(t); }
  }, [emailTimer]);

  const handleOTPChange = (value: string, index: number, setter: React.Dispatch<React.SetStateAction<string[]>>, otp: string[], refs: React.MutableRefObject<(TextInput | null)[]>) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp]; next[index] = value; setter(next);
    if (value && index < 5) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (e: any, index: number, otp: string[], refs: React.MutableRefObject<(TextInput | null)[]>) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handleResend = async (type: 'mobile' | 'email') => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/resend-otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resend OTP');
      if (type === 'mobile') { setMobileTimer(30); setMobileOTP(['', '', '', '', '', '']); }
      else { setEmailTimer(30); setEmailOTP(['', '', '', '', '', '']); }
      setSuccess(`OTP resent to your ${type === 'mobile' ? 'mobile' : 'email'}`);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend OTP');
      setTimeout(() => setError(''), 5000);
    }
  };

  const handleVerify = async () => {
    const mStr = mobileOTP.join('');
    const eStr = emailOTP.join('');
    const e = { mobile: '', email: '' };
    if (mStr.length !== 6) e.mobile = 'Enter complete mobile OTP';
    if (eStr.length !== 6) e.email = 'Enter complete email OTP';
    if (e.mobile || e.email) { setErrors(e); return; }

    setIsVerifying(true); setErrors({ mobile: '', email: '' }); setError(''); setSuccess('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, mobileOTP: mStr, emailOTP: eStr }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'OTP verification failed');
      login(userId!, email!);
      navigate('/mobile/kyc-verification', { state: { userId, userEmail: email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const otpInput = (digit: string, index: number, setter: React.Dispatch<React.SetStateAction<string[]>>, otp: string[], refs: React.MutableRefObject<(TextInput | null)[]>) => (
    <TextInput
      ref={(el) => { refs.current[index] = el; }}
      value={digit}
      onChangeText={(v) => handleOTPChange(v, index, setter, otp, refs)}
      onKeyPress={(e) => handleKeyDown(e, index, otp, refs)}
      className="w-9 h-11 text-center text-base font-bold border border-gray-300 rounded-lg"
      keyboardType="number-pad"
      maxLength={1}
    />
  );

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} className="flex-1 bg-gray-50 px-4 py-6" keyboardShouldPersistTaps="handled">
      <View className="max-w-sm w-full self-center">
        <View className="items-center mb-4">
          <Image
            source={require('../../../public/PayByCard-Logo.png')}
            className="w-20 h-20"
            resizeMode="contain"
          />
          <Text className="text-xl font-bold text-gray-900 mt-2">Verify Your Account</Text>
          <Text className="text-xs text-gray-500 mt-0.5">
            {fromLogin ? 'Verify your mobile and email to continue' : 'Codes sent to your mobile and email'}
          </Text>
        </View>

        {error ? (
          <View className="mb-4 bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
            <AlertCircle size={16} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{error}</Text>
          </View>
        ) : null}
        {success ? (
          <View className="mb-4 bg-green-50 border border-green-300 rounded-xl p-3 flex-row items-start gap-2">
            <CheckCircle size={16} color="#16a34a" />
            <Text className="text-sm text-green-700 flex-1">{success}</Text>
          </View>
        ) : null}

        <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 gap-4">
          <View>
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                <Smartphone size={16} color="#8c76f0" />
                <Text className="text-xs font-semibold text-gray-900">Mobile OTP</Text>
              </View>
              <Text className="text-xs text-gray-500">{mobileNumber}</Text>
            </View>
            <View className="flex-row justify-center gap-2 mb-2">
              {mobileOTP.map((d, i) => otpInput(d, i, setMobileOTP, mobileOTP, mobileRefs))}
            </View>
            {errors.mobile ? <Text className="text-red-600 text-xs text-center">{errors.mobile}</Text> : null}
            <View className="items-center">
              {mobileTimer > 0 ? (
                <Text className="text-xs text-gray-500">Resend in {mobileTimer}s</Text>
              ) : (
                <TouchableOpacity onPress={() => handleResend('mobile')} className="flex-row items-center gap-1" activeOpacity={0.7} delayPressIn={0}>
                  <RefreshCw size={12} color="#8c76f0" />
                  <Text className="text-xs text-[#8c76f0] font-semibold">Resend Mobile OTP</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View className="border-t border-gray-100" />

          <View>
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                <Mail size={16} color="#8c76f0" />
                <Text className="text-xs font-semibold text-gray-900">Email OTP</Text>
              </View>
              <Text className="text-xs text-gray-500" numberOfLines={1}>{email}</Text>
            </View>
            <View className="flex-row justify-center gap-2 mb-2">
              {emailOTP.map((d, i) => otpInput(d, i, setEmailOTP, emailOTP, emailRefs))}
            </View>
            {errors.email ? <Text className="text-red-600 text-xs text-center">{errors.email}</Text> : null}
            <View className="items-center">
              {emailTimer > 0 ? (
                <Text className="text-xs text-gray-500">Resend in {emailTimer}s</Text>
              ) : (
                <TouchableOpacity onPress={() => handleResend('email')} className="flex-row items-center gap-1" activeOpacity={0.7} delayPressIn={0}>
                  <RefreshCw size={12} color="#8c76f0" />
                  <Text className="text-xs text-[#8c76f0] font-semibold">Resend Email OTP</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Pressable
            onPress={handleVerify}
            disabled={isVerifying}
            className="w-full bg-[#8c76f0] rounded-xl py-3"
            style={{ opacity: isVerifying ? 0.5 : 1 }}
          >
            <Text className="text-white font-semibold text-center text-base">
              {isVerifying ? 'Verifying...' : 'Verify & Continue'}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
