import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Pressable, ScrollView, Modal } from 'react-native';
import { Eye, EyeOff, CircleAlert as AlertCircle, X, FileText, Shield } from 'lucide-react-native';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../../utils/passwordValidation';

interface FormData {
  firstName: string; middleName: string; lastName: string;
  mobileNumber: string; email: string; password: string; confirmPassword: string;
  agreeToTerms: boolean;
}

type ModalType = 'terms' | 'privacy' | null;

export default function MobileRegister() {
  const { navigate } = useNav();
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
    else if (!/^[A-Za-z ]+$/.test(formData.firstName)) e.firstName = 'Letters and spaces only';
    else if (formData.firstName.length > 30) e.firstName = 'Max 30 characters';

    if (formData.middleName.trim() && (!/^[A-Za-z ]+$/.test(formData.middleName) || formData.middleName.length > 30))
      e.middleName = 'Letters and spaces only, max 30';

    if (!formData.lastName.trim()) e.lastName = 'Last name is required';
    else if (!/^[A-Za-z ]+$/.test(formData.lastName)) e.lastName = 'Letters and spaces only';
    else if (formData.lastName.length > 30) e.lastName = 'Max 30 characters';

    if (!formData.mobileNumber.trim()) e.mobileNumber = 'Mobile number is required';
    else if (!/^\d{10}$/.test(formData.mobileNumber)) e.mobileNumber = 'Enter a valid 10-digit number';

    if (!formData.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = 'Enter a valid email';

    const pv = validatePassword(formData.password);
    if (!pv.isValid) e.password = pv.error!;

    if (!formData.confirmPassword) e.confirmPassword = 'Please confirm password';
    else if (formData.password !== formData.confirmPassword) e.confirmPassword = 'Passwords do not match';

    if (!formData.agreeToTerms) e.agreeToTerms = 'You must agree to the terms';

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const fullName = [formData.firstName.trim(), formData.middleName.trim(), formData.lastName.trim()].filter(Boolean).join(' ');
      const res = await fetch(`${SUPABASE_URL}/functions/v1/register-user`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName.trim(), middleName: formData.middleName.trim() || undefined,
          lastName: formData.lastName.trim(), fullName,
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
    <ScrollView className="flex-1 bg-gray-50 px-4 pt-12 pb-6">
      <View className="max-w-sm w-full self-center">
        <View className="items-center mb-4">
          <Image
            source={require('../../../../public/PayByCard-Logo.png')}
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
              <Text className="text-xs font-semibold text-gray-700 mb-1">First Name *</Text>
              <TextInput
                value={formData.firstName}
                onChangeText={(v) => setFormData({ ...formData, firstName: v.replace(/[^A-Za-z ]/g, '') })}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                placeholder="Amit" maxLength={30}
              />
              {errors.firstName ? <Text className="text-red-600 text-xs mt-1">{errors.firstName}</Text> : null}
            </View>
            <View className="flex-1">
              <Text className="text-xs font-semibold text-gray-700 mb-1">Last Name *</Text>
              <TextInput
                value={formData.lastName}
                onChangeText={(v) => setFormData({ ...formData, lastName: v.replace(/[^A-Za-z ]/g, '') })}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                placeholder="Jha" maxLength={30}
              />
              {errors.lastName ? <Text className="text-red-600 text-xs mt-1">{errors.lastName}</Text> : null}
            </View>
          </View>

          <View>
            <Text className="text-xs font-semibold text-gray-700 mb-1">Middle Name</Text>
            <TextInput
              value={formData.middleName}
              onChangeText={(v) => setFormData({ ...formData, middleName: v.replace(/[^A-Za-z ]/g, '') })}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
              placeholder="Kumar" maxLength={30}
            />
            {errors.middleName ? <Text className="text-red-600 text-xs mt-1">{errors.middleName}</Text> : null}
          </View>

          <View>
            <Text className="text-xs font-semibold text-gray-700 mb-1">Mobile Number *</Text>
            <View className="flex-row">
              <View className="px-3 py-2 bg-gray-100 border border-r-0 border-gray-300 rounded-l-xl justify-center">
                <Text className="text-gray-700 font-semibold text-sm">+91</Text>
              </View>
              <TextInput
                value={formData.mobileNumber}
                onChangeText={(v) => setFormData({ ...formData, mobileNumber: v.replace(/\D/g, '').slice(0, 10) })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-r-xl text-sm"
                placeholder="9999999999" maxLength={10} keyboardType="number-pad"
              />
            </View>
            {errors.mobileNumber ? <Text className="text-red-600 text-xs mt-1">{errors.mobileNumber}</Text> : null}
          </View>

          <View>
            <Text className="text-xs font-semibold text-gray-700 mb-1">Email Address *</Text>
            <TextInput
              value={formData.email}
              onChangeText={(v) => setFormData({ ...formData, email: v.replace(/[^A-Za-z0-9@_.\-]/g, '') })}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
              placeholder="amit.jha@example.com" maxLength={100}
              keyboardType="email-address" autoCapitalize="none"
            />
            {errors.email ? <Text className="text-red-600 text-xs mt-1">{errors.email}</Text> : null}
          </View>

          <View>
            <Text className="text-xs font-semibold text-gray-700 mb-1">Password *</Text>
            <View className="flex-row items-center">
              <TextInput
                value={formData.password}
                onChangeText={(v) => setFormData({ ...formData, password: v })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm pr-10"
                placeholder="********" maxLength={20}
                secureTextEntry={!showPassword} autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} className="absolute right-3" activeOpacity={0.7}>
                {showPassword ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
              </TouchableOpacity>
            </View>
            {errors.password ? <Text className="text-red-600 text-xs mt-1">{errors.password}</Text> : null}
          </View>

          <View>
            <Text className="text-xs font-semibold text-gray-700 mb-1">Confirm Password *</Text>
            <View className="flex-row items-center">
              <TextInput
                value={formData.confirmPassword}
                onChangeText={(v) => setFormData({ ...formData, confirmPassword: v })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm pr-10"
                placeholder="********" maxLength={20}
                secureTextEntry={!showConfirm} autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} className="absolute right-3" activeOpacity={0.7}>
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
              <Text className="text-xs text-gray-700">I agree to the </Text>
              <TouchableOpacity onPress={() => setActiveModal('terms')} activeOpacity={0.7}>
                <Text className="text-xs text-[#8c76f0] font-semibold">Terms</Text>
              </TouchableOpacity>
              <Text className="text-xs text-gray-700"> and </Text>
              <TouchableOpacity onPress={() => setActiveModal('privacy')} activeOpacity={0.7}>
                <Text className="text-xs text-[#8c76f0] font-semibold">Privacy Policy</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
          {errors.agreeToTerms ? <Text className="text-red-600 text-xs">{errors.agreeToTerms}</Text> : null}

          <Pressable
            onPress={handleSubmit}
            disabled={isSubmitting}
            className="w-full bg-[#8c76f0] rounded-xl py-2.5"
            style={{ opacity: isSubmitting ? 0.5 : 1 }}
          >
            <Text className="text-white font-semibold text-center">
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
            </Text>
          </Pressable>
        </View>

        <View className="flex-row justify-center mt-3 pb-4">
          <Text className="text-sm text-gray-600">Already have an account? </Text>
          <TouchableOpacity onPress={() => navigate('/mobile/login')} activeOpacity={0.7}>
            <Text className="text-sm text-[#8c76f0] font-semibold">Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={activeModal !== null} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 justify-center items-center p-4">
          <View className="bg-white rounded-2xl w-full max-h-[85%]">
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
              <View className="flex-row items-center gap-2">
                {activeModal === 'terms' ? <FileText size={20} color="#8c76f0" /> : <Shield size={20} color="#8c76f0" />}
                <Text className="text-base font-bold text-gray-900">
                  {activeModal === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setActiveModal(null)} className="p-1.5" activeOpacity={0.7}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <ScrollView className="flex-1 p-4">
              <Text className="text-sm text-gray-700">
                {activeModal === 'terms'
                  ? 'Terms of Service content. In the web version this renders the full TermsOfService component.'
                  : 'Privacy Policy content. In the web version this renders the full Privacy component.'}
              </Text>
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
  );
}
