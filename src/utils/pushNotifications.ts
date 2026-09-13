import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || '7bdf2f35-5688-4c1a-bfb0-4c624da0654a';

export async function registerPushToken(userId: string): Promise<void> {
  if (!userId) return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
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
          push_token: token,
          platform: Platform.OS,
          appVersion: null,
        }),
      });
    }
  } catch (e) {
    console.warn('Failed to register push token:', e);
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
      body: JSON.stringify({ userId, push_token: pushToken, action: 'unregister' }),
    });
  } catch {
    /* no-op */
  }
}
