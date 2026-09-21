import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, del } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatDate } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { User, Archive, ChevronLeft, ChevronRight, Plus, Eye, Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface StaffMember {
  id: number
  name: string
  email: string
  role_label: string
  status: string
  mobile_number: string | null
  created_at: string
}

const ITEMS_PER_PAGE = 8

export default function BusinessOwnerStaff() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [archiveId, setArchiveId] = useState<number | null>(null)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-staff', selectedBusinessId],
    queryFn: () => {
      const params = selectedBusinessId ? `?business_id=${selectedBusinessId}` : ''
      return get<{ staff: StaffMember[] }>(`/business-owner/staff${params}`)
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => del(`/business-owner/staff/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-staff'] })
      setArchiveId(null)
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const staff = data?.staff ?? []
  const totalPages = Math.ceil(staff.length / ITEMS_PER_PAGE)
  const paginated = staff.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Staff</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage your staff members</p>
        </div>
        <button onClick={() => navigate('/business-owner/staff/create')} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
          <Plus className="w-4 h-4" /> Add Staff
        </button>
      </div>

      {staff.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <User className="w-12 h-12 text-[#647067] mx-auto mb-4" />
          <p className="text-[#647067]">No staff members yet.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Name</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Email</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Role</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Joined</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {paginated.map((s) => (
                    <tr key={s.id} className="hover:bg-[#F6F8F4] transition-colors">
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-[#F3F8F4] rounded-full flex items-center justify-center text-[#647067] text-xs font-bold">
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-[#17201A]">{s.name}</span>
                        </div>
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap">{s.email}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap capitalize">{s.role_label}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={s.status} /></td>
                      <td className="px-5 lg:px-6 py-3 text-[#647067] whitespace-nowrap">{formatDate(s.created_at)}</td>
                      <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                        <button onClick={() => navigate(`/business-owner/staff/${s.id}`)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#16803C] hover:bg-[#EAF6ED] transition">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => navigate(`/business-owner/staff/${s.id}/edit`)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#16803C] hover:bg-[#EAF6ED] transition ml-1">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setArchiveId(s.id)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#A66F00] hover:bg-[#FFF7D6] transition ml-1">
                          <Archive className="w-4 h-4" />
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
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, staff.length)} of {staff.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal show={archiveId !== null} onClose={() => setArchiveId(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-2">Archive Staff Member</h3>
          <p className="text-sm text-[#647067] mb-6">Are you sure you want to archive this staff member?</p>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setArchiveId(null)} className="px-4 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
              Cancel
            </button>
            <button
              onClick={() => archiveId && archiveMutation.mutate(archiveId)}
              disabled={archiveMutation.isPending}
              className="px-4 py-2 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-sm font-semibold transition"
            >
              {archiveMutation.isPending ? 'Archiving...' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
