import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import type { PaginatedResponse } from '@/shared/types'
import { Search, ChevronLeft, ChevronRight, FileText } from 'lucide-react'

interface AuditLog {
  id: number
  user_id: number
  user_name: string
  action: string
  description: string
  model_type: string | null
  model_id: number | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-[#EAF6ED] text-[#16803C] border-[#D7E8DB]',
  updated: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
  deleted: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  login: 'bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]',
  logout: 'bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]',
  verified: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]',
  suspended: 'bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]',
}

export default function AdminAuditLogs() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
    const timeout = setTimeout(() => setDebouncedSearch(value), 400)
    return () => clearTimeout(timeout)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-logs', debouncedSearch, page],
    queryFn: () =>
      get<PaginatedResponse<AuditLog>>(API_ENDPOINTS.ADMIN.AUDIT_LOGS, {
        params: { search: debouncedSearch || undefined, page },
      }),
  })

  if (isLoading) return <TableSkeleton rows={10} cols={5} />

  const logs = data?.data ?? []
  const meta = data?.meta

  return (
    <div className="min-h-screen bg-[#F8FAF9]">
      <div className="mb-8 relative overflow-hidden rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 lg:p-8">
        <div className="absolute inset-0 opacity-5">
          <svg className="w-full h-full" viewBox="0 0 400 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 180L100 80L180 140L260 60L340 120L400 40" stroke="#16803C" strokeWidth="2"/>
            <circle cx="100" cy="80" r="8" fill="#16803C"/>
            <circle cx="260" cy="60" r="8" fill="#16803C"/>
            <circle cx="340" cy="120" r="6" fill="#126B32"/>
          </svg>
        </div>
        <div className="relative">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Audit Logs</h1>
          <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Track system activity and user actions</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
            <input
              type="text"
              placeholder="Search audit logs..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">User</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Action</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Description</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">IP Address</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-[#F6F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#6B7280]" />
                      <span className="font-medium text-[#17201A]">{log.user_name}</span>
                    </div>
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-[#F6F8F4] text-[#6B7280] border-[#E2E8E3]'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] max-w-xs truncate">{log.description}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] font-mono text-xs whitespace-nowrap">{log.ip_address || '—'}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No audit logs found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {meta && meta.last_page > 1 && (
          <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
            <p className="text-sm text-[#6B7280]">
              Showing {((meta.current_page - 1) * meta.per_page) + 1} to{' '}
              {Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total} logs
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
    </div>
  )
}
