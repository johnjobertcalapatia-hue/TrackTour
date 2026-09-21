import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency } from '@/shared/utils'
import { MapPin, Truck, Clock, Navigation, X, Bike } from 'lucide-react'

interface TransportOption {
  id: number
  type: string
  provider: string
  route: string
  fare: number
  estimated_time: string
  is_available: boolean
  municipality: string
}

interface PendingBooking {
  destination: { name: string; address: string }
  distanceKm: number
  vehicle: string
}

export default function TouristTransport() {
  const [selectedType, setSelectedType] = useState('')
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem('tracktour_pending_booking')
    if (raw) {
      try {
        setPendingBooking(JSON.parse(raw))
      } catch { /* ignore */ }
      localStorage.removeItem('tracktour_pending_booking')
    }
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-transport', selectedType],
    queryFn: () => get<{ data: TransportOption[] }>('/tourist/transport', { params: { type: selectedType } }),
  })

  if (isLoading) return <DashboardSkeleton />

  const options = data?.data ?? []
  const types = [...new Set(options.map((o) => o.type))]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Transport</h1>
        <p className="mt-1 text-sm text-gray-400">Find transportation options around Oriental Mindoro</p>
      </div>

      {/* Pending Booking Card */}
      {pendingBooking && (
        <div className="mb-6 bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-emerald-500/30 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Navigation className="w-4 h-4 text-emerald-400" />
              </span>
              <p className="text-sm font-semibold text-gray-100">Your Booking</p>
            </div>
            <button
              onClick={() => setPendingBooking(null)}
              className="w-6 h-6 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center gap-1 mt-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
              <div className="w-px h-6 bg-gray-700" />
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
            </div>
            <div className="flex flex-col gap-3 flex-1 min-w-0">
              <div>
                <p className="text-xs text-gray-500">From</p>
                <p className="text-sm font-medium text-gray-300">Your location</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">To</p>
                <p className="text-sm font-medium text-gray-300 truncate">
                  {pendingBooking.destination.name} — {pendingBooking.destination.address}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-700/50">
            <div className="flex items-center gap-1.5">
              <Bike className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-gray-400 capitalize">{pendingBooking.vehicle}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-gray-400">{pendingBooking.distanceKm.toFixed(2)} km</span>
            </div>
          </div>
        </div>
      )}

      {types.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <button
            onClick={() => setSelectedType('')}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition ${!selectedType ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            All
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition ${selectedType === t ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {options.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <Truck className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No transport options available.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {options.map((opt) => (
            <div key={opt.id} className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-5 hover:border-emerald-500/30 transition-all duration-200">
              <div className="flex items-start justify-between mb-3">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-900/30 text-blue-400 border border-blue-800/50">
                  {opt.type}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${opt.is_available ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                  {opt.is_available ? 'Available' : 'Unavailable'}
                </span>
              </div>
              <h3 className="font-semibold text-gray-100">{opt.provider}</h3>
              <div className="flex items-center gap-2 text-sm text-gray-400 mt-2">
                <MapPin className="w-4 h-4" /> {opt.route}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-400 mt-1">
                <Clock className="w-4 h-4" /> {opt.estimated_time}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-lg font-bold text-emerald-400">{formatCurrency(opt.fare)}</span>
                <span className="text-xs text-gray-500">{opt.municipality}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
