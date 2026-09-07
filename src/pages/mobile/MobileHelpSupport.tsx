import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { MessageCircle, Plus, ChevronRight, Clock, CircleCheck as CheckCircle, Circle as XCircle, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Send, X } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface Ticket {
  id: string; ticket_number: string; subject: string; status: string;
  priority: string; created_at: string; updated_at: string;
  last_reply_by?: string; user_replied?: boolean; admin_replied?: boolean;
  category?: string; sub_category?: string; description?: string;
}

const CATEGORIES: Record<string, string[]> = {
  'Account Related': [
    'Unable to Change Password',
    'Unable to View Transactions',
    'Dashboard Data is Not Loading Properly',
    'Not Getting Notification Emails',
    'Not Getting Notification SMS',
    'Delete Account',
  ],
  'KYC Related': [
    'KYC Pending for Long Time',
    'KYC Rejected Even with Correct Data',
    'Update Address & its KYC Document',
    'Update PAN Number & its KYC Document',
    'Update Company/Business Information and its KYC Document',
  ],
  'Transaction Related': [
    'Money Deducted But Transaction Failed',
    'Money Deducted But Page Redirection Failed',
    'Transaction Settlement Pending',
    'Unable to Use Credit Card',
    'Credit Card Transaction is Failing',
    'Raise Charges Related Dispute',
    'Transactions History Mismatch',
    'Wrong Beneficiary Details',
  ],
  'Report Fraud': [
    'Report Fraud Transaction',
    'My Account is Compromised',
  ],
};

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
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubCategory, setSelectedSubCategory] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showCategoryList, setShowCategoryList] = useState(false);
  const [showSubCategoryList, setShowSubCategoryList] = useState(false);

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
    if (!selectedCategory) { setError('Please select a category'); return; }
    if (!selectedSubCategory) { setError('Please select a sub-category'); return; }
    if (!description.trim()) { setError('Description is required'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-support-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, category: selectedCategory, sub_category: selectedSubCategory, description: description.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create ticket');
      setShowCreate(false);
      setSelectedCategory(''); setSelectedSubCategory(''); setDescription('');
      fetchTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally { setSubmitting(false); }
  };

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const openCreateModal = () => {
    setSelectedCategory(''); setSelectedSubCategory(''); setDescription('');
    setError(''); setShowCategoryList(false); setShowSubCategoryList(false);
    setShowCreate(true);
  };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-3 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-gray-900">Help & Support</Text>
          <TouchableOpacity
            onPress={openCreateModal}
            className="flex-row items-center gap-2 px-4 py-2.5 bg-[#8c76f0] rounded-xl"
            activeOpacity={0.7} delayPressIn={0}
          >
            <Plus size={18} color="white" />
            <Text className="text-white text-sm font-semibold">New Ticket</Text>
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
            <TouchableOpacity onPress={openCreateModal} className="mt-3 flex-row items-center gap-2 px-4 py-2.5 bg-[#8c76f0] rounded-xl" activeOpacity={0.7} delayPressIn={0}>
              <Plus size={18} color="white" />
              <Text className="text-white text-sm font-semibold">Create Ticket</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            <View className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              {tickets.map((t, idx) => {
                const cfg = STATUS_CFG[t.status] || STATUS_CFG.open;
                return (
                  <View key={t.id} className={`p-3 ${idx > 0 ? 'border-t border-gray-100' : ''}`}>
                    <View className="flex-row items-start justify-between gap-2">
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>{t.sub_category || t.subject || t.category || 'Ticket'}</Text>
                        <Text className="text-[10px] text-gray-400 mt-0.5 font-mono">{t.ticket_number}</Text>
                      </View>
                      <View className={`px-2 py-0.5 rounded-md ${cfg.bg}`}>
                        <Text className="text-[10px] font-bold" style={{ color: cfg.color }}>{cfg.label}</Text>
                      </View>
                    </View>
                    {t.category && (
                      <Text className="text-[10px] text-gray-500 mt-1">{t.category}</Text>
                    )}
                    <Text className="text-[10px] text-gray-400 mt-1">{timeAgo(t.updated_at)}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>

      <Modal visible={showCreate} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View className="flex-1 bg-black/60 justify-end">
            <View className="bg-white rounded-t-2xl p-4 gap-3">
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-bold text-gray-900">New Support Ticket</Text>
                <TouchableOpacity onPress={() => setShowCreate(false)} className="p-1.5" activeOpacity={0.7} delayPressIn={0}>
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
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Category *</Text>
                <TouchableOpacity
                  onPress={() => { setShowCategoryList(!showCategoryList); setShowSubCategoryList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className={`text-base ${selectedCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedCategory || 'Select category...'}
                  </Text>
                  {showCategoryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                {showCategoryList && (
                  <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {Object.keys(CATEGORIES).map((cat) => (
                        <TouchableOpacity
                          key={cat}
                          onPress={() => { setSelectedCategory(cat); setSelectedSubCategory(''); setShowCategoryList(false); }}
                          className={`p-3.5 border-b border-gray-100 ${selectedCategory === cat ? 'bg-[#f3f0fe]' : ''}`}
                          activeOpacity={0.7} delayPressIn={0}
                        >
                          <Text className="text-base font-medium text-gray-900">{cat}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Sub-Category *</Text>
                <TouchableOpacity
                  onPress={() => { if (selectedCategory) setShowSubCategoryList(!showSubCategoryList); setShowCategoryList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7} delayPressIn={0}
                  style={{ opacity: selectedCategory ? 1 : 0.5 }}
                >
                  <Text className={`text-base ${selectedSubCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedSubCategory || (selectedCategory ? 'Select sub-category...' : 'Select category first')}
                  </Text>
                  {showSubCategoryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                {showSubCategoryList && selectedCategory && (
                  <View className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {CATEGORIES[selectedCategory].map((sub) => (
                        <TouchableOpacity
                          key={sub}
                          onPress={() => { setSelectedSubCategory(sub); setShowSubCategoryList(false); }}
                          className={`p-3.5 border-b border-gray-100 ${selectedSubCategory === sub ? 'bg-[#f3f0fe]' : ''}`}
                          activeOpacity={0.7} delayPressIn={0}
                        >
                          <Text className="text-base font-medium text-gray-900">{sub}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              <View>
                <Text className="text-sm font-semibold text-gray-700 mb-1.5">Description *</Text>
                <TextInput
                  value={description} onChangeText={setDescription}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                  placeholder="Provide more details..." multiline
                  numberOfLines={4} maxLength={1000}
                  textAlignVertical="top"
                  style={{ minHeight: 100 }}
                />
              </View>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowCreate(false)}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className="text-base text-gray-700 font-medium text-center">Cancel</Text>
                </TouchableOpacity>
                <Pressable
                  onPress={handleCreateTicket}
                  disabled={submitting}
                  className="flex-1 flex-row items-center justify-center gap-2 bg-[#8c76f0] rounded-xl py-3"
                  style={{ opacity: submitting ? 0.5 : 1 }}
                >
                  <Send size={16} color="white" />
                  <Text className="text-white text-base font-semibold">{submitting ? 'Submitting...' : 'Submit Ticket'}</Text>
                </Pressable>
              </View>
            </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </MobileLayout>
  );
}
