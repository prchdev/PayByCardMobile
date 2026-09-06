import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

export async function registerPushToken(userId: string): Promise<void> {
  if (!userId) return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
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
  if (!userId || !pushToken) return;

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
