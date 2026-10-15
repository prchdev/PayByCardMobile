import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { buildAuthHeaders, checkSessionExpired } from './api';
import { requestNotificationPermission } from './notifications';

const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || '7bdf2f35-5688-4c1a-bfb0-4c624da0654a';

export async function registerPushToken(userId: string): Promise<void> {
  if (!userId) return;

  // Web platform doesn't support Expo push notifications
  if (Platform.OS === 'web') return;

  try {
    // Request notification permissions before trying to get a token
    const granted = await requestNotificationPermission();
    if (!granted) {
      console.warn('Push notification permission not granted');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    });

    if (token) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/register-push-token`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({
          userId,
          push_token: token,
          platform: Platform.OS,
          appVersion: null,
        }),
      });
      await checkSessionExpired(res);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.warn('Push token registration failed:', errData?.error || res.status);
      }
    }
  } catch (e) {
    console.warn('Failed to register push token:', e);
  }
}

export async function unregisterPushToken(userId: string, pushToken: string): Promise<void> {
  if (!userId || !pushToken) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/register-push-token`, {
      method: 'POST',
      headers: await buildAuthHeaders(),
      body: JSON.stringify({ userId, push_token: pushToken, action: 'unregister' }),
    });
    await checkSessionExpired(res);
  } catch {
    /* no-op */
  }
}
