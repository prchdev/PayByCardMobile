import { View, ScrollView } from 'react-native';
import MobileHeader from './MobileHeader';
import BottomNavigation from './BottomNavigation';
import { useNav } from '../../hooks/useNav';
import { impact } from '../../utils/haptics';

interface MobileLayoutProps {
  children: React.ReactNode;
  userId?: string;
  userEmail?: string;
  onLogout?: () => void;
  showBack?: boolean;
  title?: string;
  showBottomNav?: boolean;
  scroll?: boolean;
}

export default function MobileLayout({
  children,
  userId,
  userEmail,
  onLogout,
  showBack,
  title,
  showBottomNav = true,
  scroll = true,
}: MobileLayoutProps) {
  const { navigate } = useNav();

  return (
    <View className="flex-1 bg-gray-50">
      <MobileHeader
        userEmail={userEmail}
        userId={userId}
        onLogout={onLogout}
        showBack={showBack}
        title={title}
      />

      {scroll ? (
        <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1, paddingBottom: showBottomNav ? 80 : 0 }}>
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1">{children}</View>
      )}

      {showBottomNav && <BottomNavigation userId={userId} userEmail={userEmail} />}
    </View>
  );
}
