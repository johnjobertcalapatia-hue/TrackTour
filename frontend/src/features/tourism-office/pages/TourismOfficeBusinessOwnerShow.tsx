import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatDateTime } from '@/shared/utils'
import { ArrowLeft, User, Mail, Phone, Calendar, Building2, CheckCircle, XCircle, FileText } from 'lucide-react'

const rejectSchema = z.object({
  remarks: z.string().min(5, 'Remarks must be at least 5 characters'),
})

type RejectFormData = z.infer<typeof rejectSchema>

interface Business {
  id: number
  name: string
  description: string | null
  status: string
  address: string | null
  created_at: string
}

interface StatusHistoryEntry {
  id: number
  status: string
  remarks: string | null
  created_by: string
  created_at: string
}

interface BusinessOwnerDetail {
  id: number
  name: string
  email: string
  phone: string | null
  account_status: string
  created_at: string
  businesses: Business[]
  status_history: StatusHistoryEntry[]
}

export default function TourismOfficeBusinessOwnerShow() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [showRejectModal, setShowRejectModal] = useState(false)

  const { data: owner, isLoading } = useQuery({
    queryKey: ['to-business-owner', id],
    queryFn: () => get<BusinessOwnerDetail>(`/tourism-office/business-owners/${id}`),
  })

  const approveMutation = useMutation({
    mutationFn: () =>
      patch(`/tourism-office/business-owners/${id}/status`, { account_status: 'active', remarks: 'Approved by tourism office' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-business-owner', id] })
      queryClient.invalidateQueries({ queryKey: ['to-business-owners'] })
    },
  })

  const rejectForm = useForm<RejectFormData>({
    resolver: zodResolver(rejectSchema),
  })

  const rejectMutation = useMutation({
    mutationFn: (data: RejectFormData) =>
      patch(`/tourism-office/business-owners/${id}/status`, { account_status: 'rejected', remarks: data.remarks }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['to-business-owner', id] })
      queryClient.invalidateQueries({ queryKey: ['to-business-owners'] })
      setShowRejectModal(false)
      rejectForm.reset()
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!owner) return <div className="text-center py-20 text-gray-400">Business owner not found.</div>

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/tourism-office/business-owners" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Business Owners
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
        <div className="w-14 h-14 bg-gray-800 rounded-2xl flex items-center justify-center text-gray-400 text-xl font-bold shrink-0">
          {owner.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">{owner.name}</h1>
            <StatusBadge status={owner.account_status} size="md" />
          </div>
          <p className="mt-1 text-sm text-gray-400">Business owner details and management</p>
        </div>
        {owner.account_status === 'pending_review' && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              <CheckCircle className="w-4 h-4" />
              {approveMutation.isPending ? 'Approving...' : 'Approve'}
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Contact Information</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center">
                <User className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Full Name</p>
                <p className="text-sm text-gray-100">{owner.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center">
                <Mail className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Email</p>
                <p className="text-sm text-gray-100">{owner.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center">
                <Phone className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Phone</p>
                <p className="text-sm text-gray-100">{owner.phone ?? 'Not provided'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center">
                <Calendar className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Registered</p>
                <p className="text-sm text-gray-100">{formatDateTime(owner.created_at)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Businesses</h2>
          {owner.businesses.length === 0 ? (
            <div className="text-center py-8">
              <Building2 className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No businesses registered yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {owner.businesses.map((biz) => (
                <div key={biz.id} className="flex items-center gap-4 p-3 bg-gray-800/30 rounded-xl border border-gray-700/20">
                  <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-100 truncate">{biz.name}</p>
                    {biz.address && <p className="text-xs text-gray-500 truncate">{biz.address}</p>}
                  </div>
                  <StatusBadge status={biz.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Status History</h2>
        {owner.status_history.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No status history available.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {owner.status_history.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 p-3 bg-gray-800/30 rounded-xl border border-gray-700/20">
                <div className="mt-0.5">
                  <StatusBadge status={entry.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-300">{entry.created_by}</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-500 text-xs">{formatDateTime(entry.created_at)}</span>
                  </div>
                  {entry.remarks && (
                    <p className="text-sm text-gray-400 mt-1">{entry.remarks}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal show={showRejectModal} onClose={() => { setShowRejectModal(false); rejectForm.reset(); }}>
        <div className="bg-gray-900 rounded-2xl border border-gray-700/30 p-6 w-full max-w-md">
          <h2 className="text-lg font-semibold text-gray-100 mb-2">Reject Business Owner</h2>
          <p className="text-sm text-gray-400 mb-6">Provide a reason for rejecting this business owner's registration.</p>
          <form onSubmit={rejectForm.handleSubmit((data) => rejectMutation.mutate(data))} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Remarks</label>
              <textarea
                {...rejectForm.register('remarks')}
                rows={3}
                placeholder="Explain the reason for rejection..."
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-emerald-500/50 resize-none"
              />
              {rejectForm.formState.errors.remarks && (
                <p className="text-red-400 text-xs mt-1">{rejectForm.formState.errors.remarks.message}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowRejectModal(false); rejectForm.reset(); }}
                className="px-4 py-2.5 rounded-xl border border-gray-700 text-sm font-medium text-gray-300 hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={rejectMutation.isPending}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  )
}
