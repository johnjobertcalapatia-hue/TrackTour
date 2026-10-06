import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/shared/services/api'
import { useNavigate } from 'react-router-dom'
import { toAssetUrl } from '@/shared/utils'
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { beachPinIcon, pinIcon, userPinIcon } from '@/shared/utils/pin-icon'
import {
  X,
  MapPin,
  Star,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  Share2,
  Clock,
  Banknote,
  UtensilsCrossed,
  Hotel,
  Building2,
  Bike,
  Motorbike,
  Van,
  Bus,
  Footprints,
  type LucideIcon,
} from 'lucide-react'

type MapType = 'street' | 'satellite'

const MAP_LAYERS: Record<MapType, { url: string; attribution: string }> = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
  },
}

const MAP_CATEGORY_GROUPS: Record<string, string[]> = {
  'Tourist Spots': ['Tourist Attraction', 'Nature', 'Beach', 'Park', 'Historical'],
  Food: ['Restaurant', 'Food', 'Cafe', 'Bakery', 'Fast Food'],
  Businesses: ['Hotel', 'Resort', 'Shop', 'Market', 'Pharmacy', 'Hospital'],
  Resorts: ['Resort', 'Beach Resort', 'Mountain Resort'],
}

const MAP_CATEGORY_OPTIONS = ['all', 'Tourist Spots', 'Food', 'Businesses', 'Resorts'] as const

interface Business {
  id: number
  name: string
  business_name?: string | null
  business_description?: string | null
  description?: string | null
  category: { id: number; name: string } | null
  municipality: { id: number; name: string } | null
  barangay: { id: number; name: string } | null
  address: string | null
  contact_number?: string | null
  phone?: string | null
  opening_time?: string | null
  closing_time?: string | null
  latitude: number | null
  longitude: number | null
  logo: string | null
  cover_photo: string | null
  images?: (string | null)[]
  media?: { file_path?: string | null; type?: string | null }[]
  is_open: boolean
  reviews_count: number
  reviews_avg_rating: number | null
  promotions: unknown[]
  services?: string[] | null
  price_range?: string | null
  menu_items?: { id: number; name: string; description?: string | null; price: number; image?: string | null; bestseller?: boolean }[]
}

interface MapData {
  businesses: Business[]
  municipalities: { id: number; name: string }[]
  categories?: unknown[]
}

const PANEL_TABS = ['Overview', 'Menu', 'Reviews', 'About'] as const
type PanelTab = (typeof PANEL_TABS)[number]

const transportModes = [
  { key: 'motorcycle', label: 'Motorcycle', icon: Motorbike, speed: 30, baseFare: 40, includedKm: 1, perKm: 15 },
  { key: 'van', label: 'Van', icon: Van, speed: 22, baseFare: 50, includedKm: 0, perKm: 10 },
  { key: 'bus', label: 'Bus', icon: Bus, speed: 18, baseFare: 30, includedKm: 0, perKm: 3 },
  { key: 'bicycle', label: 'Bicycle', icon: Bike, speed: 15, baseFare: 0, includedKm: 0, perKm: 0 },
  { key: 'walking', label: 'Walking', icon: Footprints, speed: 5, baseFare: 0, includedKm: 0, perKm: 0 },
] as const

type TransportKey = (typeof transportModes)[number]['key']

function calcTravelTime(distanceKm: number, speedKmh: number): string {
  const hours = distanceKm / speedKmh
  const totalMin = Math.round(hours * 60)
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return `${h}h ${m}m`
  }
  return `${totalMin} min`
}

function calcFare(distanceKm: number, mode: (typeof transportModes)[number]): number {
  if (mode.baseFare === 0) return 0
  return Math.round(mode.baseFare + Math.max(0, distanceKm - mode.includedKm) * mode.perKm)
}

function businessAction(b: Business): { label: string; to: string; icon: LucideIcon } | null {
  const cat = b.category?.name ?? ''
  if (['Restaurant', 'Food', 'Cafe', 'Bakery', 'Fast Food'].includes(cat))
    return { label: 'Order Food', to: '/tourist/food', icon: UtensilsCrossed }
  if (['Hotel', 'Resort', 'Beach Resort', 'Mountain Resort'].includes(cat))
    return { label: 'Book / Reserve', to: '/tourist/stays', icon: Hotel }
  if (['Tourist Attraction', 'Nature', 'Beach', 'Park', 'Historical'].includes(cat))
    return { label: 'Explore Place', to: '/tourist/explore', icon: Navigation }
  return { label: 'View Business', to: '/tourist/directory', icon: Building2 }
}

