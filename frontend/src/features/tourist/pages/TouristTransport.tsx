import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn } from '@/shared/utils'
import { Map as MapIcon, ArrowRight, ChevronRight, Lock, Pencil } from 'lucide-react'
import BookRideSheet from '../components/BookRideSheet'
import RideLocationPicker, { RIDE_POINT_COLORS, ridePointIcon, type RidePoint, type RidePointKind } from '../components/ride/RideLocationPicker'

/**
 * Ride Hailing (2026-11-10): two stacked cards, Pickup then Drop-off. Each
 * opens a full-screen map to search, move the marker and confirm. A confirmed
 * point keeps its marker until the tourist edits that card again. With both
 * set, Continue opens the trip summary (vehicle, payment, Book). Once booked,
 * the points cannot be edited while the ride is active.
 */

interface TripRow {
  id: number
  order_number: string
  status: string
  delivery_address: string | null
}

/** Handed over from the map's route card ("Book a Rider"). */
interface PendingBooking {
  destination: { name: string; address: string }
  distanceKm: number
  vehicle: string
  lat?: number
  lng?: number
}

interface RideDraft {
  pickup: RidePoint | null
  dropoff: RidePoint | null
  vehicle?: string
  /** Set when the ride was booked from these points: they stay locked while it is active. */
  booked?: boolean
  /** When it was booked (ms): the draft is cleared only by a rides list loaded after this. */
  bookedAt?: number
}

const PENDING_BOOKING_KEY = 'tracktour_pending_booking'
export const RIDE_DRAFT_KEY = 'tracktour_ride_draft'
const EMPTY_DRAFT: RideDraft = { pickup: null, dropoff: null }

const STATUS_INFO: Record<string, string> = {
  searching: 'Finding a Driver',
  arriving: 'Driver Arriving',
  assigned: 'Driver Assigned',
  driver_arrived: 'Driver Arrived',
  in_progress: 'Trip In Progress',
}
const ACTIVE_RIDE_STATUSES = Object.keys(STATUS_INFO)

function readPendingBooking(): PendingBooking | null {
  const raw = localStorage.getItem(PENDING_BOOKING_KEY)
  if (!raw) return null
  localStorage.removeItem(PENDING_BOOKING_KEY)
  try {
    const parsed = JSON.parse(raw) as PendingBooking
    return parsed?.destination?.name ? parsed : null
  } catch {
    return null
  }
}

function validPoint(p: unknown): p is RidePoint {
  const r = p as RidePoint | null
  return !!r && typeof r.name === 'string' && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))
}

function readDraft(): RideDraft {
  try {
    const d = JSON.parse(sessionStorage.getItem(RIDE_DRAFT_KEY) || 'null') as RideDraft | null
    if (!d) return EMPTY_DRAFT
    return { pickup: validPoint(d.pickup) ? d.pickup : null, dropoff: validPoint(d.dropoff) ? d.dropoff : null, vehicle: d.vehicle, booked: !!d.booked, bookedAt: Number(d.bookedAt) || 0 }
  } catch {
    return EMPTY_DRAFT
  }
}

function FitBoth({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    // Pins stand above their point: more room at the top so neither is cut off.
    map.fitBounds(points, { paddingTopLeft: [40, 60], paddingBottomRight: [40, 24], maxZoom: 16 })
  }, [map, points])
  return null
}

/** Both confirmed markers, fixed (only the cards change them). */
function LockedPointsMap({ pickup, dropoff }: { pickup: RidePoint; dropoff: RidePoint }) {
  const from = useMemo<[number, number]>(() => [pickup.lat, pickup.lng], [pickup])
  const to = useMemo<[number, number]>(() => [dropoff.lat, dropoff.lng], [dropoff])
  const points = useMemo(() => [from, to], [from, to])
  const pickupIcon = useMemo(() => ridePointIcon('pickup'), [])
  const dropoffIcon = useMemo(() => ridePointIcon('dropoff'), [])
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E9E7]" data-testid="ride-points-preview">
      <MapContainer center={from} zoom={13} className="h-48 w-full z-0" scrollWheelZoom={false} zoomControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
        <FitBoth points={points} />
        <Marker position={from} icon={pickupIcon} />
        <Marker position={to} icon={dropoffIcon} />
      </MapContainer>
    </div>
  )
}

