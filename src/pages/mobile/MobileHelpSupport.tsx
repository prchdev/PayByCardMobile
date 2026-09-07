import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable } from 'react-native';
import { MessageCircle, Plus, ChevronRight, Clock, CircleCheck as CheckCircle, Circle as XCircle, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Send, X } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface Ticket {
  id: string; ticket_number: string; subject: string; status: string;
  priority: string; created_at: string; updated_at: string;
  last_reply_by?: string; user_replied?: boolean; admin_replied?: boolean;
}

const STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
  open: { color: '#2563eb', bg: 'bg-blue-50', label: 'Open' },
  in_progress: { color: '#d97706', bg: 'bg-amber-50', label: 'In Progress' },
  resolved: { color: '#16a34a', bg: 'bg-green-50', label: 'Resolved' },
  closed: { color: '#6b7280', bg: 'bg-gray-100', label: 'Closed' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MobileHelpSupport() {
  const { navigate, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchTickets();
  }, [userId]);

  const fetchTickets = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-support-tickets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setTickets(data.tickets || []);
    } catch {} finally { setLoading(false); }
  };

  const handleCreateTicket = async () => {
    if (!subject.trim()) { setError('Subject is required'); return; }
    if (!description.trim()) { setError('Description is required'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-support-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subject: subject.trim(), description: description.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create ticket');
      setShowCreate(false); setSubject(''); setDescription('');
      fetchTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally { setSubmitting(false); }
  };

  const handleLogout = () => { logout(); navigate('/mobile/login'); };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-3 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-gray-900">Help & Support</Text>
          <TouchableOpacity
            onPress={() => setShowCreate(true)}
            className="flex-row items-center gap-1.5 px-3 py-1.5 bg-[#8c76f0] rounded-lg"
            activeOpacity={0.7}
          >
            <Plus size={14} color="white" />
            <Text className="text-white text-xs font-semibold">New Ticket</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading tickets...</Text>
          </View>
        ) : tickets.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-3">
              <MessageCircle size={32} color="#d1d5db" />
            </View>
            <Text className="text-sm font-semibold text-gray-700">No support tickets yet</Text>
            <Text className="text-xs text-gray-400 mt-1">Create a ticket if you need help.</Text>
            <TouchableOpacity onPress={() => setShowCreate(true)} className="mt-3 px-4 py-2 bg-[#8c76f0] rounded-lg" activeOpacity={0.7}>
              <Text className="text-white text-sm font-semibold">Create Ticket</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            {tickets.map((t, idx) => {
              const cfg = STATUS_CFG[t.status] || STATUS_CFG.open;
              return (
                <View key={t.id} className={`p-3 ${idx > 0 ? 'border-t border-gray-100' : ''}`}>
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>{t.subject}</Text>
                      <Text className="text-[10px] text-gray-400 mt-0.5 font-mono">{t.ticket_number}</Text>
                    </View>
                    <View className={`px-2 py-0.5 rounded-md ${cfg.bg}`}>
                      <Text className="text-[10px] font-bold" style={{ color: cfg.color }}>{cfg.label}</Text>
                    </View>
                  </View>
                  <Text className="text-[10px] text-gray-400 mt-1">{timeAgo(t.updated_at)}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <Modal visible={showCreate} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-2xl p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">New Support Ticket</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)} className="p-1.5" activeOpacity={0.7}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {error ? (
              <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
                <AlertCircle size={14} color="#dc2626" />
                <Text className="text-xs text-red-700 flex-1">{error}</Text>
              </View>
            ) : null}
            <View>
              <Text className="text-xs font-semibold text-gray-700 mb-1">Subject *</Text>
              <TextInput
                value={subject} onChangeText={setSubject}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                placeholder="Describe your issue briefly" maxLength={100}
              />
            </View>
            <View>
              <Text className="text-xs font-semibold text-gray-700 mb-1">Description *</Text>
              <TextInput
                value={description} onChangeText={setDescription}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                placeholder="Provide more details..." multiline
                numberOfLines={4} maxLength={1000}
                textAlignVertical="top"
              />
            </View>
            <View className="flex-row gap-3 pb-4">
              <TouchableOpacity
                onPress={() => setShowCreate(false)}
                className="px-4 py-2 border border-gray-300 rounded-xl"
                activeOpacity={0.7}
              >
                <Text className="text-sm text-gray-700 font-medium">Cancel</Text>
              </TouchableOpacity>
              <Pressable
                onPress={handleCreateTicket}
                disabled={submitting}
                className="flex-1 flex-row items-center justify-center gap-2 bg-[#8c76f0] rounded-xl py-2"
                style={{ opacity: submitting ? 0.5 : 1 }}
              >
                <Send size={14} color="white" />
                <Text className="text-white text-sm font-semibold">{submitting ? 'Submitting...' : 'Submit Ticket'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
