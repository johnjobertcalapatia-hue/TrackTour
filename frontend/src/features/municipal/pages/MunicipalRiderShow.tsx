import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileText } from 'lucide-react'
import { get, apiErrorMessage, openAuthenticatedDocument } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate, formatDateTime } from '@/shared/utils'
import {
  ActionButton,
  accountActions,
  card,
  DetailRow,
  ModerationDialog,
  PageHeader,
  RiderPresence,
} from '@/features/municipal/components/MunicipalUi'
import { useModeration } from '@/features/municipal/hooks/use-moderation'
import { MUNICIPAL_API, type DocumentLink, type RiderRow } from '@/features/municipal/types'

interface RiderDetail extends RiderRow {
  plate_number: string | null
  documents?: DocumentLink[]
  history: { decision: string; remarks: string | null; reviewed_by: string | null; created_at: string }[]
}

export default function MunicipalRiderShow() {
  const { id } = useParams()
  const moderation = useModeration(MUNICIPAL_API.RIDERS)
  const [docError, setDocError] = useState('')

  const { data: rider, isLoading, error } = useQuery({
    queryKey: ['municipal', 'rider', id],
    queryFn: () => get<RiderDetail>(`${MUNICIPAL_API.RIDERS}/${id}`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (error || !rider) return <Alert type="error" message={apiErrorMessage(error, 'Rider not found.')} />

  const decisionStatus = (d: string) => (d === 'reactivated' ? 'approved' : d)

  return (
    <div>
      <Link to="/municipal/riders" className="inline-flex items-center gap-1 text-sm text-[#2E8B57] hover:underline mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to riders
      </Link>
      <PageHeader
        title={rider.name}
        subtitle={rider.email}
        actions={accountActions(rider.account_status).map((action) => (
          <ActionButton key={action} action={action} onClick={() => moderation.open(rider.id, rider.name, action)} />
        ))}
      />

      {moderation.notice && <Alert type="success" message={moderation.notice} onDismiss={moderation.clearNotice} />}
      {docError && <Alert type="error" message={docError} onDismiss={() => setDocError('')} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${card} p-5`} aria-label="Rider profile">
          <dl>
            <DetailRow label="Account" value={<StatusBadge status={rider.account_status} />} />
            <DetailRow label="Presence" value={<RiderPresence status={rider.rider_status} />} />
            <DetailRow label="Service" value={rider.current_service} />
            <DetailRow label="Vehicle" value={rider.vehicle_type} />
            <DetailRow label="Plate number" value={rider.plate_number} />
            <DetailRow label="Mobile" value={rider.phone} />
            <DetailRow label="Registered" value={formatDate(rider.created_at)} />
          </dl>
        </section>

        <section className={`${card} p-5`} aria-label="Documents">
          <h2 className="text-sm font-semibold text-[#1C2B22] mb-3">Documents</h2>
          {!rider.documents || rider.documents.length === 0 ? (
            <p className="text-sm text-[#66736B]">No documents uploaded.</p>
          ) : (
            <div className="space-y-2">
              {rider.documents.map((doc) => (
                <button
                  key={doc.file_url}
                  type="button"
                  onClick={() => openAuthenticatedDocument(doc.file_url).catch((e: Error) => setDocError(e.message))}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E7E2D6] text-sm text-[#1C2B22] hover:border-[#2E8B57]"
                >
                  <FileText className="w-4 h-4 text-[#2E8B57]" /> {doc.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={`${card} p-5`} aria-label="Review history">
          <h2 className="text-sm font-semibold text-[#1C2B22] mb-3">Review history</h2>
          {rider.history.length === 0 ? (
            <p className="text-sm text-[#66736B]">No decisions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {rider.history.map((h, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={decisionStatus(h.decision)} />
                    <span className="text-xs text-[#66736B]">{formatDateTime(h.created_at)}</span>
                  </div>
                  {h.remarks && <p className="mt-1 text-[#1C2B22]">{h.remarks}</p>}
                  {h.reviewed_by && <p className="text-xs text-[#66736B]">by {h.reviewed_by}</p>}
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
