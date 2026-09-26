import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Clock, CircleCheck as CheckCircle, Circle as XCircle, RefreshCw, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Factory as History } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { buildAuthHeaders, checkSessionExpired } from '../../utils/api';

interface Transaction {
  id: string; payment_reference: string; amount: string; total_amount: string;
  status: string; display_status: string; card_type: string | null;
  created_at: string; beneficiary_details: any; selected_payment_option: any;
}

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  completed: { label: 'Completed', color: '#15803d', dot: '#22c55e' },
  failed: { label: 'Failed', color: '#dc2626', dot: '#ef4444' },
  cancelled: { label: 'Failed', color: '#dc2626', dot: '#ef4444' },
  processing: { label: 'Processing', color: '#2563eb', dot: '#3b82f6' },
  pending: { label: 'Processing', color: '#2563eb', dot: '#3b82f6' },
  kyc_pending: { label: 'KYC Required', color: '#d97706', dot: '#f59e0b' },
  settlement_pending: { label: 'Settlement', color: '#2563eb', dot: '#60a5fa' },
  settlement_in_progress: { label: 'Settlement', color: '#2563eb', dot: '#60a5fa' },
  refunded: { label: 'Refunded', color: '#ea580c', dot: '#fb923c' },
  refund_pending: { label: 'Refund Pending', color: '#e11d48', dot: '#f43f5e' },
};

function fmtAmt(v: string | number) {
  return parseFloat(String(v || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

export default function MobileMyTransactions() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchTransactions();
  }, [userId]);

  const fetchTransactions = async (statusFilter?: string) => {
    const effectiveFilter = statusFilter !== undefined ? statusFilter : filter;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-transactions`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ userId, page: 1, limit: 50, status: effectiveFilter }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (res.ok) setTransactions(data.payments || []);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = () => { setRefreshing(true); fetchTransactions(); };

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const filters = [
    { label: 'All', value: 'all' },
    { label: 'Completed', value: 'completed' },
    { label: 'Processing', value: 'processing' },
    { label: 'Settlement', value: 'settlement_pending' },
    { label: 'Failed', value: 'failed' },
    { label: 'Refunded', value: 'refunded' },
  ];

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-3 gap-3">
        <Text className="text-lg font-bold text-gray-900">Transaction History</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
          <View className="flex-row gap-2">
            {filters.map(f => (
              <TouchableOpacity
                key={f.value}
                onPress={() => { setFilter(f.value); setLoading(true); fetchTransactions(f.value); }}
                className={`px-3 py-1.5 rounded-full ${filter === f.value ? 'bg-[#8c76f0]' : 'bg-gray-100'}`}
                activeOpacity={0.7} delayPressIn={0}
              >
                <Text className={`text-xs font-semibold ${filter === f.value ? 'text-white' : 'text-gray-600'}`}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading transactions...</Text>
          </View>
        ) : transactions.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-3">
              <History size={32} color="#d1d5db" />
            </View>
            <Text className="text-sm font-semibold text-gray-700">No transactions found</Text>
            <TouchableOpacity onPress={() => navigate('/mobile/make-payment', { state: { userId, userEmail } })} activeOpacity={0.7} delayPressIn={0}>
              <View className="mt-3 px-4 py-2 bg-[#8c76f0] rounded-lg">
                <Text className="text-white text-sm font-semibold">Make Payment</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <View className="gap-2 pb-4">
              {transactions.map((txn) => {
                const ds = txn.display_status || txn.status;
                const cfg = STATUS_CFG[ds] || STATUS_CFG.processing;
                const isExpanded = expandedId === txn.id;
                return (
                  <TouchableOpacity
                    key={txn.id}
                    onPress={() => setExpandedId(isExpanded ? null : txn.id)}
                    className="bg-white rounded-xl border border-gray-200 p-3"
                    activeOpacity={0.9}
                  >
                    <View className="flex-row items-center gap-3">
                      <View className={`w-8 h-8 rounded-lg items-center justify-center ${
                        ds === 'completed' ? 'bg-green-50' : ds === 'failed' || ds === 'cancelled' ? 'bg-red-50' :
                        ds === 'kyc_pending' || ds === 'refund_pending' ? 'bg-amber-50' : 'bg-blue-50'}`}>
                        <View className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.dot }} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                          {txn.beneficiary_details?.full_name || 'Unknown'}
                        </Text>
                        <Text className="text-[10px] text-blue-600">{txn.payment_reference}</Text>
                      </View>
                      <View>
                        <Text className="text-sm font-bold text-gray-900">{`\u20B9${fmtAmt(txn.total_amount)}`}</Text>
                        <Text className="text-[10px] text-right" style={{ color: cfg.color }}>{cfg.label}</Text>
                      </View>
                      {isExpanded ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
                    </View>
                    {isExpanded && (
                      <View className="mt-3 pt-3 border-t border-gray-100 gap-1.5">
                        <View className="flex-row justify-between">
                          <Text className="text-xs text-gray-500">Amount</Text>
                          <Text className="text-xs font-medium text-gray-900">{`\u20B9${fmtAmt(txn.amount)}`}</Text>
                        </View>
                        <View className="flex-row justify-between">
                          <Text className="text-xs text-gray-500">Date</Text>
                          <Text className="text-xs font-medium text-gray-900">{fmtDate(txn.created_at)}</Text>
                        </View>
                        {(txn.selected_payment_option?.category_name || txn.card_type) && (
                          <View className="flex-row justify-between">
                            <Text className="text-xs text-gray-500">Payment Option</Text>
                            <Text className="text-xs font-medium text-gray-900" numberOfLines={1}>
                              {txn.selected_payment_option?.category_name || txn.card_type}
                            </Text>
                          </View>
                        )}
                        {txn.beneficiary_details && (
                          <View className="flex-row justify-between">
                            <Text className="text-xs text-gray-500">Account</Text>
                            <Text className="text-xs font-medium text-gray-900" numberOfLines={1}>
                              {txn.beneficiary_details.bank_account || 'N/A'}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>
    </MobileLayout>
  );
}
