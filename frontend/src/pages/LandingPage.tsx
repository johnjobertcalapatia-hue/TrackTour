import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { get } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import { pinIcon, userPinIcon } from '@/shared/utils/pin-icon'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import {
  ArrowRight,
  MapPin,
  Star,
  Compass,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  X,
  Navigation,
  Share2,
  Clock,
  Banknote,
  UtensilsCrossed,
  Hotel,
  Building2,
  Motorbike,
  Van,
  Bus,
  Bike,
  Footprints,
  MapPinned,
  LayoutGrid,
  Search,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react'

interface MapBusiness {
  id: number
  name: string
  latitude: number
  longitude: number
  cover_photo?: string | null
  images?: (string | null)[]
  category?: string | null
  municipality?: string | null
  price_range?: string | null
  average_rating?: number
  review_count?: number
  popularity_score?: number
  is_open?: boolean
  is_accepting_orders?: boolean
  availability_status?: string | null
  module_codes?: string[]
  services?: string[] | null
  facilities?: string[] | null
  created_at?: string | null
  menu_items?: MapMenuItem[]
}

interface MapMenuItem {
  id: number
  name: string
  description?: string | null
  price: number
  image?: string | null
  bestseller?: boolean
  category?: string | null
}

const MIN_MARKER_ZOOM = 11
const MIN_LABEL_ZOOM = 11

const MAP_TILES: Record<'streets' | 'satellite', { url: string; attribution: string }> = {
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
}

function MapResizer() {
  const map = useMap()
  useEffect(() => {
    const refresh = () => map.invalidateSize()
    refresh()
    const timer = window.setTimeout(refresh, 250)
    const observer = new ResizeObserver(refresh)
    observer.observe(map.getContainer())
    window.addEventListener('resize', refresh)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      window.removeEventListener('resize', refresh)
    }
  }, [map])
  return null
}

const DEFAULT_MAP_CENTER: [number, number] = [12.8667, 121.45]
let landingUserFocusDone = false

function UserLocation({ userPos }: { userPos: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (!userPos || landingUserFocusDone) return
    landingUserFocusDone = true
    const t = window.setTimeout(() => {
      const c = map.getCenter()
      const moved =
        Math.abs(c.lat - DEFAULT_MAP_CENTER[0]) > 0.02 || Math.abs(c.lng - DEFAULT_MAP_CENTER[1]) > 0.02
      if (!moved) map.flyTo(userPos, 12, { duration: 0.9 })
    }, 150)
    return () => window.clearTimeout(t)
  }, [map, userPos])
  if (!userPos) return null
  return <Marker position={userPos} icon={userPinIcon} />
}

function FitRoute({ route }: { route: [number, number][] | null }) {
  const map = useMap()
  useEffect(() => {
    if (route && route.length > 1) {
      map.fitBounds(L.latLngBounds(route), { padding: [50, 50] })
    }
  }, [map, route])
  return null
}

