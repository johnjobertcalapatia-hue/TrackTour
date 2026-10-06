import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, post } from '@/shared/services/api'
import { formatCurrency, cn } from '@/shared/utils'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  X, MapPin, Loader2, Car, Bus, Bike, CheckCircle2, ChevronLeft,
  Navigation, Crosshair, Search, RotateCcw, ArrowRight,
} from 'lucide-react'

interface RideSheetProps {
  isOpen: boolean
  onClose: () => void
  destination?: string
  destinationCoords?: { lat: number; lng: number }
  initialQuery?: string
}

interface LocationResult {
  id: number | null
  type: 'attraction' | 'stay' | 'restaurant' | 'municipality' | 'barangay' | 'custom'
  name: string
  address: string
  lat: number
  lng: number
}

interface RecentLocation {
  name: string
  address: string
  lat: number
  lng: number
}

interface VehicleFare {
  base_fare: number
  distance_fare: number
  fare: number
  total_fare: number
  fare_text: string
}

interface EstimateResult {
  distance_km: number
  distance_text: string
  duration_min: number
  duration_text: string
  service_fee: number
  fares: Record<string, VehicleFare>
}

interface RouteResult {
  polyline: [number, number][]
  distance_km: number
  duration_min: number
  source: 'osrm' | 'straight_line'
}

interface BookResponse {
  order_id: number
  redirect: string
}

type Step = 'destination' | 'pickup' | 'summary'

const VEHICLES: { type: string; name: string; icon: typeof Bike }[] = [
  { type: 'motorcycle', name: 'Motorcycle', icon: Bike },
  { type: 'tricycle', name: 'Tricycle', icon: Bike },
  { type: 'car', name: 'Car', icon: Car },
  { type: 'van', name: 'Van', icon: Bus },
]

const PAYMENT_METHODS = ['cash', 'gcash', 'maya', 'card']

const RECENT_KEY = 'tracktour_recent_locations'
const FALLBACK_CENTER: [number, number] = [12.5, 121.3]

function loadRecent(): RecentLocation[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(0, 4) : []
  } catch {
    return []
  }
}

function createMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      width: 26px; height: 26px;
      background: ${color};
      border: 3px solid #fff;
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

const pickupIcon = createMarkerIcon('#087F3F')
const destinationIcon = createMarkerIcon('#F4B400')

function PinMap({
  center,
  marker,
  onPick,
}: {
  center: [number, number]
  marker: [number, number] | null
  onPick: (point: [number, number]) => void
}) {
  function ClickHandler() {
    useMapEvents({
      click(event) {
        onPick([event.latlng.lat, event.latlng.lng])
      },
    })
    return null
  }

  function RecenterView({ center }: { center: [number, number] }) {
    const map = useMapEvents({})
    useEffect(() => {
      map.setView(center, map.getZoom() >= 13 ? map.getZoom() : 13)
    }, [map, center[0], center[1]])
    return null
  }

  return (
    <MapContainer center={center} zoom={13} className="w-full h-64 rounded-xl z-0" scrollWheelZoom>
      <ClickHandler />
      <RecenterView center={center} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {marker && (
        <Marker position={marker}>
          <Popup>Pinned location</Popup>
        </Marker>
      )}
    </MapContainer>
  )
}

function FitRoute({ points }: { points: [number, number][] }) {
  const map = useMap()

  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(points, { padding: [24, 24] })
    } else if (points.length === 1) {
      map.setView(points[0], 14)
    }
  }, [map, points])

  return null
}

function RoutePreview({
  route,
  pickup,
  destination,
}: {
  route: RouteResult
  pickup: { lat: number; lng: number }
  destination: { lat: number; lng: number }
}) {
  const points: [number, number][] = route.polyline.length >= 2 ? route.polyline : [
    [pickup.lat, pickup.lng],
    [destination.lat, destination.lng],
  ]

  return (
    <MapContainer center={[pickup.lat, pickup.lng]} zoom={12} className="w-full h-52 rounded-xl z-0" scrollWheelZoom>
      <FitRoute points={points} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />
      <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} />
      <Polyline
        positions={points}
        pathOptions={{
          color: route.source === 'osrm' ? '#087F3F' : '#9CA3AF',
          weight: 4,
          opacity: 0.9,
          dashArray: route.source === 'osrm' ? undefined : '6 6',
        }}
      />
    </MapContainer>
  )
}

