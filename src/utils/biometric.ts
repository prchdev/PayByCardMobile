import * as LocalAuth from 'expo-local-authentication';
import { getItem, setItem, removeItem } from './secureStorage';

const CREDENTIAL_KEY = 'pbc_biometric_enrolled';

export async function isBiometricSupported(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuth.hasHardwareAsync();
    const isEnrolled = await LocalAuth.isEnrolledAsync();
    return hasHardware && isEnrolled;
  } catch {
    return false;
  }
}

export async function registerBiometric(_email: string): Promise<boolean> {
  try {
    const result = await LocalAuth.authenticateAsync({
      promptMessage: 'Enable Biometric Unlock',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
    });
    if (result.success) {
      await setItem(CREDENTIAL_KEY, 'true');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(): Promise<boolean> {
  try {
    const result = await LocalAuth.authenticateAsync({
      promptMessage: 'Unlock PayByCard',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
    });
    return result.success;
  } catch {
    return false;
  }
}

export async function clearBiometricCredential(): Promise<void> {
  await removeItem(CREDENTIAL_KEY);
}

export async function hasBiometricCredential(): Promise<boolean> {
  return (await getItem(CREDENTIAL_KEY)) !== null;
}
