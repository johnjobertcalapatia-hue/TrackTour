import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDate } from '@/shared/utils'
import type { User } from '@/shared/types'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'

interface BusinessOwnerUser extends User {
  business_count: number
}

const ITEMS_PER_PAGE = 8

export default function TourismOfficeBusinessOwners() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['to-business-owners'],
    queryFn: () => get<{ data: BusinessOwnerUser[] }>('/tourism-office/business-owners'),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, account_status }: { id: number; account_status: string }) =>
      patch(`/tourism-office/business-owners/${id}/status`, { account_status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['to-business-owners'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const owners = data?.data ?? []
  const totalPages = Math.ceil(owners.length / ITEMS_PER_PAGE)
  const paginated = owners.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Business Owners</h1>
        <p className="mt-1 text-sm text-gray-400">Manage registered business owners</p>
      </div>

      {owners.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No business owners registered yet.</p>
        </div>
      ) : (
        <>
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/50 bg-gray-800/30">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Name</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Email</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Businesses</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Joined</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {paginated.map((owner) => (
                    <tr key={owner.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 text-xs font-bold">
                            {owner.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-100">{owner.name}</span>
                        </div>
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-gray-300 whitespace-nowrap">{owner.email}</td>
                      <td className="px-5 lg:px-6 py-3 text-gray-300 whitespace-nowrap">{owner.business_count}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={owner.account_status} /></td>
                      <td className="px-5 lg:px-6 py-3 text-gray-400 whitespace-nowrap">{formatDate(owner.created_at)}</td>
                      <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                        {owner.account_status === 'pending_review' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => statusMutation.mutate({ id: owner.id, account_status: 'active' })}
                              disabled={statusMutation.isPending}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => statusMutation.mutate({ id: owner.id, account_status: 'suspended' })}
                              disabled={statusMutation.isPending}
                              className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {owner.account_status === 'active' && (
                          <button
                            onClick={() => statusMutation.mutate({ id: owner.id, account_status: 'suspended' })}
                            disabled={statusMutation.isPending}
                            className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition"
                          >
                            Suspend
                          </button>
                        )}
                        {owner.account_status === 'suspended' && (
                          <button
                            onClick={() => statusMutation.mutate({ id: owner.id, account_status: 'active' })}
                            disabled={statusMutation.isPending}
                            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition"
                          >
                            Reinstate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-400">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, owners.length)} of {owners.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
