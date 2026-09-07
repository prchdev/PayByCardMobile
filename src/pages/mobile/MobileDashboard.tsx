import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { CircleCheck as CheckCircle, ArrowUpRight, Users, Clock, CircleAlert as AlertCircle, Circle as XCircle, RefreshCw, Factory as History, TrendingUp, Hourglass, Hash, Landmark, Bell, Info } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { impact } from '../../utils/haptics';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface RecentTxn {
  id: string; payment_reference: string; amount: string; total_amount: string;
  status: string; display_status: string; card_type: string | null; created_at: string;
  beneficiary_details: any; selected_payment_option: any;
}

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  completed: { label: 'Completed', color: '#15803d', dot: '#22c55e' },
  failed: { label: 'Failed', color: '#dc2626', dot: '#ef4444' },
  cancelled: { label: 'Failed', color: '#6b7280', dot: '#9ca3af' },
  processing: { label: 'Processing', color: '#2563eb', dot: '#3b82f6' },
  pending: { label: 'Processing', color: '#2563eb', dot: '#3b82f6' },
  kyc_pending: { label: 'KYC Required', color: '#d97706', dot: '#f59e0b' },
  merchant_kyc_review: { label: 'Merchant KYC', color: '#d97706', dot: '#f59e0b' },
  settlement_pending: { label: 'Settlement', color: '#2563eb', dot: '#60a5fa' },
  settlement_in_progress: { label: 'Settlement', color: '#2563eb', dot: '#60a5fa' },
  refunded: { label: 'Refunded', color: '#ea580c', dot: '#fb923c' },
  refund_pending: { label: 'Refund Pending', color: '#e11d48', dot: '#f43f5e' },
};

