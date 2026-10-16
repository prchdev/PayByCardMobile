import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import { getItem, setItem } from './secureStorage';

const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || '7bdf2f35-5688-4c1a-bfb0-4c624da0654a';
const PUSH_TOKEN_KEY = 'pbc_expo_push_token';

let cachedPushToken: string | null = null;

export function getCachedPushToken(): string | null {
  return cachedPushToken;
}

const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION';

let backgroundTaskRegistered = false;

export async function setupNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });

    await Notifications.setNotificationChannelAsync('campaigns', {
      name: 'Campaign Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3B82F6',
    });
  }

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data || {};
      const channelId = data.type === 'campaign' ? 'campaigns' : 'default';

      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        notificationChannel: channelId,
      };
    },
  });

  if (!backgroundTaskRegistered) {
    TaskManager.defineTask(
      BACKGROUND_NOTIFICATION_TASK,
      ({ data, error }) => {
        if (error) {
          console.warn('Background notification task error:', error);
        }
        return Promise.resolve();
      },
    );
    backgroundTaskRegistered = true;
  }

  await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
}

let notificationListener: Notifications.Subscription | null = null;
let responseListener: Notifications.Subscription | null = null;

export function registerNotificationListeners(
  onReceive?: (notification: Notifications.Notification) => void,
  onResponse?: (response: Notifications.NotificationResponse) => void,
) {
  if (notificationListener) notificationListener.remove();
  if (responseListener) responseListener.remove();

  if (onReceive) {
    notificationListener = Notifications.addNotificationReceivedListener(onReceive);
  }
  if (onResponse) {
    responseListener = Notifications.addNotificationResponseReceivedListener(onResponse);
  }
}

export function unregisterNotificationListeners() {
  if (notificationListener) { notificationListener.remove(); notificationListener = null; }
  if (responseListener) { responseListener.remove(); responseListener = null; }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return false;
  }

  if (Platform.OS === 'ios') {
    await Notifications.setNotificationCategoryAsync('default', []);
  }

  return true;
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    const granted = await requestNotificationPermission();
    if (!granted) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    });

    if (token) {
      cachedPushToken = token;
      await setItem(PUSH_TOKEN_KEY, token);
      return token;
    }
  } catch (e) {
    console.warn('Failed to get Expo push token:', e);
  }

  return null;
}

export async function getStoredPushToken(): Promise<string | null> {
  if (cachedPushToken) return cachedPushToken;
  const stored = await getItem(PUSH_TOKEN_KEY);
  if (stored) {
    cachedPushToken = stored;
    return stored;
  }
  return null;
}
