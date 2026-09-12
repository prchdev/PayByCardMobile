/// <reference types="nativewind/types" />

import './src/native-styles.css';
import { useRef, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from './src/contexts/AuthContext';
import { setNativeNavigationRef } from './src/utils/navigation';
import { setupNotifications, requestNotificationPermission, registerNotificationListeners, unregisterNotificationListeners } from './src/utils/notifications';
import type { RootStackParamList } from './src/types/navigation';

import MobileHome from './src/pages/mobile/MobileHome';
import MobileLogin from './src/pages/mobile/MobileLogin';
import MobileRegister from './src/pages/mobile/MobileRegister';
import MobileVerifyOTP from './src/pages/mobile/MobileVerifyOTP';
import MobileForgotPassword from './src/pages/mobile/MobileForgotPassword';
import MobileDashboard from './src/pages/mobile/MobileDashboard';
import MobileMakePayment from './src/pages/mobile/MobileMakePayment';
import MobileMyTransactions from './src/pages/mobile/MobileMyTransactions';
import MobileMyBeneficiaries from './src/pages/mobile/MobileMyBeneficiaries';
import MobileMyBankAccounts from './src/pages/mobile/MobileMyBankAccounts';
import MobileKYCVerification from './src/pages/mobile/MobileKYCVerification';
import MobileHelpSupport from './src/pages/mobile/MobileHelpSupport';
import MobileChangePassword from './src/pages/mobile/MobileChangePassword';
import MobileMore from './src/pages/mobile/MobileMore';
import MobileNotifications from './src/pages/mobile/MobileNotifications';

export type { RootStackParamList };

const Stack = createNativeStackNavigator<RootStackParamList>();

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await setupNotifications();
        await requestNotificationPermission();
      } catch {}
      setAppReady(true);
    })();

    registerNotificationListeners(
      undefined,
      (response) => {
        const screen = response.notification.request.content.data?.screen;
        if (screen === 'notifications') {
          navRef.current?.navigate('Notifications' as any, undefined);
        }
      },
    );

    return () => unregisterNotificationListeners();
  }, []);

  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady]);

  if (!appReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NavigationContainer
          ref={navRef}
          onReady={() => {
            setNativeNavigationRef({
              navigate: (name: string, params?: Record<string, unknown>) => {
                (navRef.current?.navigate as any)(name, params);
              },
              goBack: () => navRef.current?.goBack(),
            });
          }}
        >
          <StatusBar style="dark" />
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Home" component={MobileHome} />
            <Stack.Screen name="Login" component={MobileLogin} />
            <Stack.Screen name="Register" component={MobileRegister} />
            <Stack.Screen name="VerifyOTP" component={MobileVerifyOTP} />
            <Stack.Screen name="ForgotPassword" component={MobileForgotPassword} />
            <Stack.Screen name="Dashboard" component={MobileDashboard} />
            <Stack.Screen name="MakePayment" component={MobileMakePayment} />
            <Stack.Screen name="MyTransactions" component={MobileMyTransactions} />
            <Stack.Screen name="MyBeneficiaries" component={MobileMyBeneficiaries} />
            <Stack.Screen name="MyBankAccounts" component={MobileMyBankAccounts} />
            <Stack.Screen name="KYCVerification" component={MobileKYCVerification} />
            <Stack.Screen name="HelpSupport" component={MobileHelpSupport} />
            <Stack.Screen name="ChangePassword" component={MobileChangePassword} />
            <Stack.Screen name="More" component={MobileMore} />
            <Stack.Screen name="Notifications" component={MobileNotifications} />
          </Stack.Navigator>
        </NavigationContainer>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
