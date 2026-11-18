import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle, ArrowLeft, Loader2, MapPin, Navigation, RotateCcw } from 'lucide-react'
import { apiErrorMessage, get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency } from '@/shared/utils'
import { destinationMarkerIcon, riderMarkerIcon } from '@/shared/utils/map-markers'
import RideLocationPicker, { type RidePoint } from '@/features/tourist/components/ride/RideLocationPicker'
import {
  confirmDestinationChange, newIdempotencyKey, previewDestinationChange, type DestinationPreview,
} from '@/features/tourist/services/destination-change'

interface TripSummary {
  id: number
  order_number: string
  destination_address: string
  destination_latitude?: number | null
  destination_longitude?: number | null
  destination_change_allowed?: boolean
  destination_changes_left?: number
  destination_change_unavailable_reason?: string | null
}

function FitRoute({ points }: { points: [number, number][] }) {
  const map = useMap()
  const done = useRef(false)
  if (!done.current && points.length >= 2) {
    done.current = true
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] })
  }
  return null
}

/**
 * Change destination (2026-11-17): once per ride, after the driver picked
 * the tourist up. Pick a place → the revised route and fare (distance
 * already travelled + the road route to the new place) → confirm. Nothing is
 * changed until the tourist confirms; leaving here keeps the one change.
 */
