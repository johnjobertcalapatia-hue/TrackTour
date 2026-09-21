import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import type { User } from '@/shared/types'
import { Search, ChevronLeft, ChevronRight, Edit2, Check, XCircle, Slash, Archive } from 'lucide-react'

const ROLES = [
  { value: '', label: 'All Roles' },
  { value: 'tourist', label: 'Tourist' },
  { value: 'business_owner', label: 'Business Owner' },
  { value: 'staff', label: 'Staff' },
  { value: 'rider', label: 'Rider' },
  { value: 'bansud_tourism_office', label: 'Admin' },
  { value: 'tourism_office', label: 'Tourism Office' },
]

export default function AdminUsers() {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [actionModal, setActionModal] = useState<null | { type: string; user: any }>(null)
  const [remarks, setRemarks] = useState('')
  const queryClient = useQueryClient()

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
    const timeout = setTimeout(() => setDebouncedSearch(value), 400)
    return () => clearTimeout(timeout)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', debouncedSearch, role, page],
    queryFn: () =>
      get<{ data: User[]; meta: any }>(API_ENDPOINTS.ADMIN.USERS, {
        params: { search: debouncedSearch || undefined, role: role || undefined, page },
      }),
  })

  if (isLoading) return <TableSkeleton rows={8} cols={6} />

  const users = data?.data ?? []
  const meta = data?.meta

  function openActionModal(type: string, user: any) {
    setRemarks('')
    setActionModal({ type, user })
  }

  async function performAction(type: string, userId: number) {
    try {
      const payload = {} as any
      if (['reject', 'suspend', 'archive'].includes(type)) payload.remarks = remarks
      await post(`${API_ENDPOINTS.ADMIN.USERS}/${userId}/${type}`, payload)
      // refresh
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setActionModal(null)
    } catch (err) {
      console.error('Action failed', err)
      alert('Action failed')
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8F4]">
      {/* Header */}
      <div className="mb-8 rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5 pointer-events-none">
          <svg className="w-full h-full" viewBox="0 0 800 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M100 180C100 180 150 120 200 100C250 80 300 140 350 120C400 100 450 60 500 80C550 100 600 160 650 140C700 120 750 80 800 100" stroke="#16803C" strokeWidth="2"/>
            <path d="M0 160C50 160 100 100 150 80C200 60 250 120 300 100C350 80 400 40 450 60C500 80 550 140 600 120C650 100 700 60 750 80" stroke="#126B32" strokeWidth="1.5"/>
            <circle cx="150" cy="50" r="3" fill="#16803C" opacity="0.3"/>
            <circle cx="400" cy="30" r="4" fill="#126B32" opacity="0.2"/>
            <circle cx="650" cy="60" r="2.5" fill="#16803C" opacity="0.25"/>
          </svg>
        </div>
        <div className="relative">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Users</h1>
          <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage all system users</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
              <input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C]"
              />
            </div>
            <select
              value={role}
              onChange={(e) => { setRole(e.target.value); setPage(1) }}
              className="px-4 py-2.5 bg-white border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C]"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">User</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Role</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Verified</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Joined</th>
                <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-[#F6F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#EAF6ED] flex items-center justify-center text-sm font-medium text-[#16803C] overflow-hidden">
                        {user.profile_photo ? (
                          <img src={user.profile_photo} alt="" className="w-full h-full object-cover" />
                        ) : (
                          (user.name || user.email).charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-[#17201A]">{user.name}</div>
                        <div className="text-xs text-[#6B7280]">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#17201A] whitespace-nowrap capitalize">
                    {user.role.replace(/_/g, ' ')}
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <StatusBadge status={user.account_status} />
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    {user.email_verified_at ? (
                      <span className="text-[#16803C] text-xs font-medium">Verified</span>
                    ) : (
                      <span className="text-[#6B7280] text-xs font-medium">Unverified</span>
                    )}
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <a href={`/admin/users/${user.id}/edit`} className="p-2 rounded-xl hover:bg-[#EAF6ED] text-[#16803C] transition-colors" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </a>
                      {user.role !== 'bansud_tourism_office' && (
                        <>
                          {user.account_status === 'pending_review' && (
                            <button onClick={() => openActionModal('approve', user)} className="p-2 rounded-xl hover:bg-[#EAF6ED] text-[#16803C] transition-colors" title="Approve">
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                          {(user.account_status === 'pending_review' || user.account_status === 'active') && (
                            <button onClick={() => openActionModal('reject', user)} className="p-2 rounded-xl hover:bg-red-50 text-red-500 transition-colors" title="Reject">
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {user.account_status === 'active' && (
                            <button onClick={() => openActionModal('suspend', user)} className="p-2 rounded-xl hover:bg-[#FFF7D6] text-amber-600 transition-colors" title="Suspend">
                              <Slash className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => openActionModal('archive', user)} className="p-2 rounded-xl hover:bg-red-50 text-red-500 transition-colors" title="Archive">
                            <Archive className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No users found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {meta && meta.last_page > 1 && (
          <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
            <p className="text-sm text-[#6B7280]">
              Showing {((meta.current_page - 1) * meta.per_page) + 1} to{' '}
              {Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total} users
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-[#6B7280] px-3">
                Page {meta.current_page} of {meta.last_page}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                disabled={page === meta.last_page}
                className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setActionModal(null)} />
          <div className="relative bg-white rounded-2xl p-6 border border-[#E2E8E3] shadow-tourism-lg w-full max-w-md">
            <h3 className="text-lg font-bold text-[#17201A] mb-3">{actionModal.type.replace(/_/g, ' ').toUpperCase()}</h3>
            <p className="text-sm text-[#6B7280] mb-4">Are you sure you want to {actionModal.type} <strong className="text-[#17201A]">{actionModal.user.fullName || actionModal.user.email}</strong>?</p>
            {(actionModal.type === 'reject' || actionModal.type === 'suspend' || actionModal.type === 'archive') && (
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Remarks (required)" className="w-full rounded-xl border border-[#D7E8DB] bg-white px-3 py-2 text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C] mb-3" />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setActionModal(null)} className="px-4 py-2 rounded-xl bg-white text-[#17201A] border border-[#D7E8DB] hover:bg-[#F3F8F4] transition-colors">Cancel</button>
              <button onClick={() => performAction(actionModal.type, actionModal.user.id)} className="px-4 py-2 rounded-xl bg-[#16803C] text-white hover:bg-[#126B32] transition-colors">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