const CARD_WIDTH = 256
const CARD_GAP = 10

interface HoverState {
  b: Business
  pos: [number, number]
  size: [number, number]
}

const AUTO_FOCUS_FLAG = 'tracktour_map_autofocused'
const PENDING_MAP_DESTINATION_KEY = 'tracktour_pending_map_destination'

function AutoLocate() {
  const map = useMap()
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        const alreadyFocused = sessionStorage.getItem(AUTO_FOCUS_FLAG) === '1'
        L.marker([latitude, longitude], { icon: userPinIcon }).addTo(map)
        if (!alreadyFocused) {
          map.setView([latitude, longitude], 14)
          sessionStorage.setItem(AUTO_FOCUS_FLAG, '1')
        }
      },
      () => {},
      { enableHighAccuracy: true }
    )
  }, [map])
  return null
}

function MapEventsHandler({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({
    click: () => onMapClick(),
  })
  return null
}

function FocusMapOnLocation({ location }: { location: { lat: number; lng: number } | null }) {
  const map = useMap()

  useEffect(() => {
    if (!location) return

    const focus = () => {
      map.invalidateSize({ pan: false })
      map.setView([location.lat, location.lng], Math.max(map.getZoom(), 14), { animate: true })
    }

    const frame = window.requestAnimationFrame(focus)
    const timer = window.setTimeout(focus, 150)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [location, map])

  return null
}

const originIcon = userPinIcon

const destinationIcon = L.divIcon({
  className: 'route-destination-marker',
  html: '<div style="width:22px;height:22px;background:#087F3F;border:3px solid #fff;border-radius:50%;box-shadow:0 4px 12px rgba(0,0,0,0.3)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function RouteOverlay({ route, destination }: {
  route: { coords: [number, number][]; origin: { lat: number; lng: number } }
  destination: { lat: number; lng: number }
}) {
  return (
    <>
      <Polyline positions={route.coords} pathOptions={{ color: '#ecf718', weight: 6, opacity: 0.95 }} />
      <Polyline positions={route.coords} pathOptions={{ color: '#fff', weight: 2, opacity: 0.3 }} />
      <Marker position={[route.origin.lat, route.origin.lng]} icon={originIcon} />
      <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} />
    </>
  )
}

export default function TouristExploreMap() {
  const navigate = useNavigate()
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [pinned, setPinned] = useState<Business | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedImage, setSelectedImage] = useState(0)
  const [panelTab, setPanelTab] = useState<PanelTab>('Overview')
  const [saved, setSaved] = useState(false)
  const [hover, setHover] = useState<HoverState | null>(null)
  const overCardRef = useRef(false)
  const hideTimerRef = useRef<number | null>(null)
  const [activeImage, setActiveImage] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(0)

  const [mapType, setMapType] = useState<MapType>('street')
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [route, setRoute] = useState<[number, number][] | null>(null)
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null)
  const [routeDestination, setRouteDestination] = useState<{ name: string; address: string } | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<TransportKey>('motorcycle')
  const [focusLocation, setFocusLocation] = useState<{ lat: number; lng: number } | null>(null)
  const activeMapType: MapType = MAP_LAYERS[mapType] ? mapType : 'street'

  const { data: mapData, isLoading } = useQuery<MapData>({
    queryKey: ['tourist', 'map-data'],
    queryFn: async () => {
      const res = await api.get<MapData>('/tourist/explore/map')
      return res.data
    },
    placeholderData: { businesses: [], categories: [], municipalities: [] },
  })

  const businesses = mapData?.businesses ?? []

  const filteredBusinesses = businesses.filter((b) => {
    const cat = b.category?.name ?? ''
    if (categoryFilter === 'all') return true
    const group = MAP_CATEGORY_GROUPS[categoryFilter] ?? []
    return group.includes(cat)
  })

  const handleBusinessSelect = (biz: Business) => {
    setPinned(biz)
    setPanelOpen(true)
    setSelectedImage(0)
    setPanelTab('Overview')
    setSaved(false)
    if (biz.latitude != null && biz.longitude != null) {
    }
  }

  const handleClosePanel = () => {
    setPanelOpen(false)
    setPinned(null)
    setRoute(null)
    setRouteDistanceKm(null)
    setRouteDestination(null)
  }

  const handleDirections = (b: Business) => {
    if (b.latitude == null || b.longitude == null) return
    const doRoute = (from: [number, number]) => {
      const currentLocation = { lat: from[0], lng: from[1] }
      setUserLocation(currentLocation)
      setFocusLocation(currentLocation)
      const url =
        `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${b.longitude},${b.latitude}` +
        `?overview=full&geometries=geojson`
      fetch(url)
        .then((r) => r.json())
        .then((data) => {
          const coords: number[][] = data?.routes?.[0]?.geometry?.coordinates
          if (Array.isArray(coords)) {
            setRoute(coords.map((c) => [c[1], c[0]] as [number, number]))
            const r = data?.routes?.[0]
            setRouteDistanceKm((r?.distance ?? 0) / 1000)
            setFocusLocation({ ...currentLocation })
            setRouteDestination({
              name: b.name ?? 'Business',
              address: b.municipality ? `${typeof b.municipality === 'object' ? (b.municipality as { name: string }).name : b.municipality}, Oriental Mindoro` : 'Bansud, Oriental Mindoro',
            })
          }

        })
        .catch(() => {})
    }
    if (userLocation) doRoute([userLocation.lat, userLocation.lng])
    else if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const from: [number, number] = [pos.coords.latitude, pos.coords.longitude]
          setUserLocation({ lat: from[0], lng: from[1] })
          doRoute(from)
        },
        () => {},
        { enableHighAccuracy: true }
      )
    }
  }

  const clearRoute = () => {
    setRoute(null)
    setRouteDistanceKm(null)
    setRouteDestination(null)
  }

  const handleShare = (b: Business) => {
    const url = `${window.location.origin}/tourist/explore/${b.id}`
    if (navigator.share) {
      navigator.share({ title: `TrackTour — ${b.name}`, url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(url).catch(() => {})
    }
  }

  useEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [hover])

  useEffect(() => { setActiveImage(0) }, [hover])
  useEffect(() => { setSaved(false) }, [hover])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!businesses.length) return
    const stored = sessionStorage.getItem(PENDING_MAP_DESTINATION_KEY)
    if (!stored) return

    sessionStorage.removeItem(PENDING_MAP_DESTINATION_KEY)
    try {
      const pending = JSON.parse(stored) as { id?: number; latitude?: number; longitude?: number }
      const attraction = pending.id != null
        ? businesses.find((business) => business.id === pending.id)
        : businesses.find((business) => business.latitude === pending.latitude && business.longitude === pending.longitude)

      if (attraction) {
        handleBusinessSelect(attraction)
        handleDirections(attraction)
      }
    } catch {
      sessionStorage.removeItem(PENDING_MAP_DESTINATION_KEY)
    }
  }, [businesses])

  const getBusinessImages = (business: Business | null): string[] => {
    if (!business) return []

    return [
      business.cover_photo,
      business.logo,
      ...(business.images ?? []),
      ...(business.media ?? []).map((media) => media.file_path),
    ].filter((src, index, all): src is string => Boolean(src) && all.indexOf(src) === index)
  }

  const cardImages = getBusinessImages(hover?.b ?? null)
  const currentImage = cardImages[Math.min(activeImage, cardImages.length - 1)] ?? null

  const displayBusiness = pinned
  const panelImages = getBusinessImages(displayBusiness)
  const panelImage = panelImages[Math.min(selectedImage, panelImages.length - 1)] ?? null
  const action = displayBusiness ? businessAction(displayBusiness) : null
  const ActionIcon = action?.icon

  let cardStyle: React.CSSProperties = { opacity: 0 }
  if (hover) {
    const [mx, my] = hover.pos
    const [mw, mh] = hover.size
    let left = mx + CARD_GAP
    let top = my - cardHeight / 2
    if (left + CARD_WIDTH > mw) left = mx - CARD_GAP - CARD_WIDTH
    left = Math.max(4, Math.min(left, mw - CARD_WIDTH - 4))
    top = Math.max(4, Math.min(top, mh - cardHeight - 4))
    cardStyle = { left, top, opacity: 1 }
  }

  return (
    <div className="flex flex-col min-h-0 overflow-hidden bg-[#f8faf7] h-[calc(100dvh-4rem)] -mx-6 -mt-6 -mb-24 lg:-mb-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-b border-[#E5E9E7] z-[1000] shrink-0">
        <div className="flex flex-wrap gap-2">
          {MAP_CATEGORY_OPTIONS.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`h-[34px] px-4 rounded-full text-xs font-medium transition-colors ${
                categoryFilter === cat
                  ? 'bg-[#087F3F] text-white'
                  : 'bg-white text-[#17201A] border border-[#E2E8E3] hover:bg-[#EAF6ED]'
              }`}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
        <div className="relative shrink-0">
          <label htmlFor="tourist-map-layer" className="sr-only">Map layer</label>
          <select
            id="tourist-map-layer"
            value={mapType}
            onChange={(event) => setMapType(event.target.value as MapType)}
            className="h-[34px] min-w-[126px] appearance-none rounded-[20px] border border-[#E2E8E3] bg-white px-3 pr-8 text-xs font-medium text-[#17201A] shadow-sm outline-none transition-colors hover:bg-[#EAF6ED] focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/20"
            aria-label="Change map layer"
          >
            <option value="street">Street View</option>
            <option value="satellite">Satellite</option>
          </select>
          <ChevronRight className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-[#087F3F]" />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left Panel */}
        {panelOpen ? (
          <aside className="absolute inset-x-0 bottom-0 z-[600] max-h-[60vh] sm:max-h-full sm:static sm:inset-auto sm:w-[405px] sm:max-w-[90vw] sm:shrink-0 bg-white rounded-t-2xl sm:rounded-none border-t sm:border-t-0 sm:border-r border-[#E5E9E7] shadow-2xl sm:shadow-none flex flex-col overflow-hidden">
            <div className="flex items-center justify-end p-2 shrink-0">
              <button
                type="button"
                onClick={handleClosePanel}
                aria-label="Close panel"
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {displayBusiness ? (
                <>
                  <div className="relative w-full h-48 shrink-0">
                    {displayBusiness.category && (
                      <span className="absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-[#064E2E] text-[11px] font-semibold shadow-sm">
                        {displayBusiness.category.name}
                      </span>
                    )}
                    {panelImage ? (
                      <img src={toAssetUrl(panelImage)} alt={displayBusiness.name ?? ''} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-amber-300 to-yellow-500" />
                    )}
                    {panelImages.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setSelectedImage((selectedImage - 1 + panelImages.length) % panelImages.length)}
                          className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/85 shadow flex items-center justify-center hover:bg-white"
                          aria-label="Previous image"
                        >
                          <ChevronLeft className="w-4 h-4 text-gray-800" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedImage((selectedImage + 1) % panelImages.length)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/85 shadow flex items-center justify-center hover:bg-white"
                          aria-label="Next image"
                        >
                          <ChevronRight className="w-4 h-4 text-gray-800" />
                        </button>
                        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
                          {panelImages.map((_, i) => (
                            <span
                              key={i}
                              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                                i === selectedImage ? 'bg-white' : 'bg-white/50'
                              }`}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="p-4">
                    <h3 className="font-bold text-gray-900 text-lg leading-snug" title={displayBusiness.name ?? ''}>
                      {displayBusiness.name ?? ''}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-semibold text-gray-900">{Number(displayBusiness.reviews_avg_rating ?? 0).toFixed(1)}</span>
                        <span className="inline-flex items-center gap-0.5">
                          {Array.from({ length: 5 }, (_, i) => (
                            <Star
                              key={i}
                              className={`w-3 h-3 ${
                                i < Math.round(displayBusiness.reviews_avg_rating ?? 0) ? 'fill-[#F4B400] text-[#F4B400]' : 'fill-gray-200 text-gray-200'
                              }`}
                            />
                          ))}
                        </span>
                        {displayBusiness.reviews_count != null && <span className="text-gray-500">({displayBusiness.reviews_count})</span>}
                      </span>
                      {displayBusiness.price_range ? <span>&middot; {displayBusiness.price_range}</span> : null}
                    </div>
                    {displayBusiness.category && <p className="mt-1 text-sm text-gray-600">{displayBusiness.category.name}</p>}

                    <div className="mt-3 flex gap-5 border-b border-[#E2E8E3]">
                      {PANEL_TABS.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setPanelTab(t)}
                          className={`py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            panelTab === t
                              ? 'border-[#087F3F] text-[#087F3F]'
                              : 'border-transparent text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    {panelTab === 'Overview' && (
                      <div className="pt-4">
                        <div className="grid grid-cols-4 gap-2">
                          <button
                            type="button"
                            onClick={() => handleDirections(displayBusiness)}
                            className="flex flex-col items-center gap-1.5"
                          >
                            <span className="w-11 h-11 rounded-full bg-[#E6F4F0] text-[#087F3F] flex items-center justify-center hover:bg-[#087F3F] hover:text-white transition-colors">
                              <Navigation className="w-5 h-5" />
                            </span>
                            <span className="text-[11px] text-gray-600">Directions</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSaved((v) => !v)}
                            className="flex flex-col items-center gap-1.5"
                          >
                            <span
                              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                                saved ? 'bg-[#087F3F] text-white' : 'bg-[#E6F4F0] text-[#087F3F] hover:bg-[#087F3F] hover:text-white'
                              }`}
                            >
                              <Bookmark className={`w-5 h-5 ${saved ? 'fill-white' : ''}`} />
                            </span>
                            <span className="text-[11px] text-gray-600">Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShare(displayBusiness)}
                            className="flex flex-col items-center gap-1.5"
                          >
                            <span className="w-11 h-11 rounded-full bg-[#E6F4F0] text-[#087F3F] flex items-center justify-center hover:bg-[#087F3F] hover:text-white transition-colors">
                              <Share2 className="w-5 h-5" />
                            </span>
                            <span className="text-[11px] text-gray-600">Share</span>
                          </button>
                        </div>

                        {Array.isArray(displayBusiness.services) && displayBusiness.services.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {displayBusiness.services.slice(0, 6).map((s) => (
                              <span key={s} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#0c2a17]/5 text-gray-700 text-[11px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#087F3F]" /> {s}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="mt-4 pt-4 border-t border-[#EFF3F0] flex flex-col gap-3">
                          <p className="flex items-start gap-2.5 text-sm text-gray-800">
                            <MapPin className="w-4 h-4 text-[#087F3F] mt-0.5 shrink-0" />
                            {displayBusiness.address || `${typeof displayBusiness.municipality === 'object' ? (displayBusiness.municipality as { name: string }).name : displayBusiness.municipality ?? ''}, Oriental Mindoro`}
                          </p>
                          <p className="flex items-center gap-2.5 text-sm text-gray-800">
                            <Clock className="w-4 h-4 text-[#087F3F] shrink-0" />
                            {displayBusiness.is_open ? (
                              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Open
                              </span>
                            ) : (
                              <span className="text-red-600">Closed</span>
                            )}
                          </p>
                          {displayBusiness.price_range && (
                            <p className="flex items-center gap-2.5 text-sm text-gray-800">
                              <Banknote className="w-4 h-4 text-[#087F3F] shrink-0" /> {displayBusiness.price_range}
                            </p>
                          )}
                        </div>

                        {panelImages.length >= 2 && (
                          <div className="mt-4 pt-4 border-t border-[#EFF3F0]">
                            <p className="text-sm font-semibold text-gray-900 mb-2">Photos</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {panelImages.slice(0, 9).map((src, i) => (
                                <img
                                  key={i}
                                  src={toAssetUrl(src)}
                                  alt=""
                                  onClick={() => setSelectedImage(i)}
                                  className="w-full h-16 object-cover rounded-lg cursor-pointer"
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {action && ActionIcon && (
                          <button
                            type="button"
                            onClick={() => navigate(action.to)}
                            className="mt-5 w-full h-12 rounded-xl bg-[#087F3F] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#056B35] transition-colors"
                          >
                            <ActionIcon className="w-4 h-4" /> {action.label}
                          </button>
                        )}
                      </div>
                    )}

                    {panelTab === 'Menu' && (
                      <div className="pt-4">
                        {Array.isArray(displayBusiness.menu_items) && displayBusiness.menu_items.length > 0 ? (
                          <div className="grid grid-cols-2 gap-3">
                            {displayBusiness.menu_items.map((item) => (
                              <div key={item.id} className="rounded-xl border border-[#E2E8E3] overflow-hidden flex flex-col bg-white shadow-sm">
                                {item.image ? (
                                  <img src={toAssetUrl(item.image)} alt={item.name} className="w-full h-20 object-cover" />
                                ) : (
                                  <div className="w-full h-20 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                                    <UtensilsCrossed className="w-5 h-5 text-emerald-300" />
                                  </div>
                                )}
                                <div className="p-2 flex flex-col gap-1 flex-1">
                                  <div className="flex items-start justify-between gap-1">
                                    <p className="text-sm font-semibold text-gray-900 leading-tight truncate" title={item.name}>
                                      {item.name}
                                    </p>
                                    {item.bestseller ? (
                                      <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-semibold">
                                        Bestseller
                                      </span>
                                    ) : null}
                                  </div>
                                  {item.description ? (
                                    <p className="text-[11px] text-gray-500 leading-tight">{item.description}</p>
                                  ) : null}
                                  <span className="mt-auto pt-1 text-sm font-bold text-[#087F3F]">
                                    &#8369;{Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="pt-10 pb-6 text-center">
                            <UtensilsCrossed className="w-8 h-8 mx-auto text-gray-300" />
                            <p className="mt-3 text-sm text-gray-500">No menu available for this business yet.</p>
                          </div>
                        )}

                        {action && ActionIcon && Array.isArray(displayBusiness.menu_items) && displayBusiness.menu_items.length > 0 && (
                          <button
                            type="button"
                            onClick={() => navigate(action.to)}
                            className="mt-4 w-full h-11 rounded-xl bg-[#087F3F] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#056B35] transition-colors"
                          >
                            <ActionIcon className="w-4 h-4" /> Order Now
                          </button>
                        )}
                      </div>
                    )}

                    {panelTab === 'Reviews' && (
                      <div className="pt-10 pb-6 text-center">
                        <p className="text-3xl font-bold text-gray-900">{Number(displayBusiness.reviews_avg_rating ?? 0).toFixed(1)}</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-sm text-gray-600">
                          {Array.from({ length: 5 }, (_, i) => (
                            <Star
                              key={i}
                              className={`w-4 h-4 ${
                                i < Math.round(displayBusiness.reviews_avg_rating ?? 0) ? 'fill-[#F4B400] text-[#F4B400]' : 'fill-gray-200 text-gray-200'
                              }`}
                            />
                          ))}
                        </p>
                        <p className="mt-1 text-sm text-gray-500">
                          Based on {displayBusiness.reviews_count ?? 0} review{(displayBusiness.reviews_count ?? 0) === 1 ? '' : 's'}
                        </p>
                      </div>
                    )}

                    {panelTab === 'About' && (
                      <div className="pt-10 pb-6 text-center">
                        <Building2 className="w-8 h-8 mx-auto text-gray-300" />
                        <p className="mt-3 text-sm text-gray-500">
                          {displayBusiness.business_description || displayBusiness.description || `More details about this ${displayBusiness.category?.name ?? 'business'} will be available here soon.`}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-10 text-center flex flex-col items-center justify-center">
                  <MapPin className="w-9 h-9 text-[#087F3F]/40" />
                  <p className="text-sm text-gray-600 mt-3">Click a marker on the map to view its details here.</p>
                </div>
              )}
            </div>
          </aside>
        ) : null}

        {/* Route Info Panel */}
        {routeDistanceKm != null && (() => {
          const activeMode = transportModes.find((m) => m.key === selectedVehicle) ?? transportModes[0]
          const travelTime = calcTravelTime(routeDistanceKm, activeMode.speed)
          const fare = calcFare(routeDistanceKm, activeMode)
          const fareLabel = activeMode.baseFare === 0
            ? 'Free'
            : activeMode.includedKm > 0
              ? `${activeMode.label} fare: \u20B1${activeMode.baseFare} first ${activeMode.includedKm}km + \u20B1${activeMode.perKm}/km after`
              : `${activeMode.label} fare: \u20B1${activeMode.baseFare} base + \u20B1${activeMode.perKm}/km`

          return (
            <aside className="w-[260px] shrink-0 bg-white border-t sm:border-t-0 sm:border-r border-[#E5E9E7] flex flex-col overflow-y-auto">
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#087F3F] shrink-0" />
                      <p className="text-xs font-semibold text-[#17201B] truncate">Your location</p>
                    </div>
                    {routeDestination && (
                      <>
                        <div className="ml-[3px] w-px h-2 bg-gray-300" />
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                          <p className="text-xs text-gray-500 leading-tight truncate" title={`${routeDestination.name}, ${routeDestination.address}`}>
                            {routeDestination.name} — {routeDestination.address}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={clearRoute}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex gap-1.5">
                  {transportModes.map((mode) => {
                    const Icon = mode.icon
                    const isActive = mode.key === selectedVehicle
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => setSelectedVehicle(mode.key)}
                        className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-[10px] font-medium transition-all ${
                          isActive
                            ? 'bg-[#087F3F] text-white shadow-sm'
                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="leading-tight">{calcTravelTime(routeDistanceKm, mode.speed)}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="h-px bg-[#E5E9E7]" />

                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4 text-[#087F3F]" />
                  </span>
                  <div>
                    <p className="text-lg font-bold text-[#17201B] leading-tight">{travelTime}</p>
                    <p className="text-[11px] text-gray-500">Est. travel time by {activeMode.label}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-[#087F3F]" />
                  </span>
                  <div>
                    <p className="text-lg font-bold text-[#17201B] leading-tight">{routeDistanceKm.toFixed(2)} km</p>
                    <p className="text-[11px] text-gray-500">Total distance</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                    <Banknote className="w-4 h-4 text-[#087F3F]" />
                  </span>
                  <div>
                    <p className="text-lg font-bold text-[#087F3F] leading-tight">
                      {activeMode.baseFare === 0 ? 'Free' : <>{'\u20B1'}{fare.toLocaleString()}</>}
                    </p>
                    <p className="text-[11px] text-gray-500">{fareLabel}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (routeDestination && routeDistanceKm != null) {
                      localStorage.setItem('tracktour_pending_booking', JSON.stringify({
                        destination: routeDestination,
                        distanceKm: routeDistanceKm,
                        vehicle: selectedVehicle,
                      }))
                    }
                    navigate('/tourist/transport')
                  }}
                  className="mt-1 w-full py-2.5 rounded-xl bg-[#087F3F] text-white text-xs font-semibold hover:bg-[#056B35] transition-colors flex items-center justify-center gap-2"
                >
                  <Bike className="w-4 h-4" />
                  Book a Rider
                </button>

                <button
                  type="button"
                  onClick={clearRoute}
                  className="w-full py-2 rounded-xl bg-[#E9F7EF] text-[#087F3F] text-xs font-semibold hover:bg-[#DDF4E6] transition-colors"
                >
                  Close Route
                </button>
              </div>
            </aside>
          )
        })()}

        {/* Map */}
        <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden bg-[#f8faf7]">
          <MapContainer
            center={[12.8667, 121.45]}
            zoom={12}
            minZoom={2}
            className="w-full h-full"
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer
              key={activeMapType}
              url={MAP_LAYERS[activeMapType].url}
              attribution={MAP_LAYERS[activeMapType].attribution}
            />
            <MapEventsHandler onMapClick={handleClosePanel} />

            {filteredBusinesses.map((biz) => {
              if (biz.latitude == null || biz.longitude == null) return null
              return (
                <Marker
                  key={biz.id}
                  position={[biz.latitude, biz.longitude]}
                  icon={biz.category?.id === 7 ? beachPinIcon : pinIcon(biz.name, biz.id === pinned?.id)}
                  eventHandlers={{
                    click: () => handleBusinessSelect(biz),
                    mouseover: (e) => {
                      if (hideTimerRef.current) {
                        window.clearTimeout(hideTimerRef.current)
                        hideTimerRef.current = null
                      }
                      const map = e.target._map
                      if (map) {
                        const pt = map.latLngToContainerPoint([biz.latitude!, biz.longitude!])
                        const container = map.getContainer()
                        setHover({ b: biz, pos: [pt.x, pt.y], size: [container.clientWidth, container.clientHeight] })
                      }
                    },
                    mouseout: () => {
                      if (hideTimerRef.current) {
                        window.clearTimeout(hideTimerRef.current)
                        hideTimerRef.current = null
                      }
                      hideTimerRef.current = window.setTimeout(() => {
                        if (!overCardRef.current) setHover(null)
                      }, 400)
                    },
                  }}
                />
              )
            })}
            <AutoLocate />
            <FocusMapOnLocation location={focusLocation} />
            {route && pinned && pinned.latitude != null && pinned.longitude != null && (
              <>
                <RouteOverlay
                  route={{ coords: route, origin: userLocation ?? { lat: 12.8667, lng: 121.45 } }}
                  destination={{ lat: pinned.latitude, lng: pinned.longitude }}
                />
              </>
            )}
          </MapContainer>

          {/* Hover Card */}
          <div
            ref={cardRef}
            style={cardStyle}
            onMouseEnter={() => {
              overCardRef.current = true
              if (hideTimerRef.current) {
                window.clearTimeout(hideTimerRef.current)
                hideTimerRef.current = null
              }
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseLeave={() => {
              overCardRef.current = false
              if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
              hideTimerRef.current = window.setTimeout(() => {
                if (!overCardRef.current) setHover(null)
                hideTimerRef.current = null
              }, 250)
            }}
            className={`absolute z-[500] w-64 transition-opacity duration-300 ease-out ${
              hover ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <div className="relative bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.35)] ring-1 ring-[#E5E9E7] h-[240px] overflow-hidden flex flex-col">
              <div className="relative w-full h-[60%] shrink-0 group">
                {hover?.b.category && (
                  <span className="absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-[#064E2E] text-[11px] font-semibold shadow-sm">
                    {hover.b.category.name}
                  </span>
                )}
                {currentImage ? (
                  <img src={toAssetUrl(currentImage)} alt={hover?.b.name ?? ''} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-amber-300 to-yellow-500" />
                )}
                {hover && cardImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        setActiveImage((current) => (current - 1 + cardImages.length) % cardImages.length)
                      }}
                      className="absolute left-1.5 top-1/2 z-20 -translate-y-1/2 pointer-events-auto w-6 h-6 rounded-full bg-white/85 shadow flex items-center justify-center hover:bg-white"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-800" />
                    </button>
                    <button
                      type="button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        setActiveImage((current) => (current + 1) % cardImages.length)
                      }}
                      className="absolute right-1.5 top-1/2 z-20 -translate-y-1/2 pointer-events-auto w-6 h-6 rounded-full bg-white/85 shadow flex items-center justify-center hover:bg-white"
                      aria-label="Next image"
                    >
                      <ChevronRight className="w-4 h-4 text-gray-800" />
                    </button>
                  </>
                )}
                {cardImages.length > 1 && (
                  <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
                    {cardImages.map((_, i) => (
                      <span
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${
                          i === activeImage ? 'bg-white' : 'bg-white/50'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 flex flex-col p-4 min-h-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug truncate" title={hover?.b.name ?? ''}>
                      {hover?.b.name ?? 'Business name'}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                      <Star className="w-3.5 h-3.5 fill-[#F4B400] text-[#F4B400]" />
                      <span className="font-semibold text-gray-900">{Number(hover?.b.reviews_avg_rating ?? 0).toFixed(1)}</span>
                      {hover?.b.reviews_count ? <span className="text-gray-500">({hover.b.reviews_count})</span> : null}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    {hover && (
                      <button
                        type="button"
                        onClick={() => handleDirections(hover.b)}
                        className="w-10 h-10 rounded-full bg-[#087F3F]/40 text-white flex items-center justify-center pointer-events-auto shadow hover:bg-[#087F3F]/50 transition-colors"
                        aria-label="Get directions"
                      >
                        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="4" width="16" height="16" rx="3.5" transform="rotate(45 12 12)" fill="#087F3F" stroke="none" />
                          <path d="M10.2 14.5v-4.3" />
                          <path d="M10.2 10.2h4.3" />
                          <path d="M14.5 8.6l2 1.6-2 1.6" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSaved((v) => !v)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center pointer-events-auto shadow transition-colors ${
                        saved ? 'bg-[#087F3F]/70 text-[#064E2E]' : 'bg-[#087F3F]/40 text-[#064E2E] hover:bg-[#087F3F]/50'
                      }`}
                      aria-label="Save business"
                    >
                      <Bookmark className="w-4 h-4" strokeWidth={2.75} />
                    </button>
                  </div>
                </div>
                <p className="mt-auto pt-2 flex items-center gap-1.5 text-xs text-gray-600">
                  <MapPin className="w-3.5 h-3.5 text-[#087F3F]" /> {typeof hover?.b.municipality === 'object' ? (hover?.b.municipality as { name: string })?.name : hover?.b.municipality ?? 'Oriental Mindoro'}
                </p>
              </div>
            </div>
          </div>

          {/* Business Count Badge */}
          <div className="absolute bottom-6 left-4 z-[400] pointer-events-none">
            <div className="px-4 py-2 bg-white/90 backdrop-blur-xl border border-[#E5E9E7] rounded-xl shadow-lg">
              <p className="text-sm text-[#6B7280]">
                <span className="font-semibold text-[#087F3F]">{filteredBusinesses.length}</span> businesses on map
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 bg-white/90 backdrop-blur-xl border border-[#E5E9E7] rounded-xl shadow-lg pointer-events-none">
          <p className="text-sm text-[#6B7280]">Loading businesses...</p>
        </div>
      )}
    </div>
  )
}
