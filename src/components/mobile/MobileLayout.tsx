import { View, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import MobileHeader from './MobileHeader';
import BottomNavigation from './BottomNavigation';
import { useNav } from '../../hooks/useNav';

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

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        {scroll ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: showBottomNav ? 90 : 0 }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={() => {}}>
              {children}
            </Pressable>
          </ScrollView>
        ) : (
          <View className="flex-1">{children}</View>
        )}
      </KeyboardAvoidingView>

      {showBottomNav && <BottomNavigation userId={userId} userEmail={userEmail} />}
    </View>
  );
}
