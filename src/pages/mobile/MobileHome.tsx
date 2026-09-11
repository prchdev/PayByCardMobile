import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Shield, Landmark, Zap, BadgeIndianRupee, Building2, Lock, FingerprintPattern as Fingerprint, LogOut, CircleAlert as AlertCircle, Loader as Loader2 } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { authenticateBiometric, isBiometricSupported } from '../../utils/biometric';
import { impact, notification } from '../../utils/haptics';
import { useNav } from '../../hooks/useNav';

export default function MobileHome() {
  const { navigate } = useNav();
  const { isRemembered, rememberedEmail, biometricUnlock, clearRememberedSession, hasBiometric } = useAuth();
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    isBiometricSupported().then(setBiometricAvailable);
  }, []);

  const highlights = [
    { icon: BadgeIndianRupee, label: 'Lowest Fees' },
    { icon: Shield, label: 'No Hidden Charges' },
    { icon: Zap, label: 'Fast Settlement' },
    { icon: Building2, label: 'RBI Compliant' },
    { icon: Landmark, label: 'Registered Company' },
    { icon: Lock, label: '100% Secure' },
  ];

  const handleBiometricUnlock = async () => {
    setUnlocking(true);
    setUnlockError('');
    await impact('medium');

    try {
      const success = await authenticateBiometric();
      if (success) {
        await notification('success');
        const session = await biometricUnlock();
        if (session) {
          navigate('/mobile/dashboard', { state: { userId: session.userId, userEmail: session.email } });
        } else {
          navigate('/mobile/login');
        }
      } else {
        await notification('error');
        setUnlockError('Biometric authentication failed. Please try again or login manually.');
      }
    } catch {
      await notification('error');
      setUnlockError('Biometric authentication was cancelled or failed.');
    } finally {
      setUnlocking(false);
    }
  };

  const handleSwitchAccount = async () => {
    await impact('light');
    clearRememberedSession();
    navigate('/mobile/login');
  };

  const canUseBiometric = isRemembered && hasBiometric && biometricAvailable;

  return (
    <ScrollView className="flex-1 bg-white" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View className="px-4 py-6 items-center">
        <Image
          source={require('../../../public/PayByCard-Logo.png')}
          className="w-56 h-28 self-center"
          resizeMode="contain"
        />
        <Text className="text-2xl font-bold text-gray-900 text-center mt-3 leading-tight">
          Pay Bills with Your Credit Card
        </Text>
        <Text className="text-sm text-gray-600 text-center mt-2 max-w-sm self-center">
          Pay Your Bills Conveniently with Your Credit Card
        </Text>

        {isRemembered ? (
          <View className="mt-4 w-full max-w-sm">
            <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <View className="items-center gap-1">
                <View className="w-14 h-14 rounded-full items-center justify-center bg-[#8c76f0]">
                  <Fingerprint size={28} color="white" />
                </View>
                <Text className="text-sm font-semibold text-gray-900 mt-1">Welcome Back</Text>
                <Text className="text-xs text-gray-500">{rememberedEmail}</Text>
              </View>

              {unlockError ? (
                <View className="flex-row items-start bg-red-50 border border-red-300 rounded-xl p-3 mt-3">
                  <AlertCircle size={16} color="#dc2626" />
                  <Text className="text-xs text-red-800 ml-2 flex-1">{unlockError}</Text>
                </View>
              ) : null}

              {canUseBiometric ? (
                <TouchableOpacity
                  onPress={handleBiometricUnlock}
                  disabled={unlocking}
                  className="w-full bg-[#8c76f0] rounded-xl py-3.5 mt-3 flex-row items-center justify-center gap-2"
                  activeOpacity={0.8}
                >
                  {unlocking ? <Loader2 size={20} color="white" /> : <Fingerprint size={20} color="white" />}
                  <Text className="text-white font-semibold">
                    {unlocking ? 'Authenticating...' : 'Unlock with Biometric'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => navigate('/mobile/login')}
                  className="w-full bg-[#8c76f0] rounded-xl py-3.5 mt-3"
                  activeOpacity={0.8}
                >
                  <Text className="text-white font-semibold text-center">Login</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={handleSwitchAccount}
                className="w-full flex-row items-center justify-center gap-2 mt-2 py-2"
                activeOpacity={0.7} delayPressIn={0}
              >
                <LogOut size={16} color="#4b5563" />
                <Text className="text-xs text-gray-600 font-medium">Switch Account</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View className="mt-4 gap-2 w-full max-w-sm">
            <TouchableOpacity
              onPress={() => navigate('/mobile/register')}
              className="w-full bg-[#8c76f0] rounded-xl py-3.5"
              activeOpacity={0.8}
            >
              <Text className="text-white font-semibold text-center">Register</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigate('/mobile/login')}
              className="w-full border-2 border-[#8c76f0] rounded-xl py-3.5"
              activeOpacity={0.8}
            >
              <Text className="text-[#8c76f0] font-semibold text-center">Login</Text>
            </TouchableOpacity>
          </View>
        )}

        <View className="mt-4 w-full max-w-sm">
          <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
            <View className="flex-row flex-wrap gap-2">
              {highlights.map((h) => (
                <View
                  key={h.label}
                  className="flex-row items-center gap-2 bg-[#f3f0fe] rounded-xl px-2.5 py-2 border border-[#e0d5fb] mb-2"
                  style={{ width: '48%' }}
                >
                  <View className="w-7 h-7 bg-white rounded-lg items-center justify-center">
                    {(() => { const Icon = h.icon; return <Icon size={16} color="#8c76f0" />; })()}
                  </View>
                  <Text className="text-xs font-semibold text-gray-800 flex-1">{h.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View className="items-center mt-4">
          <Text className="text-xs text-gray-500 text-center">
            {'\u00A9'} 2026 PayByCard Technologies Pvt. Ltd. All rights reserved.
          </Text>
          <Text className="text-xs text-gray-500 text-center mt-1">
            CIN: U62099MH2025PTC462923
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
