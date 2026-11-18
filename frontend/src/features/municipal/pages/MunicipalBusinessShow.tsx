import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, FileText, Flag, Store } from 'lucide-react'
import { get, put, apiErrorMessage, openAuthenticatedDocument } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate } from '@/shared/utils'
import {
  ActionButton,
  card,
  DetailRow,
  ModerationDialog,
  PageHeader,
} from '@/features/municipal/components/MunicipalUi'
import { useModeration } from '@/features/municipal/hooks/use-moderation'
import { MUNICIPAL_API, type BusinessRow, type ModerationAction } from '@/features/municipal/types'

function businessActions(status: string): ModerationAction[] {
  if (status === 'approved') return ['suspend']
  if (status === 'suspended' || status === 'rejected') return ['approve']
  return ['approve', 'reject']
}

export default function MunicipalBusinessShow() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const moderation = useModeration(MUNICIPAL_API.BUSINESSES)
  const [docError, setDocError] = useState('')

  const { data: business, isLoading, error } = useQuery({
    queryKey: ['municipal', 'business', id],
    queryFn: () => get<BusinessRow>(`${MUNICIPAL_API.BUSINESSES}/${id}`),
  })

  const review = useMutation({
    mutationFn: ({ docId, status }: { docId: number; status: 'verified' | 'flagged' }) =>
      put(`${MUNICIPAL_API.BUSINESSES}/${id}/documents/${docId}/review`, { verification_status: status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['municipal'] }),
    onError: (e) => setDocError(apiErrorMessage(e)),
  })

  if (isLoading) return <DashboardSkeleton />
  if (error || !business) return <Alert type="error" message={apiErrorMessage(error, 'Business not found.')} />

  const documents = business.documents ?? []
  const unverified = documents.filter((d) => d.verification_status !== 'verified').length
  const label = business.status === 'suspended' || business.status === 'rejected' ? 'Reinstate' : undefined

  return (
    <div>
      <Link to="/municipal/businesses" className="inline-flex items-center gap-1 text-sm text-[#2E8B57] hover:underline mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to businesses
      </Link>
      <PageHeader
        title={business.business_name}
        subtitle={[business.category, business.barangay].filter(Boolean).join(' · ')}
        actions={businessActions(business.status).map((action) => (
          <ActionButton
            key={action}
            action={action}
            label={action === 'approve' ? label : undefined}
            disabled={action === 'approve' && unverified > 0}
            onClick={() => moderation.open(business.id, business.business_name, action)}
          />
        ))}
      />

      {moderation.notice && <Alert type="success" message={moderation.notice} onDismiss={moderation.clearNotice} />}
      {docError && <Alert type="error" message={docError} onDismiss={() => setDocError('')} />}
      {unverified > 0 && business.status !== 'approved' && (
        <Alert type="info" message={`Verify all documents before approving. ${unverified} document(s) still need review.`} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${card} p-5`} aria-label="Business details">
          <div className="w-14 h-14 rounded-xl bg-[#E6F2EB] overflow-hidden flex items-center justify-center mb-3">
            {business.logo ? <img src={business.logo} alt="" className="w-full h-full object-cover" /> : <Store className="w-6 h-6 text-[#2E8B57]" />}
          </div>
          <dl>
            <DetailRow label="Status" value={<StatusBadge status={business.status} />} />
            <DetailRow label="Owner" value={business.owner ? <Link className="text-[#2E8B57] hover:underline" to={`/municipal/business-owners/${business.owner.id}`}>{business.owner.name}</Link> : null} />
            <DetailRow label="Contact" value={business.contact_number} />
            <DetailRow label="Email" value={business.email} />
            <DetailRow label="Address" value={business.address} />
            <DetailRow label="Registered" value={formatDate(business.created_at)} />
          </dl>
          {business.business_description && (
            <p className="mt-4 text-sm text-[#4E5A52] whitespace-pre-line">{business.business_description}</p>
          )}
        </section>

        <section className={`${card} p-5 lg:col-span-2`} aria-label="Documents">
          <h2 className="text-sm font-semibold text-[#1C2B22] mb-3">Required documents</h2>
          {documents.length === 0 ? (
            <p className="text-sm text-[#66736B]">No documents uploaded.</p>
          ) : (
            <ul className="divide-y divide-[#F1EDE3]">
              {documents.map((doc) => (
                <li key={doc.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1C2B22] flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#2E8B57] shrink-0" /> {doc.name}
                    </p>
                    <p className="text-xs text-[#66736B] mt-0.5">
                      {[doc.document_number && `No. ${doc.document_number}`, doc.expiration_date && `Expires ${formatDate(doc.expiration_date)}`]
                        .filter(Boolean)
                        .join(' · ') || 'No details provided'}
                    </p>
                    {doc.admin_remarks && <p className="text-xs text-amber-700 mt-0.5">Remarks: {doc.admin_remarks}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={doc.verification_status === 'flagged' ? 'rejected' : doc.verification_status === 'verified' ? 'approved' : 'pending'} />
                    {doc.file_url && (
                      <button
                        type="button"
                        onClick={() => openAuthenticatedDocument(doc.file_url!).catch((e: Error) => setDocError(e.message))}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#CFE5D7] text-[#2E8B57] hover:bg-[#F1F7F3]"
                      >
                        View
                      </button>
                    )}
                    {doc.verification_status !== 'verified' && (
                      <button
                        type="button"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ docId: doc.id, status: 'verified' })}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2E8B57] text-white hover:bg-[#257347] inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Verify
                      </button>
                    )}
                    {doc.verification_status !== 'flagged' && (
                      <button
                        type="button"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ docId: doc.id, status: 'flagged' })}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Flag className="w-3.5 h-3.5" /> Flag
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ModerationDialog
        open={moderation.target !== null}
        action={moderation.target?.action ?? null}
        subject={moderation.target?.label ?? ''}
        pending={moderation.pending}
        error={moderation.error}
        onCancel={moderation.cancel}
        onConfirm={moderation.confirm}
      />
    </div>
  )
}
