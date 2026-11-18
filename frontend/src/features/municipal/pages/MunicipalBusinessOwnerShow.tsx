import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileText, Store } from 'lucide-react'
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
} from '@/features/municipal/components/MunicipalUi'
import { useModeration } from '@/features/municipal/hooks/use-moderation'
import { MUNICIPAL_API, type AccountRow, type BusinessRow, type DocumentLink } from '@/features/municipal/types'

interface OwnerDetail {
  owner: AccountRow & { profile?: { mobile_number?: string | null } | null }
  businesses: BusinessRow[]
  kyc: { government_id_type: string | null; verification_status: string | null; documents: DocumentLink[] } | null
  history: { status: string; remarks: string | null; reviewed_at: string | null }[]
}

export default function MunicipalBusinessOwnerShow() {
  const { id } = useParams()
  const moderation = useModeration(MUNICIPAL_API.BUSINESS_OWNERS)
  const [docError, setDocError] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['municipal', 'business-owner', id],
    queryFn: () => get<OwnerDetail>(`${MUNICIPAL_API.BUSINESS_OWNERS}/${id}`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (error || !data) return <Alert type="error" message={apiErrorMessage(error, 'Business owner not found.')} />

  const { owner, businesses, kyc, history } = data
  const openDoc = (url: string) => openAuthenticatedDocument(url).catch((e: Error) => setDocError(e.message))

  return (
    <div>
      <Link to="/municipal/business-owners" className="inline-flex items-center gap-1 text-sm text-[#2E8B57] hover:underline mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to business owners
      </Link>
      <PageHeader
        title={owner.name}
        subtitle={owner.email}
        actions={accountActions(owner.account_status).map((action) => (
          <ActionButton key={action} action={action} onClick={() => moderation.open(owner.id, owner.name, action)} />
        ))}
      />

      {moderation.notice && <Alert type="success" message={moderation.notice} onDismiss={moderation.clearNotice} />}
      {docError && <Alert type="error" message={docError} onDismiss={() => setDocError('')} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${card} p-5`} aria-label="Account">
          <h2 className="text-sm font-semibold text-[#1C2B22] mb-2">Account</h2>
          <dl>
            <DetailRow label="Status" value={<StatusBadge status={owner.account_status} />} />
            <DetailRow label="Mobile" value={owner.phone} />
            <DetailRow label="Registered" value={formatDate(owner.created_at)} />
            <DetailRow label="ID type" value={kyc?.government_id_type?.replace(/_/g, ' ')} />
            <DetailRow label="ID check" value={kyc?.verification_status} />
          </dl>
          {kyc && kyc.documents.length > 0 && (
            <div className="mt-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#66736B]">Identity documents</h3>
              {kyc.documents.map((doc) => (
                <button
                  key={doc.file_url}
                  type="button"
                  onClick={() => openDoc(doc.file_url)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E7E2D6] text-sm text-[#1C2B22] hover:border-[#2E8B57]"
                >
                  <FileText className="w-4 h-4 text-[#2E8B57]" /> {doc.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={`${card} p-5 lg:col-span-2`} aria-label="Businesses in this municipality">
          <h2 className="text-sm font-semibold text-[#1C2B22] mb-3">Businesses in this municipality</h2>
          {businesses.length === 0 ? (
            <p className="text-sm text-[#66736B]">No businesses registered here yet.</p>
          ) : (
            <ul className="divide-y divide-[#F1EDE3]">
              {businesses.map((b) => (
                <li key={b.id}>
                  <Link to={`/municipal/businesses/${b.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-[#FAF7F0] -mx-2 px-2 rounded-lg">
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-lg bg-[#E6F2EB] overflow-hidden flex items-center justify-center shrink-0">
                        {b.logo ? <img src={b.logo} alt="" className="w-full h-full object-cover" /> : <Store className="w-4 h-4 text-[#2E8B57]" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[#1C2B22] truncate">{b.business_name}</span>
                        <span className="block text-xs text-[#66736B] truncate">
                          {[b.category, b.barangay].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </span>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h2 className="text-sm font-semibold text-[#1C2B22] mt-6 mb-3">Review history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-[#66736B]">No decisions recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h, i) => (
                <li key={i} className="text-sm flex flex-wrap items-center gap-2">
                  <StatusBadge status={h.status} />
                  <span className="text-[#66736B]">{h.reviewed_at ? formatDateTime(h.reviewed_at) : ''}</span>
                  {h.remarks && <span className="text-[#1C2B22]">— {h.remarks}</span>}
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
