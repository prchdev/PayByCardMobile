import { View, Text, TouchableOpacity } from 'react-native';
import Constants from 'expo-constants';
import {
  ShieldCheck, Lock, MessageCircle, Landmark, CreditCard, Clock, Users,
  LogOut, ChevronRight, Bell,
} from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';

export default function MobileMore() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();

  const handleLogout = () => { logout(); reset('/mobile/login'); };
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const menuItems = [
    { icon: Bell, label: 'Notifications', path: '/mobile/notifications', color: 'bg-violet-50', iconColor: '#8c76f0' },
    { icon: ShieldCheck, label: 'My KYC Details', path: '/mobile/kyc-verification', color: 'bg-green-50', iconColor: '#16a34a' },
    { icon: Landmark, label: 'My Bank Accounts', path: '/mobile/my-bank-accounts', color: 'bg-blue-50', iconColor: '#2563eb' },
    { icon: Users, label: 'My Payee', path: '/mobile/my-beneficiaries', color: 'bg-purple-50', iconColor: '#8c76f0' },
    { icon: Clock, label: 'Transaction History', path: '/mobile/my-transactions', color: 'bg-amber-50', iconColor: '#d97706' },
    { icon: CreditCard, label: 'Make Payment', path: '/mobile/make-payment', color: 'bg-rose-50', iconColor: '#e11d48' },
    { icon: Lock, label: 'Change Password', path: '/mobile/change-password', color: 'bg-gray-100', iconColor: '#4b5563' },
    { icon: MessageCircle, label: 'Help & Support', path: '/mobile/help-support', color: 'bg-cyan-50', iconColor: '#0891b2' },
  ];

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-4 gap-4">
        <View>
          <Text className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Account</Text>
          <View className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            {menuItems.map((item, idx) => (
              <TouchableOpacity
                key={item.label}
                onPress={() => navigate(item.path, { state: { userId, userEmail } })}
                className={`flex-row items-center gap-3 p-4 ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                activeOpacity={0.7} delayPressIn={0}
              >
                <View className={`w-10 h-10 rounded-xl items-center justify-center ${item.color}`}>
                  <item.icon size={20} color={item.iconColor} />
                </View>
                <Text className="flex-1 text-base font-medium text-gray-900">{item.label}</Text>
                <ChevronRight size={18} color="#9ca3af" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          onPress={handleLogout}
          className="flex-row items-center justify-center gap-2 p-4 bg-white rounded-2xl border border-red-200"
          activeOpacity={0.7} delayPressIn={0}
        >
          <LogOut size={20} color="#dc2626" />
          <Text className="text-red-600 font-semibold text-base">Log Out</Text>
        </TouchableOpacity>

        <View className="items-center pb-2">
          <Text className="text-sm text-gray-400">PayByCard Mobile v{appVersion}</Text>
        </View>
      </View>
    </MobileLayout>
  );
}
