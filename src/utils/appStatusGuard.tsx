import { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Platform, Linking, AppState } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

type AppStatus = {
  mobile_app_enabled: boolean;
  android_min_version: string;
  android_min_build: string;
  ios_min_version: string;
  ios_min_build: string;
};

type BlockReason = {
  type: 'maintenance' | 'update';
  message: string;
};

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=in.paybycard.app';
const APP_STORE_URL = 'https://apps.apple.com/app/paybycard/id';

function compareVersion(current: string, required: string): number {
  if (!required) return 0;
  const cur = current.split('.').map(Number);
  const req = required.split('.').map(Number);
  const len = Math.max(cur.length, req.length);
  for (let i = 0; i < len; i++) {
    const c = cur[i] || 0;
    const r = req[i] || 0;
    if (c < r) return -1;
    if (c > r) return 1;
  }
  return 0;
}

function compareBuild(current: string, required: string): boolean {
  if (!required) return false;
  const curNum = parseInt(current, 10) || 0;
  const reqNum = parseInt(required, 10) || 0;
  return curNum < reqNum;
}

function getAppVersion(): string {
  return Constants.expoConfig?.version || '1.0.0';
}

function getAppBuild(): string {
  if (Platform.OS === 'ios') {
    return Constants.expoConfig?.ios?.buildNumber || '1';
  }
  return String(Constants.expoConfig?.android?.versionCode || 1);
}

function checkVersion(status: AppStatus): BlockReason | null {
  if (!status.mobile_app_enabled) {
    return {
      type: 'maintenance',
      message: 'PayByCard Mobile Application is under maintenance. Please use the website for transactions.',
    };
  }

  const currentVersion = getAppVersion();
  const currentBuild = getAppBuild();

  if (Platform.OS === 'android') {
    if (status.android_min_version && compareVersion(currentVersion, status.android_min_version) < 0) {
      return {
        type: 'update',
        message: 'You need to update the application to the latest version to use it.',
      };
    }
    if (status.android_min_build && compareBuild(currentBuild, status.android_min_build)) {
      return {
        type: 'update',
        message: 'You need to update the application to the latest version to use it.',
      };
    }
  }

  if (Platform.OS === 'ios') {
    if (status.ios_min_version && compareVersion(currentVersion, status.ios_min_version) < 0) {
      return {
        type: 'update',
        message: 'You need to update the application to the latest version to use it.',
      };
    }
    if (status.ios_min_build && compareBuild(currentBuild, status.ios_min_build)) {
      return {
        type: 'update',
        message: 'You need to update the application to the latest version to use it.',
      };
    }
  }

  return null;
}

export function useAppStatusGuard() {
  const [blockReason, setBlockReason] = useState<BlockReason | null>(null);
  const [checking, setChecking] = useState(true);
  const checkedRef = useRef(false);

  const checkStatus = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-app-status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) return;
      const data: AppStatus = await res.json();
      const reason = checkVersion(data);
      if (reason) {
        setBlockReason(reason);
        SplashScreen.hideAsync().catch(() => {});
      }
    } catch {
      // On error, allow app to proceed
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    checkStatus();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !blockReason) {
        checkStatus();
      }
    });
    return () => sub.remove();
  }, [blockReason]);

  return { blockReason, checking };
}

export function AppBlockModal({ blockReason, onOkay }: { blockReason: BlockReason; onOkay: () => void }) {
  const isUpdate = blockReason.type === 'update';

  const handleOkay = () => {
    if (isUpdate) {
      const url = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
      Linking.openURL(url).catch(() => {});
    }
    onOkay();
  };

  return (
    <Modal visible transparent animationType="fade" style={{ zIndex: 9999 }}>
      <View className="flex-1 bg-black/60 justify-center items-center p-6">
        <View className="bg-white rounded-2xl p-6 w-full max-w-sm gap-4">
          <Text className="text-lg font-bold text-gray-900 text-center">
            {isUpdate ? 'Update Required' : 'Under Maintenance'}
          </Text>
          <Text className="text-sm text-gray-600 text-center">{blockReason.message}</Text>
          <TouchableOpacity
            onPress={handleOkay}
            className="w-full bg-[#8c76f0] rounded-xl py-3.5"
            activeOpacity={0.7}
            delayPressIn={0}
          >
            <Text className="text-white font-semibold text-center text-base">Okay</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
