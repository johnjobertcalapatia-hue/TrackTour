import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Store } from 'lucide-react'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { formatDate } from '@/shared/utils'
import { card, EmptyState, ListFilters, PageHeader, Pagination } from '@/features/municipal/components/MunicipalUi'
import { MUNICIPAL_API, type BusinessRow, type ListResponse } from '@/features/municipal/types'

export default function MunicipalBusinesses() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounce(search)

  const { data, isLoading } = useQuery({
    queryKey: ['municipal', 'businesses', debounced, status, page],
    queryFn: () =>
      get<ListResponse<BusinessRow>>(MUNICIPAL_API.BUSINESSES, {
        params: { search: debounced || undefined, status: status || undefined, page },
      }),
    placeholderData: keepPreviousData,
  })

  const stats = data?.meta.stats ?? {}
  const businesses = data?.data ?? []

  return (
    <div>
      <PageHeader
        title="Businesses"
        subtitle="Verify documents and approve the restaurants, stays and attractions registered in your municipality."
      />

      <ListFilters
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        placeholder="Search by business, address or owner"
        status={status}
        onStatus={(v) => {
          setStatus(v)
          setPage(1)
        }}
        options={[
          { value: '', label: 'All', count: stats.total },
          { value: 'pending', label: 'Pending review', count: stats.pending },
          { value: 'approved', label: 'Approved', count: stats.approved },
          { value: 'suspended', label: 'Suspended', count: stats.suspended },
          { value: 'rejected', label: 'Rejected', count: stats.rejected },
        ]}
      />

      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : businesses.length === 0 ? (
        <EmptyState icon={Store} message="No businesses match these filters." />
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7E2D6] bg-[#FAF7F0] text-left text-xs font-semibold uppercase tracking-wider text-[#66736B]">
                  <th className="px-5 py-3">Business</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Barangay</th>
                  <th className="px-5 py-3">Owner</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EDE3]">
                {businesses.map((b) => (
                  <tr key={b.id} className="hover:bg-[#FAF7F0]">
                    <td className="px-5 py-3">
                      <Link to={`/municipal/businesses/${b.id}`} className="flex items-center gap-3 group">
                        <span className="w-9 h-9 rounded-lg bg-[#E6F2EB] overflow-hidden flex items-center justify-center shrink-0">
                          {b.logo ? <img src={b.logo} alt="" className="w-full h-full object-cover" /> : <Store className="w-4 h-4 text-[#2E8B57]" />}
                        </span>
                        <span className="font-medium text-[#1C2B22] group-hover:text-[#2E8B57]">{b.business_name}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[#1C2B22]">{b.category ?? '—'}</td>
                    <td className="px-5 py-3 text-[#1C2B22]">{b.barangay ?? '—'}</td>
                    <td className="px-5 py-3 text-[#66736B]">{b.owner?.name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-5 py-3 text-[#66736B] whitespace-nowrap">{formatDate(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination meta={data?.meta} onPage={setPage} noun="businesses" />
    </div>
  )
}