function RidePointCard({
  kind,
  point,
  locked,
  lockedText,
  onOpen,
}: {
  kind: RidePointKind
  point: RidePoint | null
  locked: boolean
  lockedText?: string | null
  onOpen: () => void
}) {
  const isPickup = kind === 'pickup'
  const title = isPickup ? 'Pickup' : 'Drop-off'
  const shown = point?.name ?? lockedText ?? null
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={locked}
      aria-label={locked ? `${title}: ${shown ?? 'booked'} (booked, cannot be changed)` : point ? `Edit ${title.toLowerCase()}: ${point.name}` : isPickup ? 'Set pickup point' : 'Set drop-off'}
      data-testid={`ride-card-${kind}`}
      data-state={locked ? 'locked' : point ? 'set' : 'empty'}
      className={cn(
        'flex w-full items-center gap-4 rounded-2xl border bg-[#fff] p-4 text-left shadow-sm transition',
        locked ? 'cursor-not-allowed border-[#E5E9E7] opacity-90' : 'border-[#E5E9E7] hover:border-[#087F3F]/40 hover:shadow-md',
      )}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: isPickup ? '#E9F7EF' : '#FEF6DD' }}>
        <span className="h-4 w-4 rounded-full ring-4 ring-white" style={{ background: RIDE_POINT_COLORS[kind] }} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase tracking-wide text-[#68736D]">{title}</span>
        <span className={cn('block truncate text-base font-bold', shown ? 'text-[#17201B]' : 'text-[#8A948F]')}>
          {shown ?? (isPickup ? 'Set your pickup point' : 'Where are you going?')}
        </span>
        {point?.address && <span className="block truncate text-xs text-[#68736D]">{point.address}</span>}
        {locked && <span className="mt-0.5 block text-[11px] font-medium text-[#68736D]">Booked: cannot be changed</span>}
      </span>
      {locked ? (
        <Lock className="h-5 w-5 shrink-0 text-[#8A948F]" aria-hidden="true" />
      ) : point ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#E9F7EF] px-3 py-1 text-xs font-semibold text-[#087F3F]">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
        </span>
      ) : (
        <ChevronRight className="h-5 w-5 shrink-0 text-[#8A948F]" aria-hidden="true" />
      )}
    </button>
  )
}

