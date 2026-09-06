import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

let Notifications: typeof import('expo-notifications') | null = null;
if (Platform.OS !== 'web') {
  Notifications = require('expo-notifications');
}

export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !userId) return;

  try {
    const { data: token } = await Notifications!.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_EXPO_PROJECT_ID,
    });

    if (token) {
      await fetch(`${SUPABASE_URL}/functions/v1/register-push-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          pushToken: token,
          platform: Platform.OS,
          appVersion: null,
        }),
      });
    }
  } catch {
    /* no-op */
  }
}

export async function unregisterPushToken(userId: string, pushToken: string): Promise<void> {
  if (Platform.OS === 'web' || !userId || !pushToken) return;

  try {
    await fetch(`${SUPABASE_URL}/functions/v1/register-push-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, pushToken, action: 'unregister' }),
    });
  } catch {
    /* no-op */
  }
}
