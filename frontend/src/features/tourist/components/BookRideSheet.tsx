import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { post } from '@/shared/services/api'
import { formatCurrency, cn } from '@/shared/utils'
import { Car, X, MapPin, Loader2 } from 'lucide-react'

interface RideSheetProps {
  isOpen: boolean
  onClose: () => void
  destination: string
  destinationCoords?: { lat: number; lng: number }
}

interface FareEstimate {
  fare_min: number
  fare_max: number
  distance_km: number
}

export default function BookRideSheet({ isOpen, onClose, destination, destinationCoords }: RideSheetProps) {
  const [pickup, setPickup] = useState('')
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | undefined>()
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null)
  const [useCurrentLocation, setUseCurrentLocation] = useState(true)

  const fareEstimateMutation = useMutation({
    mutationFn: (payload: { pickup_lat: number; pickup_lng: number; dest_lat: number; dest_lng: number }) =>
      post<FareEstimate>('/tourist/transport/estimate', payload),
    onSuccess: (data) => setFareEstimate(data as unknown as FareEstimate),
  })

  const requestRideMutation = useMutation({
    mutationFn: () =>
      post('/tourist/transport/request', {
        pickup_address: pickup,
        pickup_lat: pickupCoords?.lat,
        pickup_lng: pickupCoords?.lng,
        destination,
        dest_lat: destinationCoords?.lat,
        dest_lng: destinationCoords?.lng,
      }),
    onSuccess: () => onClose(),
  })

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPickupCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setPickup('Current Location')
        setUseCurrentLocation(true)
        if (destinationCoords) {
          fareEstimateMutation.mutate({
            pickup_lat: pos.coords.latitude,
            pickup_lng: pos.coords.longitude,
            dest_lat: destinationCoords.lat,
            dest_lng: destinationCoords.lng,
          })
        }
      },
      () => setUseCurrentLocation(false)
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl border-t border-[#E5E9E7]">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-[#E5E9E7] rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#E9F7EF] flex items-center justify-center">
              <Car className="w-4 h-4 text-[#087F3F]" />
            </div>
            <h3 className="font-semibold text-[#17201B]">Book a Ride</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E9F7EF] transition">
            <X className="w-5 h-5 text-[#68736D]" />
          </button>
        </div>
        <div className="px-5 pb-6 space-y-4">
          {/* Pickup */}
          <div>
            <label className="text-[10px] text-[#68736D] mb-1.5 block">Pickup Location</label>
            {useCurrentLocation ? (
              <button
                onClick={handleGetCurrentLocation}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-left hover:border-[#087F3F]/40 transition"
              >
                <MapPin className="w-4 h-4 text-[#087F3F] shrink-0" />
                <span className={pickup ? 'text-[#17201B]' : 'text-[#9CA3AF]'}>{pickup || 'Use current location'}</span>
              </button>
            ) : (
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
                <input
                  type="text"
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  placeholder="Enter pickup location"
                  className="w-full pl-10 pr-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] outline-none transition"
                />
              </div>
            )}
          </div>

          <div className="flex justify-center"><div className="w-px h-3 bg-[#E5E9E7]" /></div>

          {/* Destination */}
          <div>
            <label className="text-[10px] text-[#68736D] mb-1.5 block">Destination</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#F4B400]" />
              <input type="text" value={destination} readOnly className="w-full pl-10 pr-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] outline-none" />
            </div>
          </div>

          {/* Fare */}
          {fareEstimate && (
            <div className="bg-[#E9F7EF] border border-[#087F3F]/20 rounded-xl p-4">
              <p className="text-[10px] text-[#68736D] mb-1">Estimated Fare</p>
              <p className="text-xl font-bold text-[#17201B]">
                {formatCurrency(fareEstimate.fare_min)} – {formatCurrency(fareEstimate.fare_max)}
              </p>
              <p className="text-[10px] text-[#68736D] mt-1">{fareEstimate.distance_km?.toFixed(1)} km away</p>
            </div>
          )}

          <button
            onClick={() => requestRideMutation.mutate()}
            disabled={!pickup || requestRideMutation.isPending}
            className={cn(
              'w-full py-3.5 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2',
              pickup && !requestRideMutation.isPending
                ? 'bg-[#087F3F] text-white hover:bg-[#056B35]'
                : 'bg-[#E5E9E7] text-[#9CA3AF] cursor-not-allowed'
            )}
          >
            {requestRideMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Requesting...</> : 'Request Ride'}
          </button>
          <p className="text-[10px] text-[#9CA3AF] text-center">Ride managed by Tourism Office transportation</p>
        </div>
      </div>
    </div>
  )
}
