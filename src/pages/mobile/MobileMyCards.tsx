import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Image, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import {
  CreditCard, CircleAlert as AlertCircle, CircleCheck as CheckCircle,
  Clock, Upload, X, RefreshCw, Info, ChevronRight, Camera,
} from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';
import { buildAuthHeaders, checkSessionExpired } from '../../utils/api';
import { getErrorMessage } from '../../utils/errorMessage';
import { getSessionItem } from '../../utils/secureStorage';
import { impact } from '../../utils/haptics';

interface UserCard {
  id: string;
  card_last_four: string;
  card_network: string | null;
  card_type: string | null;
  bank_name: string | null;
  name_on_card: string | null;
  front_photo_url: string | null;
  back_photo_url: string | null;
  status: string;
  admin_rejection_reason: string | null;
  card_verification_deadline: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle }> = {
  not_submitted: { label: 'Photos Required', color: '#d97706', bg: 'bg-amber-50', icon: Clock },
  pending_verification: { label: 'Under Review', color: '#2563eb', bg: 'bg-blue-50', icon: Clock },
  verified: { label: 'Verified', color: '#15803d', bg: 'bg-green-50', icon: CheckCircle },
  rejected: { label: 'Rejected', color: '#dc2626', bg: 'bg-red-50', icon: AlertCircle },
};