export default function TouristChangeDestination() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const back = () => navigate(`/tourist/transport/tracking/${id}`, { replace: true })

  const { data: trip, isLoading } = useQuery({
    queryKey: ['tourist', 'trip-tracking', id],
    queryFn: () => get<TripSummary>(`/tourist/transport/trip/${id}/status`),
    enabled: !!id,
  })

  const [picking, setPicking] = useState(true)
  const [point, setPoint] = useState<RidePoint | null>(null)
  const [preview, setPreview] = useState<DestinationPreview | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per reviewed estimate: a double tap confirms once.
  const keyRef = useRef<string>(newIdempotencyKey())

  const previewMutation = useMutation({
    mutationFn: (p: RidePoint) => previewDestinationChange(id, p),
    onSuccess: (data) => {
      setPreview(data)
      keyRef.current = newIdempotencyKey()
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e, "Couldn't work out the new route. Please try again.")),
  })

  const confirmMutation = useMutation({
    mutationFn: () => confirmDestinationChange(id, preview!.quote_token, keyRef.current),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'trip-tracking', id] })
      back()
    },
    onError: (e) => {
      setConfirmOpen(false)
      setError(apiErrorMessage(e, "Couldn't change the destination. Please try again."))
    },
  })

  const routePoints = useMemo<[number, number][]>(
    () => (preview ? preview.route.map(([lat, lng]) => [Number(lat), Number(lng)] as [number, number]) : []),
    [preview],
  )

  if (isLoading) return <DashboardSkeleton />

  const unavailable = trip && trip.destination_change_allowed === false
  const header = (
    <div className="mb-4 flex items-center gap-3">
      <button
        type="button"
        onClick={back}
        aria-label="Back to your ride"
        className="shrink-0 rounded-full border border-[#E5E9E7] bg-white p-2.5 text-[#17201B] transition hover:border-[#087F3F]/40 hover:text-[#087F3F]"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <div className="min-w-0">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Change destination</h1>
        <p className="text-sm text-[#56615B]">
          {unavailable ? 'No changes left on this ride.' : 'You can change the destination once on this ride.'}
        </p>
      </div>
    </div>
  )

  if (unavailable) {
    return (
      <div className="mx-auto lg:mx-0 w-full max-w-3xl">
        {header}
        <p role="alert" className="rounded-2xl border border-[#E5E9E7] bg-white p-5 text-sm text-[#3B4540]">
          {trip?.destination_change_unavailable_reason ?? 'The destination of this ride can no longer be changed.'}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto lg:mx-0 w-full max-w-3xl" data-testid="change-destination-page">
      {header}

      <section aria-label="Current destination" className="mb-4 rounded-2xl border border-[#E5E9E7] bg-white p-4 text-sm">
        <p className="text-xs text-[#56615B]">Current destination</p>
        <p className="font-medium text-[#17201B]">{trip?.destination_address}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#E9F7EF] px-2.5 py-1 text-xs font-semibold text-[#087F3F]">
          {trip?.destination_changes_left ?? 1} change left
        </p>
      </section>

      {error && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-[#FFF7E6] px-3 py-2 text-sm text-[#8A5A00]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}

      {!picking && point && !preview && previewMutation.isPending && (
        <p className="flex items-center gap-2 text-sm text-[#56615B]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Working out the new route and fare…</p>
      )}

      {!picking && !preview && !previewMutation.isPending && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[#087F3F] px-5 text-sm font-semibold text-white hover:bg-[#056B35]"
        >
          <MapPin className="h-4 w-4" aria-hidden="true" /> Choose the new destination
        </button>
      )}

      {preview && (
        <section aria-label="Revised trip" className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-[#E5E9E7]" style={{ height: 260 }} data-testid="revised-route-map">
            <MapContainer center={routePoints[0] ?? [12.8667, 121.45]} zoom={14} className="h-full w-full" zoomControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
              <FitRoute points={routePoints} />
              <Polyline positions={routePoints} pathOptions={{ color: '#087F3F', weight: 5, dashArray: preview.route_source === 'osrm' ? undefined : '6 6' }} />
              <Marker position={[preview.from.latitude, preview.from.longitude]} icon={riderMarkerIcon} />
              <Marker position={[preview.destination.latitude, preview.destination.longitude]} icon={destinationMarkerIcon} />
            </MapContainer>
          </div>

          <div className="rounded-2xl border border-[#E5E9E7] bg-white p-4 text-sm">
            <p className="text-xs text-[#56615B]">New destination</p>
            <p className="font-semibold text-[#17201B]">{preview.destination.name ?? preview.destination.address}</p>
            {preview.destination.address && preview.destination.address !== preview.destination.name && (
              <p className="text-xs text-[#56615B]">{preview.destination.address}</p>
            )}
            <dl className="mt-3 space-y-1.5">
              <div className="flex justify-between text-[#56615B]"><dt>Travelled so far (verified)</dt><dd>{preview.traveled_km.toFixed(2)} km</dd></div>
              <div className="flex justify-between text-[#56615B]">
                <dt>To the new destination{preview.route_source === 'osrm' ? ' (road route)' : ' (straight line — road route unavailable)'}</dt>
                <dd>{preview.remaining_km.toFixed(2)} km</dd>
              </div>
              <div className="flex justify-between text-[#56615B]"><dt>Booked fare</dt><dd>{formatCurrency(preview.original_fare)}</dd></div>
              <div className="flex justify-between border-t border-[#EEF1EF] pt-2 text-base font-bold text-[#17201B]">
                <dt>Estimated new fare</dt><dd>{formatCurrency(preview.estimated_fare)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-[#17201B]"><dt>Maximum you will pay</dt><dd>{formatCurrency(preview.max_fare)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-[#56615B]">
              The final fare is worked out at the end from the distance actually travelled (verified GPS only), and is never more than {formatCurrency(preview.max_fare)}.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => { setPreview(null); setPicking(true) }}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-[#087F3F] text-sm font-semibold text-[#087F3F] hover:bg-[#E9F7EF]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Choose another place
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#087F3F] text-sm font-bold text-white hover:bg-[#056B35]"
            >
              <Navigation className="h-4 w-4" aria-hidden="true" /> Change destination
            </button>
          </div>
        </section>
      )}

      {picking && (
        <RideLocationPicker
          kind="dropoff"
          near={trip?.destination_latitude != null && trip.destination_longitude != null ? { lat: Number(trip.destination_latitude), lng: Number(trip.destination_longitude) } : null}
          onConfirm={(p) => {
            setPicking(false)
            setPoint(p)
            setPreview(null)
            previewMutation.mutate(p)
          }}
          onClose={() => {
            setPicking(false)
            if (!point) back()
          }}
        />
      )}

      {confirmOpen && preview && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Confirm the new destination">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-[#17201B]">Change your destination?</h2>
            <p className="mt-2 text-sm text-[#3B4540]">
              Your driver will take you to <strong>{preview.destination.name ?? preview.destination.address}</strong>.
            </p>
            <p className="mt-2 text-sm text-[#3B4540]">
              Estimated fare <strong>{formatCurrency(preview.estimated_fare)}</strong>, at most <strong>{formatCurrency(preview.max_fare)}</strong>.
            </p>
            <p className="mt-2 text-sm font-semibold text-[#8A5A00]">You can change the destination only once on this ride.</p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={confirmMutation.isPending}
                className="h-11 flex-1 rounded-full border border-[#E5E9E7] text-sm font-semibold text-[#3B4540] hover:bg-[#F4F8F3]"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => confirmMutation.mutate()}
                disabled={confirmMutation.isPending}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#087F3F] text-sm font-bold text-white hover:bg-[#056B35] disabled:opacity-70"
              >
                {confirmMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Changing…</> : 'Yes, change it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
