import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { ShieldCheck, CircleAlert as AlertCircle, CircleCheck as CheckCircle, Clock, Circle as XCircle, Upload, ChevronLeft, FileText, Building2, MapPin, User } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

export default function MobileKYCVerification() {
  const { navigate } = useNav();
  const { route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [kycStatus, setKycStatus] = useState<string>('loading');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchKycStatus();
  }, [userId]);

  const fetchKycStatus = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setKycStatus(data.isVerified ? 'verified' : data.status || 'not_started');
      else setKycStatus('not_started');
    } catch { setKycStatus('not_started'); }
    finally { setLoading(false); }
  };

  const handleLogout = () => { logout(); navigate('/mobile/login'); };

  const statusConfig: Record<string, { icon: any; color: string; bg: string; title: string; message: string }> = {
    verified: { icon: CheckCircle, color: '#16a34a', bg: 'bg-green-50', title: 'KYC Verified', message: 'Your KYC is complete. You can now make payments.' },
    pending: { icon: Clock, color: '#d97706', bg: 'bg-amber-50', title: 'KYC Under Review', message: 'Your documents are being reviewed. This usually takes 1-2 business days.' },
    rejected: { icon: XCircle, color: '#dc2626', bg: 'bg-red-50', title: 'KYC Rejected', message: 'Your KYC was rejected. Please review and resubmit your documents.' },
    not_started: { icon: AlertCircle, color: '#d97706', bg: 'bg-yellow-50', title: 'Complete Your KYC', message: 'KYC verification is required to make payments. Please submit your documents.' },
    loading: { icon: Clock, color: '#6b7280', bg: 'bg-gray-100', title: 'Checking Status...', message: 'Please wait while we check your KYC status.' },
  };

  const cfg = statusConfig[kycStatus] || statusConfig.not_started;
  const Icon = cfg.icon;

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-3 gap-3">
        <Text className="text-lg font-bold text-gray-900">KYC Verification</Text>

        <View className={`${cfg.bg} rounded-xl p-4 flex-row items-start gap-3`}>
          <Icon size={24} color={cfg.color} />
          <View className="flex-1">
            <Text className="text-sm font-bold" style={{ color: cfg.color }}>{cfg.title}</Text>
            <Text className="text-xs text-gray-700 mt-1">{cfg.message}</Text>
          </View>
        </View>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading KYC details...</Text>
          </View>
        ) : kycStatus === 'not_started' || kycStatus === 'rejected' ? (
          <View className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 gap-3">
            <Text className="text-sm font-bold text-gray-900">Submit Your Documents</Text>
            <Text className="text-xs text-gray-600">
              To complete KYC, you'll need to provide your PAN card, address proof, and a photo. You can also use DigiLocker for automatic verification.
            </Text>
            <View className="gap-2">
              {[
                { icon: User, label: 'Personal Details', desc: 'Full name, date of birth, etc.' },
                { icon: FileText, label: 'PAN Card', desc: 'PAN number and photo' },
                { icon: MapPin, label: 'Address Proof', desc: 'Aadhaar, passport, or utility bill' },
                { icon: Building2, label: 'Business Details', desc: 'If applicable (optional)' },
              ].map((item, i) => (
                <View key={i} className="flex-row items-center gap-3 p-2.5 bg-gray-50 rounded-xl">
                  <View className="w-8 h-8 bg-white rounded-lg items-center justify-center">
                    <item.icon size={16} color="#8c76f0" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-gray-900">{item.label}</Text>
                    <Text className="text-xs text-gray-500">{item.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
            <TouchableOpacity
              onPress={() => Alert.alert('KYC', 'The full KYC form will be available in the next update. For now, please use the web version to complete KYC.')}
              className="w-full bg-[#8c76f0] rounded-xl py-3"
              activeOpacity={0.7}
            >
              <Text className="text-white font-semibold text-center">Start KYC Verification</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </MobileLayout>
  );
}
