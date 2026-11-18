import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Bike } from 'lucide-react'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { formatDate } from '@/shared/utils'
import {
  ActionButton,
  accountActions,
  card,
  EmptyState,
  ListFilters,
  ModerationDialog,
  PageHeader,
  Pagination,
  RiderPresence,
} from '@/features/municipal/components/MunicipalUi'
import { useModeration } from '@/features/municipal/hooks/use-moderation'
import { MUNICIPAL_API, type ListResponse, type RiderRow } from '@/features/municipal/types'

export default function MunicipalRiders() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounce(search)
  const moderation = useModeration(MUNICIPAL_API.RIDERS)

  const { data, isLoading } = useQuery({
    queryKey: ['municipal', 'riders', debounced, status, page],
    queryFn: () =>
      get<ListResponse<RiderRow>>(MUNICIPAL_API.RIDERS, {
        params: { search: debounced || undefined, status: status || undefined, page },
      }),
    placeholderData: keepPreviousData,
  })

  const stats = data?.meta.stats ?? {}
  const riders = data?.data ?? []

  return (
    <div>
      <PageHeader
        title="Riders"
        subtitle={`Riders registered in your municipality${stats.active_now !== undefined ? ` · ${stats.active_now} online now` : ''}.`}
      />

      {moderation.notice && <Alert type="success" message={moderation.notice} onDismiss={moderation.clearNotice} />}

      <ListFilters
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        placeholder="Search by name, email or mobile number"
        status={status}
        onStatus={(v) => {
          setStatus(v)
          setPage(1)
        }}
        options={[
          { value: '', label: 'All', count: stats.total },
          { value: 'pending_review', label: 'Pending', count: stats.pending },
          { value: 'approved', label: 'Approved', count: stats.approved },
          { value: 'suspended', label: 'Suspended', count: stats.suspended },
          { value: 'rejected', label: 'Rejected', count: stats.rejected },
        ]}
      />

      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : riders.length === 0 ? (
        <EmptyState icon={Bike} message="No riders match these filters." />
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7E2D6] bg-[#FAF7F0] text-left text-xs font-semibold uppercase tracking-wider text-[#66736B]">
                  <th className="px-5 py-3">Rider</th>
                  <th className="px-5 py-3">Vehicle</th>
                  <th className="px-5 py-3">Presence</th>
                  <th className="px-5 py-3">Account</th>
                  <th className="px-5 py-3">Registered</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EDE3]">
                {riders.map((rider) => (
                  <tr key={rider.id} className="hover:bg-[#FAF7F0]">
                    <td className="px-5 py-3">
                      <Link to={`/municipal/riders/${rider.id}`} className="font-medium text-[#1C2B22] hover:text-[#2E8B57]">
                        {rider.name}
                      </Link>
                      <p className="text-xs text-[#66736B]">{rider.phone ?? rider.email}</p>
                    </td>
                    <td className="px-5 py-3 text-[#1C2B22] capitalize">{rider.vehicle_type ?? '—'}</td>
                    <td className="px-5 py-3">
                      <RiderPresence status={rider.rider_status} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={rider.account_status} />
                    </td>
                    <td className="px-5 py-3 text-[#66736B] whitespace-nowrap">{formatDate(rider.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        {accountActions(rider.account_status).map((action) => (
                          <ActionButton key={action} action={action} onClick={() => moderation.open(rider.id, rider.name, action)} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination meta={data?.meta} onPage={setPage} noun="riders" />

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
