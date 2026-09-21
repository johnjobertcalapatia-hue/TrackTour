import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, del } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { formatDate } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import { Database, Download, Trash2 } from 'lucide-react'

interface Backup {
  id: number
  filename: string
  size: string
  created_by: string
  status: 'completed' | 'in_progress' | 'failed'
  created_at: string
}

export default function AdminSystemBackup() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-system-backup'],
    queryFn: () => get<{ data: Backup[] }>(API_ENDPOINTS.ADMIN.SYSTEM_BACKUP),
  })

  const createBackupMutation = useMutation({
    mutationFn: () => post(API_ENDPOINTS.ADMIN.SYSTEM_BACKUP),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-system-backup'] })
    },
  })

  const deleteBackupMutation = useMutation({
    mutationFn: (id: number) => del(`${API_ENDPOINTS.ADMIN.SYSTEM_BACKUP}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-system-backup'] })
    },
  })

  if (isLoading) return <TableSkeleton rows={5} cols={5} />

  const backups = data?.data ?? []

  return (
    <div>
      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="backup-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1.5" fill="#16803C" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#backup-pattern)" />
          </svg>
        </div>
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Backup Management</h1>
            <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Create, download, and manage system backups</p>
          </div>
          <button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
          >
            <Database className="w-4 h-4" />
            {createBackupMutation.isPending ? 'Creating...' : 'Create Backup'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F9FAFB]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Filename</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Size</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Created By</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {backups.map((backup) => (
                <tr key={backup.id} className="hover:bg-[#F3F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="bg-[#EAF6ED] p-1.5 rounded-lg">
                        <Database className="w-4 h-4 text-[#16803C]" />
                      </div>
                      <span className="font-medium text-[#17201A] font-mono text-xs">{backup.filename}</span>
                    </div>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{backup.size}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{backup.created_by}</td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      backup.status === 'completed'
                        ? 'bg-[#EAF6ED] text-[#16803C] border-[#D7E8DB]'
                        : backup.status === 'in_progress'
                        ? 'bg-[#FFF7D6] text-[#B45309] border-[#FDE68A]'
                        : 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]'
                    }`}>
                      {backup.status}
                    </span>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                    {formatDate(backup.created_at)}
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      {backup.status === 'completed' && (
                        <a href={`${API_ENDPOINTS.ADMIN.SYSTEM_BACKUP}/${backup.id}/download`} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-[#6B7280] hover:text-[#16803C] hover:bg-[#EAF6ED] transition inline-flex">
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => deleteBackupMutation.mutate(backup.id)}
                        disabled={deleteBackupMutation.isPending}
                        className="p-2 rounded-lg text-[#6B7280] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No backups found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
