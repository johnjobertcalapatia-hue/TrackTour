import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDate } from '@/shared/utils'
import { ArrowLeft, Calendar, MapPin } from 'lucide-react'
import type { Event } from '@/shared/types'

interface EventDetail extends Event {
  organizer: string
  contact: string
  ticket_price: number | null
}

export default function TouristEventsShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: event, isLoading } = useQuery({
    queryKey: ['tourist-event', id],
    queryFn: () => get<EventDetail>(`/tourist/events/${id}`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!event) return <div className="text-center py-20 text-gray-400">Event not found.</div>

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {event.cover_photo ? (
        <div className="rounded-2xl overflow-hidden mb-6 h-48 sm:h-64">
          <img src={event.cover_photo} alt={event.name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden mb-6 h-48 sm:h-64 bg-gradient-to-br from-emerald-900/40 to-blue-900/40 flex items-center justify-center">
          <Calendar className="w-16 h-16 text-gray-600" />
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">{event.name}</h1>
        <p className="text-sm text-gray-400 mt-2">Organized by {event.organizer}</p>
      </div>

      <div className="space-y-4">
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6 space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <div>
              <p className="text-xs text-gray-500">Date & Time</p>
              <p className="text-gray-100">{formatDate(event.date)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <MapPin className="w-4 h-4 text-red-400" />
            <div>
              <p className="text-xs text-gray-500">Location</p>
              <p className="text-gray-100">{event.location}</p>
              <p className="text-xs text-gray-500">{event.municipality}</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6">
          <h2 className="text-lg font-semibold text-gray-100 mb-3">About This Event</h2>
          <p className="text-sm text-gray-300 leading-relaxed">{event.description}</p>
        </div>

        {event.ticket_price !== null && (
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Ticket Price</span>
              <span className="text-lg font-bold text-emerald-400">
                {event.ticket_price === 0 ? 'Free' : `₱${Number(event.ticket_price).toLocaleString()}`}
              </span>
            </div>
          </div>
        )}

        {event.contact && (
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6 text-sm text-gray-400">
            Contact: {event.contact}
          </div>
        )}
      </div>
    </div>
  )
}
