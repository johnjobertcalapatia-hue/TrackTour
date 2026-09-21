import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDateTime } from '@/shared/utils'
import {
  AlertTriangle,
  MapPin,
  Clock,
  CheckCircle,
  Bell,
  User,
  Phone,
} from 'lucide-react'

interface SOSReport {
  id: number
  reporter_name: string
  reporter_phone: string | null
  location: string
  latitude: number | null
  longitude: number | null
  message: string | null
  status: 'pending' | 'acknowledged' | 'responded' | 'resolved'
  responder_name: string | null
  created_at: string
  updated_at: string
}

export default function AdminLiveSOS() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('active')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-live-sos', filter],
    queryFn: () => get<{ data: SOSReport[] }>('/admin/live/sos', { params: { filter } }),
    refetchInterval: 5000,
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => post(`/admin/live/sos/${id}/acknowledge`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-live-sos'] })
    },
  })

  const respondMutation = useMutation({
    mutationFn: (id: number) => post(`/admin/live/sos/${id}/respond`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-live-sos'] })
    },
  })

  const resolveMutation = useMutation({
    mutationFn: (id: number) => post(`/admin/live/sos/${id}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-live-sos'] })
    },
  })

  if (isLoading) return <TableSkeleton rows={6} cols={5} />

  const reports = data?.data ?? []
  const pendingCount = reports.filter((r) => r.status === 'pending').length

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Live — SOS</h1>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DC2626] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#DC2626]" />
          </span>
          {pendingCount > 0 && (
            <span className="px-2.5 py-0.5 bg-[#FEF2F2] border border-[#FCA5A5] text-[#DC2626] text-xs font-medium rounded-full">
              {pendingCount} pending
            </span>
          )}
        </div>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">
          Emergency SOS reports and panic alerts
          <span className="text-[#9CA3AF] ml-2">(auto-refreshes every 5s)</span>
        </p>
      </div>

      <div className="mb-6">
        <div className="flex gap-2">
          {[
            { value: 'active', label: 'Active' },
            { value: 'all', label: 'All' },
            { value: 'resolved', label: 'Resolved' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                filter === opt.value
                  ? 'bg-[#16803C] text-white'
                  : 'bg-white border border-[#E2E8E3] text-[#6B7280] hover:text-[#17201A] hover:bg-[#F9FAFB] shadow-tourism'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism">
        {reports.length === 0 ? (
          <div className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-[#9CA3AF]" />
            <p className="text-[#6B7280] font-medium">No SOS Reports</p>
            <p className="text-sm text-[#9CA3AF] mt-1">
              {filter === 'active' ? 'No active emergency reports at this time.' : 'No reports found.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E2E8E3]">
            {reports.map((report) => (
              <div
                key={report.id}
                className={`p-5 lg:p-6 transition-colors ${
                  report.status === 'pending'
                    ? 'bg-[#FEF2F2]/50 hover:bg-[#FEF2F2]/70 border-l-2 border-l-[#DC2626]'
                    : 'hover:bg-[#F9FAFB]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          report.status === 'pending'
                            ? 'bg-[#FEF2F2] border border-[#FCA5A5]'
                            : 'bg-[#F9FAFB] border border-[#E2E8E3]'
                        }`}
                      >
                        <AlertTriangle
                          className={`w-5 h-5 ${
                            report.status === 'pending' ? 'text-[#DC2626]' : 'text-[#9CA3AF]'
                          }`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#17201A] flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-[#9CA3AF]" />
                            {report.reporter_name}
                          </span>
                          <StatusBadge status={report.status} />
                        </div>
                        {report.reporter_phone && (
                          <div className="text-xs text-[#6B7280] flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3" />
                            {report.reporter_phone}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 ml-[52px]">
                      <div className="flex items-start gap-2 text-sm">
                        <MapPin className="w-3.5 h-3.5 text-[#9CA3AF] mt-0.5 flex-shrink-0" />
                        <span className="text-[#17201A]">{report.location}</span>
                      </div>
                      {report.message && (
                        <p className="text-sm text-[#6B7280] bg-[#F9FAFB] rounded-lg p-3 border border-[#E2E8E3]">
                          "{report.message}"
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-[#6B7280]">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(report.created_at)}
                        </span>
                        {report.responder_name && (
                          <span className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-[#16803C]" />
                            Responded by {report.responder_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-[52px] sm:ml-0">
                    {report.status === 'pending' && (
                      <>
                        <button
                          onClick={() => acknowledgeMutation.mutate(report.id)}
                          disabled={acknowledgeMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FFF7D6] hover:bg-[#FEF3C7] border border-[#FCD34D] text-[#D97706] rounded-lg text-xs font-medium transition disabled:opacity-50"
                        >
                          <Bell className="w-3.5 h-3.5" />
                          Acknowledge
                        </button>
                        <button
                          onClick={() => respondMutation.mutate(report.id)}
                          disabled={respondMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#EAF6ED] hover:bg-[#D7E8DB] border border-[#16803C]/30 text-[#16803C] rounded-lg text-xs font-medium transition disabled:opacity-50"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Respond
                        </button>
                      </>
                    )}
                    {report.status === 'acknowledged' && (
                      <button
                        onClick={() => respondMutation.mutate(report.id)}
                        disabled={respondMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#EAF6ED] hover:bg-[#D7E8DB] border border-[#16803C]/30 text-[#16803C] rounded-lg text-xs font-medium transition disabled:opacity-50"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Respond
                      </button>
                    )}
                    {report.status === 'responded' && (
                      <button
                        onClick={() => resolveMutation.mutate(report.id)}
                        disabled={resolveMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#EAF6ED] hover:bg-[#D7E8DB] border border-[#16803C]/30 text-[#16803C] rounded-lg text-xs font-medium transition disabled:opacity-50"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
