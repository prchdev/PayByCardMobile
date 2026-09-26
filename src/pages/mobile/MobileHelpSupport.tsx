import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, Platform, FlatList } from 'react-native';
import { MessageCircle, Plus, ChevronRight, ChevronLeft, Clock, CircleCheck as CheckCircle, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Send, X, Upload, FileText, User, Tag } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { buildAuthHeaders, checkSessionExpired } from '../../utils/api';
import { getSessionItem } from '../../utils/secureStorage';
import { getErrorMessage } from '../../utils/errorMessage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Ticket {
  id: string;
  ticket_number: string;
  category: string;
  sub_category: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

interface Reply {
  reply_id: string;
  ticket_id: string;
  user_type: 'user' | 'admin';
  message: string;
  created_at: string;
  user_name: string;
  admin_name: string;
  attachments: Attachment[];
}

interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  uploaded_at: string;
}

interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
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

const STATUS_FILTERS = ['All', 'Open', 'In Progress', 'On Hold', 'Waiting For More Details', 'Resolved', 'Closed'];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Open': { bg: 'bg-blue-100', text: 'text-blue-800' },
  'In Progress': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  'On Hold': { bg: 'bg-orange-100', text: 'text-orange-800' },
  'Waiting For More Details': { bg: 'bg-purple-100', text: 'text-purple-800' },
  'Resolved': { bg: 'bg-green-100', text: 'text-green-800' },
  'Closed': { bg: 'bg-gray-100', text: 'text-gray-800' },
};

const PRIORITY_COLORS: Record<string, string> = {
  'Urgent': 'text-red-600',
  'High': 'text-orange-600',
  'Medium': 'text-yellow-600',
  'Low': 'text-green-600',
};

const VALID_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
const MAX_FILE_SIZE = 1048576;

function validateFiles(files: PickedFile[], newFiles: PickedFile[]): { valid: boolean; error: string; combined: PickedFile[] } {
  if (files.length + newFiles.length > 3) {
    return { valid: false, error: 'Maximum 3 files allowed', combined: files };
  }
  const invalid = newFiles.filter(f => !VALID_TYPES.includes(f.mimeType) || f.size > MAX_FILE_SIZE);
  if (invalid.length > 0) {
    return { valid: false, error: 'Files must be PNG, JPG, JPEG, or PDF and less than 1MB each', combined: files };
  }
  return { valid: true, error: '', combined: [...files, ...newFiles] };
}

async function pickFiles(): Promise<PickedFile[]> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
      copyToCacheDirectory: false,
      multiple: true,
    });
    if (result.canceled || !result.assets?.length) return [];
    return result.assets.map(a => ({
      uri: a.uri,
      name: a.name,
      size: a.size ?? 0,
      mimeType: a.mimeType || 'application/octet-stream',
    }));
  } catch {
    return [];
  }
}

