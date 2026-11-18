import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { formatDate } from '@/shared/utils'
import { card, EmptyState, ListFilters, PageHeader, Pagination } from '@/features/municipal/components/MunicipalUi'
import { MUNICIPAL_API, type ListResponse, type TouristRow } from '@/features/municipal/types'

export default function MunicipalTourists() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounce(search)

  const { data, isLoading } = useQuery({
    queryKey: ['municipal', 'tourists', debounced, page],
    queryFn: () =>
      get<ListResponse<TouristRow>>(MUNICIPAL_API.TOURISTS, {
        params: { search: debounced || undefined, page },
      }),
    placeholderData: keepPreviousData,
  })

  const tourists = data?.data ?? []

  return (
    <div>
      <PageHeader
        title="Tourists"
        subtitle={`Tourists who ordered from or booked with businesses in your municipality${data ? ` · ${data.meta.stats.total} total` : ''}. Tourist accounts are managed by the Bansud Tourism Office.`}
      />

      <ListFilters
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        placeholder="Search by name or email"
      />

      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : tourists.length === 0 ? (
        <EmptyState icon={UserCheck} message="No tourists have transacted with businesses here yet." />
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7E2D6] bg-[#FAF7F0] text-left text-xs font-semibold uppercase tracking-wider text-[#66736B]">
                  <th className="px-5 py-3">Tourist</th>
                  <th className="px-5 py-3">Nationality</th>
                  <th className="px-5 py-3">Orders</th>
                  <th className="px-5 py-3">Bookings</th>
                  <th className="px-5 py-3">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EDE3]">
                {tourists.map((t) => (
                  <tr key={t.id} className="hover:bg-[#FAF7F0]">
                    <td className="px-5 py-3">
                      <Link to={`/municipal/tourists/${t.id}`} className="font-medium text-[#1C2B22] hover:text-[#2E8B57]">
                        {t.name}
                      </Link>
                      <p className="text-xs text-[#66736B]">{t.email}</p>
                    </td>
                    <td className="px-5 py-3 text-[#1C2B22]">{t.nationality ?? '—'}</td>
                    <td className="px-5 py-3 text-[#1C2B22]">{t.orders_count}</td>
                    <td className="px-5 py-3 text-[#1C2B22]">{t.bookings_count}</td>
                    <td className="px-5 py-3 text-[#66736B] whitespace-nowrap">
                      {t.last_activity_at ? formatDate(t.last_activity_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination meta={data?.meta} onPage={setPage} noun="tourists" />
    </div>
  )
}
