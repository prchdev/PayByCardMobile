import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Pressable, ScrollView } from 'react-native';
import { ArrowLeft, Mail, Eye, EyeOff, Smartphone, RefreshCw, CircleCheck as CheckCircle, CircleAlert as AlertCircle } from 'lucide-react-native';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../../utils/passwordValidation';

export default function MobileForgotPassword() {
  const { navigate } = useNav();
  const [step, setStep] = useState<'email' | 'otp' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [maskedMobile, setMaskedMobile] = useState('');
  const [emailOtp, setEmailOtp] = useState(['', '', '', '', '', '']);
  const [mobileOtp, setMobileOtp] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [emailTimer, setEmailTimer] = useState(0);
  const [mobileTimer, setMobileTimer] = useState(0);

  const emailRefs = useRef<(TextInput | null)[]>([]);
  const mobileRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (emailTimer > 0) { const t = setTimeout(() => setEmailTimer(v => v - 1), 1000); return () => clearTimeout(t); }
  }, [emailTimer]);
  useEffect(() => {
    if (mobileTimer > 0) { const t = setTimeout(() => setMobileTimer(v => v - 1), 1000); return () => clearTimeout(t); }
  }, [mobileTimer]);

  const handleSendOTP = async () => {
    setError('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/user-forgot-password`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
      setMaskedMobile(data.maskedMobile || '');
      setSuccess('OTPs sent to your email and mobile');
      setEmailTimer(30); setMobileTimer(30); setStep('otp');
    } catch (err) { setError(err instanceof Error ? err.message : 'An error occurred'); }
    finally { setLoading(false); }
  };

  const handleOtpChange = (val: string, idx: number, setter: React.Dispatch<React.SetStateAction<string[]>>, refs: React.MutableRefObject<(TextInput | null)[]>) => {
    if (!/^\d*$/.test(val)) return;
    setter((prev: string[]) => { const n = [...prev]; n[idx] = val.slice(-1); return n; });
    if (val && idx < 5) refs.current[idx + 1]?.focus();
  };

  const handleResend = async (type: 'email' | 'mobile') => {
    setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/user-forgot-password`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resend');
      if (type === 'email') { setEmailOtp(['', '', '', '', '', '']); setEmailTimer(30); }
      else { setMobileOtp(['', '', '', '', '', '']); setMobileTimer(30); }
      setSuccess(`OTP resent to your ${type}`); setTimeout(() => setSuccess(''), 5000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to resend'); }
  };

  const handleVerifyOTP = async () => {
    setError('');
    const eStr = emailOtp.join(''), mStr = mobileOtp.join('');
    if (eStr.length !== 6) { setError('Enter complete email OTP'); return; }
    if (mStr.length !== 6) { setError('Enter complete mobile OTP'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/user-verify-reset-otp`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, emailOtp: eStr, mobileOtp: mStr }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid OTP');
      setSuccess('OTPs verified'); setStep('password');
    } catch (err) { setError(err instanceof Error ? err.message : 'An error occurred'); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async () => {
    setError('');
    const pv = validatePassword(newPassword);
    if (!pv.isValid) { setError(pv.error!); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/user-reset-password`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: emailOtp.join(''), newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setSuccess('Password reset! Redirecting to login...');
      setTimeout(() => navigate('/mobile/login'), 2000);
    } catch (err) { setError(err instanceof Error ? err.message : 'An error occurred'); }
    finally { setLoading(false); }
  };

  const otpRow = (otp: string[], setter: React.Dispatch<React.SetStateAction<string[]>>, refs: React.MutableRefObject<(TextInput | null)[]>) => (
    <View className="flex-row justify-center gap-2">
      {otp.map((d, i) => (
        <TextInput
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          onChangeText={(v) => handleOtpChange(v, i, setter, refs)}
          className="w-9 h-11 text-center text-base font-bold border border-gray-300 rounded-lg"
          keyboardType="number-pad"
          maxLength={1}
        />
      ))}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} className="flex-1 bg-gray-50 px-4 py-6">
      <View className="max-w-sm w-full self-center">
        <TouchableOpacity onPress={() => navigate('/mobile/login')} className="mb-3 flex-row items-center" activeOpacity={0.7} delayPressIn={0}>
          <ArrowLeft size={16} color="#4b5563" />
          <Text className="text-sm text-gray-600 ml-1">Back to Login</Text>
        </TouchableOpacity>

        <View className="items-center mb-4">
          <Image
            source={require('../../../public/PayByCard-Logo.png')}
            className="w-20 h-20"
            resizeMode="contain"
          />
          <Text className="text-xl font-bold text-gray-900 mt-2">
            {step === 'email' && 'Forgot Password'}
            {step === 'otp' && 'Verify OTPs'}
            {step === 'password' && 'Reset Password'}
          </Text>
          <Text className="text-xs text-gray-500 mt-0.5">
            {step === 'email' && 'Enter your email to receive codes'}
            {step === 'otp' && `Codes sent to email${maskedMobile ? ` and ${maskedMobile}` : ' and mobile'}`}
            {step === 'password' && 'Create a new password'}
          </Text>
        </View>

        {success ? (
          <View className="mb-4 bg-green-50 border border-green-300 rounded-xl p-3 flex-row items-start gap-2">
            <CheckCircle size={16} color="#16a34a" />
            <Text className="text-sm text-green-700 flex-1">{success}</Text>
          </View>
        ) : null}
        {error ? (
          <View className="mb-4 bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
            <AlertCircle size={16} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{error}</Text>
          </View>
        ) : null}

        <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          {step === 'email' && (
            <View className="gap-3">
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-1.5">Email Address</Text>
                <TextInput
                  value={email} onChangeText={setEmail}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                  placeholder="john.doe@example.com" keyboardType="email-address" autoCapitalize="none"
                />
              </View>
              <Pressable onPress={handleSendOTP} disabled={loading} className="w-full bg-[#8c76f0] rounded-xl py-2.5" style={{ opacity: loading ? 0.5 : 1 }}>
                <Text className="text-white font-semibold text-center">{loading ? 'Sending...' : 'Send OTPs'}</Text>
              </Pressable>
            </View>
          )}

          {step === 'otp' && (
            <View className="gap-4">
              <View>
                <View className="flex-row items-center gap-2 mb-2">
                  <Mail size={16} color="#8c76f0" />
                  <Text className="text-xs font-semibold text-gray-900">Email OTP</Text>
                </View>
                {otpRow(emailOtp, setEmailOtp, emailRefs)}
                <View className="items-center mt-2">
                  {emailTimer > 0 ? <Text className="text-xs text-gray-500">Resend in {emailTimer}s</Text> :
                    <TouchableOpacity onPress={() => handleResend('email')} className="flex-row items-center gap-1" activeOpacity={0.7} delayPressIn={0}>
                      <RefreshCw size={12} color="#8c76f0" />
                      <Text className="text-xs text-[#8c76f0] font-semibold">Resend Email OTP</Text>
                    </TouchableOpacity>}
                </View>
              </View>
              <View className="border-t border-gray-100" />
              <View>
                <View className="flex-row items-center gap-2 mb-2">
                  <Smartphone size={16} color="#8c76f0" />
                  <Text className="text-xs font-semibold text-gray-900">Mobile OTP</Text>
                </View>
                {otpRow(mobileOtp, setMobileOtp, mobileRefs)}
                <View className="items-center mt-2">
                  {mobileTimer > 0 ? <Text className="text-xs text-gray-500">Resend in {mobileTimer}s</Text> :
                    <TouchableOpacity onPress={() => handleResend('mobile')} className="flex-row items-center gap-1" activeOpacity={0.7} delayPressIn={0}>
                      <RefreshCw size={12} color="#8c76f0" />
                      <Text className="text-xs text-[#8c76f0] font-semibold">Resend Mobile OTP</Text>
                    </TouchableOpacity>}
                </View>
              </View>
              <Pressable onPress={handleVerifyOTP} disabled={loading} className="w-full bg-[#8c76f0] rounded-xl py-2.5" style={{ opacity: loading ? 0.5 : 1 }}>
                <Text className="text-white font-semibold text-center">{loading ? 'Verifying...' : 'Verify OTPs'}</Text>
              </Pressable>
              <TouchableOpacity onPress={() => { setStep('email'); setSuccess(''); setError(''); }} activeOpacity={0.7} delayPressIn={0}>
                <Text className="text-xs text-gray-500 text-center">Didn't receive codes? Go back</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'password' && (
            <View className="gap-3">
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-1.5">New Password</Text>
                <View className="flex-row items-center">
                  <TextInput
                    value={newPassword} onChangeText={setNewPassword}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm pr-10"
                    placeholder="********" secureTextEntry={!showPassword} autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} className="absolute right-3" activeOpacity={0.7} delayPressIn={0}>
                    {showPassword ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                  </TouchableOpacity>
                </View>
              </View>
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-1.5">Confirm Password</Text>
                <View className="flex-row items-center">
                  <TextInput
                    value={confirmPassword} onChangeText={setConfirmPassword}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm pr-10"
                    placeholder="********" secureTextEntry={!showConfirm} autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} className="absolute right-3" activeOpacity={0.7} delayPressIn={0}>
                    {showConfirm ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                  </TouchableOpacity>
                </View>
              </View>
              <View className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                {PASSWORD_REQUIREMENTS.map((req, idx) => (
                  <View key={idx} className="flex-row items-center gap-1.5 mb-0.5">
                    <View className="w-1 h-1 bg-[#8c76f0] rounded-full" />
                    <Text className="text-xs text-gray-500">{req}</Text>
                  </View>
                ))}
              </View>
              <Pressable onPress={handleResetPassword} disabled={loading} className="w-full bg-[#8c76f0] rounded-xl py-2.5" style={{ opacity: loading ? 0.5 : 1 }}>
                <Text className="text-white font-semibold text-center">{loading ? 'Resetting...' : 'Reset Password'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
