import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatDateTime } from '@/shared/utils'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Ban,
  RotateCcw,
  User,
  Bike,
  FileText,
  Mail,
  Phone,
  MapPin,
  Clock,
  History,
  ShieldCheck,
} from 'lucide-react'

interface RiderDetail {
  id: number
  name: string
  email: string
  phone: string | null
  profile_photo: string | null
  account_status: 'active' | 'suspended' | 'pending_review' | 'rejected'
  municipality: string | null
  barangay: string | null
  address: string | null
  created_at: string
  vehicle_type: string | null
  vehicle_plate: string | null
  license_number: string | null
  license_expiry: string | null
  registration_number: string | null
  documents?: { id: number; name: string; file_url: string; verification_status: string }[]
  review_history?: { id: number; status: string; remarks: string; created_at: string; performed_by: string }[]
}

export default function AdminRiderShow() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [activeModal, setActiveModal] = useState<'approve' | 'reject' | 'suspend' | null>(null)
  const [remarks, setRemarks] = useState('')

  const { data: rider, isLoading } = useQuery({
    queryKey: ['admin-rider', id],
    queryFn: () => get<RiderDetail>(`/admin/riders/${id}`),
    enabled: !!id,
  })

  const actionMutation = useMutation({
    mutationFn: (action: string) =>
      post(`/admin/riders/${id}/${action}`, { remarks: remarks || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-rider', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-riders'] })
      setActiveModal(null)
      setRemarks('')
    },
  })

  const handleAction = () => {
    if (activeModal) actionMutation.mutate(activeModal)
  }

  const closeModal = () => {
    setActiveModal(null)
    setRemarks('')
  }

  const requiredDocuments = [
    'Valid Government ID',
    "Driver's License",
    'Vehicle Registration',
    'NBI Clearance',
  ]

  if (isLoading) return <DashboardSkeleton />
  if (!rider) return <div className="text-[#6B7280] text-center py-12">Rider not found</div>

  return (
    <div>
      <Link
        to="/admin/riders"
        className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#16803C] transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Riders
      </Link>

      <div className="mb-8">
        <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6">
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <svg className="absolute inset-0 w-full h-full opacity-5" viewBox="0 0 400 400" fill="none">
              <path d="M200 50L350 150V300L200 350L50 300V150L200 50Z" stroke="#16803C" strokeWidth="1"/>
              <path d="M200 100L300 170V270L200 300L100 270V170L200 100Z" stroke="#16803C" strokeWidth="0.5"/>
            </svg>
          </div>
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center overflow-hidden flex-shrink-0">
                {rider.profile_photo ? (
                  <img src={rider.profile_photo} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Bike className="w-6 h-6 text-[#16803C]" />
                )}
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">{rider.name}</h1>
                <p className="text-sm text-[#6B7280]">Rider Profile & Verification</p>
              </div>
            </div>
            <StatusBadge status={rider.account_status} size="md" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                <User className="w-4 h-4 text-[#16803C]" />
              </div>
              Personal Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Full Name</label>
                <p className="text-[#17201A] mt-1">{rider.name}</p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Email</label>
                <p className="text-[#17201A] mt-1 flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-[#6B7280]" />
                  {rider.email}
                </p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Phone</label>
                <p className="text-[#17201A] mt-1 flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-[#6B7280]" />
                  {rider.phone || '—'}
                </p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Municipality</label>
                <p className="text-[#17201A] mt-1 flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#6B7280]" />
                  {rider.municipality || '—'}
                </p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Barangay</label>
                <p className="text-[#17201A] mt-1">{rider.barangay || '—'}</p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Address</label>
                <p className="text-[#17201A] mt-1">{rider.address || '—'}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                <Bike className="w-4 h-4 text-[#16803C]" />
              </div>
              Vehicle Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Vehicle Type</label>
                <p className="text-[#17201A] mt-1">{rider.vehicle_type || '—'}</p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Plate Number</label>
                <p className="text-[#17201A] mt-1 font-mono">{rider.vehicle_plate || '—'}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-[#16803C]" />
              </div>
              License & Registration
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">License Number</label>
                <p className="text-[#17201A] mt-1 font-mono">{rider.license_number || '—'}</p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">License Expiry</label>
                <p className="text-[#17201A] mt-1">{rider.license_expiry || '—'}</p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Registration Number</label>
                <p className="text-[#17201A] mt-1 font-mono">{rider.registration_number || '—'}</p>
              </div>
            </div>
          </div>

          {rider.documents && rider.documents.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
              <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                  <FileText className="w-4 h-4 text-[#16803C]" />
                </div>
                Uploaded Documents
              </h2>
              <div className="space-y-3">
                {rider.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 bg-[#F3F8F4] rounded-xl border border-[#E2E8E3]"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-[#6B7280]" />
                      <span className="text-[#17201A] text-sm">{doc.name}</span>
                    </div>
                    <StatusBadge status={doc.verification_status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {rider.documents && rider.documents.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
              <h2 className="text-lg font-semibold text-[#17201A] mb-4">Document Checklist</h2>
              <div className="space-y-2">
                {requiredDocuments.map((req) => {
                  const uploaded = rider.documents?.some(
                    (d) => d.name.toLowerCase().includes(req.toLowerCase().split(' ')[0] ?? '')
                  )
                  return (
                    <div key={req} className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${uploaded ? 'bg-[#16803C]' : 'bg-red-500'}`}
                      />
                      <span className={`text-sm ${uploaded ? 'text-[#17201A]' : 'text-[#6B7280]'}`}>
                        {req}
                      </span>
                      <span className={`text-xs ml-auto ${uploaded ? 'text-[#16803C]' : 'text-red-500'}`}>
                        {uploaded ? 'Uploaded' : 'Missing'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {rider.review_history && rider.review_history.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
              <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                  <History className="w-4 h-4 text-[#16803C]" />
                </div>
                Review History
              </h2>
              <div className="space-y-3">
                {rider.review_history.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 p-3 bg-[#F3F8F4] rounded-xl border border-[#E2E8E3]"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <StatusBadge status={entry.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {entry.remarks && (
                        <p className="text-[#17201A] text-sm">{entry.remarks}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-xs text-[#6B7280]">
                        <Clock className="w-3 h-3" />
                        <span>{formatDateTime(entry.created_at)}</span>
                        <span>by {entry.performed_by}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Actions</h2>
            <div className="space-y-3">
              {rider.account_status !== 'active' && (
                <button
                  onClick={() => setActiveModal('approve')}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
              )}
              {rider.account_status !== 'rejected' && (
                <button
                  onClick={() => setActiveModal('reject')}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              )}
              {rider.account_status !== 'suspended' && rider.account_status !== 'rejected' && (
                <button
                  onClick={() => setActiveModal('suspend')}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
                >
                  <Ban className="w-4 h-4" />
                  Suspend
                </button>
              )}
              {rider.account_status === 'suspended' && (
                <button
                  onClick={() => setActiveModal('approve')}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reactivate
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-3">Quick Info</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#6B7280]">Joined</span>
                <span className="text-[#17201A]">{formatDateTime(rider.created_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6B7280]">Status</span>
                <StatusBadge status={rider.account_status} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal show={activeModal !== null} onClose={closeModal} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-2">
            {activeModal === 'approve' && 'Approve Rider'}
            {activeModal === 'reject' && 'Reject Rider'}
            {activeModal === 'suspend' && 'Suspend Rider'}
          </h2>
          <p className="text-sm text-[#6B7280] mb-4">
            Are you sure you want to {activeModal} <span className="text-[#17201A] font-medium">{rider.name}</span>?
          </p>
          {activeModal !== 'approve' && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-[#17201A] mb-2">Remarks (required)</label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder={`Provide a reason for ${activeModal}...`}
                className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C] resize-none"
              />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={closeModal}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAction}
              disabled={actionMutation.isPending || (activeModal !== 'approve' && !remarks.trim())}
              className={`px-4 py-2.5 text-white rounded-xl text-sm font-medium transition disabled:opacity-50 ${
                activeModal === 'approve'
                  ? 'bg-[#16803C] hover:bg-[#126B32]'
                  : activeModal === 'reject'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-yellow-600 hover:bg-yellow-700'
              }`}
            >
              {actionMutation.isPending
                ? 'Processing...'
                : activeModal === 'approve'
                ? 'Approve'
                : activeModal === 'reject'
                ? 'Reject'
                : 'Suspend'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
