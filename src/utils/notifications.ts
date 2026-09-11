import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function setupNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });

    // Additional channel for campaign notifications with images
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
        priority: Notifications.AndroidImportance.HIGH,
        notificationChannel: channelId,
      };
    },
  });
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
