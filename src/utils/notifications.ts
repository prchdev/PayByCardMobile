import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';

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
