import * as Haptics from 'expo-haptics';

export async function impact(style: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
  try {
    const styleMap = {
      light: Haptics.ImpactFeedbackStyle.Light,
      medium: Haptics.ImpactFeedbackStyle.Medium,
      heavy: Haptics.ImpactFeedbackStyle.Heavy,
    };
    await Haptics.impactAsync(styleMap[style]);
  } catch {
    /* no-op */
  }
}

export async function notification(type: 'success' | 'warning' | 'error' = 'success'): Promise<void> {
  try {
    const typeMap = {
      success: Haptics.NotificationFeedbackType.Success,
      warning: Haptics.NotificationFeedbackType.Warning,
      error: Haptics.NotificationFeedbackType.Error,
    };
    await Haptics.notificationAsync(typeMap[type]);
  } catch {
    /* no-op */
  }
}

export async function selection(): Promise<void> {
  try {
    await Haptics.selectionAsync();
  } catch {
    /* no-op */
  }
}
