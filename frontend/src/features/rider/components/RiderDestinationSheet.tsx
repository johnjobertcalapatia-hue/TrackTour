import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Flag, Loader2, MapPin, Navigation, Search, X } from 'lucide-react'
import { apiErrorMessage, del, get, put } from '@/shared/services/api'
import { cn } from '@/shared/utils'

/** GET /rider/destination (RiderDestinationService::state). */
export interface RiderDestinationState {
  active: boolean
  destination: { label: string | null; latitude: number; longitude: number; set_at: string; expires_at: string | null } | null
  corridor_km: number
  arrival_radius_m: number
  duration_minutes: number
}

interface PlaceResult {
  id?: number | string | null
  type?: string
  name: string
  address?: string | null
  lat: number
  lng: number
}

export const RIDER_DESTINATION_QUERY_KEY = ['rider-destination'] as const

const destinationIcon = L.divIcon({
  className: '',
  html: '<div style="width:30px;height:30px;border-radius:9999px;background:#B3261E;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px">&#9873;</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})

const timeOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : null

/**
 * The rider's My Destination state, re-checked every minute while it is on
 * (the server switches it off on arrival or after 3 hours). `endedNotice` is
 * set once when it ends on its own, so the rider learns why offers widened.
 */
export function useRiderDestination(enabled = true) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: RIDER_DESTINATION_QUERY_KEY,
    queryFn: () => get<RiderDestinationState>('/rider/destination'),
    refetchInterval: (q) => (q.state.data?.active ? 60_000 : false),
    retry: false,
    enabled,
  })
  const [endedNotice, setEndedNotice] = useState<string | null>(null)
  const wasActive = useRef<{ active: boolean; label: string | null }>({ active: false, label: null })
  const turnedOffByRider = useRef(false)

  useEffect(() => {
    const data = query.data
    if (!data) return
    if (wasActive.current.active && !data.active && !turnedOffByRider.current) {
      setEndedNotice(
        `My Destination is off${wasActive.current.label ? ` (${wasActive.current.label})` : ''}: you arrived or the 3 hours ended. You will get all offers again.`,
      )
    }
    turnedOffByRider.current = false
    wasActive.current = { active: data.active, label: data.destination?.label ?? null }
  }, [query.data])

  const set = useMutation({
    mutationFn: (body: { latitude: number; longitude: number; label: string }) => put<RiderDestinationState>('/rider/destination', body),
    onSuccess: (state) => {
      setEndedNotice(null)
      queryClient.setQueryData(RIDER_DESTINATION_QUERY_KEY, state)
      void queryClient.invalidateQueries({ queryKey: ['rider-board'] })
    },
  })
  const clear = useMutation({
    mutationFn: () => {
      turnedOffByRider.current = true
      return del<RiderDestinationState>('/rider/destination')
    },
    onSuccess: (state) => {
      queryClient.setQueryData(RIDER_DESTINATION_QUERY_KEY, state)
      void queryClient.invalidateQueries({ queryKey: ['rider-board'] })
    },
  })

  return { state: query.data, isLoading: query.isLoading, set, clear, endedNotice, dismissEndedNotice: () => setEndedNotice(null) }
}

function TapToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

function FlyTo({ point }: { point: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (point) map.flyTo(point, Math.max(map.getZoom(), 15), { duration: 0.6 })
  }, [map, point])
  return null
}

/**
 * My Destination sheet (rider dashboard tile). Off: pick the destination by
 * search or by tapping / dragging the pin, name it, turn it on. On: shows
 * where the rider is heading, until when, and lets them change or turn it off.
 */
