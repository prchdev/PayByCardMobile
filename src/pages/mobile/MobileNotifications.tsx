import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Image, Linking } from 'react-native';
import { Bell, CircleCheck as CheckCircle, Circle as XCircle, Clock, Users, CreditCard, RefreshCw, CircleAlert as AlertCircle, Megaphone, ArrowLeft, Trash2, CheckCheck, X, Gift } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { impact, selection } from '../../utils/haptics';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface AppNotification {
  id: string; user_id: string; type: string; title: string;
  body: string | null; data: any; is_read: boolean;
  campaign_id: string | null; created_at: string;
  image_url: string | null; notification_format: string;
}

interface ActiveCampaign {
  id: string; title: string; message: string;
  image_url: string | null; action_url: string | null;
  action_label: string | null; target_audience: string;
  notification_format: string; action_type: string | null;
}

const NOTIF_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  kyc_submitted: { icon: Clock, color: '#2563eb', bg: 'bg-blue-50' },
  kyc_approved: { icon: CheckCircle, color: '#16a34a', bg: 'bg-green-50' },
  kyc_rejected: { icon: XCircle, color: '#dc2626', bg: 'bg-red-50' },
  account_active: { icon: CheckCircle, color: '#059669', bg: 'bg-emerald-50' },
  beneficiary_added: { icon: Users, color: '#9333ea', bg: 'bg-purple-50' },
  payment_captured: { icon: CreditCard, color: '#2563eb', bg: 'bg-blue-50' },
  merchant_kyc_pending: { icon: AlertCircle, color: '#d97706', bg: 'bg-amber-50' },
  merchant_kyc_completed: { icon: CheckCircle, color: '#16a34a', bg: 'bg-green-50' },
  settlement_completed: { icon: CheckCircle, color: '#16a34a', bg: 'bg-green-50' },
  refund_initiated: { icon: RefreshCw, color: '#ea580c', bg: 'bg-orange-50' },
  payment_failed: { icon: XCircle, color: '#dc2626', bg: 'bg-red-50' },
  campaign: { icon: Megaphone, color: '#8c76f0', bg: 'bg-[#f3f0fe]' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

export default function MobileNotifications() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [campaigns, setCampaigns] = useState<ActiveCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-notifications`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unread_count || 0);
        setCampaigns(data.active_campaigns || []);
      }
    } catch {} finally { setLoading(false); }
  }, [userId]);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchNotifications();
  }, [userId, fetchNotifications]);

  const markAsRead = async (notifId: string) => {
    impact('light');
    setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/get-user-notifications`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'mark_read', notificationId: notifId }),
      });
    } catch {}
  };

  const markAllRead = async () => {
    selection();
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/get-user-notifications`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'mark_all_read' }),
      });
    } catch {}
  };

  const deleteNotification = async (notifId: string) => {
    impact('medium');
    setNotifications(prev => prev.filter(n => n.id !== notifId));
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/get-user-notifications`, {
        method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'delete', notificationId: notifId }),
      });
    } catch {}
  };

  const dismissCampaign = (campaignId: string) => {
    selection();
    setCampaigns(prev => prev.filter(c => c.id !== campaignId));
  };

  const clickCampaign = async (campaignId: string, actionUrl?: string | null, actionType?: string | null) => {
    impact('light');
    setCampaigns(prev => prev.filter(c => c.id !== campaignId));
    if (actionUrl) {
      if (actionType === 'external_url') {
        Linking.openURL(actionUrl);
      } else {
        navigate(actionUrl, { state: { userId, userEmail } });
      }
    }
  };

  const handleLogout = () => { logout(); reset('/mobile/login'); };
  const filteredNotifs = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications;

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-3 gap-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <TouchableOpacity onPress={() => navigate('/mobile/dashboard', { state: { userId, userEmail } })} className="p-1.5 -ml-1.5 rounded-lg" activeOpacity={0.7} delayPressIn={0}>
              <ArrowLeft size={20} color="#374151" />
            </TouchableOpacity>
            <View>
              <Text className="text-xl font-bold text-gray-900">Notifications</Text>
              {unreadCount > 0 && <Text className="text-xs text-[#8c76f0] font-medium">{unreadCount} unread</Text>}
            </View>
          </View>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllRead} className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f3f0fe]" activeOpacity={0.7} delayPressIn={0}>
              <CheckCheck size={14} color="#8c76f0" />
              <Text className="text-[#8c76f0] text-xs font-semibold">Mark all read</Text>
            </TouchableOpacity>
          )}
        </View>

        <View className="flex-row gap-2">
          {(['all', 'unread'] as const).map(f => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full ${filter === f ? 'bg-[#8c76f0]' : 'bg-gray-100'}`}
              activeOpacity={0.7} delayPressIn={0}
            >
              <Text className={`text-xs font-semibold ${filter === f ? 'text-white' : 'text-gray-600'}`}>
                {f === 'all' ? 'All' : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {campaigns.map((c) => (
          <View key={c.id} className="relative bg-[#f3f0fe] border border-[#8c76f0]/30 rounded-2xl overflow-hidden">
            <TouchableOpacity onPress={() => dismissCampaign(c.id)} className="absolute top-2 right-2 z-10 p-1 rounded-full bg-white/70" activeOpacity={0.7} delayPressIn={0}>
              <X size={14} color="#6b7280" />
            </TouchableOpacity>
            {c.image_url ? (
              <Image source={{ uri: c.image_url }} className="w-full h-32" resizeMode="cover" />
            ) : null}
            <View className="p-3.5 pr-8 flex-row items-start gap-2.5">
              <View className="w-10 h-10 rounded-xl bg-[#8c76f0] items-center justify-center">
                <Gift size={20} color="white" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-gray-900">{c.title}</Text>
                <Text className="text-xs text-gray-600 mt-0.5">{c.message}</Text>
                {c.action_label && (
                  <TouchableOpacity onPress={() => clickCampaign(c.id, c.action_url, c.action_type)} className="mt-2 px-3 py-1.5 bg-[#8c76f0] rounded-lg self-start" activeOpacity={0.7} delayPressIn={0}>
                    <Text className="text-white text-xs font-semibold">{c.action_label}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ))}

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading notifications...</Text>
          </View>
        ) : filteredNotifs.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Bell size={32} color="#d1d5db" />
            </View>
            <Text className="text-sm font-semibold text-gray-700">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </Text>
            <Text className="text-xs text-gray-400 mt-1">
              {filter === 'unread' ? "You're all caught up!" : 'Notifications will appear here.'}
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            {filteredNotifs.map((notif) => {
              const cfg = NOTIF_ICONS[notif.type] || NOTIF_ICONS.campaign;
              const Icon = cfg.icon;
              return (
                <TouchableOpacity
                  key={notif.id}
                  onPress={() => !notif.is_read && markAsRead(notif.id)}
                  className={`bg-white rounded-xl border overflow-hidden ${notif.is_read ? 'border-gray-200' : 'border-[#8c76f0]/30 bg-[#faf8ff]'}`}
                  activeOpacity={0.9}
                >
                  {notif.image_url ? (
                    <Image source={{ uri: notif.image_url }} className="w-full h-28" resizeMode="cover" />
                  ) : null}
                  <View className="p-3 flex-row items-start gap-3">
                    <View className={`w-9 h-9 rounded-xl items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                      <Icon size={16} color={cfg.color} />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="text-sm font-semibold text-gray-900 flex-1" numberOfLines={1}>{notif.title}</Text>
                        {!notif.is_read && <View className="w-2 h-2 rounded-full bg-[#8c76f0]" />}
                      </View>
                      {notif.body ? <Text className="text-xs text-gray-600 mt-0.5">{notif.body}</Text> : null}
                      <View className="flex-row items-center justify-between mt-1.5">
                        <Text className="text-[10px] text-gray-400">{timeAgo(notif.created_at)}</Text>
                        <TouchableOpacity onPress={() => deleteNotification(notif.id)} className="p-1 rounded-lg" activeOpacity={0.7} delayPressIn={0}>
                          <Trash2 size={14} color="#9ca3af" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    </MobileLayout>
  );
}
