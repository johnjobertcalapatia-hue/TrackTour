import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { Business } from '@/shared/types'
import { formatDateTime } from '@/shared/utils'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Ban,
  FileText,
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  Clock,
  History,
} from 'lucide-react'

interface BusinessDocument {
  id: number
  name: string
  file_url: string
  file_path?: string
  document_number: string | null
  registered_name: string | null
  issued_by: string | null
  issue_date: string | null
  expiration_date: string | null
  owner_remarks: string | null
  admin_remarks: string | null
  verification_status: string
  required_document?: { id: number; name: string; is_expirable: boolean }
}

interface BusinessDetail extends Business {
  owner?: { id: number; name: string; email: string }
  documents?: BusinessDocument[]
  status_history?: { id: number; status: string; remarks: string; created_at: string; performed_by: string }[]
}

export default function AdminBusinessShow() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [approveModal, setApproveModal] = useState(false)
  const [rejectModal, setRejectModal] = useState(false)
  const [suspendModal, setSuspendModal] = useState(false)
  const [rejectRemarks, setRejectRemarks] = useState('')
  const [suspendRemarks, setSuspendRemarks] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [docFilter, setDocFilter] = useState('all')
  const [docReviewId, setDocReviewId] = useState<number | null>(null)
  const [docReviewStatus, setDocReviewStatus] = useState<string>('')
  const [docReviewRemarks, setDocReviewRemarks] = useState('')
  const [expandedDoc, setExpandedDoc] = useState<number | null>(null)

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const { data: business, isLoading } = useQuery({
    queryKey: ['admin-business', id],
    queryFn: () => get<BusinessDetail>(`/admin/businesses/${id}`),
    enabled: !!id,
  })

  const approveMutation = useMutation({
    mutationFn: () => post(`/admin/businesses/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-businesses'] })
      setApproveModal(false)
      flash('Business approved successfully.')
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () => post(`/admin/businesses/${id}/reject`, { remarks: rejectRemarks }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-businesses'] })
      setRejectModal(false)
      setRejectRemarks('')
    },
  })

  const suspendMutation = useMutation({
    mutationFn: () => post(`/admin/businesses/${id}/suspend`, { remarks: suspendRemarks }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-businesses'] })
      setSuspendModal(false)
      setSuspendRemarks('')
    },
  })

  const reviewDocMutation = useMutation({
    mutationFn: ({ docId, status, remarks }: { docId: number; status: string; remarks: string }) =>
      put(`/admin/businesses/${id}/documents/${docId}/review`, { verification_status: status, admin_remarks: remarks }),
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-business', id] })
      setDocReviewId(null)
      setDocReviewRemarks('')
      flash(status === 'verified' ? 'Document approved successfully.' : status === 'pending' ? 'Document resubmitted.' : 'Resubmission requested.')
    },
  })

  const openDocReview = (docId: number, status: string) => {
    setDocReviewId(docId)
    setDocReviewStatus(status)
    setDocReviewRemarks('')
  }

  if (isLoading) return <DashboardSkeleton />
  if (!business) return <div className="text-[#6B7280] text-center py-12">Business not found</div>

  const hasDocuments = business.documents && business.documents.length > 0
  const allDocsVerified = hasDocuments && business.documents!.every((d) => d.verification_status === 'verified')

  const filteredDocs = hasDocuments
    ? docFilter === 'all'
      ? business.documents!
      : business.documents!.filter((d) => d.verification_status === docFilter)
    : []

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {successMsg && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl bg-[#16803C] text-white text-sm font-medium shadow-lg shadow-[#16803C]/20 animate-in fade-in slide-in-from-top-2">
          {successMsg}
        </div>
      )}
      <Link
        to="/admin/businesses"
        className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201A] transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Businesses
      </Link>

      <div className="mb-8">
        <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">{business.name}</h1>
              <p className="mt-1 text-sm text-[#6B7280]">Business Details & Verification</p>
            </div>
            <StatusBadge status={business.status} size="md" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#16803C]" />
              Business Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Name</label>
                <p className="text-[#17201A] mt-1">{business.name}</p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Category</label>
                <p className="text-[#17201A] mt-1">{business.category}</p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Email</label>
                <p className="text-[#17201A] mt-1 flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-[#6B7280]" />
                  {business.email || '—'}
                </p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Contact</label>
                <p className="text-[#17201A] mt-1 flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-[#6B7280]" />
                  {business.phone || '—'}
                </p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Municipality</label>
                <p className="text-[#17201A] mt-1 flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#6B7280]" />
                  {business.municipality}
                </p>
              </div>
              <div>
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Barangay</label>
                <p className="text-[#17201A] mt-1">{business.barangay || '—'}</p>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-[#6B7280] uppercase tracking-wider">Address</label>
                <p className="text-[#17201A] mt-1">{business.address || '—'}</p>
              </div>
              {business.description && (
                <div className="sm:col-span-2">
                  <label className="text-xs text-[#6B7280] uppercase tracking-wider">Description</label>
                  <p className="text-[#6B7280] mt-1 text-sm leading-relaxed">{business.description}</p>
                </div>
              )}
            </div>
          </div>

          {business.documents && business.documents.length > 0 && (
            <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
              <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#16803C]" />
                Documents
              </h2>
              <div className="flex gap-1.5 mb-6 flex-wrap">
                {['all', 'pending', 'verified', 'flagged'].map((f) => (
                  <button
                    key={f}
                    onClick={() => { setDocFilter(f); setExpandedDoc(null); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      docFilter === f
                        ? 'bg-[#16803C] text-white'
                        : 'bg-white text-[#6B7280] border border-[#D7E8DB] hover:bg-[#F3F8F4]'
                    }`}
                  >
                    {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              {filteredDocs.length === 0 ? (
                <p className="text-sm text-[#6B7280] py-4 text-center">No documents match this filter.</p>
              ) : (
                <div className="space-y-3">
                  {filteredDocs.map((doc) => {
                    const isExpanded = expandedDoc === doc.id

                    return (
                      <div
                        key={doc.id}
                        className={`rounded-xl overflow-hidden transition-all duration-300 ${
                          isExpanded
                            ? 'bg-white border border-[#E2E8E3] shadow-tourism'
                            : 'bg-[#F8FAFC] border border-[#E2E8E3] hover:bg-white hover:shadow-tourism'
                        }`}
                      >
                        <div
                          className="px-4 py-3 flex items-center justify-between cursor-pointer"
                          onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                              <FileText className="w-4 h-4 text-[#16803C]" />
                            </div>
                            <span className="font-semibold text-sm text-[#17201A]">
                              {doc.required_document?.name || doc.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                              doc.verification_status === 'verified' ? 'bg-[#EAF6ED] text-[#16803C] border border-[#D7E8DB]' :
                              doc.verification_status === 'flagged' ? 'bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]' :
                              'bg-[#FFF7D6] text-[#D97706] border border-[#FDE68A]'
                            }`}>
                              {doc.verification_status}
                            </span>
                          </div>
                        </div>

                        <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                          <div className="px-4 pb-4 pt-1 space-y-3">
                            <div className="h-px bg-[#E2E8E3]" />
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                              {doc.document_number && (
                                <div><span className="text-[#6B7280]">Doc #:</span> <span className="text-[#17201A]">{doc.document_number}</span></div>
                              )}
                              {doc.registered_name && (
                                <div><span className="text-[#6B7280]">Name:</span> <span className="text-[#17201A]">{doc.registered_name}</span></div>
                              )}
                              {doc.issued_by && (
                                <div><span className="text-[#6B7280]">Issued by:</span> <span className="text-[#17201A]">{doc.issued_by}</span></div>
                              )}
                              {doc.issue_date && (
                                <div><span className="text-[#6B7280]">Issued:</span> <span className="text-[#17201A]">{doc.issue_date}</span></div>
                              )}
                              {doc.expiration_date && (
                                <div><span className="text-[#6B7280]">Expires:</span> <span className="text-[#17201A]">{doc.expiration_date}</span></div>
                              )}
                              {doc.owner_remarks && (
                                <div className="col-span-full"><span className="text-[#6B7280]">Remarks:</span> <span className="text-[#17201A]">{doc.owner_remarks}</span></div>
                              )}
                              {doc.admin_remarks && (
                                <div className="col-span-full"><span className="text-[#6B7280]">Admin:</span> <span className="text-[#17201A]">{doc.admin_remarks}</span></div>
                              )}
                            </div>

                            {(doc.file_url || doc.file_path) && (
                              <div className="bg-[#F8FAFC] rounded-lg p-3 border border-[#E2E8E3]">
                                <a
                                  href={doc.file_url ?? `/storage/${doc.file_path}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-[#16803C] hover:text-[#126B32] text-xs font-medium"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  View Document
                                </a>
                              </div>
                            )}

                            <div className="flex gap-2 pt-1">
                              {doc.verification_status !== 'verified' && (
                                <button
                                  onClick={() => openDocReview(doc.id, 'verified')}
                                  className="px-3 py-1.5 rounded-lg bg-[#EAF6ED] hover:bg-[#D1FAE5] text-[#16803C] text-xs font-medium transition border border-[#D7E8DB]"
                                >
                                  Approve
                                </button>
                              )}
                              {doc.verification_status !== 'flagged' && (
                                <button
                                  onClick={() => openDocReview(doc.id, 'flagged')}
                                  className="px-3 py-1.5 rounded-lg bg-[#FEE2E2] hover:bg-[#FECACA] text-[#DC2626] text-xs font-medium transition border border-[#FECACA]"
                                >
                                  Request Resubmission
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {business.status_history && business.status_history.length > 0 && (
            <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
              <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
                <History className="w-5 h-5 text-[#16803C]" />
                Status History
              </h2>
              <div className="space-y-3">
                {business.status_history.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8E3]"
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
          {business.owner && (
            <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
              <h2 className="text-lg font-semibold text-[#17201A] mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-[#16803C]" />
                Owner
              </h2>
              <div className="space-y-2">
                <p className="text-[#17201A] font-medium">{business.owner.name}</p>
                <p className="text-[#6B7280] text-sm flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5" />
                  {business.owner.email}
                </p>
              </div>
            </div>
          )}

          <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Actions</h2>
            <div className="space-y-3">
              <button
                onClick={() => setApproveModal(true)}
                disabled={business.status === 'approved' || business.status === 'active' || (hasDocuments && !allDocsVerified)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  business.status === 'approved' || business.status === 'active'
                    ? 'Business is already approved'
                    : hasDocuments && !allDocsVerified
                    ? 'All documents must be approved first'
                    : ''
                }
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
              <button
                onClick={() => setRejectModal(true)}
                disabled={business.status === 'approved' || business.status === 'active' || business.status === 'rejected'}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#DC2626] hover:bg-[#B91C1C] text-white rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  business.status === 'approved' || business.status === 'active'
                    ? 'Cannot reject an approved business'
                    : business.status === 'rejected'
                    ? 'Business is already rejected'
                    : ''
                }
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
              {business.status !== 'suspended' && business.status !== 'rejected' && (
                <button
                  onClick={() => setSuspendModal(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#F59E0B] hover:bg-[#D97706] text-white rounded-xl text-sm font-medium transition"
                >
                  <Ban className="w-4 h-4" />
                  Suspend
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-3">Quick Info</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#6B7280]">Created</span>
                <span className="text-[#17201A]">{formatDateTime(business.created_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#6B7280]">Status</span>
                <StatusBadge status={business.status} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal show={approveModal} onClose={() => setApproveModal(false)} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-2">Approve Business</h2>
          <p className="text-sm text-[#6B7280] mb-6">
            Are you sure you want to approve <span className="text-[#17201A] font-medium">{business.name}</span>?
            This will set their status to active.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setApproveModal(false)}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {approveMutation.isPending ? 'Approving...' : 'Approve'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal show={rejectModal} onClose={() => setRejectModal(false)} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-2">Reject Business</h2>
          <p className="text-sm text-[#6B7280] mb-4">
            Are you sure you want to reject <span className="text-[#17201A] font-medium">{business.name}</span>?
          </p>
          <div className="mb-6">
            <label className="block text-sm font-medium text-[#17201A] mb-2">Remarks (required)</label>
            <textarea
              value={rejectRemarks}
              onChange={(e) => setRejectRemarks(e.target.value)}
              rows={3}
              placeholder="Provide a reason for rejection..."
              className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#DC2626]/50 focus:border-[#DC2626]/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setRejectModal(false); setRejectRemarks('') }}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || !rejectRemarks.trim()}
              className="px-4 py-2.5 bg-[#DC2626] hover:bg-[#B91C1C] text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal show={suspendModal} onClose={() => setSuspendModal(false)} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-2">Suspend Business</h2>
          <p className="text-sm text-[#6B7280] mb-4">
            Are you sure you want to suspend <span className="text-[#17201A] font-medium">{business.name}</span>?
          </p>
          <div className="mb-6">
            <label className="block text-sm font-medium text-[#17201A] mb-2">Remarks (required)</label>
            <textarea
              value={suspendRemarks}
              onChange={(e) => setSuspendRemarks(e.target.value)}
              rows={3}
              placeholder="Provide a reason for suspension..."
              className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/50 focus:border-[#F59E0B]/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setSuspendModal(false); setSuspendRemarks('') }}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() => suspendMutation.mutate()}
              disabled={suspendMutation.isPending || !suspendRemarks.trim()}
              className="px-4 py-2.5 bg-[#F59E0B] hover:bg-[#D97706] text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {suspendMutation.isPending ? 'Suspending...' : 'Suspend'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal show={docReviewId !== null} onClose={() => setDocReviewId(null)} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-2">
            {docReviewStatus === 'verified' ? 'Approve Document' : 'Request Resubmission'}
          </h2>
          <p className="text-sm text-[#6B7280] mb-4">
            {docReviewStatus === 'verified'
              ? 'Confirm this document is valid and complete.'
              : 'Request the business owner to resubmit this document with corrections.'}
          </p>
          <div className="mb-6">
            <label className="block text-sm font-medium text-[#17201A] mb-2">
              Remarks {docReviewStatus === 'flagged' ? <span className="text-[#DC2626]">(required)</span> : '(optional)'}
            </label>
            <textarea
              value={docReviewRemarks}
              onChange={(e) => setDocReviewRemarks(e.target.value)}
              rows={3}
              placeholder={docReviewStatus === 'flagged' ? 'Explain what needs to be corrected...' : 'Add notes...'}
              className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDocReviewId(null)}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                reviewDocMutation.mutate({ docId: docReviewId!, status: docReviewStatus, remarks: docReviewRemarks })
              }
              disabled={reviewDocMutation.isPending || (docReviewStatus === 'flagged' && !docReviewRemarks.trim())}
              className={`px-4 py-2.5 text-white rounded-xl text-sm font-medium transition disabled:opacity-50 ${
                docReviewStatus === 'verified'
                  ? 'bg-[#16803C] hover:bg-[#126B32]'
                  : 'bg-[#DC2626] hover:bg-[#B91C1C]'
              }`}
            >
              {reviewDocMutation.isPending ? 'Updating...' : docReviewStatus === 'verified' ? 'Approve' : 'Request Resubmission'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Folder UI Styles */}
    </div>
  )
}
