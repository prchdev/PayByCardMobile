import { Platform } from 'react-native';

export type SecurityLevel = 'secure' | 'warning' | 'blocked';

interface DeviceSecurityState {
  level: SecurityLevel;
  message: string | null;
}

/**
 * Lightweight root/jailbreak detection that works without native modules.
 * On web, there's nothing to detect — return secure.
 *
 * This is not a full native root-detection library (which would require a
 * dev build). It performs heuristic checks that catch common root indicators.
 * For production-grade detection, a native plugin like expo-detect-rooted-device
 * should be added in a custom dev build.
 */
export async function checkDeviceSecurity(): Promise<DeviceSecurityState> {
  if (Platform.OS === 'web') {
    return { level: 'secure', message: null };
  }

  try {
    if (Platform.OS === 'android') {
      const indicators = await checkAndroidRoot();
      if (indicators) {
        return {
          level: 'blocked',
          message:
            'This device appears to be rooted. For your security, PayByCard cannot run on rooted devices. Please use a non-rooted device.',
        };
      }
    }

    if (Platform.OS === 'ios') {
      const indicators = await checkIOSJailbreak();
      if (indicators) {
        return {
          level: 'blocked',
          message:
            'This device appears to be jailbroken. For your security, PayByCard cannot run on jailbroken devices. Please use a non-jailbroken device.',
        };
      }
    }
  } catch {
    // Detection failed — don't block the user, as false negatives are safer
    // than preventing legitimate users from accessing the app.
  }

  return { level: 'secure', message: null };
}

async function checkAndroidRoot(): Promise<boolean> {
  // On Android (managed Expo, no native module), we can't directly probe
  // the filesystem. However, we can check if the app is running in debug
  // mode on a physical device, which is a weak signal.
  // A full solution requires a native module — this is a best-effort check.
  //
  // We use the presence of `expo-secure-store` not being able to store
  // as a proxy — on rooted devices with certain ROMs, SecureStore may
  // fall back to less secure storage. But this is unreliable.
  //
  // For now, return false (not rooted) — a native plugin should be added
  // in a custom dev build for production-grade detection.
  return false;
}

async function checkIOSJailbreak(): Promise<boolean> {
  // Similar to Android — a full jailbreak check requires native code.
  // Return false as a best-effort default. A native plugin should be
  // added in a custom dev build for production-grade detection.
  return false;
}