export default function TouristTransport() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<RideDraft>(readDraft)
  const [picker, setPicker] = useState<{ kind: RidePointKind; query?: string } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    sessionStorage.setItem(RIDE_DRAFT_KEY, JSON.stringify(draft))
  }, [draft])

  // A place handed over from the map becomes the drop-off.
  useEffect(() => {
    const handoff = readPendingBooking()
    if (!handoff) return
    if (handoff.lat != null && handoff.lng != null) {
      setDraft((d) => ({
        ...(d.booked ? EMPTY_DRAFT : d),
        dropoff: { name: handoff.destination.name, address: handoff.destination.address ?? '', lat: handoff.lat!, lng: handoff.lng! },
        vehicle: handoff.vehicle,
      }))
    } else {
      setPicker({ kind: 'dropoff', query: handoff.destination.name })
    }
  }, [])

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['tourist-transport'],
    queryFn: () => get<{ data: TripRow[] }>('/tourist/transport'),
  })
  const rows = data?.data ?? []
  const activeRide = rows.find((t) => ACTIVE_RIDE_STATUSES.includes(t.status))

  // The booked ride has ended (seen in a rides list loaded after booking): start a fresh trip.
  useEffect(() => {
    if (!isLoading && draft.booked && !activeRide && dataUpdatedAt > (draft.bookedAt ?? 0)) setDraft(EMPTY_DRAFT)
  }, [isLoading, draft.booked, draft.bookedAt, activeRide, dataUpdatedAt])

  if (isLoading) return <DashboardSkeleton />

  const locked = Boolean(activeRide)
  const { pickup, dropoff } = draft
  const ready = !locked && pickup != null && dropoff != null

  const confirmPoint = (kind: RidePointKind, point: RidePoint) => {
    setDraft((d) => ({ ...d, booked: false, [kind]: point }))
    setPicker(null)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Ride Hailing</h1>
          <p className="mt-1 text-sm text-[#68736D]">Book a motorcycle, tricycle, car, or van ride around Oriental Mindoro</p>
        </div>
        {/* Map: the Ride Hailing map (businesses on the map, no places panel). */}
        <button
          type="button"
          onClick={() => navigate('/tourist/transport/map')}
          aria-label="Map"
          title="View the map"
          className="shrink-0 inline-flex h-11 items-center gap-2 rounded-full border border-[#E5E9E7] bg-[#fff] px-4 text-sm font-semibold text-[#087F3F] shadow-sm transition hover:border-[#087F3F]/40 hover:bg-[#E9F7EF]"
        >
          <MapIcon className="h-5 w-5" aria-hidden="true" />
          <span>Map</span>
        </button>
      </div>

      {/* Active ride banner */}
      {activeRide && (
        <button
          type="button"
          onClick={() => navigate(`/tourist/transport/tracking/${activeRide.id}`)}
          className="w-full mb-4 flex items-center gap-3 bg-[#E9F7EF] border border-[#087F3F]/30 rounded-2xl p-4 hover:border-[#087F3F]/60 transition-all"
        >
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#087F3F] opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#087F3F]" />
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-[#087F3F]">{STATUS_INFO[activeRide.status] ?? 'Active'}</p>
            <p className="text-xs text-[#68736D] truncate">
              {activeRide.delivery_address || 'Destination'} • {activeRide.order_number}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-[#087F3F] shrink-0" />
        </button>
      )}

      {/* Pickup, then Drop-off: one column, two rows. */}
      <section aria-label="Pickup and drop-off" className="grid grid-cols-1 gap-3">
        <RidePointCard
          kind="pickup"
          point={pickup}
          locked={locked}
          lockedText={locked && !pickup ? 'Booked ride' : null}
          onOpen={() => setPicker({ kind: 'pickup' })}
        />
        <RidePointCard
          kind="dropoff"
          point={dropoff}
          locked={locked}
          lockedText={locked && !dropoff ? activeRide?.delivery_address ?? 'Booked ride' : null}
          onOpen={() => setPicker({ kind: 'dropoff' })}
        />
      </section>

      {ready && (
        <section aria-label="Your trip" className="mt-4 space-y-3">
          <LockedPointsMap pickup={pickup} dropoff={dropoff} />
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="h-12 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#087F3F] text-base font-bold text-white transition hover:bg-[#056B35]"
          >
            Continue <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="text-center text-xs text-[#68736D]">Next: choose a vehicle and how to pay, then book.</p>
        </section>
      )}

      {picker && (
        <RideLocationPicker
          kind={picker.kind}
          initial={draft[picker.kind]}
          near={(picker.kind === 'pickup' ? dropoff : pickup) ?? null}
          initialQuery={picker.query}
          onConfirm={(point) => confirmPoint(picker.kind, point)}
          onClose={() => setPicker(null)}
        />
      )}

      {ready && (
        <BookRideSheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          destination={dropoff.name}
          destinationAddress={dropoff.address}
          destinationCoords={{ lat: dropoff.lat, lng: dropoff.lng }}
          pickupPoint={{ name: pickup.address ? `${pickup.name}, ${pickup.address}` : pickup.name, lat: pickup.lat, lng: pickup.lng }}
          initialVehicle={draft.vehicle}
          onBooked={() => {
            const booked = { ...draft, booked: true, bookedAt: Date.now() }
            sessionStorage.setItem(RIDE_DRAFT_KEY, JSON.stringify(booked))
            setDraft(booked)
          }}
        />
      )}
    </div>
  )
}
