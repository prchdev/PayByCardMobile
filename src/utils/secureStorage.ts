import { Platform } from 'react-native';

let SecureStore: typeof import('expo-secure-store') | null = null;
if (Platform.OS !== 'web') {
  SecureStore = require('expo-secure-store');
}

export async function getItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return await SecureStore!.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore!.setItemAsync(key, value);
  } catch {
    /* no-op */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore!.deleteItemAsync(key);
  } catch {
    /* no-op */
  }
}

export async function getSessionItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return sessionStorage.getItem(key);
    }
    return await SecureStore!.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setSessionItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      sessionStorage.setItem(key, value);
      return;
    }
    await SecureStore!.setItemAsync(key, value);
  } catch {
    /* no-op */
  }
}

export async function removeSessionItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      sessionStorage.removeItem(key);
      return;
    }
    await SecureStore!.deleteItemAsync(key);
  } catch {
    /* no-op */
  }
}
