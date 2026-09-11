import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Eye, EyeOff, CircleAlert as AlertCircle } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { impact, notification } from '../../utils/haptics';
import { registerPushToken } from '../../utils/pushNotifications';
import { setSessionItem } from '../../utils/secureStorage';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

export default function MobileLogin() {
  const { navigate } = useNav();
  const { login } = useAuth();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isLocked, setIsLocked] = useState(false);

  const validateForm = (): boolean => {
    const e = { email: '', password: '' };
    if (!formData.email.trim()) e.email = 'Email is required';
    else if (formData.email.length > 100) e.email = 'Email must not exceed 100 characters';
    else if (!/^[A-Za-z0-9@_.\-]+$/.test(formData.email)) e.email = 'Email may only contain letters, numbers, @, _, ., and -';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = 'Please enter a valid email address';
    if (!formData.password) e.password = 'Password is required';
    else if (formData.password.length < 8) e.password = 'Password must be at least 8 characters';
    else if (formData.password.length > 20) e.password = 'Password must not exceed 20 characters';
    setErrors(e);
    return !e.email && !e.password;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    await impact('medium');
    setIsSubmitting(true);
    setError('');
    setIsLocked(false);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/login-user`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: formData.email, password: formData.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.isLocked) setIsLocked(true);
        throw new Error(data.error || 'Login failed');
      }
      if (data.needsVerification) {
        navigate('/mobile/verify-otp', {
          state: { userId: data.userId, email: data.email, mobileNumber: data.mobileNumber, fromLogin: true },
        });
      } else {
        login(data.userId, data.email, data.sessionToken);
        if (data.isRestricted) await setSessionItem('isRestricted', 'true');
        else await setSessionItem('isRestricted', 'false');
        await notification('success');
        registerPushToken(data.userId);
        if (!data.kycCompleted) {
          navigate('/mobile/kyc-verification', { state: { userId: data.userId, userEmail: data.email } });
        } else {
          navigate('/mobile/dashboard', { state: { userId: data.userId, userEmail: data.email } });
        }
      }
    } catch (err) {
      await notification('error');
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} className="flex-1 bg-gray-50 px-4 py-6" keyboardShouldPersistTaps="handled" keyboardShouldDismissOnDrag="always" showsVerticalScrollIndicator={false}>
      <View className="max-w-sm w-full self-center">
        <View className="items-center mb-4">
          <Image
            source={require('../../../public/PayByCard-Logo.png')}
            className="w-28 h-14"
            resizeMode="contain"
          />
          <Text className="text-xl font-bold text-gray-900 mt-2">Welcome Back</Text>
          <Text className="text-xs text-gray-500 mt-0.5">Sign in to your PayByCard account</Text>
        </View>

        {error ? (
          <View className={`mb-4 rounded-xl p-3 ${isLocked ? 'bg-orange-50 border border-orange-300' : 'bg-red-50 border border-red-300'}`}>
            <View className="flex-row items-start gap-2">
              <AlertCircle size={16} color={isLocked ? '#ea580c' : '#dc2626'} />
              <View className="flex-1">
                <Text className={`text-sm font-semibold ${isLocked ? 'text-orange-900' : 'text-red-900'}`}>
                  {isLocked ? 'Account Locked' : 'Error'}
                </Text>
                <Text className={`text-xs mt-0.5 ${isLocked ? 'text-orange-800' : 'text-red-800'}`}>{error}</Text>
                {isLocked && (
                  <TouchableOpacity onPress={() => navigate('/mobile/forgot-password')} activeOpacity={0.7} delayPressIn={0}>
                    <Text className="text-xs font-semibold text-orange-700 underline mt-1">Reset your password now</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ) : null}

        <View className="gap-3 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <View>
            <Text className="text-sm font-semibold text-gray-700 mb-1.5">Email Address <Text className="text-red-600">*</Text></Text>
            <TextInput
              value={formData.email}
              onChangeText={(v) => setFormData({ ...formData, email: v.replace(/[^A-Za-z0-9@_.\-]/g, '') })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
              placeholder="amit.jha@example.com"
              maxLength={100}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {errors.email ? <Text className="text-red-600 text-xs mt-1">{errors.email}</Text> : null}
          </View>

          <View>
            <Text className="text-sm font-semibold text-gray-700 mb-1.5">Password <Text className="text-red-600">*</Text></Text>
            <View className="flex-row items-center">
              <TextInput
                value={formData.password}
                onChangeText={(v) => setFormData({ ...formData, password: v })}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-base pr-10"
                placeholder="********"
                maxLength={20}
                secureTextEntry={!showPassword}
                minLength={8}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                className="absolute right-3"
                activeOpacity={0.7} delayPressIn={0}
              >
                {showPassword ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
              </TouchableOpacity>
            </View>
            {errors.password ? <Text className="text-red-600 text-xs mt-1">{errors.password}</Text> : null}
          </View>

          <View className="flex-row justify-end">
            <TouchableOpacity onPress={() => navigate('/mobile/forgot-password')} activeOpacity={0.7} delayPressIn={0}>
              <Text className="text-xs text-[#8c76f0] font-medium">Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={isSubmitting}
            className="w-full bg-[#8c76f0] rounded-xl py-3.5"
            style={{ opacity: isSubmitting ? 0.5 : 1 }}
          >
            <Text className="text-white font-semibold text-center">
              {isSubmitting ? 'Signing In...' : 'Sign In'}
            </Text>
          </Pressable>
        </View>

        <View className="flex-row justify-center mt-3">
          <Text className="text-sm text-gray-600">Don't have an account? </Text>
          <TouchableOpacity onPress={() => navigate('/mobile/register')} activeOpacity={0.7} delayPressIn={0}>
            <Text className="text-sm text-[#8c76f0] font-semibold">Sign Up</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