async function uploadAttachment(file: PickedFile, ticketId: string, userId: string, replyId?: string) {
  return new Promise<boolean>(async (resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/functions/v1/upload-ticket-attachment`);
    xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
    const sessionToken = await getSessionItem('pbc_session');
    if (sessionToken) xhr.setRequestHeader('x-pbc-session', sessionToken);

    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);

    const formData = new FormData();
    formData.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    formData.append('ticketId', ticketId);
    formData.append('userId', userId);
    formData.append('ip', 'user');
    if (replyId) formData.append('replyId', replyId);

    xhr.send(formData);
  });
}

export default function MobileHelpSupport() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Create ticket state
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubCategory, setSelectedSubCategory] = useState('');
  const [description, setDescription] = useState('');
  const [createFiles, setCreateFiles] = useState<PickedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showCategoryList, setShowCategoryList] = useState(false);
  const [showSubCategoryList, setShowSubCategoryList] = useState(false);

  // Ticket details state
  const [showDetails, setShowDetails] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [ticketAttachments, setTicketAttachments] = useState<Attachment[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [replyFiles, setReplyFiles] = useState<PickedFile[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchTickets();
  }, [userId, statusFilter, currentPage]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ userId: userId!, page: currentPage.toString(), limit: '10' });
      if (statusFilter !== 'All') params.append('status', statusFilter);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-support-tickets?${params}`, {
        method: 'GET',
        headers: await buildAuthHeaders(),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch tickets');
      setTickets(data.tickets || []);
      setTotalPages(data.totalPages || 1);
    } catch {} finally { setLoading(false); }
  };

  const fetchTicketDetails = async (ticketId: string) => {
    setDetailsLoading(true);
    setDetailsError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-ticket-details?ticketId=${ticketId}&userId=${userId}`, {
        method: 'GET',
        headers: await buildAuthHeaders(),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch ticket details');
      setTicketDetail(data.ticket);
      setReplies(data.replies || []);
      setTicketAttachments(data.attachments || []);
    } catch (err) {
      setDetailsError(getErrorMessage(err, 'Failed to load ticket details'));
    } finally { setDetailsLoading(false); }
  };

  const handleCreateTicket = async () => {
    if (!selectedCategory) { setError('Please select a category'); return; }
    if (!selectedSubCategory) { setError('Please select a sub-category'); return; }
    if (!description.trim()) { setError('Description is required'); return; }

    setSubmitting(true); setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-support-ticket`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ userId, category: selectedCategory, sub_category: selectedSubCategory, description: description.trim(), ip: 'user' }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create ticket');

      const ticketId = data.ticket.id;
      for (const file of createFiles) {
        await uploadAttachment(file, ticketId, userId!);
      }

      setShowCreate(false);
      setSelectedCategory(''); setSelectedSubCategory(''); setDescription('');
      setCreateFiles([]); setError('');
      setCurrentPage(1);
      fetchTickets();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create ticket'));
    } finally { setSubmitting(false); }
  };

  const handleSendReply = async () => {
    if (!replyMessage.trim() || !selectedTicketId) return;
    setSending(true); setDetailsError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/add-ticket-reply`, {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify({ ticketId: selectedTicketId, userId, message: replyMessage, ip: 'user' }),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reply');

      const replyId = data.reply.id;
      for (const file of replyFiles) {
        await uploadAttachment(file, selectedTicketId, userId!, replyId);
      }

      setReplyMessage(''); setReplyFiles([]);
      fetchTicketDetails(selectedTicketId);
    } catch (err) {
      setDetailsError(getErrorMessage(err, 'Failed to send reply'));
    } finally { setSending(false); }
  };

  const handlePickCreateFiles = async () => {
    const picked = await pickFiles();
    if (!picked.length) return;
    const result = validateFiles(createFiles, picked);
    if (!result.valid) { setError(result.error); return; }
    setCreateFiles(result.combined); setError('');
  };

  const handlePickReplyFiles = async () => {
    const picked = await pickFiles();
    if (!picked.length) return;
    const result = validateFiles(replyFiles, picked);
    if (!result.valid) { setDetailsError(result.error); return; }
    setReplyFiles(result.combined); setDetailsError('');
  };

  const openTicket = (ticket: Ticket) => {
    setSelectedTicketId(ticket.id);
    setShowDetails(true);
    setReplyMessage(''); setReplyFiles([]); setDetailsError('');
    fetchTicketDetails(ticket.id);
  };

  const closeDetails = () => {
    setShowDetails(false); setSelectedTicketId(null);
    setTicketDetail(null); setReplies([]); setTicketAttachments([]);
    fetchTickets();
  };

  const openCreateModal = () => {
    setSelectedCategory(''); setSelectedSubCategory(''); setDescription('');
    setCreateFiles([]); setError('');
    setShowCategoryList(false); setShowSubCategoryList(false);
    setShowCreate(true);
  };

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const canReply = ticketDetail && !['Resolved', 'Closed'].includes(ticketDetail.status);

  const getStatusStyle = (status: string) => STATUS_COLORS[status] || { bg: 'bg-gray-100', text: 'text-gray-800' };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-4 gap-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 bg-[#8c76f0] rounded-xl items-center justify-center">
              <MessageCircle size={20} color="white" />
            </View>
            <View>
              <Text className="text-xl font-bold text-gray-900">Help & Support</Text>
              <Text className="text-sm text-gray-500">Raise and manage your support tickets</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={openCreateModal}
            className="flex-row items-center gap-2 px-4 py-2.5 bg-[#8c76f0] rounded-xl"
            activeOpacity={0.7} delayPressIn={0}
          >
            <Plus size={18} color="white" />
            <Text className="text-white text-sm font-semibold">New Ticket</Text>
          </TouchableOpacity>
        </View>

        {/* Status filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {STATUS_FILTERS.map((status) => (
            <TouchableOpacity
              key={status}
              onPress={() => { setStatusFilter(status); setCurrentPage(1); }}
              className={`px-4 py-2 rounded-lg ${statusFilter === status ? 'bg-[#8c76f0]' : 'bg-gray-100'}`}
              activeOpacity={0.7} delayPressIn={0}
            >
              <Text className={`text-sm font-medium ${statusFilter === status ? 'text-white' : 'text-gray-700'}`}>{status}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading tickets...</Text>
          </View>
        ) : tickets.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-full bg-gray-100 items-center justify-center mb-3">
              <MessageCircle size={40} color="#d1d5db" />
            </View>
            <Text className="text-base font-semibold text-gray-700">No Tickets Found</Text>
            <Text className="text-sm text-gray-400 mt-1 text-center">
              {statusFilter !== 'All' ? `You don't have any tickets with status "${statusFilter}"` : "You haven't created any support tickets yet"}
            </Text>
            <TouchableOpacity onPress={openCreateModal} className="mt-4 flex-row items-center gap-2 px-6 py-3 bg-[#8c76f0] rounded-xl" activeOpacity={0.7} delayPressIn={0}>
              <Plus size={18} color="white" />
              <Text className="text-white text-sm font-semibold">Create Your First Ticket</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="gap-3">
            {tickets.map((t) => {
              const sc = getStatusStyle(t.status);
              const pc = PRIORITY_COLORS[t.priority] || 'text-gray-600';
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => openTicket(t)}
                  className="bg-white rounded-2xl border border-gray-200 p-4"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <View className="flex-row items-start justify-between mb-2">
                    <Text className="text-sm font-medium text-[#8c76f0]">{t.ticket_number}</Text>
                    <View className={`px-2.5 py-1 rounded-full ${sc.bg}`}>
                      <Text className={`text-xs font-medium ${sc.text}`}>{t.status}</Text>
                    </View>
                  </View>
                  <Text className="text-sm font-semibold text-gray-900 mb-1">{t.category}</Text>
                  <Text className="text-sm text-gray-600 mb-2">{t.sub_category}</Text>
                  <View className="flex-row items-center justify-between">
                    <Text className={`text-sm font-medium ${pc}`}>{t.priority}</Text>
                    <Text className="text-sm text-gray-500">{new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {totalPages > 1 && (
              <View className="flex-row items-center justify-between mt-2">
                <Text className="text-sm text-gray-600">Page {currentPage} of {totalPages}</Text>
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="flex-row items-center gap-1 px-4 py-2 border border-gray-300 rounded-xl"
                    activeOpacity={0.7} delayPressIn={0}
                    style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
                  >
                    <ChevronLeft size={16} color="#6b7280" />
                    <Text className="text-sm text-gray-700 font-medium">Prev</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="flex-row items-center gap-1 px-4 py-2 border border-gray-300 rounded-xl"
                    activeOpacity={0.7} delayPressIn={0}
                    style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
                  >
                    <Text className="text-sm text-gray-700 font-medium">Next</Text>
                    <ChevronRight size={16} color="#6b7280" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        <View className="bg-[#f3f0fe] border border-[#8c76f0] rounded-2xl p-4">
          <View className="flex-row items-start gap-3">
            <AlertCircle size={18} color="#8c76f0" />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-gray-900">About Support Tickets</Text>
              <Text className="text-sm text-gray-700 mt-1">Need help? Create a support ticket and our team will assist you. You can track the status of your tickets and receive updates on your queries.</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Create Ticket Modal */}
      <Modal visible={showCreate} animationType="slide" transparent={false}>
        <View className="flex-1 bg-gray-50" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View className="flex-row items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
            <Text className="text-lg font-bold text-gray-900">Create Support Ticket</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)} className="p-2" activeOpacity={0.7} delayPressIn={0}>
              <X size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}>
              {error ? (
                <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2 mb-4">
                  <AlertCircle size={16} color="#dc2626" />
                  <Text className="text-sm text-red-900 flex-1">{error}</Text>
                </View>
              ) : null}

              {/* Category */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1.5">Category <Text className="text-red-500">*</Text></Text>
                <TouchableOpacity
                  onPress={() => { setShowCategoryList(!showCategoryList); setShowSubCategoryList(false); }}
                  className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className={`text-base ${selectedCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedCategory || 'Select a category'}
                  </Text>
                  {showCategoryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                </TouchableOpacity>
                {showCategoryList && (
                  <View className="mt-1 bg-white border border-gray-200 rounded-xl">
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

              {/* Sub-Category */}
              {selectedCategory ? (
                <View className="mb-4">
                  <Text className="text-sm font-medium text-gray-700 mb-1.5">Sub-Category <Text className="text-red-500">*</Text></Text>
                  <TouchableOpacity
                    onPress={() => setShowSubCategoryList(!showSubCategoryList)}
                    className="flex-row items-center justify-between w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                    activeOpacity={0.7} delayPressIn={0}
                  >
                    <Text className={`text-base ${selectedSubCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                      {selectedSubCategory || 'Select a sub-category'}
                    </Text>
                    {showSubCategoryList ? <ChevronUp size={18} color="#6b7280" /> : <ChevronDown size={18} color="#6b7280" />}
                  </TouchableOpacity>
                  {showSubCategoryList && (
                    <View className="mt-1 bg-white border border-gray-200 rounded-xl">
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
              ) : null}

              {/* Description */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1.5">Description of Help Needed <Text className="text-red-500">*</Text></Text>
                <TextInput
                  value={description}
                  onChangeText={(v) => setDescription(v.slice(0, 1000))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                  placeholder="Please describe your issue in detail..."
                  multiline
                  numberOfLines={4}
                  maxLength={1000}
                  textAlignVertical="top"
                  style={{ minHeight: 100 }}
                />
                <Text className="text-xs text-gray-500 mt-1 text-right">{description.length}/1000</Text>
              </View>

              {/* Attachments */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1.5">Attachments (Optional - Max 3 files)</Text>
                <TouchableOpacity
                  onPress={handlePickCreateFiles}
                  disabled={createFiles.length >= 3}
                  className="w-full px-4 py-3 border border-dashed border-gray-300 rounded-xl flex-row items-center justify-center gap-2"
                  activeOpacity={0.7} delayPressIn={0}
                  style={{ opacity: createFiles.length >= 3 ? 0.5 : 1 }}
                >
                  <Upload size={20} color="#6b7280" />
                  <Text className="text-sm font-medium text-gray-600">
                    {createFiles.length >= 3 ? 'Maximum files reached' : 'Upload Files (PNG, JPG, JPEG, PDF - Max 1MB each)'}
                  </Text>
                </TouchableOpacity>
                {createFiles.length > 0 && (
                  <View className="mt-2 gap-2">
                    {createFiles.map((file, index) => (
                      <View key={index} className="flex-row items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <View className="flex-row items-center gap-2 flex-1">
                          <FileText size={16} color="#6b7280" />
                          <Text className="text-sm text-gray-900 flex-1" numberOfLines={1}>{file.name}</Text>
                          <Text className="text-xs text-gray-500">({(file.size / 1024).toFixed(1)} KB)</Text>
                        </View>
                        <TouchableOpacity onPress={() => setCreateFiles(createFiles.filter((_, i) => i !== index))} className="p-1" activeOpacity={0.7} delayPressIn={0}>
                          <X size={16} color="#6b7280" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View className="bg-[#f3f0fe] border border-purple-200 rounded-xl p-3 mb-4">
                <Text className="text-xs text-purple-900 font-medium">Please provide as much detail as possible to help us resolve your issue quickly.</Text>
              </View>

              {/* Buttons */}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowCreate(false)}
                  className="flex-1 py-3.5 border border-gray-300 rounded-xl"
                  activeOpacity={0.7} delayPressIn={0}
                >
                  <Text className="text-center text-gray-700 font-semibold">Cancel</Text>
                </TouchableOpacity>
                <Pressable
                  onPress={handleCreateTicket}
                  disabled={submitting}
                  className="flex-1 py-3.5 bg-[#8c76f0] rounded-xl flex-row items-center justify-center gap-2"
                  style={{ opacity: submitting ? 0.5 : 1 }}
                >
                  {submitting ? <ActivityIndicator size="small" color="white" /> : <Plus size={18} color="white" />}
                  <Text className="text-white font-semibold">{submitting ? 'Creating...' : 'Create Ticket'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Ticket Details Modal */}
      <Modal visible={showDetails} animationType="slide" transparent={false}>
        <View className="flex-1 bg-gray-50" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View className="flex-row items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
            <View className="flex-row items-center gap-3 flex-1">
              {ticketDetail && (
                <Text className="text-lg font-bold text-gray-900" numberOfLines={1}>Ticket #{ticketDetail.ticket_number}</Text>
              )}
              {ticketDetail && (() => {
                const sc = getStatusStyle(ticketDetail.status);
                return <View className={`px-2.5 py-1 rounded-full ${sc.bg}`}><Text className={`text-xs font-medium ${sc.text}`}>{ticketDetail.status}</Text></View>;
              })()}
            </View>
            <TouchableOpacity onPress={closeDetails} className="p-2" activeOpacity={0.7} delayPressIn={0}>
              <X size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {detailsLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#8c76f0" />
            </View>
          ) : detailsError && !ticketDetail ? (
            <View className="flex-1 items-center justify-center px-4">
              <AlertCircle size={48} color="#dc2626" />
              <Text className="text-base font-medium text-gray-900 mt-4 text-center">Failed to load ticket details</Text>
              <TouchableOpacity onPress={closeDetails} className="mt-4 px-6 py-3 bg-[#8c76f0] rounded-xl" activeOpacity={0.7} delayPressIn={0}>
                <Text className="text-white font-semibold">Close</Text>
              </TouchableOpacity>
            </View>
          ) : ticketDetail ? (
            <View className="flex-1">
              <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, flexGrow: 1 }}>
                {/* Ticket info card */}
                <View className="bg-[#f3f0fe] border border-purple-200 rounded-xl p-4 mb-4">
                  <View className="flex-row gap-4 mb-3">
                    <View className="flex-row items-center gap-2 flex-1">
                      <Tag size={16} color="#6b7280" />
                      <Text className="text-sm text-gray-600">Category:</Text>
                      <Text className="text-sm font-medium text-gray-900 flex-1" numberOfLines={1}>{ticketDetail.category}</Text>
                    </View>
                    <View className="flex-row items-center gap-2 flex-1">
                      <Clock size={16} color="#6b7280" />
                      <Text className="text-sm text-gray-600">Created:</Text>
                      <Text className="text-sm font-medium text-gray-900 flex-1" numberOfLines={1}>{new Date(ticketDetail.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</Text>
                    </View>
                  </View>
                  <Text className="text-sm text-gray-600 mb-1">Sub-Category:</Text>
                  <Text className="text-sm font-medium text-gray-900 mb-2">{ticketDetail.sub_category}</Text>
                  <Text className="text-sm text-gray-600 mb-1">Description:</Text>
                  <Text className="text-sm text-gray-900">{ticketDetail.description}</Text>

                  {ticketAttachments.length > 0 && (
                    <View className="mt-3">
                      <Text className="text-sm text-gray-600 mb-2">Attachments:</Text>
                      <View className="gap-2">
                        {ticketAttachments.map((a) => (
                          <View key={a.id} className="flex-row items-center gap-2 p-2 bg-white border border-gray-200 rounded-lg">
                            <FileText size={16} color="#6b7280" />
                            <Text className="text-sm text-gray-900 flex-1" numberOfLines={1}>{a.file_name}</Text>
                            <Text className="text-xs text-gray-500">({(a.file_size / 1024).toFixed(1)} KB)</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>

                {/* Conversation */}
                {replies.length > 0 && (
                  <View className="mb-4">
                    <View className="flex-row items-center gap-2 mb-3">
                      <MessageCircle size={18} color="#6b7280" />
                      <Text className="text-base font-semibold text-gray-900">Conversation</Text>
                    </View>
                    <View className="gap-3">
                      {replies.map((reply) => {
                        const isAdmin = reply.user_type === 'admin';
                        return (
                          <View key={reply.reply_id} className={`rounded-xl p-4 ${isAdmin ? 'bg-green-50 border border-green-200' : 'bg-purple-50 border border-purple-200'}`}>
                            <View className="flex-row items-start gap-3 mb-2">
                              <View className={`w-8 h-8 rounded-full items-center justify-center ${isAdmin ? 'bg-green-200' : 'bg-purple-200'}`}>
                                <User size={16} color={isAdmin ? '#16a34a' : '#8c76f0'} />
                              </View>
                              <View className="flex-1">
                                <View className="flex-row items-center gap-2 mb-1">
                                  <Text className="text-sm font-medium text-gray-900">{isAdmin ? reply.admin_name : reply.user_name}</Text>
                                  <View className={`px-2 py-0.5 rounded-full ${isAdmin ? 'bg-green-200' : 'bg-purple-200'}`}>
                                    <Text className={`text-xs ${isAdmin ? 'text-green-800' : 'text-purple-800'}`}>{isAdmin ? 'Admin' : 'You'}</Text>
                                  </View>
                                  <Text className="text-xs text-gray-500">{new Date(reply.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</Text>
                                </View>
                                <Text className="text-sm text-gray-900">{reply.message}</Text>
                                {reply.attachments && reply.attachments.length > 0 && (
                                  <View className="mt-2 gap-2">
                                    {reply.attachments.map((a) => (
                                      <View key={a.id} className="flex-row items-center gap-2 p-2 bg-white border border-gray-200 rounded-lg">
                                        <FileText size={16} color="#6b7280" />
                                        <Text className="text-sm text-gray-900 flex-1" numberOfLines={1}>{a.file_name}</Text>
                                        <Text className="text-xs text-gray-500">({(a.file_size / 1024).toFixed(1)} KB)</Text>
                                      </View>
                                    ))}
                                  </View>
                                )}
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}

                {detailsError ? (
                  <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-start gap-2 mb-4">
                    <AlertCircle size={16} color="#dc2626" />
                    <Text className="text-sm text-red-900 flex-1">{detailsError}</Text>
                  </View>
                ) : null}
              </ScrollView>

              {/* Reply area */}
              {canReply ? (
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                  <View className="border-t border-gray-200 p-4 bg-white gap-3">
                    <TextInput
                      value={replyMessage}
                      onChangeText={setReplyMessage}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base"
                      placeholder="Type your reply..."
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                      style={{ minHeight: 80 }}
                    />

                    {replyFiles.length > 0 && (
                      <View className="gap-2">
                        {replyFiles.map((file, index) => (
                          <View key={index} className="flex-row items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <View className="flex-row items-center gap-2 flex-1">
                              <FileText size={16} color="#6b7280" />
                              <Text className="text-sm text-gray-900 flex-1" numberOfLines={1}>{file.name}</Text>
                              <Text className="text-xs text-gray-500">({(file.size / 1024).toFixed(1)} KB)</Text>
                            </View>
                            <TouchableOpacity onPress={() => setReplyFiles(replyFiles.filter((_, i) => i !== index))} className="p-1" activeOpacity={0.7} delayPressIn={0}>
                              <X size={16} color="#6b7280" />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}

                    <View className="flex-row gap-2">
                      <TouchableOpacity
                        onPress={handlePickReplyFiles}
                        disabled={replyFiles.length >= 3}
                        className="px-4 py-3 border border-gray-300 rounded-xl flex-row items-center gap-2"
                        activeOpacity={0.7} delayPressIn={0}
                        style={{ opacity: replyFiles.length >= 3 ? 0.5 : 1 }}
                      >
                        <Upload size={16} color="#6b7280" />
                        <Text className="text-sm font-medium text-gray-700">Attach</Text>
                      </TouchableOpacity>
                      <Pressable
                        onPress={handleSendReply}
                        disabled={sending || !replyMessage.trim()}
                        className="flex-1 py-3 bg-[#8c76f0] rounded-xl flex-row items-center justify-center gap-2"
                        style={{ opacity: sending || !replyMessage.trim() ? 0.5 : 1 }}
                      >
                        {sending ? <ActivityIndicator size="small" color="white" /> : <Send size={16} color="white" />}
                        <Text className="text-white font-semibold">{sending ? 'Sending...' : 'Send Reply'}</Text>
                      </Pressable>
                    </View>
                  </View>
                </KeyboardAvoidingView>
              ) : (
                <View className="border-t border-gray-200 p-4 bg-gray-50">
                  <Text className="text-center text-gray-600 font-medium">This ticket is {ticketDetail.status.toLowerCase()} and cannot accept new replies.</Text>
                </View>
              )}
            </View>
          ) : null}
        </View>
      </Modal>
    </MobileLayout>
  );
}