export default function MobileMyCards() {
  const { navigate, reset, route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();

  const [cards, setCards] = useState<UserCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingCard, setUploadingCard] = useState<string | null>(null);
  const [uploadingSide, setUploadingSide] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  const fetchCards = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-cards`, {
        method: 'GET',
        headers: await buildAuthHeaders(),
      });
      await checkSessionExpired(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load cards');
      setCards(data.cards || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load cards'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchCards();
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      if (userId) fetchCards();
    }, [userId])
  );

  const handleLogout = () => { logout(); reset('/mobile/login'); };

  const pickAndUpload = async (cardId: string, side: 'front' | 'back') => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const file = result.assets[0];
      if (file.size && file.size > 5 * 1024 * 1024) {
        Alert.alert('File Too Large', 'Photo size must be less than 5 MB');
        return;
      }

      setUploadingCard(cardId);
      setUploadingSide(side);
      impact('light');

      const mimeType = file.mimeType || 'image/jpeg';
      const formData = new FormData();
      formData.append('file', { uri: file.uri, name: file.name, type: mimeType } as any);
      formData.append('cardId', cardId);
      formData.append('photoSide', side);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/functions/v1/upload-card-photo`);
      xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
      const sessionToken = await getSessionItem('pbc_session');
      if (sessionToken) xhr.setRequestHeader('x-pbc-session', sessionToken);

      const uploadResult = await new Promise<{ ok: boolean; data: any }>((resolve, reject) => {
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
          } catch {
            reject(new Error('Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(formData);
      });

      if (!uploadResult.ok) {
        throw new Error(uploadResult.data?.error || 'Failed to upload photo');
      }

      impact('notification' as any);
      await fetchCards();
    } catch (err) {
      Alert.alert('Upload Failed', getErrorMessage(err, 'Failed to upload card photo'));
    } finally {
      setUploadingCard(null);
      setUploadingSide(null);
    }
  };

  const renderPhotoUpload = (card: UserCard, side: 'front' | 'back') => {
    const photoUrl = side === 'front' ? card.front_photo_url : card.back_photo_url;
    const isUploading = uploadingCard === card.id && uploadingSide === side;
    const canUpload = card.status === 'not_submitted' || card.status === 'rejected';

    return (
      <View className="flex-1">
        <Text className="text-xs font-semibold text-gray-600 mb-1.5">
          {side === 'front' ? 'Front Photo' : 'Back Photo'}
        </Text>
        {photoUrl ? (
          <TouchableOpacity
            onPress={() => { setPreviewPhoto(photoUrl); setPreviewTitle(`${side === 'front' ? 'Front' : 'Back'} - ****${card.card_last_four}`); }}
            activeOpacity={0.8}
            className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50"
            style={{ height: 100 }}
          >
            <Image source={{ uri: photoUrl }} className="w-full h-full" resizeMode="cover" />
            <View className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1">
              <Text className="text-white text-[10px] font-medium text-center">Tap to view</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => canUpload ? pickAndUpload(card.id, side) : null}
            disabled={!canUpload || isUploading}
            className={`items-center justify-center rounded-xl border-2 border-dashed ${canUpload ? 'border-gray-300 bg-gray-50' : 'border-gray-200 bg-gray-100'} ${canUpload ? 'active:opacity-0.7' : ''}`}
            style={{ height: 100 }}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#8c76f0" />
            ) : (
              <View className="items-center gap-1">
                <Camera size={20} color={canUpload ? '#9ca3af' : '#d1d5db'} />
                <Text className={`text-[10px] ${canUpload ? 'text-gray-500' : 'text-gray-400'}`}>
                  {canUpload ? 'Upload Photo' : 'Locked'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}
        {photoUrl && canUpload && !isUploading && (
          <TouchableOpacity
            onPress={() => pickAndUpload(card.id, side)}
            className="flex-row items-center justify-center gap-1 mt-1.5 py-1"
            activeOpacity={0.7} delayPressIn={0}
          >
            <RefreshCw size={11} color="#6b7280" />
            <Text className="text-[10px] text-gray-500 font-medium">Replace</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderCard = (card: UserCard, idx: number) => {
    const cfg = STATUS_CFG[card.status] || STATUS_CFG.not_submitted;
    const StatusIcon = cfg.icon;
    const canUpload = card.status === 'not_submitted' || card.status === 'rejected';

    return (
      <View key={card.id} className={`bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden ${idx > 0 ? 'mt-3' : ''}`}>
        {/* Card header */}
        <View className="flex-row items-center gap-3 p-4">
          <View className="w-12 h-12 rounded-xl items-center justify-center bg-violet-50">
            <CreditCard size={22} color="#8c76f0" />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-base font-bold text-gray-900">
                {card.card_network || 'Card'} •••• {card.card_last_four}
              </Text>
            </View>
            <Text className="text-xs text-gray-500 mt-0.5">
              {card.bank_name || 'Unknown Bank'}{card.name_on_card ? ` • ${card.name_on_card}` : ''}
            </Text>
          </View>
        </View>

        {/* Status badge */}
        <View className="px-4 pb-3">
          <View className={`flex-row items-center gap-1.5 ${cfg.bg} rounded-lg px-2.5 py-1.5 self-start`}>
            <StatusIcon size={14} color={cfg.color} />
            <Text className="text-xs font-semibold" style={{ color: cfg.color }}>{cfg.label}</Text>
          </View>
        </View>

        {/* Rejection reason */}
        {card.status === 'rejected' && card.admin_rejection_reason && (
          <View className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-xl p-3 flex-row items-start gap-2">
            <AlertCircle size={14} color="#dc2626" />
            <View className="flex-1">
              <Text className="text-xs font-semibold text-red-800">Verification Rejected</Text>
              <Text className="text-xs text-red-700 mt-0.5">{card.admin_rejection_reason}</Text>
            </View>
          </View>
        )}

        {/* Photo upload section */}
        <View className="px-4 pb-4 gap-3">
          {card.status === 'not_submitted' && (
            <View className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex-row items-start gap-2">
              <Info size={14} color="#d97706" />
              <Text className="text-xs text-amber-800 flex-1">
                Upload clear photos of the front and back of your card. Ensure the last 4 digits and name are clearly visible. Mask the first 12 digits, CVV, and expiry before uploading.
              </Text>
            </View>
          )}

          {card.status === 'not_submitted' || card.status === 'rejected' ? (
            <View className="flex-row gap-3">
              {renderPhotoUpload(card, 'front')}
              {renderPhotoUpload(card, 'back')}
            </View>
          ) : (
            <View className="flex-row gap-3">
              {card.front_photo_url ? (
                <TouchableOpacity
                  onPress={() => { setPreviewPhoto(card.front_photo_url); setPreviewTitle(`Front - ****${card.card_last_four}`); }}
                  activeOpacity={0.8}
                  className="flex-1"
                >
                  <Text className="text-xs font-semibold text-gray-600 mb-1.5">Front Photo</Text>
                  <View className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 100 }}>
                    <Image source={{ uri: card.front_photo_url }} className="w-full h-full" resizeMode="cover" />
                  </View>
                </TouchableOpacity>
              ) : null}
              {card.back_photo_url ? (
                <TouchableOpacity
                  onPress={() => { setPreviewPhoto(card.back_photo_url); setPreviewTitle(`Back - ****${card.card_last_four}`); }}
                  activeOpacity={0.8}
                  className="flex-1"
                >
                  <Text className="text-xs font-semibold text-gray-600 mb-1.5">Back Photo</Text>
                  <View className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 100 }}>
                    <Image source={{ uri: card.back_photo_url }} className="w-full h-full" resizeMode="cover" />
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout} showBack>
      <View className="px-4 py-4 gap-3">
        <View>
          <Text className="text-xl font-bold text-gray-900">My Cards</Text>
          <Text className="text-sm text-gray-500 mt-1">
            Cards used for payments and their verification status
          </Text>
        </View>

        {/* Info banner */}
        <View className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex-row items-start gap-2">
          <Info size={16} color="#2563eb" />
          <View className="flex-1">
            <Text className="text-xs font-semibold text-blue-900">Card Verification</Text>
            <Text className="text-xs text-blue-700 mt-0.5">
              Upload front and back photos of your card with the last 4 digits and name clearly visible. Mask the first 12 digits, CVV, and expiry date before uploading for security.
            </Text>
          </View>
        </View>

        {error ? (
          <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
            <AlertCircle size={18} color="#dc2626" />
            <Text className="text-sm text-red-700 flex-1">{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading cards...</Text>
          </View>
        ) : cards.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-3">
              <CreditCard size={32} color="#d1d5db" />
            </View>
            <Text className="text-sm font-semibold text-gray-700">No cards found</Text>
            <Text className="text-xs text-gray-500 mt-1 text-center max-w-xs">
              Cards will appear here automatically after you make a payment using them
            </Text>
          </View>
        ) : (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="pb-6">
              {cards.map((card, idx) => renderCard(card, idx))}
            </View>
          </ScrollView>
        )}
      </View>

      {/* Photo preview modal */}
      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <View className="flex-1 bg-black/80 justify-center items-center p-4">
          <View className="w-full max-w-sm">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-white font-semibold text-base">{previewTitle}</Text>
              <TouchableOpacity onPress={() => setPreviewPhoto(null)} activeOpacity={0.7} delayPressIn={0}>
                <X size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>
            {previewPhoto && (
              <Image
                source={{ uri: previewPhoto }}
                className="w-full rounded-xl"
                style={{ height: 240 }}
                resizeMode="contain"
              />
            )}
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