function fmtAmt(v: string | number) {
  return parseFloat(String(v || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MobileDashboard() {
  const { navigate, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [kycStatus, setKycStatus] = useState<{ isVerified: boolean; status: string } | null>(null);
  const [isCheckingKyc, setIsCheckingKyc] = useState(true);
  const [recentTxns, setRecentTxns] = useState<RecentTxn[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);
  const [stats, setStats] = useState<{ amount_processed: number; amount_in_settlement: number; total_transactions: number } | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [dashboardNotifs, setDashboardNotifs] = useState<{ id: string; title: string; message: string; notification_type: string }[]>([]);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    checkKycStatus(); fetchRecentTransactions(); fetchStats(); fetchUnreadNotifs(); fetchDashboardNotifs();
  }, [userId]);

  const fetchUnreadNotifs = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-notifications`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setUnreadNotifs(data.unread_count || 0);
    } catch {}
  };

  const checkKycStatus = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const result = await res.json();
      if (res.ok) setKycStatus(result);
    } catch {} finally { setIsCheckingKyc(false); }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-stats`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setStats(data);
    } catch {}
  };

  const fetchRecentTransactions = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-transactions`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, page: 1, limit: 5, status: 'all' }),
      });
      const data = await res.json();
      if (res.ok) setRecentTxns(data.payments || []);
    } catch {} finally { setLoadingTxns(false); }
  };

  const fetchDashboardNotifs = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dashboard-notifications?action=active`, {
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      const data = await res.json();
      if (res.ok) setDashboardNotifs(data.notifications || []);
    } catch {}
  };

  const handleLogout = () => { impact('medium'); logout(); navigate('/mobile/login'); };
  if (!userId) return null;

  const quickActions = [
    { icon: Users, label: 'Add Payee', path: '/mobile/my-beneficiaries' },
    { icon: ArrowUpRight, label: 'Make Payment', path: '/mobile/make-payment' },
    { icon: Landmark, label: 'My Bank Account', path: '/mobile/my-bank-accounts' },
    { icon: History, label: 'Payment History', path: '/mobile/my-transactions' },
  ];

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-3 gap-3">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold text-gray-900">Welcome back!</Text>
            <Text className="text-base text-gray-500 mt-1">Here's your account overview</Text>
          </View>
          <TouchableOpacity
            onPress={() => { impact('light'); navigate('/mobile/notifications', { state: { userId, userEmail } }); }}
            className="relative p-2 rounded-xl bg-white border border-gray-200"
            activeOpacity={0.7}
          >
            <Bell size={24} color="#374151" />
            {unreadNotifs > 0 && (
              <View className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 items-center justify-center">
                <Text className="text-white text-xs font-bold">{unreadNotifs > 9 ? '9+' : String(unreadNotifs)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {!isCheckingKyc && kycStatus && (
          <>
            {kycStatus.isVerified ? (
              <View className="bg-green-50 border border-green-400 rounded-xl p-3 flex-row items-start gap-2.5">
                <CheckCircle size={20} color="#16a34a" />
                <View>
                  <Text className="text-base font-semibold text-green-900">Account Verified</Text>
                  <Text className="text-sm text-green-700 mt-1">KYC complete. All features unlocked.</Text>
                </View>
              </View>
            ) : kycStatus.status === 'pending' ? (
              <View className="bg-blue-50 border border-blue-400 rounded-xl p-3 flex-row items-start gap-2.5">
                <Clock size={20} color="#2563eb" />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-blue-900">KYC Under Review</Text>
                  <Text className="text-sm text-blue-700 mt-1">Your documents are being reviewed.</Text>
                  <TouchableOpacity onPress={() => navigate('/mobile/kyc-verification', { state: { userId, userEmail } })} activeOpacity={0.7}>
                    <Text className="mt-1.5 text-sm font-semibold text-blue-700 underline">View Status</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : kycStatus.status === 'rejected' ? (
              <View className="bg-red-50 border border-red-400 rounded-xl p-3 flex-row items-start gap-2.5">
                <AlertCircle size={20} color="#dc2626" />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-red-900">KYC Rejected</Text>
                  <Text className="text-sm text-red-700 mt-1">Please review and resubmit.</Text>
                  <TouchableOpacity onPress={() => navigate('/mobile/kyc-verification', { state: { userId, userEmail } })} activeOpacity={0.7}>
                    <Text className="mt-1.5 text-sm font-semibold text-red-700 underline">Review & Resubmit</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="bg-yellow-50 border border-yellow-400 rounded-xl p-3 flex-row items-start gap-2.5">
                <AlertCircle size={20} color="#ca8a04" />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-yellow-900">Complete KYC Verification</Text>
                  <Text className="text-sm text-yellow-700 mt-1">Required to access payment features.</Text>
                  <TouchableOpacity onPress={() => navigate('/mobile/kyc-verification', { state: { userId, userEmail } })} activeOpacity={0.7}>
                    <View className="mt-2 px-4 py-2 bg-yellow-600 rounded-lg">
                      <Text className="text-white text-sm font-medium">Complete KYC</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}

        {dashboardNotifs.length > 0 && (
          <View className="gap-2">
            {dashboardNotifs.map((n) => {
              const isWarning = n.notification_type === 'warning';
              const isError = n.notification_type === 'error';
              const Icon = isError ? XCircle : isWarning ? AlertCircle : Info;
              const iconColor = isError ? '#dc2626' : isWarning ? '#d97706' : '#2563eb';
              const bgClass = isError ? 'bg-red-50 border-red-300' : isWarning ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-300';
              const titleColor = isError ? '#991b1b' : isWarning ? '#78350f' : '#1e3a8a';
              const msgColor = isError ? '#b91c1c' : isWarning ? '#92400e' : '#1d4ed8';
              return (
                <View key={n.id} className={`${bgClass} border rounded-xl p-3 flex-row items-start gap-2.5`}>
                  <Icon size={20} color={iconColor} />
                  <View className="flex-1">
                    <Text className={`text-sm font-semibold`} style={{ color: titleColor }}>{n.title}</Text>
                    <Text className="text-xs mt-0.5" style={{ color: msgColor }}>{n.message}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View className="flex-row gap-2">
          {[
            { icon: TrendingUp, color: '#8c76f0', bg: 'bg-purple-50', value: stats ? `\u20B9${stats.amount_processed.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : null, label: 'Processed' },
            { icon: Hourglass, color: '#f59e0b', bg: 'bg-amber-50', value: stats ? `\u20B9${stats.amount_in_settlement.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : null, label: 'In Settlement' },
            { icon: Hash, color: '#3b82f6', bg: 'bg-blue-50', value: stats ? String(stats.total_transactions) : null, label: 'Transactions' },
          ].map((s, i) => (
            <View key={i} className="flex-1 bg-white rounded-xl border border-gray-200 p-2.5">
              <View className={`w-7 h-7 ${s.bg} rounded-lg items-center justify-center mb-1.5`}>
                <s.icon size={14} color={s.color} />
              </View>
              {s.value !== null ? (
                <Text className="text-lg font-bold text-gray-900">{s.value}</Text>
              ) : (
                <View className="h-5 w-16 bg-gray-100 rounded" />
              )}
              <Text className="text-xs text-gray-500 mt-0.5">{s.label}</Text>
            </View>
          ))}
        </View>

        <View>
          <Text className="text-base font-bold text-gray-900 mb-2">Quick Actions</Text>
          <View className="flex-row flex-wrap gap-2">
            {quickActions.map((a) => (
              <TouchableOpacity
                key={a.label}
                onPress={() => { impact('light'); navigate(a.path, { state: { userId, userEmail } }); }}
                className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-gray-200"
                style={{ width: '48%' }}
                activeOpacity={0.7}
              >
                <a.icon size={20} color="#374151" />
                <Text className="text-base font-medium text-gray-700">{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View>
          <View className="flex-row items-center justify-between mb-1.5">
            <Text className="text-sm font-bold text-gray-900">Recent Activity</Text>
            <TouchableOpacity onPress={() => navigate('/mobile/my-transactions', { state: { userId, userEmail } })} className="flex-row items-center gap-1" activeOpacity={0.7}>
              <History size={12} color="#2563eb" />
              <Text className="text-xs text-blue-600 font-medium">View All</Text>
            </TouchableOpacity>
          </View>

          {loadingTxns ? (
            <View className="bg-white rounded-xl border border-gray-200 p-4 items-center">
              <ActivityIndicator size="small" color="#8c76f0" />
              <Text className="text-sm text-gray-500 mt-1.5">Loading transactions...</Text>
            </View>
          ) : recentTxns.length === 0 ? (
            <View className="bg-white rounded-xl border border-gray-200 p-4 items-center">
              <Clock size={28} color="#d1d5db" />
              <Text className="text-base text-gray-700 font-medium mt-1.5">No transactions yet</Text>
              <TouchableOpacity onPress={() => navigate('/mobile/make-payment', { state: { userId, userEmail } })} activeOpacity={0.7}>
                <View className="mt-2 px-4 py-2 bg-[#8c76f0] rounded-lg">
                  <Text className="text-white text-sm font-medium">Make First Payment</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="bg-white rounded-xl border border-gray-200">
              {recentTxns.map((txn, idx) => {
                const ds = txn.display_status || txn.status;
                const cfg = STATUS_CFG[ds] || STATUS_CFG.processing;
                return (
                  <TouchableOpacity
                    key={txn.id}
                    onPress={() => navigate('/mobile/my-transactions', { state: { userId, userEmail } })}
                    className={`flex-row items-center gap-3 p-2.5 ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                    activeOpacity={0.7}
                  >
                    <View className={`w-8 h-8 rounded-lg items-center justify-center ${
                      ds === 'completed' ? 'bg-green-50' : ds === 'failed' || ds === 'cancelled' ? 'bg-red-50' :
                      ds === 'kyc_pending' || ds === 'refund_pending' ? 'bg-amber-50' : 'bg-blue-50'}`}>
                      <View className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.dot }} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
                        {txn.beneficiary_details?.full_name || 'Unknown'}
                      </Text>
                      <Text className="text-xs text-blue-600" numberOfLines={1}>{txn.payment_reference}</Text>
                    </View>
                    <View>
                      <Text className="text-base font-bold text-gray-900">{`\u20B9${fmtAmt(txn.total_amount)}`}</Text>
                      <Text className="text-xs font-medium text-right" style={{ color: cfg.color }}>{cfg.label}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </MobileLayout>
  );
}
