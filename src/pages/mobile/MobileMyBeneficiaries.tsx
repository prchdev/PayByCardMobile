import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Pressable, Alert } from 'react-native';
import { Users, Plus, CircleAlert as AlertCircle, ChevronDown, ChevronUp, Trash2, CircleCheck as CheckCircle, X, User } from 'lucide-react-native';
import MobileLayout from '../../components/mobile/MobileLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useNav } from '../../hooks/useNav';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/config';

interface Beneficiary {
  id: string; full_name: string; bank_name: string;
  account_number: string; ifsc_code: string; is_active: boolean;
}

export default function MobileMyBeneficiaries() {
  const { navigate } = useNav();
  const { route } = useNav();
  const { userId, userEmail } = (route.params || {}) as { userId?: string; userEmail?: string };
  const { logout } = useAuth();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Beneficiary | null>(null);
  const [kycVerified, setKycVerified] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '', account_number: '', ifsc_code: '', bank_name: '', email: '', mobile: '',
  });

  useEffect(() => {
    if (!userId) { navigate('/mobile/login'); return; }
    fetchBeneficiaries();
    checkKyc();
  }, [userId]);

  const fetchBeneficiaries = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-beneficiaries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setBeneficiaries(data.beneficiaries || []);
    } catch {} finally { setLoading(false); }
  };

  const checkKyc = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-kyc-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) setKycVerified(data.isVerified);
    } catch {}
  };

  const handleSubmit = async () => {
    setError('');
    if (!formData.full_name.trim()) { setError('Full Name is required'); return; }
    if (!/^[A-Za-z ]+$/.test(formData.full_name)) { setError('Name must contain only letters'); return; }
    if (!formData.account_number.trim()) { setError('Account Number is required'); return; }
    if (!formData.ifsc_code.trim()) { setError('IFSC Code is required'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/save-beneficiary`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...formData }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.self_transfer) {
          setError(data.error || 'Self-transfer not allowed');
        } else {
          throw new Error(data.error || 'Failed to save beneficiary');
        }
        return;
      }
      setShowModal(false);
      setFormData({ full_name: '', account_number: '', ifsc_code: '', bank_name: '', email: '', mobile: '' });
      fetchBeneficiaries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save beneficiary');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/save-beneficiary`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, beneficiaryId: deleteTarget.id }),
      });
      if (res.ok) {
        setBeneficiaries(prev => prev.filter(b => b.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } catch {}
  };

  const handleLogout = () => { logout(); navigate('/mobile/login'); };

  return (
    <MobileLayout userId={userId} userEmail={userEmail} onLogout={handleLogout}>
      <View className="px-4 py-3 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-gray-900">My Payees</Text>
          <TouchableOpacity
            onPress={() => {
              if (!kycVerified) { Alert.alert('KYC Required', 'Please complete KYC before adding payees.'); return; }
              setShowModal(true);
            }}
            className="flex-row items-center gap-1.5 px-3 py-1.5 bg-[#8c76f0] rounded-lg"
            activeOpacity={0.7}
          >
            <Plus size={14} color="white" />
            <Text className="text-white text-xs font-semibold">Add Payee</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color="#8c76f0" />
            <Text className="text-sm text-gray-500 mt-2">Loading payees...</Text>
          </View>
        ) : beneficiaries.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-3">
              <Users size={32} color="#d1d5db" />
            </View>
            <Text className="text-sm font-semibold text-gray-700">No payees yet</Text>
            <Text className="text-xs text-gray-400 mt-1">Add a payee to start making payments.</Text>
          </View>
        ) : (
          <View className="gap-2">
            {beneficiaries.map((b) => {
              const isExpanded = expandedId === b.id;
              return (
                <View key={b.id} className="bg-white rounded-xl border border-gray-200 p-3">
                  <TouchableOpacity
                    onPress={() => setExpandedId(isExpanded ? null : b.id)}
                    className="flex-row items-center gap-3"
                    activeOpacity={0.7}
                  >
                    <View className="w-9 h-9 rounded-lg bg-[#f3f0fe] items-center justify-center">
                      <User size={18} color="#8c76f0" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-gray-900">{b.full_name}</Text>
                      <Text className="text-xs text-gray-500">{b.bank_name} - {(b.account_number || '').slice(-4)}</Text>
                    </View>
                    {!b.is_active && <View className="px-2 py-0.5 bg-gray-100 rounded-md"><Text className="text-[10px] text-gray-500">Inactive</Text></View>}
                    {isExpanded ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
                  </TouchableOpacity>
                  {isExpanded && (
                    <View className="mt-3 pt-3 border-t border-gray-100 gap-1.5">
                      <View className="flex-row justify-between">
                        <Text className="text-xs text-gray-500">Account Number</Text>
                        <Text className="text-xs font-medium text-gray-900">{b.account_number}</Text>
                      </View>
                      <View className="flex-row justify-between">
                        <Text className="text-xs text-gray-500">IFSC Code</Text>
                        <Text className="text-xs font-medium text-gray-900">{b.ifsc_code}</Text>
                      </View>
                      <View className="flex-row justify-between">
                        <Text className="text-xs text-gray-500">Bank Name</Text>
                        <Text className="text-xs font-medium text-gray-900">{b.bank_name}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setDeleteTarget(b)}
                        className="flex-row items-center gap-1.5 mt-2 self-start"
                        activeOpacity={0.7}
                      >
                        <Trash2 size={14} color="#dc2626" />
                        <Text className="text-xs text-red-600 font-medium">Delete Payee</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <Modal visible={showModal} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-2xl p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-gray-900">Add New Payee</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} className="p-1.5" activeOpacity={0.7}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {error ? (
              <View className="bg-red-50 border border-red-300 rounded-xl p-3 flex-row items-center gap-2">
                <AlertCircle size={14} color="#dc2626" />
                <Text className="text-xs text-red-700 flex-1">{error}</Text>
              </View>
            ) : null}
            {[
              { key: 'full_name', label: 'Full Name *', placeholder: 'Amit Jha', keyboardType: 'default' },
              { key: 'account_number', label: 'Account Number *', placeholder: '1234567890', keyboardType: 'number-pad' },
              { key: 'ifsc_code', label: 'IFSC Code *', placeholder: 'HDFC0001234', keyboardType: 'default' },
              { key: 'bank_name', label: 'Bank Name', placeholder: 'HDFC Bank', keyboardType: 'default' },
              { key: 'email', label: 'Email (optional)', placeholder: 'amit@example.com', keyboardType: 'email-address' },
              { key: 'mobile', label: 'Mobile (optional)', placeholder: '9999999999', keyboardType: 'number-pad' },
            ].map(f => (
              <View key={f.key}>
                <Text className="text-xs font-semibold text-gray-700 mb-1">{f.label}</Text>
                <TextInput
                  value={formData[f.key as keyof typeof formData]}
                  onChangeText={(v) => setFormData({ ...formData, [f.key]: v })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                  placeholder={f.placeholder}
                  keyboardType={f.keyboardType as any}
                  autoCapitalize={f.key === 'ifsc_code' || f.key === 'email' ? 'none' : 'words'}
                />
              </View>
            ))}
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              className="w-full bg-[#8c76f0] rounded-xl py-3 mb-4"
              style={{ opacity: submitting ? 0.5 : 1 }}
            >
              <Text className="text-white font-semibold text-center">{submitting ? 'Saving...' : 'Save Payee'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={deleteTarget !== null} animationType="fade" transparent>
        <View className="flex-1 bg-black/60 justify-center items-center p-4">
          <View className="bg-white rounded-2xl p-4 w-full max-w-sm gap-3">
            <Text className="text-base font-bold text-gray-900">Delete Payee?</Text>
            <Text className="text-sm text-gray-600">Are you sure you want to delete {deleteTarget?.full_name}?</Text>
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={() => setDeleteTarget(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-xl" activeOpacity={0.7}>
                <Text className="text-sm text-gray-700 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} className="flex-1 px-4 py-2 bg-red-600 rounded-xl" activeOpacity={0.7}>
                <Text className="text-sm text-white font-semibold text-center">Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </MobileLayout>
  );
}
