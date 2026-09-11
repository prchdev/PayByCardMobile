import { View, TouchableOpacity, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, CreditCard, Clock, Users, MoreHorizontal } from 'lucide-react-native';
import type { RootStackParamList } from '../../types/navigation';
import type { RouteProp } from '@react-navigation/core';
import { selection } from '../../utils/haptics';
import { useNav } from '../../hooks/useNav';

interface BottomNavProps {
  userId?: string;
  userEmail?: string;
}

const routePaths: Record<string, string> = {
  Dashboard: '/mobile/dashboard',
  MakePayment: '/mobile/make-payment',
  MyTransactions: '/mobile/my-transactions',
  MyBeneficiaries: '/mobile/my-beneficiaries',
  More: '/mobile/more',
};

export default function BottomNavigation({ userId, userEmail }: BottomNavProps) {
  const { navigate } = useNav();
  const route = useRoute<RouteProp<RootStackParamList, keyof RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const items = [
    { icon: Home, label: 'Home', route: 'Dashboard' as const },
    { icon: CreditCard, label: 'Pay', route: 'MakePayment' as const },
    { icon: Clock, label: 'History', route: 'MyTransactions' as const },
    { icon: Users, label: 'Payees', route: 'MyBeneficiaries' as const },
    { icon: MoreHorizontal, label: 'More', route: 'More' as const },
  ];

  const isActive = (routeName: string) => route.name === routeName;

  const handleNav = (routeName: string) => {
    selection();
    const path = routePaths[routeName];
    if (path) navigate(path, { state: { userId, userEmail } });
  };

  return (
    <View
      className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center justify-around h-[60px] px-1">
        {items.map((item) => {
          const active = isActive(item.route);
          return (
            <TouchableOpacity
              key={item.route}
              onPress={() => handleNav(item.route)}
              className="flex-1 items-center justify-center h-full"
              activeOpacity={0.7} delayPressIn={0}
            >
              {(() => { const Icon = item.icon; return <Icon size={24} color={active ? '#8c76f0' : '#374151'} strokeWidth={active ? 2.5 : 2} />; })()}
              <Text
                className={`text-[11px] mt-1 ${active ? 'font-bold text-[#8c76f0]' : 'font-semibold text-gray-700'}`}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
