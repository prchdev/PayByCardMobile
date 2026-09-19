import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'paybycard_device_id';

export async function getDeviceId(): Promise<string> {
  try {
    let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!id) {
      id = `DEV-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `DEV-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
