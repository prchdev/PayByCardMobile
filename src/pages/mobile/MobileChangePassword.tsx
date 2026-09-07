import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Lock, Eye, EyeOff, CircleAlert as AlertCircle, CircleCheck as CheckCircle } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../../utils/passwordValidation';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

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
    const pv = validatePassword(formData.newPassword);
    if (!pv.isValid) { setError(pv.error!); return; }
    if (!formData.confirmPassword) { setError('Please confirm your new password.'); return; }
    if (formData.newPassword !== formData.confirmPassword) { setError('New passwords do not match.'); return; }
    if (formData.currentPassword === formData.newPassword) { setError('New password must be different from current.'); return; }

    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ user_id: userId, current_password: formData.currentPassword, new_password: formData.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      setSuccess(true);
      setFormData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardShouldDismissOnDrag="always">
        <View className="px-4 py-4 gap-4">
          <Text className="text-xl font-bold text-gray-900">Change Password</Text>

          {error ? (
            <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
              <AlertCircle size={18} color="#dc2626" />
              <Text className="text-sm text-red-700 flex-1">{error}</Text>
            </View>
          ) : null}
          {success ? (
            <View className="bg-green-50 border border-green-300 rounded-xl p-3 flex-row items-center gap-2">
              <CheckCircle size={18} color="#16a34a" />
              <Text className="text-sm text-green-700 flex-1">Password changed successfully!</Text>
            </View>
          ) : null}

          <View className="gap-4">
            {([
              { key: 'currentPassword', label: 'Current Password', show: showCurrent, toggle: () => setShowCurrent(!showCurrent), placeholder: 'Enter current password' },
              { key: 'newPassword', label: 'New Password', show: showNew, toggle: () => setShowNew(!showNew), placeholder: 'Enter new password' },
              { key: 'confirmPassword', label: 'Confirm New Password', show: showConfirm, toggle: () => setShowConfirm(!showConfirm), placeholder: 'Re-enter new password' },
            ] as const).map(({ key, label, show, toggle, placeholder }) => (
              <View key={key}>
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">{label}</Text>
                <View className="flex-row items-center w-full px-4 py-3 border border-gray-300 rounded-xl bg-white">
                  <TextInput
                    value={formData[key]}
                    onChangeText={(v) => setFormData({ ...formData, [key]: v })}
                    className="flex-1 text-base text-gray-900"
                    placeholder={placeholder}
                    placeholderTextColor="#9ca3af"
                    secureTextEntry={!show}
                    autoCapitalize="none"
                    editable={!loading && !success}
                  />
                  <TouchableOpacity onPress={toggle} activeOpacity={0.7}>
                    {show ? <EyeOff size={18} color="#9ca3af" /> : <Eye size={18} color="#9ca3af" />}
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>

          <View className="bg-gray-50 border border-gray-200 rounded-xl p-3 gap-1.5">
            <Text className="text-sm font-medium text-gray-600 mb-1">Password must contain:</Text>
            {PASSWORD_REQUIREMENTS.map((req, idx) => (
              <View key={idx} className="flex-row items-center gap-2">
                <View className="w-1.5 h-1.5 bg-[#8c76f0] rounded-full" />
                <Text className="text-sm text-gray-500">{req}</Text>
              </View>
            ))}
          </View>

          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => navigate('/mobile/dashboard', { state: { userId, userEmail } })}
              disabled={loading || success}
              className="flex-1 px-4 py-3.5 border border-gray-300 rounded-xl"
              activeOpacity={0.7}
            >
              <Text className="text-gray-700 text-base font-medium text-center">Cancel</Text>
            </TouchableOpacity>
            <Pressable
              onPress={handleSubmit}
              disabled={loading || success}
              className="flex-1 flex-row items-center justify-center gap-2 px-4 py-3.5 bg-[#8c76f0] rounded-xl"
              style={{ opacity: loading || success ? 0.5 : 1 }}
            >
              <Lock size={18} color="white" />
              <Text className="text-white text-base font-semibold">{loading ? 'Updating...' : 'Change Password'}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </MobileLayout>
  );
}
