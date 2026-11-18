import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { formatDateTime } from '@/shared/utils'
import { card, EmptyState, inputClass, ListFilters, PageHeader, Pagination } from '@/features/municipal/components/MunicipalUi'
import { MUNICIPAL_API, type ActivityEntry, type ListResponse } from '@/features/municipal/types'

const AREAS = [
  { value: '', label: 'All' },
  { value: 'business_owner', label: 'Business owners' },
  { value: 'business', label: 'Businesses' },
  { value: 'business_document', label: 'Documents' },
  { value: 'rider', label: 'Riders' },
  { value: 'municipal', label: 'Office profile' },
]

const ACTION_TONE: Record<string, string> = {
  approved: 'bg-[#E6F2EB] text-[#257347]',
  reactivated: 'bg-[#E6F2EB] text-[#257347]',
  reviewed: 'bg-sky-50 text-sky-700',
  rejected: 'bg-red-50 text-red-700',
  suspended: 'bg-red-50 text-red-700',
}

function actionLabel(action: string) {
  const verb = action.split('.').pop() ?? action
  return { verb: verb.replace(/_/g, ' '), tone: ACTION_TONE[verb] ?? 'bg-[#F1EDE3] text-[#4E5A52]' }
}

export default function MunicipalActivityLogs() {
  const [search, setSearch] = useState('')
  const [area, setArea] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounce(search)

  const { data, isLoading } = useQuery({
    queryKey: ['municipal', 'activity-logs', debounced, area, from, to, page],
    queryFn: () =>
      get<ListResponse<ActivityEntry>>(MUNICIPAL_API.ACTIVITY_LOGS, {
        params: { search: debounced || undefined, area: area || undefined, from: from || undefined, to: to || undefined, page },
      }),
    placeholderData: keepPreviousData,
  })

  const logs = data?.data ?? []

  return (
    <div>
      <PageHeader title="Activity Logs" subtitle="Every approval, suspension and document decision made by your Tourism Office." />

      <ListFilters
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        placeholder="Search actions or descriptions"
        status={area}
        onStatus={(v) => {
          setArea(v)
          setPage(1)
        }}
        options={AREAS}
      />
      <div className={`${card} -mt-2 mb-5 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl`}>
        <label className="text-xs font-medium text-[#66736B]">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-xs font-medium text-[#66736B]">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1) }} className={`${inputClass} mt-1`} />
        </label>
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} cols={4} />
      ) : logs.length === 0 ? (
        <EmptyState icon={Activity} message="No activity matches these filters." />
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7E2D6] bg-[#FAF7F0] text-left text-xs font-semibold uppercase tracking-wider text-[#66736B]">
                  <th className="px-5 py-3">When</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Details</th>
                  <th className="px-5 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EDE3]">
                {logs.map((log) => {
                  const { verb, tone } = actionLabel(log.action)
                  return (
                    <tr key={log.id} className="align-top">
                      <td className="px-5 py-3 text-[#66736B] whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${tone}`}>{verb}</span>
                      </td>
                      <td className="px-5 py-3 text-[#1C2B22]">{log.description}</td>
                      <td className="px-5 py-3 text-[#66736B] whitespace-nowrap">{log.actor}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination meta={data?.meta} onPage={setPage} noun="entries" />
    </div>
  )
}