function MapMarkers({
  businesses,
  onHover,
  onSelect,
  selectedId,
}: {
  businesses: MapBusiness[]
  onHover: (b: MapBusiness | null, pos?: [number, number], size?: [number, number]) => void
  onSelect: (b: MapBusiness) => void
  selectedId?: number | null
}) {
  const map = useMap()
  const markersRef = useRef(new Map<number, L.Marker>())
  const zoomRef = useRef(map.getZoom())
  const onHoverRef = useRef(onHover)
  onHoverRef.current = onHover
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const showPins = zoomRef.current >= MIN_MARKER_ZOOM
    const showLabels = zoomRef.current >= MIN_LABEL_ZOOM
    const wanted = new Set(businesses.map((b) => b.id))
    for (const [id, marker] of markersRef.current) {
      if (!wanted.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }
    if (showPins) {
      for (const b of businesses) {
        const bid = b.id
        let marker = markersRef.current.get(bid)
        if (!marker) {
          marker = L.marker([b.latitude, b.longitude], {
            icon: pinIcon(showLabels ? b.name : '', b.id === selectedId),
            interactive: true,
          }).addTo(map)
          marker.setZIndexOffset(b.id === selectedId ? 1000 : 0)
          marker.getElement()?.addEventListener('mouseenter', () => {
            const pt = map.latLngToContainerPoint([b.latitude, b.longitude])
            const container = map.getContainer()
            onHoverRef.current(b, [pt.x, pt.y], [container.clientWidth, container.clientHeight])
          })
          marker.getElement()?.addEventListener('mouseleave', () => onHoverRef.current(null))
          marker.getElement()?.addEventListener('click', () => onSelectRef.current(b))
          markersRef.current.set(bid, marker)
        } else {
          const b2 = businesses.find((x) => x.id === bid)
          marker.setIcon(pinIcon(showLabels && b2 ? b2.name : '', b.id === selectedId))
          marker.setZIndexOffset(b.id === selectedId ? 1000 : 0)
        }
      }
    }
  }, [map, businesses, selectedId])

  useEffect(() => {
    if (selectedId == null) return
    const b = businesses.find((x) => x.id === selectedId)
    if (b) map.panTo([b.latitude, b.longitude], { animate: true, duration: 0.6 })
  }, [map, selectedId, businesses])

  useMapEvents({
    zoomstart() {
      onHoverRef.current(null)
    },
    movestart() {
      onHoverRef.current(null)
    },
    move() {
      const container = map.getContainer()
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return
      const halfX = width / 2
      const halfY = height / 2
      for (const [, marker] of markersRef.current) {
        const el = marker.getElement()
        if (!el) continue
        const pt = map.latLngToContainerPoint(marker.getLatLng())
        const dx = Math.max(-1, Math.min(1, (pt.x - halfX) / halfX))
        const dy = Math.max(-1, Math.min(1, (pt.y - halfY) / halfY))
        const sx = Math.round(dx * 3)
        const sy = Math.round(4 + Math.max(0, dy) * 2)
        el.style.setProperty('--sx', `${sx}px`)
        el.style.setProperty('--sy', `${sy}px`)
        el.style.setProperty('--ty', `${14 - sy}px`)
        el.style.setProperty('--tx', sx > 0 ? 'calc(-100% - 18px)' : '18px')
      }
    },
    zoomend() {
      zoomRef.current = map.getZoom()
      const showPins = zoomRef.current >= MIN_MARKER_ZOOM
      const showLabels = zoomRef.current >= MIN_LABEL_ZOOM
      for (const [id, marker] of markersRef.current) {
        const el = marker.getElement()
        if (!el) continue
        if (!showPins) {
          el.style.display = 'none'
          continue
        }
        el.style.display = ''
        const b = businesses.find((x) => x.id === id)
        marker.setIcon(pinIcon(showLabels && b ? b.name : '', id === selectedId))
        marker.setZIndexOffset(id === selectedId ? 1000 : 0)
      }
    },
  })
  return null
}

function LandingMap({
  mapType,
  businesses,
  route,
  userPos,
  onHover,
  onSelect,
  selectedId,
}: {
  mapType: 'streets' | 'satellite'
  businesses: MapBusiness[]
  route: [number, number][] | null
  userPos: [number, number] | null
  onHover: (b: MapBusiness | null, pos?: [number, number], size?: [number, number]) => void
  onSelect: (b: MapBusiness) => void
  selectedId?: number | null
}) {
  return (
    <MapContainer
      center={DEFAULT_MAP_CENTER}
      zoom={11}
      minZoom={7}
      className="w-full h-full z-0"
      zoomControl={false}
      attributionControl={false}
      wheelPxPerZoomLevel={250}
    >
      <TileLayer
        key={mapType}
        url={MAP_TILES[mapType].url}
        attribution={MAP_TILES[mapType].attribution}
      />
      <MapResizer />
      <UserLocation userPos={userPos} />
      <FitRoute route={route} />
      {businesses.length > 0 && <MapMarkers businesses={businesses} onHover={onHover} onSelect={onSelect} selectedId={selectedId} />}
      {route && route.length > 1 && (
        <>
          <Polyline positions={route} pathOptions={{ color: '#FFD60A', weight: 8, opacity: 0.4 }} />
          <Polyline positions={route} pathOptions={{ color: '#FFD60A', weight: 4, opacity: 0.95 }} />
        </>
      )}
    </MapContainer>
  )
}

