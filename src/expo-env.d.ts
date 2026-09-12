/// <reference types="node" />
/// <reference types="expo/__generated__/ExpoStatic" />

declare module 'expo-local-authentication';
declare module 'expo-secure-store';
declare module 'expo-haptics';
declare module 'expo-notifications';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      EXPO_PUBLIC_SUPABASE_URL: string;
      EXPO_PUBLIC_SUPABASE_ANON_KEY: string;
      EXPO_PUBLIC_EXPO_PROJECT_ID: string;
    }
  }
}

export {};
