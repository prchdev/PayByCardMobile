import * as SecureStore from 'expo-secure-store';

export async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* no-op */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* no-op */
  }
}

export async function getSessionItem(key: string): Promise<string | null> {
  return await getItem(key);
}

export async function setSessionItem(key: string, value: string): Promise<void> {
  await setItem(key, value);
}

export async function removeSessionItem(key: string): Promise<void> {
  await removeItem(key);
}
