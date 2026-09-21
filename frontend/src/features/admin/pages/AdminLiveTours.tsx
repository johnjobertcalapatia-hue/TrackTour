import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDateTime } from '@/shared/utils'
import {
  Map,
  MapPin,
  Users,
  Clock,
  Navigation,
  User,
} from 'lucide-react'

interface LiveTour {
  id: number
  tour_name: string
  guide_name: string
  guide_phone: string | null
  participants_count: number
  max_participants: number | null
  location: string
  latitude: number | null
  longitude: number | null
  status: string
  start_time: string
  estimated_end_time: string | null
  created_at: string
}

export default function AdminLiveTours() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-live-tours'],
    queryFn: () => get<{ data: LiveTour[] }>('/admin/live/tours'),
    refetchInterval: 15000,
  })

  if (isLoading) return <TableSkeleton rows={6} cols={5} />

  const tours = data?.data ?? []

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Live — Tours</h1>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#16803C] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#16803C]" />
          </span>
        </div>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">
          Active tours and guide positions
          <span className="text-[#9CA3AF] ml-2">(auto-refreshes every 15s)</span>
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism">
        {tours.length === 0 ? (
          <div className="p-12 text-center">
            <Map className="w-10 h-10 mx-auto mb-3 text-[#9CA3AF]" />
            <p className="text-[#6B7280] font-medium">No Active Tours</p>
            <p className="text-sm text-[#9CA3AF] mt-1">
              There are currently no tours in progress.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] bg-[#F9FAFB]">
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Tour
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Guide
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Participants
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Location
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Status
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Schedule
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {tours.map((tour) => (
                  <tr key={tour.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                          <Navigation className="w-4 h-4 text-[#16803C]" />
                        </div>
                        <div>
                          <div className="font-medium text-[#17201A]">{tour.tour_name}</div>
                          <div className="text-xs text-[#6B7280]">ID: {tour.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#F9FAFB] border border-[#E2E8E3] flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-[#6B7280]" />
                        </div>
                        <div>
                          <div className="text-[#17201A]">{tour.guide_name}</div>
                          {tour.guide_phone && (
                            <div className="text-xs text-[#6B7280]">{tour.guide_phone}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-[#6B7280]" />
                        <span className="text-[#17201A]">
                          {tour.participants_count}
                          {tour.max_participants && (
                            <span className="text-[#6B7280]"> / {tour.max_participants}</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3">
                      <div className="flex items-start gap-2 max-w-xs">
                        <MapPin className="w-3.5 h-3.5 text-[#9CA3AF] mt-0.5 flex-shrink-0" />
                        <span className="text-[#6B7280] text-xs leading-relaxed">{tour.location}</span>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <StatusBadge status={tour.status} />
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="text-xs text-[#6B7280] space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-[#9CA3AF]" />
                          Start: {formatDateTime(tour.start_time)}
                        </div>
                        {tour.estimated_end_time && (
                          <div className="flex items-center gap-1.5 text-[#9CA3AF]">
                            <Clock className="w-3 h-3" />
                            Est. end: {formatDateTime(tour.estimated_end_time)}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
