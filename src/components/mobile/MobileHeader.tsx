import { useEffect, useState } from 'react';
import { View, TouchableOpacity, Text, Image } from 'react-native';
import { LogOut, CircleCheck as CheckCircle, Clock, Circle as XCircle, CircleAlert as AlertCircle, ChevronLeft } from 'lucide-react-native';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface MobileHeaderProps {
  userEmail?: string;
  userId?: string;
  onLogout?: () => void;
  showBack?: boolean;
  title?: string;
}

export default function MobileHeader({ userEmail, userId, onLogout, showBack, title }: MobileHeaderProps) {
  const { navigate, goBack } = useNav();
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
            <CheckCircle size={12} color="#16a34a" />
            <Text className="text-green-700 text-[10px] font-bold ml-0.5">Verified</Text>
          </View>
        );
      case 'pending':
        return (
          <View className="flex-row items-center bg-amber-50 px-2 py-0.5 rounded-md">
            <Clock size={12} color="#d97706" />
            <Text className="text-amber-700 text-[10px] font-bold ml-0.5">Review</Text>
          </View>
        );
      case 'rejected':
        return (
          <View className="flex-row items-center bg-red-50 px-2 py-0.5 rounded-md">
            <XCircle size={12} color="#dc2626" />
            <Text className="text-red-700 text-[10px] font-bold ml-0.5">Rejected</Text>
          </View>
        );
      default:
        return (
          <View className="flex-row items-center bg-gray-100 px-2 py-0.5 rounded-md">
            <AlertCircle size={12} color="#6b7280" />
            <Text className="text-gray-600 text-[10px] font-bold ml-0.5">Pending</Text>
          </View>
        );
    }
  };

  return (
    <View className="bg-white border-b border-gray-200 shadow-sm pt-10 pb-2 px-4 z-50">
      <View className="flex-row items-center justify-between h-9">
        <View className="flex-row items-center gap-2">
          {showBack && (
            <TouchableOpacity onPress={goBack} className="p-1.5 -ml-1.5" activeOpacity={0.7}>
              <ChevronLeft size={20} color="#374151" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => navigate('/mobile/dashboard')} activeOpacity={0.8}>
            <Image
              source={require('../../../public/PayByCard.png')}
              className="w-36 h-9"
              resizeMode="contain"
            />
          </TouchableOpacity>
          {title && <Text className="text-base font-bold text-gray-900">{title}</Text>}
        </View>

        <View className="flex-row items-center gap-2">
          {userEmail && renderKycBadge()}
          {onLogout && (
            <TouchableOpacity onPress={onLogout} className="p-1.5" activeOpacity={0.7}>
              <LogOut size={16} color="#4b5563" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
