import { getItem, setItem, removeItem } from './secureStorage';

const CREDENTIAL_KEY = 'pbc_biometric_enrolled';

export async function isBiometricSupported(): Promise<boolean> {
  return false;
}

export async function registerBiometric(_email: string): Promise<boolean> {
  return false;
}

export async function authenticateBiometric(): Promise<boolean> {
  return false;
}

export async function clearBiometricCredential(): Promise<void> {
  await removeItem(CREDENTIAL_KEY);
}

export async function hasBiometricCredential(): Promise<boolean> {
  return (await getItem(CREDENTIAL_KEY)) !== null;
}
