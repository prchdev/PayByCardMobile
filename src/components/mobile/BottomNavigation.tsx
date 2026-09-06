import { View, TouchableOpacity, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Hop as Home, CreditCard, Clock, Users, MoveHorizontal as MoreHorizontal } from 'lucide-react-native';
import type { RootStackParamList } from '../../types/navigation';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/core';
import { selection } from '../../utils/haptics';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

interface BottomNavProps {
  userId?: string;
  userEmail?: string;
}

export default function BottomNavigation({ userId, userEmail }: BottomNavProps) {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp<RootStackParamList, keyof RootStackParamList>>();

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
    (navigation.navigate as any)(routeName, { userId, userEmail });
  };

  return (
    <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
      <View className="flex-row items-center justify-around h-16 px-1">
        {items.map((item) => {
          const active = isActive(item.route);
          return (
            <TouchableOpacity
              key={item.route}
              onPress={() => handleNav(item.route)}
              className="flex-1 items-center justify-center h-full"
              activeOpacity={0.7}
            >
              <item.icon
                size={20}
                color={active ? '#8c76f0' : '#6b7280'}
                strokeWidth={active ? 2.5 : 2}
              />
              <Text
                className={`text-[10px] mt-0.5 ${active ? 'font-bold text-[#8c76f0]' : 'text-gray-500'}`}
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
