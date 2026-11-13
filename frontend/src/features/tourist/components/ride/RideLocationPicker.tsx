import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { ChevronLeft, Loader2, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { get } from '@/shared/services/api'
import { cn } from '@/shared/utils'

/**
 * Full-screen map to set the ride's pickup or drop-off point (2026-11-10).
 * Search a place, drag the marker or tap the map to move it, or (pickup) use
 * the current location; then Confirm. Nothing is saved until Confirm.
 */

export type RidePointKind = 'pickup' | 'dropoff'

export interface RidePoint {
  name: string
  address: string
  lat: number
  lng: number
}

interface LocationResult {
  id: number | null
  type: string
  name: string
  address: string
  lat: number
  lng: number
}

const FALLBACK_CENTER: [number, number] = [12.8667, 121.45] // Bansud

export const RIDE_POINT_COLORS: Record<RidePointKind, string> = { pickup: '#087F3F', dropoff: '#F4B400' }

export function ridePointIcon(kind: RidePointKind): L.DivIcon {
  const color = RIDE_POINT_COLORS[kind]
  return L.divIcon({
    className: 'ride-point-marker',
    html: `<div style="position:relative;width:34px;height:44px">
      <svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M17 1C8.2 1 1 8 1 16.7 1 28.5 17 43 17 43s16-14.5 16-26.3C33 8 25.8 1 17 1z" fill="${color}" stroke="#fff" stroke-width="2.5"/>
        <circle cx="17" cy="16.5" r="6" fill="#fff"/>
      </svg></div>`,
    iconSize: [34, 44],
    iconAnchor: [17, 43],
  })
}

const isUsable = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/** Moves the map to `target` whenever it changes (search pick, current location). */
function FlyTo({ target }: { target: { point: [number, number]; n: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.setView(target.point, Math.max(map.getZoom(), 16))
  }, [map, target])
  return null
}

function TapToMove({ onTap }: { onTap: (point: [number, number]) => void }) {
  useMapEvents({ click: (e) => onTap([e.latlng.lat, e.latlng.lng]) })
  return null
}

export default function RideLocationPicker({
  kind,
  initial,
  near,
  initialQuery = '',
  onConfirm,
  onClose,
}: {
  kind: RidePointKind
  /** The confirmed point being edited, if any. */
  initial?: RidePoint | null
  /** Where to open the map when there is no point yet (e.g. the other point). */
  near?: { lat: number; lng: number } | null
  /** Prefilled search (e.g. a place handed over by name). */
  initialQuery?: string
  onConfirm: (point: RidePoint) => void
  onClose: () => void
}) {
  const isPickup = kind === 'pickup'
  const [marker, setMarker] = useState<[number, number] | null>(initial ? [initial.lat, initial.lng] : null)
  const [label, setLabel] = useState<{ name: string; address: string } | null>(initial ? { name: initial.name, address: initial.address } : null)
  const [focus, setFocus] = useState<{ point: [number, number]; n: number } | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [debounced, setDebounced] = useState('')
  const [locError, setLocError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(t)
  }, [query])

  const results = useQuery({
    queryKey: ['ride-point-search', debounced],
    queryFn: () => get<LocationResult[]>(`/tourist/transport/locations/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  })

  const reverse = useMutation({
    mutationFn: ({ lat, lng }: { lat: number; lng: number }) =>
      get<LocationResult>('/tourist/transport/locations/reverse-geocode', { params: { lat, lng } }),
    onSuccess: (r) => setLabel({ name: r?.name || 'Pinned location', address: r?.address ?? '' }),
    onError: () => setLabel({ name: 'Pinned location', address: '' }),
  })

  const center = useMemo<[number, number]>(
    () => (initial ? [initial.lat, initial.lng] : near ? [near.lat, near.lng] : FALLBACK_CENTER),
    // Opening position only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const moveTo = (point: [number, number], known?: { name: string; address: string }) => {
    setMarker(point)
    if (known) setLabel(known)
    else {
      setLabel(null)
      reverse.mutate({ lat: point[0], lng: point[1] })
    }
  }

  const choose = (r: LocationResult) => {
    const point: [number, number] = [Number(r.lat), Number(r.lng)]
    if (!isUsable(point[0], point[1])) return
    moveTo(point, { name: r.name, address: r.address ?? '' })
    setFocus({ point, n: Date.now() })
    setQuery('')
    setDebounced('')
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocError('This phone or browser has no location service.')
      return
    }
    setLocating(true)
    setLocError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const point: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        if (!isUsable(point[0], point[1])) {
          setLocError('Your phone reported an invalid location. Check its location settings.')
          return
        }
        moveTo(point)
        setFocus({ point, n: Date.now() })
      },
      (err) => {
        setLocating(false)
        setLocError(err.code === 1 ? 'Location permission is blocked. Allow location for this site.' : 'Could not get your location. Try again or search instead.')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  const confirm = () => {
    if (!marker || !label) return
    onConfirm({ name: label.name, address: label.address, lat: marker[0], lng: marker[1] })
  }

  const title = isPickup ? 'Set pickup point' : 'Set drop-off'
  const icon = useMemo(() => ridePointIcon(kind), [kind])
  const list = debounced ? (results.data ?? []) : []

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="tourist-ui fixed inset-0 z-[2100] flex flex-col bg-[#f8faf7]">
      {/* Header + search */}
      <div className="shrink-0 bg-[#fff] px-3 pt-3 pb-2 shadow-sm" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-[#17201B] hover:bg-[#F3F8F5]">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: RIDE_POINT_COLORS[kind] }} aria-hidden="true" />
          <h2 className="text-base font-bold text-[#17201B]">{title}</h2>
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A948F]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isPickup ? 'Search a pickup place, hotel or landmark' : 'Search where you want to go'}
            aria-label={isPickup ? 'Search pickup location' : 'Search drop-off location'}
            className="h-11 w-full rounded-xl! border! border-[#E5E9E7]! bg-[#fff]! pl-10 pr-10 text-sm text-[#17201B] shadow-none! placeholder:text-[#8A948F] focus:border-[#087F3F]! focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#68736D] hover:bg-[#F3F8F5]">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {debounced && (
          <ul aria-label="Search results" className="mt-2 max-h-[40vh] overflow-y-auto rounded-xl border border-[#E5E9E7] bg-[#fff]">
            {results.isLoading && <li className="px-4 py-3 text-sm text-[#68736D]">Searching…</li>}
            {!results.isLoading && list.length === 0 && <li className="px-4 py-3 text-sm text-[#68736D]">No places found. Move the marker on the map instead.</li>}
            {list.map((r, i) => (
              <li key={`${r.type}-${r.id}-${r.name}-${i}`}>
                <button type="button" onClick={() => choose(r)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F3F8F5]">
                  <MapPin className="h-4 w-4 shrink-0 text-[#087F3F]" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#17201B]">{r.name}</span>
                    {r.address && <span className="block truncate text-xs text-[#68736D]">{r.address}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Map */}
      <div className="relative min-h-0 flex-1" data-testid="ride-point-map">
        <MapContainer center={center} zoom={initial || near ? 16 : 13} className="h-full w-full z-0" zoomControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
          <FlyTo target={focus} />
          <TapToMove onTap={(p) => moveTo(p)} />
          {marker && (
            <Marker
              position={marker}
              icon={icon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const { lat, lng } = (e.target as L.Marker).getLatLng()
                  moveTo([lat, lng])
                },
              }}
            />
          )}
        </MapContainer>
        {isPickup && (
          <button
            type="button"
            onClick={useCurrentLocation}
            aria-label="Use my current location"
            title="Use my current location"
            className="absolute bottom-4 right-3 z-[500] flex h-12 w-12 items-center justify-center rounded-xl border-2 border-white bg-[#fff] text-[#087F3F] shadow-[0_2px_8px_rgba(0,0,0,0.25)] hover:bg-[#F3F8F5]"
          >
            {locating ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <LocateFixed className="h-5 w-5" aria-hidden="true" />}
          </button>
        )}
        {!marker && (
          <p className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-[#17201B]/80 px-4 py-2 text-xs font-semibold text-white">
            {isPickup ? 'Search, tap the map or use your location' : 'Search or tap the map to place the marker'}
          </p>
        )}
      </div>

      {/* Chosen point + Confirm */}
      <div className="shrink-0 bg-[#fff] px-4 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {locError && <p role="alert" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{locError}</p>}
        <div className="mb-3 flex items-start gap-3" aria-live="polite">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: RIDE_POINT_COLORS[kind] }} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-[#68736D]">{isPickup ? 'Pickup point' : 'Drop-off'}</p>
            <p className="truncate text-sm font-semibold text-[#17201B]" data-testid="ride-point-label">
              {marker ? (label?.name ?? 'Finding the address…') : 'No point yet'}
            </p>
            {marker && label?.address && <p className="truncate text-xs text-[#68736D]">{label.address}</p>}
            {marker && <p className="mt-0.5 text-[11px] text-[#8A948F]">Drag the marker or tap the map to adjust it.</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={confirm}
          disabled={!marker || !label}
          className={cn('h-12 w-full rounded-2xl text-base font-bold text-white transition', marker && label ? 'bg-[#087F3F] hover:bg-[#056B35]' : 'bg-[#9CA3AF]')}
        >
          {isPickup ? 'Confirm pickup point' : 'Confirm drop-off'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