export default function BookRideSheet({ isOpen, onClose, destination, destinationCoords, initialQuery }: RideSheetProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('destination')
  const [dest, setDest] = useState<{ name: string; address: string; lat: number | null; lng: number | null }>()
  const [pickup, setPickup] = useState<{ name: string; lat: number | null; lng: number | null }>()
  const [recent, setRecent] = useState<RecentLocation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [manualText, setManualText] = useState('')
  const [mapMode, setMapMode] = useState(false)
  const [mapPin, setMapPin] = useState<[number, number] | null>(null)
  const [pinLabel, setPinLabel] = useState<{ name: string; address: string } | null>(null)
  const [vehicleType, setVehicleType] = useState('motorcycle')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [estimate, setEstimate] = useState<EstimateResult | null>(null)
  const seededRef = useRef(false)

  useEffect(() => {
    setRecent(loadRecent())
  }, [])

  useEffect(() => {
    if (isOpen && !seededRef.current) {
      seededRef.current = true
      if (destination) {
        setDest({
          name: destination,
          address: '',
          lat: destinationCoords?.lat ?? null,
          lng: destinationCoords?.lng ?? null,
        })
        setStep('pickup')
      } else if (initialQuery) {
        setSearchQuery(initialQuery)
        setStep('destination')
      }
    }
    if (!isOpen) {
      seededRef.current = false
    }
  }, [isOpen, destination, destinationCoords, initialQuery])

  const saveRecent = (entry: RecentLocation) => {
    setRecent((prev) => {
      const deduped = [entry, ...prev.filter((r) => r.name !== entry.name)].slice(0, 4)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(deduped))
      } catch { /* ignore */ }
      return deduped
    })
  }

  const locations = useQuery({
    queryKey: ['transport-locations', step, searchQuery],
    queryFn: () =>
      get<LocationResult[]>(`/tourist/transport/locations/search?q=${encodeURIComponent(searchQuery.trim())}`),
    enabled: isOpen && !mapMode && searchQuery.trim().length > 0,
  })

  const reverseMut = useMutation({
    mutationFn: ({ lat, lng }: { lat: number; lng: number }) =>
      get<LocationResult>('/tourist/transport/locations/reverse-geocode', { params: { lat, lng } }),
  })

  const estimateMut = useMutation({
    mutationFn: ({ from, to }: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }) =>
      post<EstimateResult>('/tourist/transport/estimate', {
        pickup_lat: from.lat,
        pickup_lng: from.lng,
        destination_lat: to.lat,
        destination_lng: to.lng,
      }),
    onSuccess: (data) => setEstimate(data),
  })

  useEffect(() => {
    if (pickup?.lat != null && pickup.lng != null && dest?.lat != null && dest.lng != null) {
      estimateMut.mutate({ from: { lat: pickup.lat, lng: pickup.lng }, to: { lat: dest.lat, lng: dest.lng } })
    }
  }, [pickup?.lat, pickup?.lng, dest?.lat, dest?.lng])

  const routeQuery = useQuery({
    queryKey: ['transport-route', pickup?.lat, pickup?.lng, dest?.lat, dest?.lng],
    queryFn: () =>
      post<RouteResult>('/tourist/transport/route', {
        pickup_lat: pickup?.lat,
        pickup_lng: pickup?.lng,
        destination_lat: dest?.lat,
        destination_lng: dest?.lng,
      }),
    enabled: Boolean(
      pickup?.lat != null && pickup?.lng != null && dest?.lat != null && dest.lng != null
    ),
  })

  const requestRideMutation = useMutation({
    mutationFn: () => {
      const fare = estimate?.fares?.[vehicleType]?.fare ?? 0
      return post<BookResponse>('/tourist/transport/book', {
        pickup_address: pickup?.name ?? '',
        pickup_lat: pickup?.lat,
        pickup_lng: pickup?.lng,
        destination_address: dest?.address || dest?.name || '',
        destination_lat: dest?.lat,
        destination_lng: dest?.lng,
        vehicle_type: vehicleType,
        passenger_count: 1,
        fare,
        distance_km: estimate?.distance_km ?? 0,
        duration_min: estimate?.duration_min ?? 1,
        payment_method: paymentMethod,
        booking_notes: '',
      })
    },
    onSuccess: (data) => {
      if (dest?.lat != null && dest.lng != null) {
        saveRecent({ name: dest.name, address: dest.address, lat: dest.lat, lng: dest.lng })
      }
      if (data?.redirect) {
        navigate(data.redirect)
      } else {
        onClose()
      }
    },
  })

  if (!isOpen) return null

  const hasDest = Boolean(dest?.name && dest.lat != null && dest.lng != null)
  const hasPickup = Boolean(pickup?.name && pickup.lat != null && pickup.lng != null)
  const canBook = hasDest && hasPickup && estimate != null && requestRideMutation.isIdle
  const currentFare = estimate?.fares?.[vehicleType]

  const chooseResult = (result: LocationResult) => {
    if (step === 'destination') {
      setDest({ name: result.name, address: result.address, lat: result.lat, lng: result.lng })
      setSearchQuery('')
      setManualText('')
      setStep('pickup')
    } else {
      setPickup({ name: result.address ? `${result.name}, ${result.address}` : result.name, lat: result.lat, lng: result.lng })
      setSearchQuery('')
      setManualText('')
      setStep('summary')
    }
  }

  const openMap = () => {
    const anchor: [number, number] =
      (step === 'destination'
        ? dest?.lat != null && dest.lng != null
          ? [dest.lat, dest.lng]
          : null
        : pickup?.lat != null && pickup.lng != null
          ? [pickup.lat, pickup.lng]
          : null) ?? FALLBACK_CENTER
    setMapPin(anchor)
    setMapMode(true)
  }

  const onMapPick = (point: [number, number]) => {
    setMapPin(point)
    reverseMut.mutate(
      { lat: point[0], lng: point[1] },
      {
        onSuccess: (label) => setPinLabel({ name: label.name, address: label.address }),
      }
    )
  }

  const confirmPinned = () => {
    if (!mapPin) return
    const label = pinLabel?.name === 'Picked location'
      ? { name: 'Picked location', address: pinLabel?.address ?? '' }
      : { name: pinLabel?.name ?? 'Picked location', address: pinLabel?.address ?? '' }
    if (step === 'destination') {
      setDest({ ...label, lat: mapPin[0], lng: mapPin[1] })
      setStep('pickup')
    } else {
      setPickup({ name: label.address ? `${label.name}, ${label.address}` : label.name, lat: mapPin[0], lng: mapPin[1] })
      setStep('summary')
    }
    setMapMode(false)
    setMapPin(null)
    setPinLabel(null)
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setPickup({ name: 'Current location', lat: latitude, lng: longitude })
        reverseMut.mutate(
          { lat: latitude, lng: longitude },
          {
            onSuccess: (label) => {
              if (label.name !== 'Picked location') {
                setPickup({ name: label.name, lat: latitude, lng: longitude })
              }
            },
          }
        )
        setStep('summary')
      },
      () => { /* permission denied — leave the user on manual entry */ }
    )
  }

  const commitManual = () => {
    const text = manualText.trim()
    if (!text) return
    if (step === 'destination') {
      setDest({ name: text, address: '', lat: null, lng: null })
      setStep('pickup')
    } else {
      setPickup({ name: text, lat: null, lng: null })
      setStep('summary')
    }
    setManualText('')
  }

  const stepTitles: Record<Step, string> = {
    destination: 'Where to?',
    pickup: 'Pickup location',
    summary: 'Trip summary',
  }

  const activeStepIndex = step === 'destination' ? 0 : step === 'pickup' ? 1 : 2

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl border-t border-[#E5E9E7] max-h-[88vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-[#E5E9E7] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-2">
          <div className="flex items-center gap-2">
            {step !== 'destination' && (
              <button
                onClick={() => {
                  setStep(step === 'pickup' ? 'destination' : 'pickup')
                  setMapMode(false)
                  setMapPin(null)
                }}
                className="p-2 -ml-1 rounded-full hover:bg-[#E9F7EF] transition"
              >
                <ChevronLeft className="w-5 h-5 text-[#68736D]" />
              </button>
            )}
            <div className="w-8 h-8 rounded-full bg-[#E9F7EF] flex items-center justify-center">
              <Bike className="w-4 h-4 text-[#087F3F]" />
            </div>
            <h3 className="font-semibold text-[#17201B]">{stepTitles[step]}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#E9F7EF] transition">
            <X className="w-5 h-5 text-[#68736D]" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pb-3 flex items-center gap-2">
          {['Destination', 'Pickup', 'Trip'].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  'w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center transition',
                  i < activeStepIndex
                    ? 'bg-[#087F3F] text-white'
                    : i === activeStepIndex
                      ? 'bg-[#087F3F] text-white'
                      : 'bg-[#E5E9E7] text-[#9CA3AF]'
                )}
              >
                {i < activeStepIndex ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
              </span>
              <span className={cn('text-[11px]', i === activeStepIndex ? 'text-[#087F3F] font-medium' : 'text-[#9CA3AF]')}>{label}</span>
              {i < 2 && <span className="w-4 h-px bg-[#E5E9E7]" />}
            </div>
          ))}
        </div>

        <div className="px-5 pb-6 space-y-4">
          {/* ─────────── Destination / Pickup selection step ─────────── */}
          {step !== 'summary' && !mapMode && (
            <>
              {/* Search box */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={step === 'destination' ? 'Search destination, hotel, resort, barangay…' : 'Search pickup point…'}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] outline-none transition"
                />
              </div>

              {/* Current suggested destination (from place page) */}
              {step === 'destination' && dest?.name && (
                <button
                  onClick={() => chooseResult({ id: null, type: 'custom', name: dest.name, address: dest.address, lat: dest.lat ?? 0, lng: dest.lng ?? 0 })}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-[#E9F7EF] border border-[#087F3F]/30 rounded-xl text-sm text-left hover:border-[#087F3F] transition"
                >
                  <MapPin className="w-4 h-4 text-[#087F3F] shrink-0" />
                  <span className="text-[#17201B] flex-1">{dest.name}</span>
                  <ArrowRight className="w-4 h-4 text-[#087F3F]" />
                </button>
              )}

              {/* Recent destinations */}
              {step === 'destination' && recent.length > 0 && !searchQuery.trim() && (
                <div>
                  <p className="text-[10px] text-[#68736D] mb-1.5">Recent destinations</p>
                  <div className="space-y-1.5">
                    {recent.map((r) => (
                      <button
                        key={r.name}
                        onClick={() => chooseResult({ id: null, type: 'custom', name: r.name, address: r.address, lat: r.lat, lng: r.lng })}
                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white border border-[#E5E9E7] rounded-xl text-sm text-left hover:border-[#087F3F]/40 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                        <span className="text-[#17201B] flex-1 truncate">{r.name}</span>
                        {r.address && <span className="text-[11px] text-[#9CA3AF] truncate max-w-[40%]">{r.address}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Search results */}
              {searchQuery.trim() && (
                <div>
                  {locations.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-[#9CA3AF] py-3">
                      <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                    </div>
                  ) : locations.data?.length ? (
                    <div className="space-y-1.5">
                      {locations.data.map((result, i) => (
                        <button
                          key={`${result.type}-${result.id}-${result.name}-${i}`}
                          onClick={() => chooseResult(result)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 bg-white border border-[#E5E9E7] rounded-xl text-sm text-left hover:border-[#087F3F]/40 transition"
                        >
                          <MapPin className="w-4 h-4 text-[#087F3F] shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[#17201B] truncate">{result.name}</span>
                            {result.address && <span className="block text-[11px] text-[#9CA3AF] truncate">{result.address}</span>}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-[#9CA3AF] border border-[#E5E9E7] rounded px-1.5 py-0.5">
                            {result.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    !locations.isLoading && (
                      <p className="text-sm text-[#9CA3AF] py-3">No matches found. Use the map or enter it manually below.</p>
                    )
                  )}
                </div>
              )}

              {/* Manual entry */}
              {!searchQuery.trim() || !locations.data?.length ? (
                <div className="pt-2 border-t border-[#E5E9E7]">
                  <p className="text-[10px] text-[#68736D] mb-1.5">Or enter an address</p>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
                    <input
                      type="text"
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      placeholder="Type an address…"
                      className="w-full pl-10 pr-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] outline-none transition"
                    />
                  </div>
                  <button
                    onClick={commitManual}
                    disabled={!manualText.trim()}
                    className="mt-2 w-full py-2 text-xs font-medium text-[#087F3F] hover:text-[#056B35] transition disabled:text-[#9CA3AF] disabled:cursor-not-allowed text-center"
                  >
                    Use this address
                  </button>
                </div>
              ) : null}

              {/* Map pin + (pickup only) current location */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={openMap}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-[#E5E9E7] rounded-xl text-sm font-medium text-[#17201B] hover:border-[#087F3F]/50 transition"
                >
                  <Navigation className="w-4 h-4 text-[#087F3F]" /> Pick on map
                </button>
                {step === 'pickup' && (
                  <button
                    onClick={useMyLocation}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-[#E5E9E7] rounded-xl text-sm font-medium text-[#17201B] hover:border-[#087F3F]/50 transition"
                  >
                    <Crosshair className="w-4 h-4 text-[#087F3F]" /> Use current location
                  </button>
                )}
              </div>
            </>
          )}

          {/* ─────────── Map pin mode ─────────── */}
          {step !== 'summary' && mapMode && (
            <>
              <PinMap center={mapPin ?? FALLBACK_CENTER} marker={mapPin} onPick={onMapPick} />
              <div className="bg-[#E9F7EF] border border-[#087F3F]/20 rounded-xl p-3">
                <p className="text-[10px] text-[#68736D] mb-0.5">Selected location</p>
                <p className="text-sm font-medium text-[#17201B]">
                  {reverseMut.isPending ? 'Resolving…' : pinLabel?.name ?? 'Tap the map to pin a location'}
                </p>
                {reverseMut.isPending ? null : pinLabel?.name === 'Picked location' ? (
                  <p className="text-[11px] text-[#68736D] mt-0.5">This point is not near a registered place.</p>
                ) : (
                  pinLabel?.address && <p className="text-[11px] text-[#68736D] mt-0.5">{pinLabel.address}</p>
                )}
              </div>
              <button
                onClick={confirmPinned}
                disabled={!mapPin}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition disabled:bg-[#E5E9E7] disabled:text-[#9CA3AF] disabled:cursor-not-allowed bg-[#087F3F] text-white hover:bg-[#056B35]"
              >
                Confirm location
              </button>
              <button
                onClick={() => setMapMode(false)}
                className="w-full py-2 text-xs font-medium text-[#68736D] hover:text-[#17201B] transition text-center"
              >
                Cancel
              </button>
            </>
          )}

          {/* ─────────── Summary step ─────────── */}
          {step === 'summary' && (
            <>
              {/* Route summary */}
              <div className="flex items-center gap-3 bg-white border border-[#E5E9E7] rounded-xl p-4">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-3 h-3 bg-[#087F3F] rounded-full" />
                  <div className="w-0.5 h-6 bg-[#E5E9E7]" />
                  <div className="w-3 h-3 bg-[#F4B400] rounded-full" />
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-[10px] text-[#68736D] uppercase tracking-wider">Pickup</p>
                    <p className="text-sm text-[#17201B]">{pickup?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#68736D] uppercase tracking-wider">Destination</p>
                    <p className="text-sm text-[#17201B]">{dest?.name}{dest?.address ? ` · ${dest.address}` : ''}</p>
                  </div>
                </div>
              </div>

              {/* Missing coordinate hint */}
              {!hasDest || !hasPickup ? (
                <p className="text-[11px] text-red-500">
                  {!hasDest ? 'Destination needs a map pin' : ''}
                  {!hasDest && !hasPickup ? ' and ' : ''}
                  {!hasPickup ? 'pickup needs a map pin or your current location' : ''} — go back and pick it on the map.
                </p>
              ) : null}

              {/* Route preview */}
              {hasDest && hasPickup && routeQuery.data && (
                <div className="overflow-hidden bg-white border border-[#E5E9E7] rounded-xl">
                  <RoutePreview
                    route={routeQuery.data}
                    pickup={{ lat: pickup?.lat ?? 0, lng: pickup?.lng ?? 0 }}
                    destination={{ lat: dest?.lat ?? 0, lng: dest?.lng ?? 0 }}
                  />
                  <div className="flex items-center justify-between px-3 py-2 border-t border-[#E5E9E7]">
                    <span className="text-[11px] text-[#68736D]">
                      {routeQuery.data.source === 'osrm' ? 'Street route' : 'Approximate route'}
                    </span>
                    <span className="text-xs font-medium text-[#17201B]">
                      {routeQuery.data.distance_km.toFixed(1)} km • {routeQuery.data.duration_min} min
                    </span>
                  </div>
                </div>
              )}

              {/* Vehicle selection */}
              <div>
                <label className="text-[10px] text-[#68736D] mb-1.5 block">Vehicle</label>
                <div className="grid grid-cols-2 gap-2">
                  {VEHICLES.map((v) => {
                    const Icon = v.icon
                    const fare = estimate?.fares?.[v.type]
                    const selected = vehicleType === v.type
                    return (
                      <button
                        key={v.type}
                        onClick={() => setVehicleType(v.type)}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm transition',
                          selected
                            ? 'border-[#087F3F] bg-[#E9F7EF] text-[#087F3F]'
                            : 'border-[#E5E9E7] bg-white text-[#68736D] hover:border-[#087F3F]/40'
                        )}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1 text-left capitalize">{v.name}</span>
                        {fare && <span className="text-xs font-semibold">{formatCurrency(fare.fare)}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Payment method */}
              <div>
                <label className="text-[10px] text-[#68736D] mb-1.5 block">Payment method</label>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={cn(
                        'px-3 py-2 rounded-lg border text-xs font-medium capitalize transition',
                        paymentMethod === m
                          ? 'border-[#087F3F] bg-[#E9F7EF] text-[#087F3F]'
                          : 'border-[#E5E9E7] bg-white text-[#68736D] hover:border-[#087F3F]/40'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fare breakdown */}
              {estimate && currentFare ? (
                <div className="bg-white border border-[#E5E9E7] rounded-xl p-4 space-y-1.5">
                  <div className="flex justify-between text-xs text-[#68736D]">
                    <span>Base fare</span>
                    <span>{formatCurrency(currentFare.base_fare)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-[#68736D]">
                    <span>Distance ({estimate.distance_text})</span>
                    <span>{formatCurrency(currentFare.distance_fare)}</span>
                  </div>
                  {estimate.service_fee > 0 && (
                    <div className="flex justify-between text-xs text-[#68736D]">
                      <span>Service fee</span>
                      <span>{formatCurrency(estimate.service_fee)}</span>
                    </div>
                  )}
                  <div className="h-px bg-[#E5E9E7]" />
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-[#68736D]">Total fare</span>
                    <span className="text-lg font-bold text-[#17201B]">{formatCurrency(currentFare.total_fare)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[#9CA3AF]">
                    <span>{estimate.distance_text} • {estimate.duration_text}</span>
                    {estimate.service_fee > 0 && <span>Service fee not included in billed total</span>}
                  </div>
                </div>
              ) : !hasDest || !hasPickup ? null : (
                <div className="flex items-center gap-2 text-sm text-[#9CA3AF] py-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Estimating fare…
                </div>
              )}

              <button
                onClick={() => requestRideMutation.mutate()}
                disabled={!canBook}
                className={cn(
                  'w-full py-3.5 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2',
                  canBook
                    ? 'bg-[#087F3F] text-white hover:bg-[#056B35]'
                    : 'bg-[#E5E9E7] text-[#9CA3AF] cursor-not-allowed'
                )}
              >
                {requestRideMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Requesting…</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4" /> Request Ride</>
                )}
              </button>
              <p className="text-[10px] text-[#9CA3AF] text-center">Ride managed by Tourism Office transportation</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}