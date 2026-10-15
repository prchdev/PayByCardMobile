import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { buildAuthHeaders, checkSessionExpired } from './api';
import { requestNotificationPermission } from './notifications';

const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || '7bdf2f35-5688-4c1a-bfb0-4c624da0654a';

async function getFreshExpoToken(): Promise<string | null> {
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId: EXPO_PROJECT_ID,
  });
  return token ?? null;
}

async function sendTokenToServer(
  userId: string,
  token: string,
  action?: string,
): Promise<{ ok: boolean; data?: any }> {
  const body: Record<string, any> = { userId, push_token: token };
  if (action) body.action = action;
  if (!action) {
    body.platform = Platform.OS;
    body.appVersion = null;
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/register-push-token`, {
    method: 'POST',
    headers: await buildAuthHeaders(),
    body: JSON.stringify(body),
  });
  await checkSessionExpired(res);

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    console.warn('Push token server error:', errData?.error || res.status);
    return { ok: false };
  }

  const data = await res.json().catch(() => ({}));
  return { ok: true, data };
}

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

    // Get the current Expo push token from the device
    const token = await getFreshExpoToken();
    if (!token) return;

    // Check if this token is already registered and still valid
    const checkRes = await sendTokenToServer(userId, token, 'check');

    if (checkRes.ok && checkRes.data?.expired) {
      // Token is expired or inactive — get a fresh token and re-register
      // Deactivate old token first
      await sendTokenToServer(userId, token, 'unregister');

      // Unregister the device-level Expo push token to force a new one
      await Notifications.unregisterForNotificationsAsync().catch(() => {});

      // Get a brand-new token
      const newToken = await getFreshExpoToken();
      if (!newToken) return;

      // Register the fresh token with a new 6-month expiry
      await sendTokenToServer(userId, newToken);
    } else if (checkRes.ok && !checkRes.data?.expired) {
      // Token is still valid — nothing to do
      return;
    } else {
      // Check failed (server error or no existing record) — register fresh
      await sendTokenToServer(userId, token);
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
