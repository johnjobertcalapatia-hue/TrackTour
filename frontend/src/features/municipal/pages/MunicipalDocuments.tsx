import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, CheckCircle2, FileCheck2, FileText, Flag } from 'lucide-react'
import { apiErrorMessage, get, openAuthenticatedDocument, put } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { cn, formatDate } from '@/shared/utils'
import { card, EmptyState, ListFilters, PageHeader, Pagination } from '@/features/municipal/components/MunicipalUi'
import {
  MUNICIPAL_API,
  type DocumentQueueRow,
  type ListResponse,
  type RiderRequirementRow,
} from '@/features/municipal/types'

const docBadge = (status: string) => (status === 'verified' ? 'approved' : status === 'flagged' ? 'rejected' : 'pending')

export default function MunicipalDocuments() {
  const [params, setParams] = useSearchParams()
  const type = params.get('type') === 'rider' ? 'rider' : 'business'
  const status = params.get('status') ?? 'pending'
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const debounced = useDebounce(search)
  const queryClient = useQueryClient()

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params)
    Object.entries(next).forEach(([k, v]) => merged.set(k, v))
    setParams(merged, { replace: true })
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['municipal', 'documents', type, status, debounced, page],
    queryFn: () =>
      get<ListResponse<DocumentQueueRow | RiderRequirementRow>>(MUNICIPAL_API.DOCUMENTS, {
        params: { type, status: type === 'business' ? status : undefined, search: debounced || undefined, page },
      }),
    placeholderData: keepPreviousData,
  })

  const review = useMutation({
    mutationFn: ({ doc, verification_status }: { doc: DocumentQueueRow; verification_status: 'verified' | 'flagged' }) =>
      put(`${MUNICIPAL_API.BUSINESSES}/${doc.business.id}/documents/${doc.id}/review`, { verification_status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['municipal'] }),
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const stats = data?.meta.stats ?? {}
  const rows = data?.data ?? []
  const openDoc = (url: string) => openAuthenticatedDocument(url).catch((e: Error) => setError(e.message))

  return (
    <div>
      <PageHeader title="Documents" subtitle="Verify permits, licenses and requirements submitted to your municipality." />
      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <div className="mb-4 inline-flex rounded-xl border border-[#E7E2D6] bg-white p-1" role="tablist" aria-label="Document type">
        {([
          ['business', 'Business documents', FileText, (stats.business_pending ?? 0)],
          ['rider', 'Rider requirements', Bike, (stats.riders_pending ?? 0)],
        ] as const).map(([value, label, Icon, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={type === value}
            onClick={() => update({ type: value })}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
              type === value ? 'bg-[#0F2E1D] text-white' : 'text-[#1C2B22] hover:bg-[#FAF7F0]'
            )}
          >
            <Icon className="w-4 h-4" aria-hidden="true" /> {label}
            {count > 0 && <span className="rounded-full bg-[#FFD700] px-1.5 text-[11px] font-bold text-[#5C4A00]">{count}</span>}
          </button>
        ))}
      </div>

      <ListFilters
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        placeholder={type === 'business' ? 'Search by business name' : 'Search riders by name or email'}
        status={type === 'business' ? status : undefined}
        onStatus={type === 'business' ? (v) => update({ status: v }) : undefined}
        options={
          type === 'business'
            ? [
                { value: 'pending', label: 'Waiting', count: stats.business_pending },
                { value: 'flagged', label: 'Flagged', count: stats.business_flagged },
                { value: 'verified', label: 'Verified', count: stats.business_verified },
                { value: 'all', label: 'All' },
              ]
            : undefined
        }
      />

      {isLoading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={FileCheck2} message={type === 'business' ? 'No documents in this list.' : 'No rider applications waiting for review.'} />
      ) : type === 'business' ? (
        <ul className={`${card} divide-y divide-[#F1EDE3]`}>
          {(rows as DocumentQueueRow[]).map((doc) => (
            <li key={doc.id} className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1C2B22] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#2E8B57] shrink-0" aria-hidden="true" /> {doc.name}
                </p>
                <p className="text-xs text-[#66736B] mt-0.5">
                  <Link to={`/municipal/businesses/${doc.business.id}`} className="font-medium text-[#2E8B57] hover:underline">
                    {doc.business.business_name}
                  </Link>
                  {doc.business.category ? ` · ${doc.business.category}` : ''} · uploaded {formatDate(doc.uploaded_at)}
                  {doc.expiration_date ? ` · expires ${formatDate(doc.expiration_date)}` : ''}
                </p>
                {doc.admin_remarks && <p className="text-xs text-amber-700 mt-0.5">Remarks: {doc.admin_remarks}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={docBadge(doc.verification_status)} />
                {doc.file_url && (
                  <button type="button" onClick={() => openDoc(doc.file_url!)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#CFE5D7] text-[#2E8B57] hover:bg-[#F1F7F3]">
                    View
                  </button>
                )}
                {doc.verification_status !== 'verified' && (
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ doc, verification_status: 'verified' })}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2E8B57] text-white hover:bg-[#257347] inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Verify
                  </button>
                )}
                {doc.verification_status !== 'flagged' && (
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ doc, verification_status: 'flagged' })}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Flag className="w-3.5 h-3.5" /> Flag
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className={`${card} divide-y divide-[#F1EDE3]`}>
          {(rows as RiderRequirementRow[]).map((rider) => (
            <li key={rider.id} className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
              <div className="min-w-0">
                <Link to={`/municipal/riders/${rider.id}`} className="text-sm font-semibold text-[#1C2B22] hover:text-[#2E8B57]">
                  {rider.name}
                </Link>
                <p className="text-xs text-[#66736B]">
                  {[rider.vehicle_type, rider.license_number && `License ${rider.license_number}`, rider.license_expiry && `expires ${formatDate(rider.license_expiry)}`]
                    .filter(Boolean)
                    .join(' · ') || 'No license details'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(rider.documents ?? []).length === 0 && <span className="text-xs text-amber-700">No documents uploaded</span>}
                {(rider.documents ?? []).map((d) => (
                  <button key={d.file_url} type="button" onClick={() => openDoc(d.file_url)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E7E2D6] text-[#1C2B22] hover:border-[#2E8B57]">
                    {d.name}
                  </button>
                ))}
                <Link to={`/municipal/riders/${rider.id}`} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2E8B57] text-white hover:bg-[#257347]">
                  Review rider
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination meta={data?.meta} onPage={setPage} noun={type === 'business' ? 'documents' : 'riders'} />
    </div>
  )
}
