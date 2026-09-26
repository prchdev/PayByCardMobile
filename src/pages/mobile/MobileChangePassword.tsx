import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Lock, Eye, EyeOff, CircleAlert as AlertCircle, CircleCheck as CheckCircle } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../../utils/passwordValidation';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { buildAuthHeaders, checkSessionExpired } from '../../utils/api';
import { getErrorMessage } from '../../utils/errorMessage';

export default function MobileChangePassword() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [formData, setFormData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!userId) navigate('/mobile/login');
  }, [userId, navigate]);

  if (!userId) return null;

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const handleSubmit = async () => {
    setError(''); setSuccess(false);

    if (!formData.currentPassword) { setError('Current password is required.'); return; }

    const passwordValidation = validatePassword(formData.newPassword);
    if (!passwordValidation.isValid) { setError(passwordValidation.error!); return; }

    if (!formData.confirmPassword) { setError('Please confirm your new password.'); return; }

    if (formData.newPassword !== formData.confirmPassword) { setError('New passwords do not match. Please re-enter.'); return; }

    if (formData.currentPassword === formData.newPassword) { setError('New password must be different from your current password.'); return; }

    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/change-password`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ user_id: userId, current_password: formData.currentPassword, new_password: formData.newPassword }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      setSuccess(true);
      setFormData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to change password'));
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { key: 'currentPassword' as const, label: 'Current Password', show: showCurrent, toggle: () => setShowCurrent(!showCurrent), placeholder: 'Enter your current password' },
    { key: 'newPassword' as const, label: 'New Password', show: showNew, toggle: () => setShowNew(!showNew), placeholder: 'Enter your new password' },
    { key: 'confirmPassword' as const, label: 'Confirm New Password', show: showConfirm, toggle: () => setShowConfirm(!showConfirm), placeholder: 'Re-enter your new password' },
  ];

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View className="px-4 py-4 gap-4">
            <View className="flex-row items-center gap-3 mb-1">
              <View className="w-10 h-10 bg-[#8c76f0] rounded-xl items-center justify-center">
                <Lock size={20} color="white" />
              </View>
              <View>
                <Text className="text-xl font-bold text-gray-900">Change Password</Text>
                <Text className="text-sm text-gray-500 mt-0.5">Update your account password to keep your account secure.</Text>
              </View>
            </View>

            {error ? (
              <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2">
                <AlertCircle size={16} color="#dc2626" />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-red-900">Error</Text>
                  <Text className="text-xs mt-0.5 text-red-800">{error}</Text>
                </View>
              </View>
            ) : null}

            {success ? (
              <View className="bg-green-50 border border-green-300 rounded-xl p-3 flex-row items-start gap-2">
                <CheckCircle size={16} color="#16a34a" />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-green-900">Success</Text>
                  <Text className="text-xs mt-0.5 text-green-800">Password changed successfully!</Text>
                </View>
              </View>
            ) : null}

            <View className="bg-white border border-gray-200 rounded-2xl p-4 gap-4">
              {fields.map(({ key, label, show, toggle, placeholder }) => (
                <View key={key}>
                  <Text className="text-sm font-medium text-gray-700 mb-1.5">{label} <Text className="text-red-500">*</Text></Text>
                  <View className="flex-row items-center">
                    <TextInput
                      value={formData[key]}
                      onChangeText={(v) => setFormData({ ...formData, [key]: v })}
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-base text-gray-900 pr-10"
                      placeholder={placeholder}
                      placeholderTextColor="#9ca3af"
                      secureTextEntry={!show}
                      autoCapitalize="none"
                      maxLength={20}
                      editable={!loading && !success}
                    />
                    <TouchableOpacity
                      onPress={toggle}
                      className="absolute right-3"
                      activeOpacity={0.7} delayPressIn={0}
                      disabled={loading || success}
                    >
                      {show ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <View className="pt-4 border-t border-gray-200 flex-row gap-3">
                <TouchableOpacity
                  onPress={() => navigate('/mobile/dashboard', { state: { userId, userEmail } })}
                  disabled={loading || success}
                  className="flex-1 py-3.5 border border-gray-300 rounded-xl"
                  activeOpacity={0.7} delayPressIn={0}
                  style={{ opacity: loading || success ? 0.5 : 1 }}
                >
                  <Text className="text-gray-700 text-base font-semibold text-center">Cancel</Text>
                </TouchableOpacity>
                <Pressable
                  onPress={handleSubmit}
                  disabled={loading || success}
                  className="flex-1 py-3.5 bg-[#8c76f0] rounded-xl"
                  style={{ opacity: loading || success ? 0.5 : 1 }}
                >
                  <Text className="text-white text-base font-semibold text-center">{loading ? 'Updating...' : 'Change Password'}</Text>
                </Pressable>
              </View>
            </View>

            <View className="bg-[#f3f0fe] border border-[#8c76f0] rounded-xl px-4 py-4">
              <View className="flex-row items-start gap-3">
                <View className="w-10 h-10 bg-[#8c76f0] rounded-xl items-center justify-center">
                  <Lock size={20} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-gray-900 mb-2">Password Requirements</Text>
                  <View className="gap-2">
                    {PASSWORD_REQUIREMENTS.map((req, idx) => (
                      <View key={idx} className="flex-row items-start gap-2">
                        <Text className="text-[#8c76f0] font-bold mt-0.5">{'\u2022'}</Text>
                        <Text className="text-sm text-gray-700 flex-1">{req}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </MobileLayout>
  );
}
