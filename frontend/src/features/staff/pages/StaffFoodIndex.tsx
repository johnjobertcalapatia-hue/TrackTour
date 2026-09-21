import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatCurrency } from '@/shared/utils'
import type { MenuItem } from '@/shared/types'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'

const ITEMS_PER_PAGE = 8

export default function StaffFoodIndex() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['staff-menu'],
    queryFn: () => get<{ data: MenuItem[] }>('/staff/menu'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(`/staff/menu/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-menu'] })
      setDeleteId(null)
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const items = data?.data ?? []
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE)
  const paginated = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Menu Items</h1>
        <p className="mt-1 text-sm text-gray-400">View and manage menu items</p>
      </div>

      {items.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <p className="text-gray-400">No menu items yet.</p>
        </div>
      ) : (
        <>
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/50 bg-gray-800/30">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Item</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Category</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Price</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {paginated.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="w-10 h-10 rounded-lg object-cover" />
                          ) : (
                            <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 text-xs">IMG</div>
                          )}
                          <div>
                            <p className="font-medium text-gray-100">{item.name}</p>
                            {item.is_featured && <span className="text-xs text-amber-400">Featured</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-gray-300 whitespace-nowrap capitalize">{item.category}</td>
                      <td className="px-5 lg:px-6 py-3 text-right font-medium text-gray-100 whitespace-nowrap">{formatCurrency(item.price)}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${item.is_available ? 'bg-emerald-900/20 text-emerald-300 border border-emerald-800/50' : 'bg-red-900/20 text-red-300 border border-red-800/50'}`}>
                          {item.is_available ? 'Available' : 'Unavailable'}
                        </span>
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setDeleteId(item.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-900/20 transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
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
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, items.length)} of {items.length}
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

      <Modal show={deleteId !== null} onClose={() => setDeleteId(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-100 mb-2">Delete Menu Item</h3>
          <p className="text-sm text-gray-400 mb-6">Are you sure you want to delete this menu item?</p>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setDeleteId(null)} className="px-4 py-2 rounded-xl border border-gray-700 text-sm font-medium text-gray-300 hover:bg-gray-800 transition">
              Cancel
            </button>
            <button
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold transition"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
