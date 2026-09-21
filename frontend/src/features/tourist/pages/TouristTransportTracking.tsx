import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { createCheckoutSession } from '@/shared/services/payment'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import {
  Navigation,
  Star,
  Phone,
  XCircle,
  Clock,
  CheckCircle2,
  Car,
  User,
  ArrowLeft,
  Smartphone,
} from 'lucide-react'

interface TripData {
  _id: string
  tripNumber: string
  status: 'assigned' | 'arriving' | 'in_progress' | 'completed' | 'cancelled'
  pickupAddress: string
  pickupCoordinates?: [number, number]
  destinationAddress: string
  destinationCoordinates?: [number, number]
  rider?: {
    _id: string
    name: string
    phone: string
    vehicleType: string
    plateNumber: string
    photo: string
  }
  fare: number
  distance: number
  duration: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  cancelledAt?: string
  cancellationReason?: string
  isRated: boolean
  rating?: number
  review?: string
}

const STATUS_STEPS = [
  { key: 'assigned', label: 'Assigned', icon: UserCheck },
  { key: 'arriving', label: 'Arriving', icon: Navigation },
  { key: 'in_progress', label: 'In Progress', icon: Car },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
]

function UserCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  )
}

const STATUS_INDEX: Record<string, number> = {
  assigned: 0,
  arriving: 1,
  in_progress: 2,
  completed: 3,
  cancelled: -1,
}