const DEFAULT_CATEGORIES: LandingCategory[] = [
  { label: 'Tourist Spots', color: '#087F3F', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=60', tab: 'places' },
  { label: 'Food', color: '#D97706', image: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=600&q=60', tab: 'food' },
  { label: 'Businesses', color: '#2563EB', image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&q=60', tab: 'businesses' },
  { label: 'Resorts', color: '#7C3AED', image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=60', tab: 'stays' },
]

const MAP_CATEGORY_GROUPS: Record<string, string[]> = {
  'Tourist Spots': ['Tourist Attraction'],
  Restaurants: ['Restaurant', 'Café', 'Food Hub'],
  Resorts: ['Resort', 'Hotel', 'Hotel & Restaurant Combination'],
}

const MAP_CATEGORY_OPTIONS = ['all', 'Tourist Spots', 'Restaurants', 'Resorts']

const PANEL_TABS = ['Overview', 'Menu', 'Reviews', 'About'] as const
type PanelTab = (typeof PANEL_TABS)[number]

function businessAction(b: MapBusiness): { label: string; to: string; icon: LucideIcon } {
  const hay = `${b.category ?? ''} ${(b.module_codes ?? []).join(' ')}`.toLowerCase()
  if (hay.includes('restaurant') || hay.includes('caf') || hay.includes('food')) {
    return { label: 'Order Food', to: '/tourist/food', icon: UtensilsCrossed }
  }
  if (hay.includes('resort') || hay.includes('hotel') || hay.includes('stay') || hay.includes('inn')) {
    return { label: 'Book / Reserve', to: '/tourist/stays', icon: Hotel }
  }
  if (
    hay.includes('attraction') ||
    hay.includes('tourist spot') ||
    hay.includes('explore') ||
    hay.includes('beach') ||
    hay.includes('fall') ||
    hay.includes('destination')
  ) {
    return { label: 'Explore Place', to: '/tourist/explore', icon: Compass }
  }
  return { label: 'View Business', to: '/tourist/directory', icon: Building2 }
}

function visitBusinessRoute(b: MapBusiness): string {
  const hay = `${b.category ?? ''} ${(b.module_codes ?? []).join(' ')}`.toLowerCase()
  if (hay.includes('restaurant') || hay.includes('caf') || hay.includes('food')) return `/explore/food/${b.id}`
  return `/tourist/explore/${b.id}`
}

interface MunicipalityLite {
  id: number
  name: string
  barangays?: { id: number; municipality_id: number; name: string }[]
  destinations_count?: number
  businesses_count?: number
}

interface LandingCategory {
  label: string
  color: string
  image: string
  tab: string
}

/**
 * One row of the landing card grid, served live from the database by
 * GET /api/landing/cards. `types` lists the filter tabs it belongs to.
 */
interface LandingCard {
  key: string
  types: string[]
  title: string
  location: string | null
  category: string
  rating: number | null
  image: string | null
}

interface LandingContent {
  hero_badge: string
  hero_title: string
  hero_title_highlight: string
  hero_subtitle: string
  hero_video: string
  categories: LandingCategory[]
}

const DISTRICT_2_MUNICIPALITIES = ['Bansud', 'Bongabong', 'Bulalacao', 'Gloria', 'Mansalay', 'Pinamalayan', 'Roxas']

const TABS = ['All', 'Tourist Spots', 'Food', 'Businesses', 'Resorts']

/** Filter-tab label → card `types` membership (null = every card). */
const TAB_TYPE: Record<string, string | null> = {
  All: null,
  'Tourist Spots': 'spot',
  Food: 'food',
  Businesses: 'business',
  Resorts: 'resort',
}

const PLACEHOLDER_COLORS = [
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-blue-500 to-indigo-600',
  'from-orange-500 to-red-600',
  'from-pink-500 to-rose-600',
  'from-amber-500 to-yellow-600',
]

const CARD_WIDTH = 256
const CARD_GAP = 10

interface HoverState {
  b: MapBusiness
  pos: [number, number]
  size: [number, number]
}

export default function LandingPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [mapType, setMapType] = useState<'streets' | 'satellite'>('streets')
  const [showMap, setShowMap] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [hover, setHover] = useState<HoverState | null>(null)
  const [saved, setSaved] = useState(false)
  const overCardRef = useRef(false)
  const hideTimerRef = useRef<number | null>(null)
  const scrollRestoreRef = useRef<number | null>(null)

  const handleToggleMap = (next?: boolean) => {
    scrollRestoreRef.current = window.scrollY
    setShowMap(next ?? ((v: boolean) => !v))
    setHover(null)
  }

  useEffect(() => {
    if (scrollRestoreRef.current == null) return
    const target = scrollRestoreRef.current
    scrollRestoreRef.current = null
    requestAnimationFrame(() => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      window.scrollTo(0, Math.min(target, maxScroll))
    })
  }, [showMap])

  useEffect(() => {
    if (sessionStorage.getItem('tracktour_scroll_to_content') !== '1') return
    sessionStorage.removeItem('tracktour_scroll_to_content')
    const scrollToContent = () => {
      document.getElementById('landing-content')?.scrollIntoView({ block: 'start' })
    }
    requestAnimationFrame(scrollToContent)
    const t = window.setTimeout(scrollToContent, 120)
    return () => window.clearTimeout(t)
  }, [])
  const [activeImage, setActiveImage] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(0)
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

function calcFare(distanceKm: number, mode: typeof transportModes[number]): number {
  if (mode.baseFare === 0) return 0
  return Math.round(mode.baseFare + Math.max(0, distanceKm - mode.includedKm) * mode.perKm)
}

  const [userPos, setUserPos] = useState<[number, number] | null>(null)
  const [route, setRoute] = useState<[number, number][] | null>(null)
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null)
  const [routeDestination, setRouteDestination] = useState<{ name: string; address: string } | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<TransportKey>('motorcycle')
  const [panelOpen, setPanelOpen] = useState(false)
  const [pinned, setPinned] = useState<MapBusiness | null>(null)
  const [selectedImage, setSelectedImage] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const [panelTab, setPanelTab] = useState<PanelTab>('Overview')

  const locateUser = (cb?: (pos: [number, number] | null) => void) => {
    if (!navigator.geolocation) {
      cb?.(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll: [number, number] = [p.coords.latitude, p.coords.longitude]
        setUserPos(ll)
        cb?.(ll)
      },
      () => cb?.(null)
    )
  }

  useEffect(() => {
    const id = window.setTimeout(() => locateUser(), 100)
    return () => window.clearTimeout(id)
  }, [])

  const handleDirections = (b: MapBusiness) => {
    const doRoute = (from: [number, number]) => {
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
            setRouteDestination({
              name: b.name ?? 'Business',
              address: b.municipality ? `${b.municipality}, Oriental Mindoro` : 'Bansud, Oriental Mindoro',
            })
          }
        })
        .catch(() => {})
    }
    if (userPos) doRoute(userPos)
    else locateUser((ll) => ll && doRoute(ll))
  }

  const clearRoute = () => {
    setRoute(null)
    setRouteDistanceKm(null)
    setRouteDestination(null)
  }

  const handleShare = (b: MapBusiness) => {
    const url = `${window.location.origin}/tourist/directory`
    const title = `TrackTour — ${b.name ?? 'Business'}`
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(url).catch(() => {})
    }
  }

  const handleSelectBusiness = (b: MapBusiness) => {
    setPinned(b)
    setPanelOpen(true)
    setSelectedImage(0)
    setSelectedId(b.id)
  }

  const { data: businesses = [] } = useQuery({
    queryKey: ['landing-map-businesses'],
    queryFn: () => get<MapBusiness[]>('/map/businesses'),
  })

  const { data: municipalitiesData } = useQuery({
    queryKey: ['landing-municipalities'],
    queryFn: () => get<MunicipalityLite[]>('/municipalities'),
  })

  const municipalities = (municipalitiesData ?? []).filter((m) =>
    DISTRICT_2_MUNICIPALITIES.includes(m.name)
  )

  const { data: landingContent } = useQuery({
    queryKey: ['landing-content'],
    queryFn: () => get<LandingContent>('/landing-content'),
    staleTime: 5 * 60 * 1000,
  })

  // Card grid is served straight from the database (destinations +
  // businesses), so refetch it on an interval instead of caching the old
  // hardcoded spot list for the whole session.
  const { data: cards = [], isPending: cardsPending } = useQuery({
    queryKey: ['landing-cards'],
    queryFn: () => get<LandingCard[]>('/landing/cards'),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  })

  const heroVideoSrc = (() => {
    const v = landingContent?.hero_video || '/assets/tracktour-web.mp4'
    return v.startsWith('/storage/') ? toAssetUrl(v) : v
  })()

  const categories = landingContent?.categories?.length ? landingContent.categories : DEFAULT_CATEGORIES
  const filteredSpots = cards.filter((card) => {
    const tabType = TAB_TYPE[activeTab] ?? null
    if (tabType && !card.types.includes(tabType)) return false

    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      card.title.toLowerCase().includes(q) ||
      (card.location ?? '').toLowerCase().includes(q) ||
      card.category.toLowerCase().includes(q)
    )
  })

  useEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [hover])

  useEffect(() => {
    setActiveImage(0)
  }, [hover])

  useEffect(() => {
    setSaved(false)
  }, [hover])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  const cardImages = hover
    ? [hover.b.cover_photo, ...(hover.b.images ?? [])].filter((src): src is string => Boolean(src))
    : []
  const currentImage = cardImages[Math.min(activeImage, cardImages.length - 1)] ?? null

  const displayBusiness = pinned
  const panelImages = displayBusiness
    ? [displayBusiness.cover_photo, ...(displayBusiness.images ?? [])].filter((src): src is string => Boolean(src))
    : []
  const panelImage = panelImages[Math.min(selectedImage, panelImages.length - 1)] ?? null
  const action = displayBusiness ? businessAction(displayBusiness) : null
  const ActionIcon = action?.icon

  useEffect(() => {
    setSelectedImage(0)
    setPanelTab('Overview')
  }, [displayBusiness?.id])

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

  const filteredBusinesses = businesses.filter((b) => {
    const catOk = categoryFilter === 'all' || (MAP_CATEGORY_GROUPS[categoryFilter] ?? []).includes(b.category ?? '')
    return catOk
  })

  return (
    <div className="min-h-screen tourism-bg tourism-bg-orbs text-[#17201A]">
      <nav className="flex items-center justify-between px-6 py-2 w-full tourism-nav">
        <Link to="/" className="flex items-center gap-3">
          <ApplicationLogo className="w-12 h-12" />
          <span className="text-xl font-bold text-[#16803C]">TrackTour</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-[#16803C] hover:text-[#126B32] transition-colors">
            Sign In
          </Link>
          <Link to="/role-selection" className="btn-tourism px-4 py-1.5 text-sm font-medium">
            Get Started
          </Link>
        </div>
      </nav>

      <section className="relative min-h-screen flex items-center overflow-hidden">
        <video
          autoPlay
          muted
          loop
          playsInline
          poster="/assets/placeholder.svg"
          className="absolute inset-0 w-full h-full object-cover blur-[2px] scale-105"
        >
          <source src={heroVideoSrc} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c2a17]/75 via-[#0c2a17]/45 to-[#17201A]" />
        <div className="max-w-7xl mx-auto px-6 py-28 sm:py-36 relative w-full">
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex items-center justify-center gap-2 text-emerald-300 text-sm font-medium mb-6">
              <MapPin className="w-4 h-4" />
              {landingContent?.hero_badge || 'Bansud, Oriental Mindoro'}
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold leading-tight text-white">
              {landingContent?.hero_title || 'Discover the Beauty of'}{' '}
              <span className="text-emerald-300">{landingContent?.hero_title_highlight || 'Oriental Mindoro'}</span>
            </h1>
            <p className="mt-6 text-lg text-gray-200 max-w-xl mx-auto">
              {landingContent?.hero_subtitle || 'Book hotels, reserve activities, order food, and request transportation — all from one platform.'}
            </p>
            <div className="grid grid-cols-2 gap-4 mt-10 max-w-md mx-auto">
              <Link
                to="/role-selection"
                className="btn-tourism flex items-center justify-center gap-2 px-8 py-4 font-semibold"
              >
                Start Exploring <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 px-8 py-4 border border-white/20 bg-white/10 backdrop-blur-sm rounded-xl hover:bg-white/20 text-white font-semibold transition-all"
              >
                I Have an Account
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Map */}
      <section className="py-14">
        {showMap && (
        <div className="ml-[10px] mr-[10px] mb-[10px] flex flex-wrap items-center justify-between gap-[10px]">
          <div className="flex flex-wrap gap-[10px]">
            {MAP_CATEGORY_OPTIONS.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`h-[38px] px-[18px] rounded-[20px] text-sm font-medium transition-colors ${
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
            <button
              type="button"
              onClick={() => handleToggleMap()}
              className={`flex items-center gap-2 h-[38px] px-4 rounded-[20px] text-sm font-medium border transition-colors ${
                showMap
                  ? 'bg-white text-[#17201A] border-[#E2E8E3] hover:bg-[#EAF6ED]'
                  : 'border-[#087F3F]/50 text-[#087F3F] bg-[#EAF6ED]'
              }`}
              aria-label="Toggle content and map"
              title="Toggle content and map"
            >
              {showMap ? <LayoutGrid className="w-4 h-4" /> : <MapPinned className="w-4 h-4" />}
              {showMap ? 'Content' : 'Map'}
            </button>
          </div>
        </div>
        )}
        {showMap ? (
        <div className="relative h-[75vh] w-[calc(100%-20px)] ml-[10px] mr-[10px] mt-[10px] mb-[10px] rounded-2xl overflow-hidden border border-[#E5E9E7] shadow-md flex">
          {panelOpen ? (
            <aside className="absolute inset-x-0 bottom-0 z-[600] max-h-[70vh] sm:max-h-full sm:static sm:inset-auto sm:w-[405px] sm:max-w-[90vw] sm:shrink-0 bg-white rounded-t-2xl sm:rounded-none border-t sm:border-t-0 sm:border-r border-[#E5E9E7] shadow-2xl sm:shadow-none flex flex-col overflow-hidden">
              <div className="flex items-center justify-end p-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
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
                          {displayBusiness.category}
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
                          <span className="font-semibold text-gray-900">{Number(displayBusiness.average_rating ?? 0).toFixed(1)}</span>
                          <span className="inline-flex items-center gap-0.5">
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star
                                key={i}
                                className={`w-3 h-3 ${
                                  i < Math.round(displayBusiness.average_rating ?? 0) ? 'fill-[#F4B400] text-[#F4B400]' : 'fill-gray-200 text-gray-200'
                                }`}
                              />
                            ))}
                          </span>
                          {displayBusiness.review_count != null && <span className="text-gray-500">({displayBusiness.review_count})</span>}
                        </span>
                        {displayBusiness.price_range ? <span>&middot; {displayBusiness.price_range}</span> : null}
                      </div>
                      {displayBusiness.category && <p className="mt-1 text-sm text-gray-600">{displayBusiness.category}</p>}

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
                              {displayBusiness.municipality ?? 'Bansud, Oriental Mindoro'}
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
                              <p className="text-sm font-semibold text-gray-900 mb-2">Photos &amp; Videos</p>
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
                            <>
                              <button
                                type="button"
                                onClick={() => navigate(visitBusinessRoute(displayBusiness))}
                                className="mt-5 w-full h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors border border-[#087F3F] bg-white text-[#087F3F] hover:bg-[#087F3F]/5"
                              >
                                <ExternalLink className="w-4 h-4" /> Visit {displayBusiness.category ?? 'Business'}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(action.to)}
                                className="mt-3 w-full h-12 rounded-xl bg-[#087F3F] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#056B35] transition-colors"
                              >
                                <ActionIcon className="w-4 h-4" /> {action.label}
                              </button>
                            </>
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
                          <p className="text-3xl font-bold text-gray-900">{Number(displayBusiness.average_rating ?? 0).toFixed(1)}</p>
                          <p className="mt-1 inline-flex items-center gap-1 text-sm text-gray-600">
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star
                                key={i}
                                className={`w-4 h-4 ${
                                  i < Math.round(displayBusiness.average_rating ?? 0) ? 'fill-[#F4B400] text-[#F4B400]' : 'fill-gray-200 text-gray-200'
                                }`}
                              />
                            ))}
                          </p>
                          <p className="mt-1 text-sm text-gray-500">
                            Based on {displayBusiness.review_count ?? 0} review{(displayBusiness.review_count ?? 0) === 1 ? '' : 's'}
                          </p>
                        </div>
                      )}

                      {panelTab === 'About' && (
                        <div className="pt-10 pb-6 text-center">
                          <Building2 className="w-8 h-8 mx-auto text-gray-300" />
                          <p className="mt-3 text-sm text-gray-500">More details about this {displayBusiness.category ?? 'business'} will be available here soon.</p>
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

                  {/* Transport Tabs */}
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

                  {/* Travel Time */}
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                      <Clock className="w-4 h-4 text-[#087F3F]" />
                    </span>
                    <div>
                      <p className="text-lg font-bold text-[#17201B] leading-tight">{travelTime}</p>
                      <p className="text-[11px] text-gray-500">Est. travel time by {activeMode.label}</p>
                    </div>
                  </div>

                  {/* Distance */}
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4 text-[#087F3F]" />
                    </span>
                    <div>
                      <p className="text-lg font-bold text-[#17201B] leading-tight">{routeDistanceKm.toFixed(2)} km</p>
                      <p className="text-[11px] text-gray-500">Total distance</p>
                    </div>
                  </div>

                  {/* Fare */}
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
                      navigate('/login', { state: { from: '/tourist/transport' } })
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

          <div className="relative flex-1 min-w-0">
          {showMap ? (
          <LandingMap
            mapType={mapType}
            businesses={filteredBusinesses}
            route={route}
            userPos={userPos}
            selectedId={selectedId}
            onSelect={handleSelectBusiness}
            onHover={(b, pos, size) => {
              const next = b && pos && size ? { b, pos, size } : null
              if (hideTimerRef.current) {
                window.clearTimeout(hideTimerRef.current)
                hideTimerRef.current = null
              }
              if (next) {
                overCardRef.current = false
                setHover(next)
              } else {
                hideTimerRef.current = window.setTimeout(() => {
                  if (!overCardRef.current) setHover(null)
                }, 150)
              }
            }}
          />
          ) : (
            <div className="absolute inset-0 bg-[#F4F7F3] overflow-y-auto">
              {filteredBusinesses.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-10 text-center">
                  <MapPinned className="w-12 h-12 text-[#087F3F]/30 mb-3" />
                  <p className="text-[#17201A] text-sm font-medium">No businesses found in this category.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                  {filteredBusinesses.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleSelectBusiness(b)}
                      className="bg-white rounded-xl border border-[#E2E8E3] overflow-hidden hover:shadow-md hover:border-[#087F3F]/40 transition-all text-left"
                    >
                      <div className="h-28 w-full bg-gradient-to-br from-amber-300 to-yellow-500">
                        {b.images && b.images.length > 0 ? (
                          <img src={toAssetUrl(b.images[0])} alt={b.name ?? ''} className="w-full h-full object-cover" loading="lazy" />
                        ) : null}
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-semibold text-[#17201A] truncate" title={b.name ?? ''}>
                          {b.name ?? 'Business'}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                          <Star className="w-3.5 h-3.5 fill-[#F4B400] text-[#F4B400]" />
                          <span className="font-semibold text-gray-900">{Number(b.average_rating ?? 0).toFixed(1)}</span>
                          {b.review_count ? <span className="text-gray-500">({b.review_count})</span> : null}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-[#68736D]">
                          <MapPin className="w-3 h-3 text-[#087F3F]" /> {b.municipality ?? 'Bansud'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Map type toggle (map view only) */}
          {showMap && (
            <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1 rounded-lg bg-white/90 backdrop-blur-md shadow-md overflow-hidden">
              {(
                [
                  { key: 'streets', label: 'Street' },
                  { key: 'satellite', label: 'Satellite' },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMapType(key)}
                  className={`px-3 py-1.5 text-xs font-semibold text-left transition-colors ${
                    mapType === key
                      ? 'bg-[#087F3F] text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Hover card */}
          {showMap && (
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
            onMouseLeave={() => {
              overCardRef.current = false
              setHover(null)
            }}
            className={`absolute z-[500] w-64 transition-opacity duration-300 ease-out ${
              hover ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <div className="relative bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.35)] ring-1 ring-[#E5E9E7] h-[240px] overflow-hidden flex flex-col">
              <div className="relative w-full h-[60%] shrink-0 group">
                {hover?.b.category && (
                  <span className="absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-[#064E2E] text-[11px] font-semibold shadow-sm">
                    {hover.b.category}
                  </span>
                )}
                {currentImage ? (
                  <img src={toAssetUrl(currentImage)} alt={hover?.b.name ?? ''} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-amber-300 to-yellow-500" />
                )}
                <button
                      type="button"
                      onClick={() => setActiveImage((activeImage - 1 + cardImages.length) % cardImages.length)}
                      disabled={cardImages.length <= 1}
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-auto w-6 h-6 rounded-full bg-white/85 shadow flex items-center justify-center hover:bg-white disabled:opacity-40"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-800" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveImage((activeImage + 1) % cardImages.length)}
                      disabled={cardImages.length <= 1}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-auto w-6 h-6 rounded-full bg-white/85 shadow flex items-center justify-center hover:bg-white disabled:opacity-40"
                      aria-label="Next image"
                    >
                      <ChevronRight className="w-4 h-4 text-gray-800" />
                    </button>
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
                      <span className="font-semibold text-gray-900">{Number(hover?.b.average_rating ?? 0).toFixed(1)}</span>
                      {hover?.b.review_count ? <span className="text-gray-500">({hover.b.review_count})</span> : null}
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
                  <MapPin className="w-3.5 h-3.5 text-[#087F3F]" /> {hover?.b.municipality ?? 'Oriental Mindoro'}
                </p>
              </div>
            </div>
          </div>
          )}
        </div>
        </div>
        ) : (
          <div id="landing-content" className="ml-[10px] mr-[10px] py-6 space-y-12">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#087F3F]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tourist spots, food, businesses, resorts..."
                className="w-full h-[48px] pl-12 pr-4 rounded-xl border border-[#087F3F]/40 bg-[#EAF6ED] text-sm font-medium text-[#087F3F] placeholder-[#6FAB85] outline-none focus:border-[#087F3F] focus:ring-2 focus:ring-[#087F3F]/20 transition-all"
              />
            </div>

            {/* Explore by Categories */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-6">
                <h2 className="text-2xl font-bold text-[#087F3F]">Explore by Categories</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleMap(true)}
                    className="flex items-center gap-2 h-[38px] px-4 rounded-[20px] text-sm font-medium bg-[#087F3F] text-white hover:bg-[#056B35] transition-colors"
                    aria-label="Show map"
                    title="Show map"
                  >
                    <MapPinned className="w-4 h-4" />
                    Map
                  </button>
                  <Link
                    to="/explore/categories"
                    className="inline-flex items-center gap-1 bg-[#087F3F] text-white hover:bg-[#056B35] text-sm font-semibold px-4 py-2 rounded-full transition-colors"
                  >
                    View all
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] w-full">
                {categories.map((cat) => (
                  <Link
                    key={cat.label}
                    to={`/explore?tab=${cat.tab}`}
                    className="relative w-full h-[112px] rounded-[6px] overflow-hidden border border-[#E2E8E3] bg-white group hover:shadow-md hover:-translate-y-0.5 transition-all"
                  >
                    <img
                      src={cat.image}
                      alt={cat.label}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-4">
                      <h3 className="text-sm font-semibold text-white leading-tight drop-shadow-sm">{cat.label}</h3>
                      <p className="text-xs text-white/85 mt-0.5">Browse {cat.label}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Where to Next */}
            {municipalities.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-[#087F3F] mb-6">Where to Next?</h2>
                <div className="flex gap-[13px] overflow-x-auto pb-2">
                  {municipalities.map((m, i) => (
                    <Link
                      key={m.id}
                      to={`/explore/municipality/${m.id}`}
                      className="flex-[0_0_168px] h-[224px] rounded-[12px] overflow-hidden border border-[#E2E8E3] relative hover:shadow-md hover:-translate-y-0.5 transition-all group"
                    >
                      <div className={`w-full h-full bg-gradient-to-br ${PLACEHOLDER_COLORS[(i + 2) % PLACEHOLDER_COLORS.length]}`} />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                        <h3 className="text-white font-bold text-sm leading-tight">{m.name}</h3>
                        <p className="mt-1 flex items-center gap-1 text-xs text-gray-200">
                          <MapPin className="w-3 h-3 text-emerald-300" />
                          {(m.destinations_count ?? 0) + (m.businesses_count ?? 0)} Places to Explore
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Tabs + spot cards */}
            <div>
              <div className="flex justify-center gap-[12px] flex-wrap mb-10">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`h-[40px] px-[20px] rounded-[21px] text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? 'bg-[#087F3F] text-white'
                        : 'bg-white text-[#17201A] border border-[#E2E8E3] hover:bg-[#EAF6ED]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="flex justify-center gap-[14px] flex-wrap">
                {cardsPending ? (
                  <p className="text-[#68736D] text-sm py-10">Loading places…</p>
                ) : filteredSpots.length === 0 ? (
                  <p className="text-[#68736D] text-sm py-10">
                    {searchQuery.trim()
                      ? 'No places match your search.'
                      : `No ${activeTab === 'All' ? 'places' : activeTab.toLowerCase()} published yet.`}
                  </p>
                ) : filteredSpots.map((spot, i) => (
                  <div
                    key={spot.key}
                    className="w-[266px] min-h-[263px] rounded-[8px] border border-[#E2E8E3] bg-[#0c2a17] overflow-hidden relative hover:shadow-md transition-shadow"
                  >
                    {spot.image ? (
                      <img
                        src={toAssetUrl(spot.image)}
                        alt={spot.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className={`absolute inset-0 bg-gradient-to-br ${PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length]}`}>
                        <Compass className="absolute inset-0 m-auto w-10 h-10 text-white/40" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-4 pt-16">
                      <h3 className="text-white font-bold text-lg leading-tight">{spot.title}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-200">
                        <MapPin className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                        {spot.location ?? 'Oriental Mindoro'}
                      </p>
                    </div>
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-white/90 text-[11px] font-semibold text-[#087F3F]">
                      {spot.category}
                    </span>
                    {spot.rating != null && (
                      <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 text-[11px] font-semibold text-[#17201B]">
                        <Star className="w-3 h-3 text-[#B08600] fill-[#B08600]" />
                        {spot.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <footer className="border-t border-ink/5 py-8 text-center text-sm text-ink-soft">
        &copy; {new Date().getFullYear()} <span className="text-[#16803C] font-semibold">TrackTour</span> — Bansud Tourism Office. All rights reserved.
      </footer>
    </div>
  )
}
