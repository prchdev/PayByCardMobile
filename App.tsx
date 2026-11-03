/// <reference types="nativewind/types" />

import './src/native-styles.css';
import { useRef, useEffect, useState } from 'react';
import { Platform, BackHandler, View, Text, TouchableOpacity, Modal } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from './src/contexts/AuthContext';
import { setNativeNavigationRef } from './src/utils/navigation';
import { setupNotifications, requestNotificationPermission, registerForPushNotifications, registerNotificationListeners, unregisterNotificationListeners } from './src/utils/notifications';
import { useAppStatusGuard, AppBlockModal } from './src/utils/appStatusGuard';
import { checkDeviceSecurity } from './src/utils/rootDetection';
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
import MobileMyCards from './src/pages/mobile/MobileMyCards';
import MobileMore from './src/pages/mobile/MobileMore';
import MobileNotifications from './src/pages/mobile/MobileNotifications';

export type { RootStackParamList };

const Stack = createNativeStackNavigator<RootStackParamList>();

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const [appReady, setAppReady] = useState(false);
  const [securityWarning, setSecurityWarning] = useState<string | null>(null);
  const { blockReason, checking, retry } = useAppStatusGuard();

  useEffect(() => {
    (async () => {
      const secState = await checkDeviceSecurity();
      if (secState.message) setSecurityWarning(secState.message);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await setupNotifications();
        const granted = await requestNotificationPermission();
        if (granted) {
          await registerForPushNotifications();
        }
      } catch {}
      setAppReady(true);
    })();

    registerNotificationListeners(
      (notification) => {
        const title = notification.request.content.title || 'Notification';
        const body = notification.request.content.body || '';
        if (Platform.OS === 'web') return;
        if (Platform.OS === 'android') {
          Notifications.scheduleNotificationAsync({
            content: {
              title,
              body,
              data: notification.request.content.data,
              sound: 'default',
              priority: Notifications.AndroidNotificationPriority.HIGH,
            },
            trigger: null,
          });
        }
      },
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
    if (appReady && !checking) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady, checking]);

  if (!appReady || checking) {
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
            <Stack.Screen name="MyCards" component={MobileMyCards} />
            <Stack.Screen name="More" component={MobileMore} />
            <Stack.Screen name="Notifications" component={MobileNotifications} />
          </Stack.Navigator>
        </NavigationContainer>
      </AuthProvider>
      {securityWarning && (
        <Modal visible transparent animationType="fade" style={{ zIndex: 9998 }}>
          <View className="flex-1 bg-black/60 justify-center items-center p-6">
            <View className="bg-white rounded-2xl p-6 w-full max-w-sm gap-4">
              <Text className="text-lg font-bold text-gray-900 text-center">Security Warning</Text>
              <Text className="text-sm text-gray-600 text-center">{securityWarning}</Text>
              <TouchableOpacity
                onPress={() => {
                  if (Platform.OS !== 'web') {
                    BackHandler.exitApp();
                  }
                }}
                className="w-full bg-[#8c76f0] rounded-xl py-3.5"
                activeOpacity={0.7}
                delayPressIn={0}
              >
                <Text className="text-white font-semibold text-center text-base">Exit App</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      {blockReason && (
        <AppBlockModal blockReason={blockReason} onOkay={() => {
          if (Platform.OS !== 'web') {
            BackHandler.exitApp();
          }
        }} onRetry={retry} />
      )}
    </GestureHandlerRootView>
  );
}
