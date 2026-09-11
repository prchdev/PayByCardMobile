import { useEffect, useState } from 'react';
import { View, TouchableOpacity, Text, Image } from 'react-native';
import { LogOut, CircleCheck as CheckCircle, Clock, Circle as XCircle, CircleAlert as AlertCircle, ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface MobileHeaderProps {
  userEmail?: string;
  userId?: string;
  onLogout?: () => void;
  showBack?: boolean;
  onBack?: () => void;
  title?: string;
}

export default function MobileHeader({ userEmail, userId, onLogout, showBack, onBack, title }: MobileHeaderProps) {
  const { navigate, goBack } = useNav();
  const insets = useSafeAreaInsets();
  const [kycStatus, setKycStatus] = useState<string>('loading');

  useEffect(() => {
    if (userId) fetchKYCStatus();
  }, [userId]);

  const fetchKYCStatus = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      });
      const result = await res.json();
      if (res.ok) {
        setKycStatus(result.isVerified ? 'verified' : result.status);
      } else {
        setKycStatus('not_started');
      }
    } catch {
      setKycStatus('not_started');
    }
  };

  const renderKycBadge = () => {
    switch (kycStatus) {
      case 'verified':
        return (
          <View className="flex-row items-center bg-green-50 px-2 py-0.5 rounded-md">
            <CheckCircle size={14} color="#16a34a" />
            <Text className="text-green-700 text-xs font-bold ml-1">Verified</Text>
          </View>
        );
      case 'pending':
        return (
          <View className="flex-row items-center bg-amber-50 px-2 py-0.5 rounded-md">
            <Clock size={14} color="#d97706" />
            <Text className="text-amber-700 text-xs font-bold ml-1">Review</Text>
          </View>
        );
      case 'rejected':
        return (
          <View className="flex-row items-center bg-red-50 px-2 py-0.5 rounded-md">
            <XCircle size={14} color="#dc2626" />
            <Text className="text-red-700 text-xs font-bold ml-1">Rejected</Text>
          </View>
        );
      default:
        return (
          <View className="flex-row items-center bg-gray-100 px-2 py-0.5 rounded-md">
            <AlertCircle size={14} color="#6b7280" />
            <Text className="text-gray-600 text-xs font-bold ml-1">Pending</Text>
          </View>
        );
    }
  };

  return (
    <View className="bg-white border-b border-gray-200 shadow-sm px-4 pb-2.5 z-50" style={{ paddingTop: insets.top + 8 }}>
      <View className="flex-row items-center justify-between h-11">
        <View className="flex-row items-center gap-2">
          {showBack && (
            <TouchableOpacity onPress={onBack || goBack} className="p-2 -ml-2" activeOpacity={0.7} delayPressIn={0}>
              <ChevronLeft size={22} color="#374151" />
            </TouchableOpacity>
          )}
          <View>
            <Image
              source={require('../../../public/PayByCard.png')}
              className="w-52 h-14"
              resizeMode="contain"
            />
          </View>
          {title && <Text className="text-lg font-bold text-gray-900">{title}</Text>}
        </View>

        <View className="flex-row items-center gap-2">
          {userEmail && renderKycBadge()}
          {onLogout && (
            <TouchableOpacity onPress={onLogout} className="p-2" activeOpacity={0.7} delayPressIn={0}>
              <LogOut size={18} color="#4b5563" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
