import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable } from 'react-native';
import { Lock, Eye, EyeOff, CircleAlert as AlertCircle, CircleCheck as CheckCircle } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../../utils/passwordValidation';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

export default function MobileChangePassword() {
  const { navigate, route } = useNav();
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

  const handleLogout = () => { logout(); navigate('/mobile/login'); };

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
      <View className="px-4 py-3 max-w-sm self-center w-full">
        <Text className="text-lg font-bold text-gray-900 mb-3">Change Password</Text>

        {error ? (
          <View className="mb-3 bg-red-50 border border-red-300 rounded-xl p-2.5 flex-row items-start gap-2">
            <AlertCircle size={16} color="#dc2626" />
            <View>
              <Text className="text-sm font-semibold text-red-900">Error</Text>
              <Text className="text-xs text-red-800 mt-0.5">{error}</Text>
            </View>
          </View>
        ) : null}
        {success ? (
          <View className="mb-3 bg-green-50 border border-green-300 rounded-xl p-2.5 flex-row items-start gap-2">
            <CheckCircle size={16} color="#16a34a" />
            <View>
              <Text className="text-sm font-semibold text-green-900">Success</Text>
              <Text className="text-xs text-green-800 mt-0.5">Password changed successfully!</Text>
            </View>
          </View>
        ) : null}

        <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 gap-3">
          {([
            { key: 'currentPassword', label: 'Current Password', show: showCurrent, toggle: () => setShowCurrent(!showCurrent), placeholder: 'Enter current password' },
            { key: 'newPassword', label: 'New Password', show: showNew, toggle: () => setShowNew(!showNew), placeholder: 'Enter new password' },
            { key: 'confirmPassword', label: 'Confirm New Password', show: showConfirm, toggle: () => setShowConfirm(!showConfirm), placeholder: 'Re-enter new password' },
          ] as const).map(({ key, label, show, toggle, placeholder }) => (
            <View key={key}>
              <Text className="text-xs font-semibold text-gray-700 mb-1.5">{label}</Text>
              <View className="flex-row items-center">
                <TextInput
                  value={formData[key]}
                  onChangeText={(v) => setFormData({ ...formData, [key]: v })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm pr-10"
                  placeholder={placeholder}
                  secureTextEntry={!show}
                  autoCapitalize="none"
                  editable={!loading && !success}
                />
                <TouchableOpacity onPress={toggle} className="absolute right-3" activeOpacity={0.7}>
                  {show ? <EyeOff size={16} color="#9ca3af" /> : <Eye size={16} color="#9ca3af" />}
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
            <Text className="text-xs text-gray-600 mb-1.5 font-medium">Password must contain:</Text>
            {PASSWORD_REQUIREMENTS.map((req, idx) => (
              <View key={idx} className="flex-row items-center gap-1.5 mb-0.5">
                <View className="w-1 h-1 bg-[#8c76f0] rounded-full" />
                <Text className="text-xs text-gray-500">{req}</Text>
              </View>
            ))}
          </View>

          <View className="flex-row gap-3 pt-1">
            <TouchableOpacity
              onPress={() => navigate('/mobile/dashboard', { state: { userId, userEmail } })}
              disabled={loading || success}
              className="px-4 py-2 border border-gray-300 rounded-xl"
              activeOpacity={0.7}
            >
              <Text className="text-gray-700 text-sm font-medium">Cancel</Text>
            </TouchableOpacity>
            <Pressable
              onPress={handleSubmit}
              disabled={loading || success}
              className="flex-1 flex-row items-center justify-center gap-2 px-4 py-2 bg-[#8c76f0] rounded-xl"
              style={{ opacity: loading || success ? 0.5 : 1 }}
            >
              <Lock size={16} color="white" />
              <Text className="text-white text-sm font-semibold">{loading ? 'Updating...' : 'Change Password'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </MobileLayout>
  );
}