export default function RiderDestinationSheet({
  isOpen,
  onClose,
  riderPosition,
  destination,
}: {
  isOpen: boolean
  onClose: () => void
  riderPosition?: [number, number]
  destination: ReturnType<typeof useRiderDestination>
}) {
  const { state, set, clear } = destination
  const [editing, setEditing] = useState(false)
  const [point, setPoint] = useState<[number, number] | null>(null)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null)
  const [label, setLabel] = useState('Home')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(id)
  }, [query])

  useEffect(() => {
    if (!isOpen) {
      setEditing(false)
      setError(null)
      setQuery('')
    }
  }, [isOpen])

  const results = useQuery({
    queryKey: ['rider-destination-search', debounced],
    queryFn: () => get<PlaceResult[]>('/rider/locations/search', { params: { q: debounced } }),
    enabled: isOpen && debounced.length >= 2,
  })

  if (!isOpen) return null

  const active = state?.active ? state.destination : null
  const showPicker = !active || editing
  const center: [number, number] = point ?? (active ? [active.latitude, active.longitude] : riderPosition ?? [12.8667, 121.45])

  const pick = (lat: number, lng: number, name?: string) => {
    setPoint([lat, lng])
    setError(null)
    if (name) setLabel(name)
  }

  const turnOn = () => {
    if (!point) {
      setError('Search for a place or tap the map to set where you are heading.')
      return
    }
    set.mutate(
      { latitude: point[0], longitude: point[1], label: label.trim() || 'My destination' },
      {
        onSuccess: () => {
          setEditing(false)
          setPoint(null)
        },
        onError: (e) => setError(apiErrorMessage(e, 'Could not turn on My Destination. Please try again.')),
      },
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[2100] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="My Destination"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E9E7] px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-[#17201B]">
              <Flag className="h-4 w-4 text-[#B3261E]" aria-hidden="true" /> My Destination
            </h2>
            <p className="text-xs text-[#59645D]">
              Heading home or somewhere? Get only offers on your way there.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[#59645D] hover:bg-[#F3F8F5]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {active && !editing && (
            <div data-testid="destination-active" className="space-y-3">
              <div className="rounded-xl border border-[#16803C]/30 bg-[#EAF6ED] p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#16803C]">On</p>
                <p className="text-lg font-bold text-[#17201B]">Heading to {active.label || 'my destination'}</p>
                <p className="mt-1 text-xs text-[#3D4A42]">
                  You only get offers whose pickup and drop-off are within {state?.corridor_km ?? 2} km of your route and bring
                  you closer. It turns off when you arrive{timeOf(active.expires_at) ? ` or at ${timeOf(active.expires_at)}` : ''}.
                </p>
              </div>
              <div className="h-44 overflow-hidden rounded-xl border border-[#E5E9E7]">
                <MapContainer center={[active.latitude, active.longitude]} zoom={14} className="h-full w-full" zoomControl={false} dragging={false} scrollWheelZoom={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                  <Marker position={[active.latitude, active.longitude]} icon={destinationIcon} />
                </MapContainer>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true)
                    setLabel(active.label || 'Home')
                    setPoint([active.latitude, active.longitude])
                  }}
                  className="flex-1 rounded-xl border border-[#D7E8DB] px-4 py-2.5 text-sm font-semibold text-[#17201B] hover:bg-[#F3F8F5]"
                >
                  Change destination
                </button>
                <button
                  type="button"
                  onClick={() => clear.mutate(undefined, { onError: (e) => setError(apiErrorMessage(e, 'Could not turn it off.')) })}
                  disabled={clear.isPending}
                  className="flex-1 rounded-xl bg-[#B3261E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#8C1D18] disabled:opacity-60"
                >
                  {clear.isPending ? 'Turning off…' : 'Turn off'}
                </button>
              </div>
            </div>
          )}

          {showPicker && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#59645D]" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search destination"
                  placeholder="Search a place, barangay or landmark"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-xl border border-[#D7E8DB] bg-[#F6F8F4] py-2.5 pl-9 pr-3 text-sm text-[#17201B]"
                />
                {debounced.length >= 2 && (results.data?.length ?? 0) > 0 && (
                  <ul role="listbox" aria-label="Destination results" className="absolute z-[1000] mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-[#E5E9E7] bg-white shadow-lg">
                    {results.data!.slice(0, 8).map((place, i) => (
                      <li key={`${place.id ?? i}-${place.lat}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => {
                            pick(place.lat, place.lng, place.name)
                            setFlyTarget([place.lat, place.lng])
                            setQuery('')
                          }}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#F3F8F5]"
                        >
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#16803C]" aria-hidden="true" />
                          <span>
                            <span className="block text-sm font-semibold text-[#17201B]">{place.name}</span>
                            {place.address && <span className="block text-xs text-[#59645D]">{place.address}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {results.isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#59645D]" />}
              </div>

              <div className="relative h-64 overflow-hidden rounded-xl border border-[#E5E9E7]" data-testid="destination-map">
                <MapContainer center={center} zoom={14} className="h-full w-full">
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                  <TapToPlace onPick={(lat, lng) => pick(lat, lng)} />
                  <FlyTo point={flyTarget} />
                  {point && (
                    <Marker
                      position={point}
                      icon={destinationIcon}
                      draggable
                      eventHandlers={{
                        dragend: (e) => {
                          const ll = (e.target as L.Marker).getLatLng()
                          pick(ll.lat, ll.lng)
                        },
                      }}
                    />
                  )}
                </MapContainer>
                {!point && (
                  <p className="pointer-events-none absolute inset-x-3 bottom-3 z-[500] rounded-lg bg-white/95 px-3 py-2 text-center text-xs font-medium text-[#17201B] shadow">
                    Tap the map where you are heading
                  </p>
                )}
              </div>

              <label className="block text-xs font-semibold text-[#3D4A42]">
                Name
                <input
                  aria-label="Destination name"
                  value={label}
                  maxLength={160}
                  onChange={(e) => setLabel(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#D7E8DB] bg-[#F6F8F4] px-3 py-2 text-sm text-[#17201B]"
                />
              </label>

              <p className="text-xs text-[#59645D]">
                You will only get offers whose pickup and drop-off are within {state?.corridor_km ?? 2} km of your route and bring
                you closer. It turns off when you arrive or after {Math.round((state?.duration_minutes ?? 180) / 60)} hours.
              </p>

              <div className="flex gap-2">
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false)
                      setPoint(null)
                    }}
                    className="rounded-xl border border-[#D7E8DB] px-4 py-2.5 text-sm font-semibold text-[#17201B]"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={turnOn}
                  disabled={set.isPending}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60',
                    point ? 'bg-[#16803C] hover:bg-[#126B32]' : 'bg-[#9CA3AF]',
                  )}
                >
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  {set.isPending ? 'Turning on…' : editing ? 'Save destination' : 'Turn on My Destination'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-[#B3261E]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
