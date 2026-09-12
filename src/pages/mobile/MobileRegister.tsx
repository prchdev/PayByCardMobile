import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Pressable, ScrollView, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Eye, EyeOff, CircleAlert as AlertCircle, X, FileText, Shield } from 'lucide-react-native';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../../utils/passwordValidation';
import { capitalizeName } from '../../utils/nameFormat';
import TermsOfServiceContent from '../../components/mobile/TermsOfServiceContent';
import PrivacyPolicyContent from '../../components/mobile/PrivacyPolicyContent';

interface FormData {
  firstName: string; middleName: string; lastName: string;
  mobileNumber: string; email: string; password: string; confirmPassword: string;
  agreeToTerms: boolean;
}

type ModalType = 'terms' | 'privacy' | null;

export default function MobileRegister() {
  const { navigate } = useNav();
  const insets = useSafeAreaInsets();
  const [formData, setFormData] = useState<FormData>({
    firstName: '', middleName: '', lastName: '', mobileNumber: '', email: '',
    password: '', confirmPassword: '', agreeToTerms: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  const validateForm = (): boolean => {
    const e: Record<string, string> = {};
    if (!formData.firstName.trim()) e.firstName = 'First name is required';
    else if (!/^[A-Za-z ]+$/.test(formData.firstName)) e.firstName = 'First name must contain only letters and spaces';
    else if (formData.firstName.length > 30) e.firstName = 'First name must not exceed 30 characters';

    if (formData.middleName.trim()) {
      if (!/^[A-Za-z ]+$/.test(formData.middleName)) e.middleName = 'Middle name must contain only letters and spaces';
      else if (formData.middleName.length > 30) e.middleName = 'Middle name must not exceed 30 characters';
    }

    if (!formData.lastName.trim()) e.lastName = 'Last name is required';
    else if (!/^[A-Za-z ]+$/.test(formData.lastName)) e.lastName = 'Last name must contain only letters and spaces';
    else if (formData.lastName.length > 30) e.lastName = 'Last name must not exceed 30 characters';

    if (!formData.mobileNumber.trim()) e.mobileNumber = 'Mobile number is required';
    else if (!/^\d{10}$/.test(formData.mobileNumber)) e.mobileNumber = 'Please enter a valid 10-digit mobile number';

    if (!formData.email.trim()) e.email = 'Email is required';
    else if (formData.email.length > 100) e.email = 'Email must not exceed 100 characters';
    else if (!/^[A-Za-z0-9@_.\-]+$/.test(formData.email)) e.email = 'Email may only contain letters, numbers, @, _, ., and -';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = 'Please enter a valid email address';

    const pv = validatePassword(formData.password);
    if (!pv.isValid) e.password = pv.error!;

    if (!formData.confirmPassword) e.confirmPassword = 'Please confirm your password';
    else if (formData.password !== formData.confirmPassword) e.confirmPassword = 'Passwords do not match';

    if (!formData.agreeToTerms) e.agreeToTerms = 'You must agree to the terms and conditions';

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const capFirst = capitalizeName(formData.firstName);
      const capMiddle = capitalizeName(formData.middleName);
      const capLast = capitalizeName(formData.lastName);
      const fullName = [capFirst, capMiddle, capLast].filter(Boolean).join(' ');
      const res = await fetch(`${SUPABASE_URL}/functions/v1/register-user`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: capFirst, middleName: capMiddle || undefined,
          lastName: capLast, fullName,
          mobileNumber: `+91${formData.mobileNumber}`, email: formData.email, password: formData.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      navigate('/mobile/verify-otp', {
        state: { userId: data.userId, email: formData.email, mobileNumber: `+91${formData.mobileNumber}` },
      });
    } catch (err) {
      setErrors({ general: err instanceof Error ? err.message : 'Registration failed' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
    <ScrollView className="flex-1 bg-gray-50 px-4" contentContainerStyle={{ paddingBottom: 120 }} style={{ paddingTop: insets.top + 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View className="max-w-sm w-full self-center">
        <View className="items-center mb-4">
          <Image
            source={require('../../../public/PayByCard-Logo.png')}
            className="w-28 h-14"
            resizeMode="contain"
          />
          <Text className="text-xl font-bold text-gray-900 mt-2">Create Account</Text>
          <Text className="text-xs text-gray-500 mt-0.5">Sign up for your PayByCard account</Text>
        </View>

        {errors.general ? (
          <View className="mb-4 bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
            <AlertCircle size={16} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{errors.general}</Text>
          </View>
        ) : null}

        <View className="gap-3 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">First Name *</Text>
              <TextInput
                value={formData.firstName}
                onChangeText={(v) => setFormData({ ...formData, firstName: v.replace(/[^A-Za-z ]/g, '') })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Amit" maxLength={30}
              />
              {errors.firstName ? <Text className="text-red-600 text-xs mt-1">{errors.firstName}</Text> : null}
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-gray-700 mb-1.5">Last Name *</Text>
              <TextInput
                value={formData.lastName}
                onChangeText={(v) => setFormData({ ...formData, lastName: v.replace(/[^A-Za-z ]/g, '') })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Jha" maxLength={30}
              />
              {errors.lastName ? <Text className="text-red-600 text-xs mt-1">{errors.lastName}</Text> : null}
            </View>
          </View>

          <View>
            <Text className="text-sm font-semibold text-gray-700 mb-1.5">Middle Name</Text>
            <TextInput
              value={formData.middleName}
              onChangeText={(v) => setFormData({ ...formData, middleName: v.replace(/[^A-Za-z ]/g, '') })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
              placeholder="Kumar" maxLength={30}
            />
            {errors.middleName ? <Text className="text-red-600 text-xs mt-1">{errors.middleName}</Text> : null}
          </View>

          <View>
            <Text className="text-sm font-semibold text-gray-700 mb-1.5">Mobile Number *</Text>
            <View className="flex-row">
              <View className="px-4 py-3 bg-gray-100 border border-r-0 border-gray-300 rounded-l-xl justify-center">
                <Text className="text-gray-700 font-semibold text-base">+91</Text>
              </View>
              <TextInput
                value={formData.mobileNumber}
                onChangeText={(v) => setFormData({ ...formData, mobileNumber: v.replace(/\D/g, '').slice(0, 10) })}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-r-xl text-base"
                placeholder="9999999999" maxLength={10} keyboardType="number-pad"
              />
            </View>
            {errors.mobileNumber ? <Text className="text-red-600 text-xs mt-1">{errors.mobileNumber}</Text> : null}
          </View>

          <View>
            <Text className="text-sm font-semibold text-gray-700 mb-1.5">Email Address *</Text>
            <TextInput
              value={formData.email}
              onChangeText={(v) => setFormData({ ...formData, email: v.replace(/[^A-Za-z0-9@_.\-]/g, '') })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
              placeholder="amit.jha@example.com" maxLength={100}
              keyboardType="email-address" autoCapitalize="none"
            />
            {errors.email ? <Text className="text-red-600 text-xs mt-1">{errors.email}</Text> : null}
          </View>

          <View>
            <Text className="text-sm font-semibold text-gray-700 mb-1.5">Password *</Text>
            <View className="flex-row items-center">
              <TextInput
                value={formData.password}
                onChangeText={(v) => setFormData({ ...formData, password: v })}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-base pr-10"
                placeholder="********" maxLength={20}
                secureTextEntry={!showPassword} autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} className="absolute right-3" activeOpacity={0.7} delayPressIn={0}>
                {showPassword ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
              </TouchableOpacity>
            </View>
            {errors.password ? <Text className="text-red-600 text-xs mt-1">{errors.password}</Text> : null}
          </View>

          <View>
            <Text className="text-sm font-semibold text-gray-700 mb-1.5">Confirm Password *</Text>
            <View className="flex-row items-center">
              <TextInput
                value={formData.confirmPassword}
                onChangeText={(v) => setFormData({ ...formData, confirmPassword: v })}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-base pr-10"
                placeholder="********" maxLength={20}
                secureTextEntry={!showConfirm} autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} className="absolute right-3" activeOpacity={0.7} delayPressIn={0}>
                {showConfirm ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
              </TouchableOpacity>
            </View>
            {errors.confirmPassword ? <Text className="text-red-600 text-xs mt-1">{errors.confirmPassword}</Text> : null}
          </View>

          <View className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <Text className="text-xs text-gray-600 mb-2 font-medium">Password must contain:</Text>
            {PASSWORD_REQUIREMENTS.map((req, idx) => (
              <View key={idx} className="flex-row items-center gap-1.5 mb-0.5">
                <View className="w-1 h-1 bg-gray-400 rounded-full" />
                <Text className="text-xs text-gray-500">{req}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={() => setFormData({ ...formData, agreeToTerms: !formData.agreeToTerms })}
            className="flex-row items-start gap-2.5"
            activeOpacity={0.8}
          >
            <View className={`w-4 h-4 rounded border mt-0.5 items-center justify-center ${formData.agreeToTerms ? 'bg-[#8c76f0] border-[#8c76f0]' : 'border-gray-300'}`}>
              {formData.agreeToTerms && <Text className="text-white text-[10px] font-bold">{'\u2713'}</Text>}
            </View>
            <View className="flex-1 flex-row flex-wrap">
              <Text className="text-sm text-gray-700">I agree to the </Text>
              <TouchableOpacity onPress={() => setActiveModal('terms')} activeOpacity={0.7} delayPressIn={0}>
                <Text className="text-sm text-[#8c76f0] font-semibold">Terms and Conditions</Text>
              </TouchableOpacity>
              <Text className="text-sm text-gray-700"> and </Text>
              <TouchableOpacity onPress={() => setActiveModal('privacy')} activeOpacity={0.7} delayPressIn={0}>
                <Text className="text-sm text-[#8c76f0] font-semibold">Privacy Policy</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
          {errors.agreeToTerms ? <Text className="text-red-600 text-xs">{errors.agreeToTerms}</Text> : null}

          <Pressable
            onPress={handleSubmit}
            disabled={isSubmitting}
            className="w-full bg-[#8c76f0] rounded-xl py-3.5"
            style={{ opacity: isSubmitting ? 0.5 : 1 }}
          >
            <Text className="text-white font-semibold text-center">
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
            </Text>
          </Pressable>
        </View>

        <View className="flex-row justify-center mt-3 pb-4">
          <Text className="text-sm text-gray-600">Already have an account? </Text>
          <TouchableOpacity onPress={() => navigate('/mobile/login')} activeOpacity={0.7} delayPressIn={0}>
            <Text className="text-sm text-[#8c76f0] font-semibold">Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={activeModal !== null} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 12 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 16, width: '100%', maxHeight: '92%', flexDirection: 'column' }}>
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
              <View className="flex-row items-center gap-2">
                {activeModal === 'terms' ? <FileText size={20} color="#8c76f0" /> : <Shield size={20} color="#8c76f0" />}
                <Text className="text-base font-bold text-gray-900">
                  {activeModal === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setActiveModal(null)} className="p-1.5" activeOpacity={0.7} delayPressIn={0}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1, padding: 16 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator>
              {activeModal === 'terms' ? <TermsOfServiceContent /> : <PrivacyPolicyContent />}
            </ScrollView>
            <View className="px-4 py-3 border-t border-gray-200">
              <Pressable onPress={() => setActiveModal(null)} className="bg-[#8c76f0] rounded-xl py-2.5">
                <Text className="text-white text-center font-semibold text-sm">Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