function createMarkerIcon(color: string) {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      width: 30px; height: 30px;
      background: ${color};
      border: 3px solid #fff;
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

const pickupIcon = createMarkerIcon('#10b981')
const destinationIcon = createMarkerIcon('#ef4444')

export default function TouristTransportTracking() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [rating, setRating] = useState(5)
  const [review, setReview] = useState('')
  const [isRedirecting, setIsRedirecting] = useState(false)

  const { data: trip, isLoading, isError } = useQuery<TripData>({
    queryKey: ['tourist', 'trip-tracking', id],
    queryFn: () => get(`/tourist/transport/trip/${id}/status`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status && !['completed', 'cancelled'].includes(status)) {
        return 5000
      }
      return false
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => post(`/tourist/transport/trip/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'trip-tracking', id] })
      setShowCancelModal(false)
      setCancelReason('')
    },
  })

  const rateMutation = useMutation({
    mutationFn: () => post(`/tourist/transport/trip/${id}/rate`, { rating, review }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'trip-tracking', id] })
      setShowRatingModal(false)
      setRating(5)
      setReview('')
    },
  })

  const handlePayWithGCash = async () => {
    try {
      setIsRedirecting(true)
      const data = await createCheckoutSession('order', Number(id), 'gcash')
      if (data?.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch {
      alert('Payment initialization failed. Please try again.')
      setIsRedirecting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950">
        <DashboardSkeleton />
      </div>
    )
  }

  if (isError || !trip) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Car className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-100 mb-2">Trip not found</h2>
          <p className="text-gray-400 mb-6">Unable to load trip details.</p>
          <button
            onClick={() => navigate('/tourist/transport')}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium"
          >
            Back to Transport
          </button>
        </div>
      </div>
    )
  }

  const currentStep = STATUS_INDEX[trip.status] ?? 0
  const isActive = !['completed', 'cancelled'].includes(trip.status)
  const canCancel = ['assigned', 'arriving'].includes(trip.status)

  const mapCenter: [number, number] = trip.pickupCoordinates
    ? [trip.pickupCoordinates[1], trip.pickupCoordinates[0]]
    : trip.destinationCoordinates
    ? [trip.destinationCoordinates[1], trip.destinationCoordinates[0]]
    : [12.8667, 121.4500]

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Map - Full Screen */}
      <div className="flex-1 relative">
        <MapContainer
          center={mapCenter}
          zoom={14}
          minZoom={2}
          className="w-full h-full"
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {trip.pickupCoordinates && (
            <Marker
              position={[trip.pickupCoordinates[1], trip.pickupCoordinates[0]]}
              icon={pickupIcon}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900">Pickup</p>
                  <p className="text-gray-600">{trip.pickupAddress}</p>
                </div>
              </Popup>
            </Marker>
          )}
          {trip.destinationCoordinates && (
            <Marker
              position={[trip.destinationCoordinates[1], trip.destinationCoordinates[0]]}
              icon={destinationIcon}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900">Destination</p>
                  <p className="text-gray-600">{trip.destinationAddress}</p>
                </div>
              </Popup>
            </Marker>
          )}
          {trip.pickupCoordinates && trip.destinationCoordinates && (
            <Polyline
              positions={[
                [trip.pickupCoordinates[1], trip.pickupCoordinates[0]],
                [trip.destinationCoordinates[1], trip.destinationCoordinates[0]],
              ]}
              pathOptions={{ color: '#EAB308', weight: 4, opacity: 0.9, dashArray: '8, 8' }}
            />
          )}
        </MapContainer>

        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 z-[1000] p-3 bg-gray-900/90 backdrop-blur-xl border border-gray-700/30 rounded-xl text-gray-300 hover:text-emerald-400 hover:border-emerald-500/50 transition-all shadow-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Status Badge */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]">
          <div className={`px-4 py-2 bg-gray-900/90 backdrop-blur-xl border border-gray-700/30 rounded-xl shadow-lg flex items-center gap-2 ${
            isActive ? 'border-emerald-500/30' : ''
          }`}>
            {isActive && <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />}
            <span className="text-sm font-medium text-gray-200">
              {trip.status === 'assigned' && 'Driver Assigned'}
              {trip.status === 'arriving' && 'Driver Arriving'}
              {trip.status === 'in_progress' && 'Trip In Progress'}
              {trip.status === 'completed' && 'Trip Completed'}
              {trip.status === 'cancelled' && 'Trip Cancelled'}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Panel */}
      <div className="bg-gray-900/95 backdrop-blur-xl border-t border-gray-700/30 max-h-[45vh] overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5">
          {/* Status Stepper */}
          <div className="flex items-center justify-between mb-5 relative">
            <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-700/50" />
            <div
              className="absolute top-4 left-0 h-0.5 bg-emerald-500 transition-all duration-500"
              style={{
                width: trip.status === 'cancelled' ? '0%' : `${(currentStep / (STATUS_STEPS.length - 1)) * 100}%`,
              }}
            />
            {STATUS_STEPS.map((step, index) => {
              const Icon = step.icon
              const isCompleted = index <= currentStep && trip.status !== 'cancelled'
              return (
                <div key={step.key} className="relative flex flex-col items-center z-10">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                      isCompleted
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                        : 'bg-gray-800 text-gray-500'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-[10px] mt-1 ${isCompleted ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Pickup & Destination */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex flex-col items-center gap-1">
              <div className="w-3 h-3 bg-emerald-500 rounded-full" />
              <div className="w-0.5 h-6 bg-gray-700" />
              <div className="w-3 h-3 bg-red-500 rounded-full" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Pickup</p>
                <p className="text-sm text-gray-200">{trip.pickupAddress}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Destination</p>
                <p className="text-sm text-gray-200">{trip.destinationAddress}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            {/* Rider Info */}
            {trip.rider && (
              <div className="bg-gray-800/50 rounded-xl border border-gray-700/20 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-700 border border-gray-600/30">
                    {trip.rider.photo ? (
                      <img src={trip.rider.photo} alt={trip.rider.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500">
                        <User className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-200">{trip.rider.name}</p>
                    <p className="text-xs text-gray-500">
                      {trip.rider.vehicleType} • {trip.rider.plateNumber}
                    </p>
                  </div>
                  <a
                    href={`tel:${trip.rider.phone}`}
                    className="p-2.5 bg-emerald-600/10 border border-emerald-500/20 rounded-xl text-emerald-400 hover:bg-emerald-600 hover:text-white transition-all"
                  >
                    <Phone className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}

            {/* Fare Display */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700/20 p-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Distance</span>
                  <span className="text-gray-300">{trip.distance?.toFixed(1)} km</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Duration</span>
                  <span className="text-gray-300">{trip.duration} min</span>
                </div>
                <div className="flex justify-between text-base font-semibold pt-2 border-t border-gray-700/30">
                  <span className="text-gray-200">Fare</span>
                  <span className="text-emerald-400">{formatCurrency(trip.fare)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-5">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Started: {trip.startedAt ? formatDateTime(trip.startedAt) : 'Pending'}</span>
            </div>
            {trip.completedAt && (
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                <span>Completed: {formatDateTime(trip.completedAt)}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            {canCancel && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-all text-sm font-medium"
              >
                <XCircle className="w-4 h-4" />
                Cancel Ride
              </button>
            )}
            {trip.status === 'completed' && (
              <button
                onClick={handlePayWithGCash}
                disabled={isRedirecting}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all text-sm font-medium disabled:opacity-50"
              >
                <Smartphone className="w-4 h-4" />
                {isRedirecting ? 'Redirecting to GCash...' : 'Pay with GCash'}
              </button>
            )}
            {trip.status === 'completed' && !trip.isRated && (
              <button
                onClick={() => setShowRatingModal(true)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all text-sm font-medium"
              >
                <Star className="w-4 h-4" />
                Rate Trip
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/30 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Cancel Ride</h3>
            <p className="text-sm text-gray-400 mb-4">Are you sure you want to cancel this ride? A cancellation fee may apply.</p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation (optional)"
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/30 rounded-xl text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm resize-none mb-4"
              rows={3}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2.5 bg-gray-800/50 border border-gray-700/30 text-gray-300 rounded-xl hover:text-gray-100 transition-all font-medium"
              >
                Keep Ride
              </button>
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all font-medium disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rating Modal */}
      {showRatingModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/30 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Rate Your Trip</h3>
            <p className="text-sm text-gray-400 mb-6">How was your ride with {trip.rider?.name || 'your driver'}?</p>

            <div className="flex items-center justify-center gap-2 mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={`w-8 h-8 ${
                      star <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-600'
                    }`}
                  />
                </button>
              ))}
            </div>

            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Write a review (optional)"
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/30 rounded-xl text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm resize-none mb-4"
              rows={3}
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowRatingModal(false)}
                className="flex-1 py-2.5 bg-gray-800/50 border border-gray-700/30 text-gray-300 rounded-xl hover:text-gray-100 transition-all font-medium"
              >
                Skip
              </button>
              <button
                onClick={() => rateMutation.mutate()}
                disabled={rateMutation.isPending}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all font-medium disabled:opacity-50"
              >
                {rateMutation.isPending ? 'Submitting...' : 'Submit Rating'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
