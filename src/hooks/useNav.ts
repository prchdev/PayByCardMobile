import { useCallback } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/core';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type RouteName = keyof RootStackParamList;

const routeMap: Record<string, RouteName> = {
  '/': 'Home',
  '/mobile': 'Home',
  '/mobile/home': 'Home',
  '/mobile/login': 'Login',
  '/mobile/register': 'Register',
  '/mobile/verify-otp': 'VerifyOTP',
  '/mobile/forgot-password': 'ForgotPassword',
  '/mobile/dashboard': 'Dashboard',
  '/mobile/make-payment': 'MakePayment',
  '/mobile/my-transactions': 'MyTransactions',
  '/mobile/my-beneficiaries': 'MyBeneficiaries',
  '/mobile/my-bank-accounts': 'MyBankAccounts',
  '/mobile/kyc-verification': 'KYCVerification',
  '/mobile/help-support': 'HelpSupport',
  '/mobile/change-password': 'ChangePassword',
  '/mobile/more': 'More',
  '/mobile/notifications': 'Notifications',
};

export function useNav() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp<RootStackParamList, RouteName>>();

  const navigate = useCallback(
    (path: string, options?: { state?: Record<string, unknown> }) => {
      const routeName = routeMap[path];
      if (routeName) {
        (navigation.navigate as any)(routeName, options?.state);
      }
    },
    [navigation]
  );

  const goBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const replace = useCallback(
    (path: string, options?: { state?: Record<string, unknown> }) => {
      const routeName = routeMap[path];
      if (routeName) {
        (navigation.replace as any)(routeName, options?.state);
      }
    },
    [navigation]
  );

  const reset = useCallback(
    (path: string, options?: { state?: Record<string, unknown> }) => {
      const routeName = routeMap[path];
      if (routeName) {
        (navigation.reset as any)({
          index: 0,
          routes: [{ name: routeName, params: options?.state }],
        });
      }
    },
    [navigation]
  );

  return { navigate, goBack, replace, reset, route };
}
