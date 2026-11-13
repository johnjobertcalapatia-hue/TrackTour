import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/shared/services/api'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getInitials, toAssetUrl } from '@/shared/utils'
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { beachPinIcon, businessLogoIcon, pinIcon, profilePinIcon, userPinIcon } from '@/shared/utils/pin-icon'
import { useAuthStore } from '@/features/auth/services/auth-store'
import MapLayerTile from '@/shared/components/MapLayerTile'
import ExploreViewToggle from '@/features/tourist/components/ExploreViewToggle'
import MapPlacesList, { matchesPlaceSearch, type MapPlace, type PlaceSort } from '@/features/tourist/components/MapPlacesList'
import { requestCompassPermission, useNavigationBearing } from '@/features/tourist/hooks/use-navigation-bearing'
import { OFF_ROUTE_METERS, routeProgress } from '@/features/tourist/utils/route-progress'
import { NavigationCamera } from '@/shared/components/map/NavigationCamera'
import { NAV_TILT_DEG, NAV_TILT_SIZE_FACTOR, navPerspectiveFor, planePointForScreen } from '@/features/rider/navigation-view'
import { RiderMapCompass } from '@/features/rider/components/RiderMapCompass'
import { RiderNavPuck } from '@/features/rider/components/RiderNavPuck'

/** Minimum gap between automatic re-routes when the tourist leaves the route. */
const REROUTE_COOLDOWN_MS = 10_000

/** OSRM route from `from` to `to`, as [lat, lng] points plus its length in km. */
async function fetchOsrmRoute(from: [number, number], to: { lat: number; lng: number }): Promise<{ coords: [number, number][]; km: number } | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`
  const data = await fetch(url).then((r) => r.json())
  const r = data?.routes?.[0]
  const coords: number[][] | undefined = r?.geometry?.coordinates
  if (!Array.isArray(coords)) return null
  return { coords: coords.map((c) => [c[1], c[0]] as [number, number]), km: (r?.distance ?? 0) / 1000 }
}
import { getDiscoveryGroup, isTouristAttractionCategory, type DiscoveryGroup } from '@/shared/utils/category'
import {
  X,
  MapPin,
  Star,
  Navigation,
  Compass,
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
  Film,
  Info,
  ShoppingCart,
  Check,
  LocateFixed,
  Navigation2,
  Route,
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

const MAP_CATEGORY_OPTIONS = ['all', 'Tourist Spots', 'Food', 'Resorts', 'Other'] as const
/** The same categories for the places panel dropdown ('' there = 'all'). */
const PANEL_CATEGORY_OPTIONS = MAP_CATEGORY_OPTIONS.filter((c) => c !== 'all').map((c) => ({ id: c, name: c }))

/** Explore tab (?category=places|food|stays) → map category chip, and back. */
const CATEGORY_PARAM_TO_FILTER: Record<string, (typeof MAP_CATEGORY_OPTIONS)[number]> = {
  places: 'Tourist Spots',
  food: 'Food',
  stays: 'Resorts',
}
const FILTER_TO_EXPLORE_TAB: Record<string, string> = {
  'Tourist Spots': 'places',
  Food: 'food',
  Resorts: 'stays',
}

type PanelTab = 'Overview' | 'Menu' | 'Gallery' | 'Videos' | 'Reviews' | 'About' | 'Amenities' | 'Visitor Info'

function panelTabsForGroup(group: DiscoveryGroup): PanelTab[] {
  if (group === 'spot') return ['Overview', 'Gallery', 'Videos', 'Reviews', 'Visitor Info']
  if (group === 'accommodation') return ['Overview', 'Amenities', 'Gallery', 'Reviews', 'About']
  if (group === 'dining') return ['Overview', 'Menu', 'Reviews', 'About']
  return ['Overview', 'Reviews', 'About']
}

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
  media?: { id?: number; file_path?: string | null; type?: string | null; caption?: string | null }[]
  is_open: boolean
  reviews_count: number
  reviews_avg_rating: number | null
  promotions: unknown[]
  services?: string[] | null
  facilities?: string[] | null
  price_range?: string | null
  category_details?: Record<string, string | null>
  is_accepting_orders?: boolean
  menu_items?: MapMenuItem[]
}

interface MapMenuItem {
  id: number
  name: string
  description?: string | null
  price: number
  image?: string | null
  bestseller?: boolean
}

interface FoodCartItem {
  id: number
  name: string
  price: number
  image: string | null
  business_name: string
  business_id: number
  quantity: number
}

interface MapData {
  businesses: Business[]
  municipalities: { id: number; name: string }[]
  categories?: unknown[]
}

function addFoodItemToCart(business: Business, item: MapMenuItem) {
  let cart: FoodCartItem[]
  try {
    cart = JSON.parse(localStorage.getItem('food_cart') || '[]') as FoodCartItem[]
  } catch {
    cart = []
  }

  const isSameItem = (cartItem: FoodCartItem) => cartItem.id === item.id && cartItem.name === item.name
  const updatedCart = cart.some(isSameItem)
    ? cart.map((cartItem) => (
      isSameItem(cartItem) ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
    ))
    : [...cart, {
      id: item.id,
      name: item.name,
      price: Number(item.price),
      image: item.image ?? null,
      business_name: business.name,
      business_id: business.id,
      quantity: 1,
    }]

  localStorage.setItem('food_cart', JSON.stringify(updatedCart))
  window.dispatchEvent(new Event('cart-updated'))
}

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
  const group = getDiscoveryGroup(b.category?.name, b.category?.id)
  if (group === 'dining')
    return { label: 'Order Food', to: `/tourist/explore/${b.id}`, icon: UtensilsCrossed }
  if (group === 'accommodation')
    return { label: 'Book / Reserve', to: `/tourist/explore/${b.id}`, icon: Hotel }
  if (group === 'spot')
    return { label: 'Explore Destination', to: `/tourist/explore/${b.id}`, icon: Compass }
  return { label: 'View Business', to: `/tourist/explore/${b.id}`, icon: Building2 }
}

const CARD_WIDTH = 256
const CARD_GAP = 10

interface HoverState {
  b: Business
  pos: [number, number]
  size: [number, number]
}

/**
 * Marker per business, matching the landing-page map: restaurants,
 * attractions and resorts / stays show their photo (logo, else cover) in the
 * round image pin (2026-11-09: attractions and resorts too). Without a
 * photo, attractions keep the beach pin and everything else the standard
 * labelled pin.
 */
function markerIconFor(biz: Business, selected: boolean): L.DivIcon {
  const photo = biz.logo || biz.cover_photo
  const group = getDiscoveryGroup(biz.category?.name, biz.category?.id)
  const attraction = isTouristAttractionCategory(biz.category?.name)
  if (photo && (attraction || group === 'dining' || group === 'spot' || group === 'accommodation')) {
    return businessLogoIcon(toAssetUrl(photo), biz.name ?? '', selected)
  }
  if (attraction) return beachPinIcon
  return pinIcon(biz.name, selected)
}

const PENDING_MAP_DESTINATION_KEY = 'tracktour_pending_map_destination'

/** Zoom used when the map centres on the tourist. */
const USER_FOCUS_ZOOM = 15

/**
 * Default view: every time the map opens, centre on the tourist's first
 * location fix. Skipped when a business or route is already in focus (e.g. a
 * "Get directions" hand-off), so it never yanks the view away from it.
 */
function CenterOnUserOnce({ location, skip }: { location: { lat: number; lng: number } | null; skip: boolean }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !location) return
    done.current = true
    if (!skip) map.setView([location.lat, location.lng], USER_FOCUS_ZOOM)
  }, [location, skip, map])
  return null
}

/** "My location" button: each bump of `signal` re-centres on the tourist. */
function RecenterOnUser({ location, signal }: { location: { lat: number; lng: number } | null; signal: number }) {
  const map = useMap()
  useEffect(() => {
    if (signal === 0 || !location) return
    map.setView([location.lat, location.lng], Math.max(map.getZoom?.() ?? USER_FOCUS_ZOOM, USER_FOCUS_ZOOM))
    // Only on an explicit request, not on every GPS update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, map])
  return null
}

/** A place picked from the places list: bring it to the middle of the map, close enough to see. */
function FocusPlace({ target }: { target: { lat: number; lng: number; n: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.setView?.([target.lat, target.lng], Math.max(map.getZoom?.() ?? USER_FOCUS_ZOOM, USER_FOCUS_ZOOM))
    // Only when a card is picked (`n` bumps), not on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.n, map])
  return null
}

function MapEventsHandler({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({
    click: () => onMapClick(),
  })
  return null
}

/**
 * Frames the whole route. On phones the route card covers the top of the map
 * and the minimised business sheet the bottom, so pad for both.
 */
function FitRouteInView({ coords, enabled = true }: { coords: [number, number][]; enabled?: boolean }) {
  const map = useMap()
  const key = coords.length
    ? `${coords[0]!.join(',')}|${coords[coords.length - 1]!.join(',')}|${coords.length}`
    : ''
  useEffect(() => {
    if (!enabled || coords.length < 2 || typeof map.fitBounds !== 'function') return
    const phone = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 639px)').matches)
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize?.({ pan: false })
      map.fitBounds(coords, {
        paddingTopLeft: [24, phone ? 200 : 32],
        paddingBottomRight: [24, phone ? 110 : 32],
        maxZoom: 17,
      })
    })
    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, enabled])
  return null
}


/** Gap between the tourist marker and the top of the mobile bottom navigation bar. */
const NAV_MARKER_GAP_PX = 30

/**
 * Where the tourist marker should sit on screen while navigating, as an offset
 * from the centre of the map area: just above the mobile bottom bar (30 px
 * above its top, directly over the "Stays" button). Without a visible bottom
 * bar (desktop) it sits 30 px above the bottom of the map. {0,0} = centred.
 */
function navMarkerScreenOffset(mapArea: HTMLElement | null): { x: number; y: number } {
  if (!mapArea || typeof document === 'undefined') return { x: 0, y: 0 }
  const area = mapArea.getBoundingClientRect()
  if (area.width <= 0 || area.height <= 0) return { x: 0, y: 0 }
  const bar = document.querySelector<HTMLElement>('nav[aria-label="Tourist bottom navigation"]')
  const barRect = bar?.getBoundingClientRect()
  const barVisible = !!bar && !!barRect && barRect.height > 0 && window.getComputedStyle(bar).display !== 'none'
  const stays = barVisible ? bar!.querySelector<HTMLElement>('a[aria-label="Stays"]')?.getBoundingClientRect() : undefined
  const bottom = barVisible ? Math.min(barRect!.top, area.bottom) : area.bottom
  const targetX = stays && stays.width > 0 ? stays.left + stays.width / 2 : area.left + area.width / 2
  const targetY = bottom - NAV_MARKER_GAP_PX
  const x = targetX - (area.left + area.width / 2)
  // Keep the whole marker (≈45 px tall above its tip) on screen.
  const y = Math.max(-area.height / 2 + 60, Math.min(area.height / 2, targetY - (area.top + area.height / 2)))
  return { x: Math.round(x), y: Math.round(y) }
}


const destinationIcon = L.divIcon({
  className: 'route-destination-marker',
  html: '<div style="width:22px;height:22px;background:#087F3F;border:3px solid #fff;border-radius:50%;box-shadow:0 4px 12px rgba(0,0,0,0.3)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function RouteOverlay({ route, destination, fit = true }: {
  /** `coords`: what to draw (the part still ahead); `fitCoords`: what to frame (the whole route). */
  route: { coords: [number, number][]; fitCoords?: [number, number][] }
  destination: { lat: number; lng: number }
  fit?: boolean
}) {
  return (
    <>
      <Polyline positions={route.coords} pathOptions={{ color: '#ffffff', weight: 10, opacity: 0.95 }} />
      <Polyline positions={route.coords} pathOptions={{ color: '#087F3F', weight: 6, opacity: 1 }} />
      <FitRouteInView coords={route.fitCoords ?? route.coords} enabled={fit} />
      <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} />
    </>
  )
}

/**
 * mapOnly: the Ride Hailing map (/tourist/transport/map, the Transport page's
 * Map button): the businesses on the map without the places list panel or the
 * List view switch, with a way back to Ride Hailing. A clicked business still
 * opens its details; closing them returns to the bare map.
 */
export default function TouristExploreMap({ mapOnly = false }: { mapOnly?: boolean } = {}) {
  const navigate = useNavigate()
  const [addedMenuItemId, setAddedMenuItemId] = useState<number | null>(null)
  const [searchParams] = useSearchParams()
  const [categoryFilter, setCategoryFilter] = useState<string>(
    () => CATEGORY_PARAM_TO_FILTER[searchParams.get('category') ?? ''] ?? 'all',
  )
  const listViewTab = FILTER_TO_EXPLORE_TAB[categoryFilter]
  const [pinned, setPinned] = useState<Business | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  /** Phone-only: business sheet minimised to its title bar (e.g. while a route is shown). */
  const [sheetCollapsed, setSheetCollapsed] = useState(false)
  /** Phone-only: places list sheet minimised to its title bar (it starts that way so the map shows). */
  const [listCollapsed, setListCollapsed] = useState(true)
  /** Places panel search: filters the list and the markers. */
  const [placeQuery, setPlaceQuery] = useState('')
  /** Places panel municipality filter (id as a string, '' = all): filters the list and the markers. */
  const [placeMunicipality, setPlaceMunicipality] = useState('')
  /** Places panel order. */
  const [placeSort, setPlaceSort] = useState<PlaceSort>('top-rated')
  /** Card hovered in the places list: its marker is highlighted. */
  const [listHoverId, setListHoverId] = useState<number | null>(null)
  /** Places list scroll position, kept while a place's details are open. */
  const listScrollRef = useRef(0)
  /** A place picked from the list: the map moves to it (bumped `n` = move again). */
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number; n: number } | null>(null)
  const [selectedImage, setSelectedImage] = useState(0)
  const [panelTab, setPanelTab] = useState<PanelTab>('Overview')
  const [saved, setSaved] = useState(false)
  const [hover, setHover] = useState<HoverState | null>(null)
  /**
   * Last hovered business. While the card fades out it keeps showing *that*
   * business in *that* spot; without this it jumped to the map's top-left
   * corner with "Business name" placeholders for the 300 ms fade.
   */
  const lastHoverRef = useRef<HoverState | null>(null)
  if (hover) lastHoverRef.current = hover
  const shownHover = hover ?? lastHoverRef.current
  const overCardRef = useRef(false)
  const hideTimerRef = useRef<number | null>(null)
  const [activeImage, setActiveImage] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(0)

  const [mapType, setMapType] = useState<MapType>('street')
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [recenterSignal, setRecenterSignal] = useState(0)
  const [userCourse, setUserCourse] = useState<number | null>(null)
  /** Current GPS speed in m/s (null when the device doesn't report it). */
  const [userSpeed, setUserSpeed] = useState<number | null>(null)
  /** Navigation view: follow + heading-up after "Directions"; the compass button toggles it. */
  const [navigating, setNavigating] = useState(false)
  // "You are here" pin shows the signed-in tourist's profile photo (initials if none); guests get the plain person pin.
  const authUser = useAuthStore((s) => s.user)
  const userMarkerIcon = authUser
    ? profilePinIcon(authUser.profile_photo ? toAssetUrl(authUser.profile_photo) : null, getInitials(authUser.name ?? ''))
    : userPinIcon

  // Live location: keeps the "you are here" marker current while the map is open.
  useEffect(() => {
    if (!('geolocation' in navigator) || typeof navigator.geolocation.watchPosition !== 'function') return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        const { heading, speed } = pos.coords
        // GPS course is only meaningful while actually moving.
        setUserCourse(heading != null && Number.isFinite(heading) && speed != null && speed >= 0.8 ? heading : null)
        setUserSpeed(speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null)
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch?.(id)
  }, [])

  const showMyLocation = () => {
    if (userLocation) {
      setRecenterSignal((n) => n + 1)
      return
    }
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setRecenterSignal((n) => n + 1)
      },
      () => {},
      { enableHighAccuracy: true, timeout: 20_000 },
    )
  }
  const [route, setRoute] = useState<[number, number][] | null>(null)
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null)
  const [routeDestination, setRouteDestination] = useState<{ name: string; address: string } | null>(null)
  /** Where the current route ends: independent of the details panel, so a route can be shown with the panel closed. */
  const [routeTo, setRouteTo] = useState<{ id: number; lat: number; lng: number } | null>(null)
  /** Ignores a slow OSRM answer for an older request. */
  const routeRequestRef = useRef(0)
  /** The route as the tourist moves: consumed behind them, with how far they've strayed. */
  const progress = useMemo(
    () => (route && userLocation ? routeProgress(route, userLocation) : null),
    [route, userLocation],
  )
  // Share of the OSRM road distance still ahead (equals OSRM's figure at the start).
  const remainingKm = progress && routeDistanceKm != null && progress.totalMeters > 0
    ? routeDistanceKm * (progress.remainingMeters / progress.totalMeters)
    : routeDistanceKm
  const lastRerouteRef = useRef(0)
  const reroutingRef = useRef(false)
  // Left the route: plan again from where the tourist is, so the line grows or
  // shrinks to match the way they actually went.
  useEffect(() => {
    if (!progress || !routeTo || !userLocation || progress.offRouteMeters <= OFF_ROUTE_METERS) return
    const now = Date.now()
    if (reroutingRef.current || now - lastRerouteRef.current < REROUTE_COOLDOWN_MS) return
    lastRerouteRef.current = now
    reroutingRef.current = true
    const requestId = ++routeRequestRef.current
    fetchOsrmRoute([userLocation.lat, userLocation.lng], routeTo)
      .then((res) => {
        if (!res || requestId !== routeRequestRef.current) return
        setRoute(res.coords)
        setRouteDistanceKm(res.km)
      })
      .catch(() => {})
      .finally(() => { reroutingRef.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress])
  const liveBearing = useNavigationBearing({ active: navigating && !!route, location: userLocation, course: userCourse, route: progress?.remaining ?? route })
  const mapAreaRef = useRef<HTMLDivElement>(null)
  /** Side of the square the rotated map needs so no corner shows blank (the container diagonal). */
  const [rotatorSize, setRotatorSize] = useState(0)
  useEffect(() => {
    const el = mapAreaRef.current
    if (!el) return
    const measure = () => {
      setRotatorSize(Math.ceil(Math.hypot(el.clientWidth, el.clientHeight)))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const navActive = navigating && !!route

  // Same navigation view as the rider's (2026-11-10): tilted 3D, heading-up,
  // and the map can be explored while navigating (drag pans, pinch / wheel
  // zoom, twist / right-drag rotates). The first pan or twist enters free
  // look: the camera stops following and the map keeps the bearing the
  // tourist gave it; "Show my location" brings it back to them.
  const [navFree, setNavFree] = useState(false)
  const [freeBearing, setFreeBearing] = useState(0)
  // Following: heading-up, or north-up after a tap on the compass (again: heading-up).
  const [northUp, setNorthUp] = useState(false)
  // A gesture is running: the map turns with the fingers, without easing.
  const [navGesturing, setNavGesturing] = useState(false)
  /** "Show my location" while navigating: the camera re-centres on the tourist. */
  const [navRecenterSignal, setNavRecenterSignal] = useState(0)
  useEffect(() => {
    if (!navActive) {
      setNavFree(false)
      setNavGesturing(false)
      setNorthUp(false)
    }
  }, [navActive])
  const bearing = navActive && navFree ? freeBearing : navActive && northUp ? 0 : liveBearing
  const shownBearingRef = useRef(bearing)
  shownBearingRef.current = bearing
  const handleFreeLookChange = useCallback((free: boolean) => {
    // Exploring starts from the view the tourist is looking at.
    if (free) setFreeBearing(shownBearingRef.current)
    setNavFree(free)
  }, [])
  const handleCompass = () => {
    if (navFree) setFreeBearing(0) // exploring: face north
    else setNorthUp((n) => !n) // following: north-up <-> heading-up
  }
  /** The tilted plane is larger than the screen so no blank corner shows while it turns and tips back. */
  const planeSize = Math.ceil(rotatorSize * NAV_TILT_SIZE_FACTOR)
  // Deepened on large viewports so the near edge stays in front of the camera.
  const navPerspective = navPerspectiveFor(planeSize)
  const navPerspectiveRef = useRef(navPerspective)
  navPerspectiveRef.current = navPerspective
  /** A point on the tilted map (client px) -> its offset on the map plane. */
  const navScreenToPlanePoint = useCallback((pt: { x: number; y: number }) => {
    const rect = mapAreaRef.current?.getBoundingClientRect()
    const cx = rect ? rect.left + rect.width / 2 : 0
    const cy = rect ? rect.top + rect.height / 2 : 0
    return planePointForScreen(pt.x - cx, pt.y - cy, NAV_TILT_DEG, navPerspectiveRef.current)
  }, [])

  const [navScreenOffset, setNavScreenOffset] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!navActive) return
    const measure = () => {
      const next = navMarkerScreenOffset(mapAreaRef.current)
      setNavScreenOffset((prev) => (prev.x === next.x && prev.y === next.y ? prev : next))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [navActive, rotatorSize])
  /** The marker's screen spot as a point on the tilted plane (what the camera places). */
  const navPlaneOffset = useMemo(() => {
    const pt = planePointForScreen(navScreenOffset.x, navScreenOffset.y, NAV_TILT_DEG, navPerspective)
    return { x: Math.round(pt.x), y: Math.round(pt.y) }
  }, [navScreenOffset, navPerspective])
  /**
   * Navigating near the route: show the tourist snapped onto the line (as Google
   * Maps does), so the centred marker sits on the route and the line runs
   * straight up from it. Off the route (re-planning), show the raw GPS position.
   */
  const markerLocation = navActive && progress && progress.offRouteMeters <= OFF_ROUTE_METERS
    ? { lat: progress.remaining[0]![0], lng: progress.remaining[0]![1] }
    : userLocation
  const [selectedVehicle, setSelectedVehicle] = useState<TransportKey>('motorcycle')
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
    if (categoryFilter === 'all') return true
    const group = getDiscoveryGroup(b.category?.name, b.category?.id)
    if (categoryFilter === 'Tourist Spots') return group === 'spot'
    if (categoryFilter === 'Food') return group === 'dining'
    if (categoryFilter === 'Resorts') return group === 'accommodation'
    if (categoryFilter === 'Other') return group === 'other'
    return true
  })
  const municipalityOptions = [...(mapData?.municipalities ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const chosenMunicipality = municipalityOptions.find((m) => String(m.id) === placeMunicipality) ?? null
  /** In the chosen municipality (some rows carry it as a plain name). */
  const inChosenMunicipality = (b: Business) => {
    if (!chosenMunicipality) return true
    const m = b.municipality as { id?: number; name?: string } | string | null
    if (typeof m === 'string') return m.toLowerCase() === chosenMunicipality.name.toLowerCase()
    return m?.id === chosenMunicipality.id
  }
  /** Shown in the places panel and on the map: category chip + municipality + search. */
  const isPlaceVisible = (b: Business) => inChosenMunicipality(b) && matchesPlaceSearch(b, placeQuery)
  const visibleBusinesses = filteredBusinesses.filter(isPlaceVisible)
  /** Municipalities that have at least one business on the map. */
  const businessMunicipalityCount = new Set(
    businesses
      .map((b) => {
        const m = b.municipality as { id?: number; name?: string } | string | null
        return typeof m === 'string' ? m.toLowerCase() : m?.id ?? m?.name?.toLowerCase() ?? null
      })
      .filter((k) => k != null),
  ).size

  /** Hide the marker hover card now and cancel any pending show/hide timer. */
  const dismissHover = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    overCardRef.current = false
    setHover(null)
  }

  const handleBusinessSelect = (biz: Business) => {
    // Opening a business (marker click, hover-card click, saved destination)
    // replaces the hover preview with the panel.
    dismissHover()
    setPinned(biz)
    setPanelOpen(true)
    setSheetCollapsed(false)
    setSelectedImage(0)
    setPanelTab('Overview')
    setSaved(false)
    if (biz.latitude != null && biz.longitude != null) {
    }
  }

  const handleMenuItemAdd = (business: Business, item: MapMenuItem) => {
    addFoodItemToCart(business, item)
    setAddedMenuItemId(item.id)
    window.setTimeout(() => setAddedMenuItemId((current) => current === item.id ? null : current), 1800)
  }

  const handleMenuItemCheckout = (business: Business, item: MapMenuItem) => {
    addFoodItemToCart(business, item)
    navigate('/tourist/food/cart')
  }

  /** A card in the places list: open its details in the panel and bring it into view. */
  const handlePlaceCardSelect = (place: MapPlace) => {
    const biz = businesses.find((b) => b.id === place.id)
    if (!biz) return
    setListHoverId(null)
    handleBusinessSelect(biz)
    if (biz.latitude != null && biz.longitude != null) {
      const lat = biz.latitude
      const lng = biz.longitude
      setFocusTarget((prev) => ({ lat, lng, n: (prev?.n ?? 0) + 1 }))
    }
  }

  /** Details -> back to the places list (a route being shown stays). */
  const handleBackToList = () => {
    setPanelOpen(false)
    setPinned(null)
    setSheetCollapsed(false)
    // Phones: the list comes back open, unless a route is on screen.
    setListCollapsed(!!route)
  }

  const handleClosePanel = () => {
    setPanelOpen(false)
    setSheetCollapsed(false)
    setListCollapsed(true)
    setPinned(null)
    setRoute(null)
    setRouteDistanceKm(null)
    setRouteDestination(null)
    setRouteTo(null)
    setNavigating(false)
  }

  /**
   * Plans a route to `b`. "Get directions" just draws it (north-up overview of
   * the whole route); "Navigate" (`navigate: true`) also starts the Waze-style
   * navigation view.
   */
  const handleDirections = (b: Business, { navigate = false }: { navigate?: boolean } = {}) => {
    // Getting directions focuses the route; the hover preview must not linger.
    dismissHover()
    if (b.latitude == null || b.longitude == null) return
    // Routing does not open the details panel (e.g. from the hover card); the
    // route carries its own destination.
    if (routeTo?.id !== b.id) {
      // Don't show the previous business's route while the new one loads.
      setRoute(null)
      setRouteDistanceKm(null)
      setRouteDestination(null)
    }
    const latitude = b.latitude
    const longitude = b.longitude
    const requestId = ++routeRequestRef.current
    if (navigate) requestCompassPermission()
    const doRoute = (from: [number, number]) => {
      const currentLocation = { lat: from[0], lng: from[1] }
      setUserLocation(currentLocation)
      fetchOsrmRoute(from, { lat: latitude, lng: longitude })
        .then((res) => {
          if (requestId !== routeRequestRef.current) return
          if (res) {
            setRouteTo({ id: b.id, lat: latitude, lng: longitude })
            setNavigating(navigate)
            lastRerouteRef.current = Date.now()
            setRoute(res.coords)
            setRouteDistanceKm(res.km)
            setSheetCollapsed(true)
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
    routeRequestRef.current++
    setNavigating(false)
    setSheetCollapsed(false)
    setRoute(null)
    setRouteDistanceKm(null)
    setRouteDestination(null)
    setRouteTo(null)
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

  const cardImages = getBusinessImages(shownHover?.b ?? null)
  const currentImage = cardImages[Math.min(activeImage, cardImages.length - 1)] ?? null

  const displayBusiness = pinned
  const showDetail = panelOpen && !!displayBusiness
  const panelImages = getBusinessImages(displayBusiness)
  const panelImage = panelImages[Math.min(selectedImage, panelImages.length - 1)] ?? null
  const currentGroup: DiscoveryGroup = getDiscoveryGroup(displayBusiness?.category?.name, displayBusiness?.category?.id)
  const availablePanelTabs = displayBusiness
    ? panelTabsForGroup(currentGroup)
    : (['Overview', 'Menu', 'Reviews', 'About'] as PanelTab[])
  const action = displayBusiness ? businessAction(displayBusiness) : null
  const ActionIcon = action?.icon
  const entranceFee =
    displayBusiness?.category_details?.['Entrance Fee'] ||
    displayBusiness?.category_details?.entrance_fee ||
    null
  const visitingHours =
    displayBusiness?.category_details?.['Daily Visiting Hours'] ||
    displayBusiness?.category_details?.visiting_hours ||
    null

  // Hidden: transparent, then visibility:hidden once the fade has finished, so
  // nothing (not even a faded placeholder) is left on the map.
  let cardStyle: React.CSSProperties = {
    opacity: 0,
    visibility: 'hidden',
    transition: 'opacity 300ms ease-out, visibility 0s linear 300ms',
  }
  if (shownHover) {
    const [mx, my] = shownHover.pos
    const [mw, mh] = shownHover.size
    let left = mx + CARD_GAP
    let top = my - cardHeight / 2
    if (left + CARD_WIDTH > mw) left = mx - CARD_GAP - CARD_WIDTH
    left = Math.max(4, Math.min(left, mw - CARD_WIDTH - 4))
    top = Math.max(4, Math.min(top, mh - cardHeight - 4))
    cardStyle = hover
      ? { left, top, opacity: 1, visibility: 'visible', transition: 'opacity 300ms ease-out' }
      : { ...cardStyle, left, top }
  }

  return (
    <div
      // Height + bottom margin: index.css .tourist-map-page (phones / tablets: ends at the top of the bottom bar, whatever its size).
      className="tourist-map-page flex flex-col min-h-0 overflow-hidden bg-[#f8faf7] -mx-4 -mt-4 sm:-mx-6 sm:-mt-6"
    >
      <div className="relative flex flex-1 min-h-0">
        {/* Left Panel */}
        {/* Left panel: the places list (search + cards); a card or marker opens
            that place's details in the same panel. Phones: a bottom sheet. */}
        {(!mapOnly || showDetail) && (
          <aside
            aria-label={showDetail ? 'Place details' : 'Places'}
            className={`map-business-sheet absolute inset-x-0 bottom-0 z-[600] transition-[max-height] duration-300 ${(showDetail ? sheetCollapsed : listCollapsed) ? 'max-h-[72px]' : 'max-h-[62dvh]'} sm:max-h-full sm:static sm:inset-auto sm:w-[405px] sm:max-w-[90vw] sm:shrink-0 bg-white rounded-t-2xl sm:rounded-none border-t sm:border-t-0 sm:border-r border-[#E5E9E7] shadow-2xl sm:shadow-none flex flex-col overflow-hidden`}
          >
            {!showDetail && (
              <>
                {/* Phone: grab bar that opens / minimises the places list */}
                <button
                  type="button"
                  onClick={() => setListCollapsed((c) => !c)}
                  aria-expanded={!listCollapsed}
                  aria-label={listCollapsed ? 'Show places list' : 'Minimize places list'}
                  className="sm:hidden shrink-0 mx-2 mt-2 mb-1 flex items-center gap-3 px-2 py-1.5 rounded-xl text-left hover:bg-[#F3F8F4]"
                >
                  <span className="w-9 h-1.5 rounded-full bg-[#C9D1CD] shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-[#17201B] truncate">Explore {visibleBusinesses.length} {visibleBusinesses.length === 1 ? 'place' : 'places'}</span>
                    {listCollapsed && <span className="block text-xs text-[#56615B]">Tap to search and browse</span>}
                  </span>
                  <ChevronRight className={`ml-auto w-5 h-5 text-[#56615B] shrink-0 transition-transform ${listCollapsed ? '-rotate-90' : 'rotate-90'}`} aria-hidden="true" />
                </button>
                <h2 className="hidden sm:block shrink-0 px-4 pt-4 pb-2 text-base font-bold text-[#17201B]">Explore places</h2>
                <MapPlacesList
                  places={visibleBusinesses}
                  query={placeQuery}
                  onQueryChange={setPlaceQuery}
                  onSelect={handlePlaceCardSelect}
                  onHover={setListHoverId}
                  userLocation={userLocation}
                  scrollRef={listScrollRef}
                  municipality={placeMunicipality}
                  municipalities={municipalityOptions}
                  onMunicipalityChange={setPlaceMunicipality}
                  category={categoryFilter === 'all' ? '' : categoryFilter}
                  categories={PANEL_CATEGORY_OPTIONS}
                  onCategoryChange={(c) => setCategoryFilter(c || 'all')}
                  totalCount={businesses.length}
                  municipalityCount={businessMunicipalityCount}
                  sort={placeSort}
                  onSortChange={setPlaceSort}
                />
              </>
            )}
            {showDetail && (<>
            <div className="flex items-center gap-2 p-2 shrink-0">
              {!mapOnly && (
              <button
                type="button"
                onClick={handleBackToList}
                aria-label="Back to places list"
                title="Back to places list"
                className="h-9 shrink-0 flex items-center gap-1 rounded-full px-2 sm:pr-3 text-sm font-semibold text-[#087F3F] hover:bg-[#E9F7EF] transition-colors"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
                <span className="hidden sm:inline">All places</span>
              </button>
              )}
              {/* Phone: grab bar that minimises / expands the sheet */}
              <button
                type="button"
                onClick={() => setSheetCollapsed((c) => !c)}
                aria-expanded={!sheetCollapsed}
                aria-label={sheetCollapsed ? 'Show business details' : 'Minimize business details'}
                className="map-sheet-handle sm:hidden flex-1 min-w-0 flex items-center gap-3 px-2 py-1.5 rounded-xl text-left hover:bg-[#F3F8F4]"
              >
                <span className="w-9 h-1.5 rounded-full bg-[#C9D1CD] shrink-0" aria-hidden="true" />
                {sheetCollapsed && displayBusiness && (
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-[#17201B] truncate">{displayBusiness.name}</span>
                    <span className="block text-xs text-[#56615B]">Tap to see details</span>
                  </span>
                )}
                <ChevronRight className={`ml-auto w-5 h-5 text-[#56615B] shrink-0 transition-transform ${sheetCollapsed ? '-rotate-90' : 'rotate-90'}`} aria-hidden="true" />
              </button>
              <span className="hidden sm:block flex-1" />
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
                      {!(Number(displayBusiness.reviews_avg_rating ?? 0) > 0) ? (
                        <span className="text-[#56615B]">No ratings yet</span>
                      ) : (
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
                      )}
                      {displayBusiness.price_range ? <span>&middot; {displayBusiness.price_range}</span> : null}
                    </div>
                    {displayBusiness.category && <p className="mt-1 text-sm text-gray-600">{displayBusiness.category.name}</p>}

                    <div className="tourist-map-detail-tabs mt-3 flex gap-5 border-b border-[#E2E8E3] overflow-x-auto">
                      {availablePanelTabs.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setPanelTab(t)}
                          className={`py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
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
                          {currentGroup === 'spot' ? (
                            <>
                              {visitingHours && (
                                <p className="flex items-center gap-2.5 text-sm text-gray-800">
                                  <Clock className="w-4 h-4 text-[#087F3F] shrink-0" />
                                  <span>Visiting hours: {visitingHours}</span>
                                </p>
                              )}
                              {entranceFee && (
                                <p className="flex items-center gap-2.5 text-sm text-gray-800">
                                  <Banknote className="w-4 h-4 text-[#087F3F] shrink-0" />
                                  <span>Entrance: {entranceFee}</span>
                                </p>
                              )}
                            </>
                          ) : (
                            displayBusiness.price_range && (
                              <p className="flex items-center gap-2.5 text-sm text-gray-800">
                                <Banknote className="w-4 h-4 text-[#087F3F] shrink-0" /> {displayBusiness.price_range}
                              </p>
                            )
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

                    {panelTab === 'Gallery' && (
                      <div className="pt-4">
                        {panelImages.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            {panelImages.map((src, i) => (
                              <img
                                key={i}
                                src={toAssetUrl(src)}
                                alt=""
                                onClick={() => setSelectedImage(i)}
                                className={`w-full h-28 object-cover rounded-xl cursor-pointer border-2 transition-all ${
                                  selectedImage === i ? 'border-[#087F3F] ring-2 ring-[#087F3F]/30' : 'border-transparent hover:opacity-90'
                                }`}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="pt-10 pb-6 text-center">
                            <MapPin className="w-8 h-8 mx-auto text-gray-300" />
                            <p className="mt-3 text-sm text-gray-500">No gallery photos uploaded yet.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {panelTab === 'Videos' && (
                      <div className="pt-4">
                        {displayBusiness.media?.some((m) =>
                          m.type === 'Promotional Video' ||
                          m.type?.toLowerCase().includes('video') ||
                          m.file_path?.endsWith('.mp4') ||
                          m.file_path?.endsWith('.mov')
                        ) ? (
                          <div className="space-y-3">
                            {displayBusiness.media
                              .filter((m) =>
                                m.type === 'Promotional Video' ||
                                m.type?.toLowerCase().includes('video') ||
                                m.file_path?.endsWith('.mp4') ||
                                m.file_path?.endsWith('.mov')
                              )
                              .map((v) => (
                                <div key={v.id ?? v.file_path} className="rounded-xl overflow-hidden border border-[#E2E8E3] bg-black">
                                  <video
                                    src={toAssetUrl(v.file_path ?? '')}
                                    controls
                                    playsInline
                                    className="w-full max-h-48 object-contain"
                                  />
                                  {v.caption && <p className="p-2 text-xs text-gray-600 bg-white">{v.caption}</p>}
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div className="pt-10 pb-6 text-center">
                            <Film className="w-8 h-8 mx-auto text-gray-300" />
                            <p className="mt-3 text-sm text-gray-500">No promotional videos available yet.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {panelTab === 'Visitor Info' && (
                      <div className="pt-4 space-y-3 text-sm text-gray-800">
                        <div className="p-3 bg-[#EAF6ED] rounded-xl flex items-start gap-2.5">
                          <Info className="w-4 h-4 text-[#087F3F] mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold text-[#17201A]">Destination Information</p>
                            <p className="text-xs text-gray-600 mt-0.5">Entrance fees and visiting hours for this attraction.</p>
                          </div>
                        </div>
                        <div className="space-y-2 border-t border-[#EFF3F0] pt-3">
                          <div className="flex justify-between items-center py-1 border-b border-[#EFF3F0]">
                            <span className="text-gray-500 text-xs">Entrance Fee</span>
                            <span className="font-semibold text-gray-900">{entranceFee || 'Free / Open to public'}</span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#EFF3F0]">
                            <span className="text-gray-500 text-xs">Visiting Hours</span>
                            <span className="font-semibold text-gray-900">{visitingHours || 'Daylight hours / Open daily'}</span>
                          </div>
                          <div className="flex justify-between items-center py-1 border-b border-[#EFF3F0]">
                            <span className="text-gray-500 text-xs">Municipality</span>
                            <span className="font-semibold text-gray-900">
                              {typeof displayBusiness.municipality === 'object'
                                ? displayBusiness.municipality?.name
                                : displayBusiness.municipality || 'Bansud, Oriental Mindoro'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {panelTab === 'Amenities' && (
                      <div className="pt-4 space-y-3">
                        {((displayBusiness.facilities && displayBusiness.facilities.length > 0) ||
                          (displayBusiness.services && displayBusiness.services.length > 0)) ? (
                          <>
                            {displayBusiness.facilities && displayBusiness.facilities.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Facilities</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {displayBusiness.facilities.map((f) => (
                                    <span key={f} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EAF6ED] text-[#087F3F] text-xs font-medium">
                                      {f}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {displayBusiness.services && displayBusiness.services.length > 0 && (
                              <div className="mt-3">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Services</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {displayBusiness.services.map((s) => (
                                    <span key={s} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="pt-10 pb-6 text-center">
                            <Building2 className="w-8 h-8 mx-auto text-gray-300" />
                            <p className="mt-3 text-sm text-gray-500">No amenities listed yet.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {panelTab === 'Menu' && (
                      <div className="pt-4">
                        {Array.isArray(displayBusiness.menu_items) && displayBusiness.menu_items.length > 0 ? (
                          <div className="grid grid-cols-2 gap-3">
                            {displayBusiness.menu_items.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-xl border border-[#E2E8E3] overflow-hidden flex flex-col bg-white shadow-sm hover:border-[#087F3F]"
                              >
                                <button
                                  type="button"
                                  aria-label={`View details for ${item.name}`}
                                  onClick={() => navigate(`/tourist/food/item/${item.id}`)}
                                  className="flex flex-col flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#087F3F]"
                                >
                                  {item.image ? (
                                    <img src={toAssetUrl(item.image)} alt={item.name} className="w-full h-20 object-cover" />
                                  ) : (
                                    <div className="w-full h-20 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                                      <UtensilsCrossed className="w-5 h-5 text-emerald-300" />
                                    </div>
                                  )}
                                  <div className="p-2 flex flex-col gap-1 flex-1 w-full">
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
                                </button>
                                <div className="grid grid-cols-2 gap-1.5 p-2 pt-0">
                                  <button
                                    type="button"
                                    disabled={!displayBusiness.is_accepting_orders}
                                    onClick={() => handleMenuItemAdd(displayBusiness, item)}
                                    className="min-h-9 rounded-lg bg-[#087F3F] px-1.5 text-[10px] font-semibold text-white hover:bg-[#056B35] disabled:cursor-not-allowed disabled:bg-gray-300"
                                  >
                                    {addedMenuItemId === item.id ? (
                                      <span className="inline-flex items-center justify-center gap-1"><Check className="h-3 w-3" /> Added</span>
                                    ) : (
                                      <span className="inline-flex items-center justify-center gap-1"><ShoppingCart className="h-3 w-3" /> Add to Cart</span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!displayBusiness.is_accepting_orders}
                                    onClick={() => handleMenuItemCheckout(displayBusiness, item)}
                                    className="min-h-9 rounded-lg bg-[#F4B400] px-1.5 text-[10px] font-bold text-[#17201B] hover:bg-[#E0A500] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
                                  >
                                    Checkout
                                  </button>
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
                        <p className="text-3xl font-bold text-gray-900">{Number(displayBusiness.reviews_avg_rating ?? 0) > 0 ? Number(displayBusiness.reviews_avg_rating).toFixed(1) : "No ratings yet"}</p>
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
            </>)}
          </aside>
        )}

        {/* Route Info Panel */}
        {/* Full route card (modes, fare, booking): the whole-route view only. */}
        {routeDistanceKm != null && !navActive && (() => {
          // Distance still to go (shrinks/grows as the tourist moves or is re-routed).
          const routeKm = remainingKm ?? routeDistanceKm
          const activeMode = transportModes.find((m) => m.key === selectedVehicle) ?? transportModes[0]
          const travelTime = calcTravelTime(routeKm, activeMode.speed)
          const fare = calcFare(routeKm, activeMode)
          const fareLabel = activeMode.baseFare === 0
            ? 'Free'
            : activeMode.includedKm > 0
              ? `${activeMode.label} fare: \u20B1${activeMode.baseFare} first ${activeMode.includedKm}km + \u20B1${activeMode.perKm}/km after`
              : `${activeMode.label} fare: \u20B1${activeMode.baseFare} base + \u20B1${activeMode.perKm}/km`

          return (
            <aside className="map-route-card absolute top-2 inset-x-2 z-[650] max-h-[48%] rounded-2xl border border-[#E5E9E7] shadow-lg sm:static sm:inset-auto sm:z-auto sm:max-h-none sm:w-[260px] sm:shrink-0 sm:rounded-none sm:border-0 sm:border-r sm:shadow-none bg-white flex flex-col overflow-y-auto" aria-label="Route">
              <div className="p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3">
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
                    aria-label="Close route"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[#56615B] hover:bg-gray-100 hover:text-gray-800 transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex gap-1.5 overflow-x-auto scrollbar-hide" role="radiogroup" aria-label="Travel mode">
                  {transportModes.map((mode) => {
                    const Icon = mode.icon
                    const isActive = mode.key === selectedVehicle
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => setSelectedVehicle(mode.key)}
                        role="radio"
                        aria-checked={isActive}
                        aria-label={`${mode.label}: ${calcTravelTime(routeKm, mode.speed)}`}
                        className={`map-mode-chip flex-1 min-w-[52px] flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-[10px] font-medium transition-all ${
                          isActive
                            ? 'bg-[#087F3F] text-white shadow-sm'
                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="leading-tight">{calcTravelTime(routeKm, mode.speed)}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Phone: one-line summary instead of the three detail rows */}
                <p className="sm:hidden text-sm text-[#17201B]" aria-live="polite">
                  <span className="font-extrabold">{travelTime}</span>
                  <span className="text-[#56615B]"> · {routeKm.toFixed(1)} km · </span>
                  <span className="font-bold text-[#087F3F]">{activeMode.baseFare === 0 ? 'Free' : `\u20B1${fare.toLocaleString()}`}</span>
                  <span className="text-[#56615B]"> by {activeMode.label}</span>
                </p>

                <div className="hidden sm:flex flex-col gap-3">
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
                    <p className="text-lg font-bold text-[#17201B] leading-tight">{routeKm.toFixed(2)} km</p>
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
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-1 gap-2">

                <button
                  type="button"
                  onClick={() => {
                    if (routeDestination && routeKm != null) {
                      localStorage.setItem('tracktour_pending_booking', JSON.stringify({
                        destination: routeDestination,
                        distanceKm: routeKm,
                        vehicle: selectedVehicle,
                        // Lets Ride Hailing go straight to the pickup step.
                        ...(routeTo ? { lat: routeTo.lat, lng: routeTo.lng } : {}),
                      }))
                    }
                    navigate('/tourist/transport')
                  }}
                  className="sm:mt-1 w-full py-2.5 rounded-xl bg-[#087F3F] text-white text-xs font-semibold hover:bg-[#056B35] transition-colors flex items-center justify-center gap-2"
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
              </div>
            </aside>
          )
        })()}

        {/* Map */}
        <div
          ref={mapAreaRef}
          data-view-mode={navActive ? 'navigation' : 'overview'}
          className="tourist-map-area relative flex-1 min-w-0 min-h-0 overflow-hidden bg-[#f8faf7]"
          style={navActive ? { perspective: `${navPerspective}px` } : undefined}
        >
          {/* View switch, top left of the map, beside the places panel and its
              filters (the category chips are now the panel's Category dropdown). */}
          {/* Ride Hailing map: back to the Ride Hailing page, top left. */}
          {!navActive && mapOnly && (
            <button
              type="button"
              onClick={() => navigate('/tourist/transport')}
              aria-label="Back to Ride Hailing"
              className="absolute top-3 left-3 z-[640] inline-flex h-11 items-center gap-1.5 rounded-full border border-[#E5E9E7] bg-[#fff] pl-2.5 pr-4 text-sm font-semibold text-[#087F3F] shadow-md transition hover:bg-[#E9F7EF]"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              Ride Hailing
            </button>
          )}
          {!navActive && !mapOnly && (
            <div className="absolute top-3 left-3 z-[640] rounded-full shadow-md">
              <ExploreViewToggle
                current="map"
                to={listViewTab ? `/tourist/explore?tab=${listViewTab}` : '/tourist/explore'}
              />
            </div>
          )}
          {/* Navigation card: small, travel-only (no fares or booking): time, distance left, speed. */}
          {navActive && routeDistanceKm != null && (() => {
            const activeMode = transportModes.find((m) => m.key === selectedVehicle) ?? transportModes[0]
            const km = remainingKm ?? routeDistanceKm
            const speedKmh = userSpeed != null ? Math.round(userSpeed * 3.6) : null
            return (
              <aside
                aria-label="Navigation"
                className="map-nav-card absolute top-3 left-3 right-[72px] sm:right-auto sm:w-[320px] z-[650] rounded-2xl bg-white/95 backdrop-blur border border-[#E5E9E7] shadow-lg px-3 py-2"
              >
                {/* Horizontal: Time | Distance | Speed side by side, exit on the right. */}
                <div className="flex items-center gap-2">
                  <dl className="flex-1 min-w-0 grid grid-cols-3 divide-x divide-[#E5E9E7] text-center">
                    <div className="min-w-0 px-1">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#56615B]">Time</dt>
                      <dd className="text-[16px] font-extrabold text-[#087F3F] leading-tight truncate" data-testid="nav-eta">{calcTravelTime(km, activeMode.speed)}</dd>
                    </div>
                    <div className="min-w-0 px-1">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#56615B]">Distance</dt>
                      <dd className="text-[16px] font-extrabold text-[#17201B] leading-tight truncate" data-testid="nav-distance">{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</dd>
                    </div>
                    <div className="min-w-0 px-1">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#56615B]">Speed</dt>
                      <dd className="text-[16px] font-extrabold text-[#17201B] leading-tight truncate" data-testid="nav-speed">{speedKmh != null ? `${speedKmh} km/h` : '—'}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    onClick={() => setNavigating(false)}
                    aria-label="Exit navigation"
                    title="Exit navigation"
                    className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[#56615B] hover:bg-gray-100 hover:text-gray-800 transition-colors"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                {routeDestination && (
                  <p className="mt-1 text-[11px] text-[#56615B] truncate" title={`${routeDestination.name} · by ${activeMode.label}`}>
                    To {routeDestination.name} · by {activeMode.label}
                  </p>
                )}
              </aside>
            )
          })()}
          {/* Map type switcher: picture tile, top right. On phones with an active
              route the route card covers the top, so the tile drops above the sheet.
              Map only (Ride Hailing map): bottom right, above the map credits; on phones
              it moves up while a business's details sheet covers the bottom. */}
          <div
            data-testid="map-controls"
            data-position={mapOnly ? 'bottom' : 'top'}
            className={`absolute right-3 z-[640] flex flex-col items-end gap-2 ${
              mapOnly
                ? routeDistanceKm != null && !navActive
                  ? 'bottom-8 max-sm:bottom-24'
                  : showDetail
                    ? 'bottom-8 max-sm:bottom-auto max-sm:top-3'
                    : 'bottom-8'
                : routeDistanceKm != null && !navActive ? 'top-3 max-sm:top-auto max-sm:bottom-24' : 'top-3'
            }`}
          >
            <MapLayerTile value={activeMapType} onChange={setMapType} />
            {/* Navigation: where north is; tap to face north (again: travel direction). */}
            {navActive && (
              <RiderMapCompass
                bearing={bearing}
                northUp={navFree ? Math.round(bearing) % 360 === 0 : northUp}
                onClick={handleCompass}
                className="map-compass-btn w-12 h-12 rounded-lg border-2 border-white bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] hover:bg-[#F3F8F4]"
              />
            )}
            {/* One view switch, like the rider's: it offers the other view. */}
            {route && (
              <button
                type="button"
                onClick={() => {
                  if (!navActive) requestCompassPermission()
                  setNavigating((v) => !v)
                }}
                aria-label={navActive ? 'Overview' : 'Navigation view'}
                title={navActive ? 'Overview (whole route, north up)' : 'Navigation view (follow me, heading up)'}
                data-current-view={navActive ? 'navigation' : 'overview'}
                className="map-view-toggle w-12 h-12 rounded-lg bg-white border-2 border-white text-[#087F3F] flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.25)] hover:bg-[#F3F8F4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F]"
              >
                {navActive ? <Route className="w-5 h-5" aria-hidden="true" /> : <Navigation2 className="w-5 h-5" aria-hidden="true" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (navActive) {
                  // Back from exploring: follow the tourist again.
                  setNavFree(false)
                  setNavRecenterSignal((n) => n + 1)
                  return
                }
                showMyLocation()
              }}
              aria-label="Show my location"
              title="Show my location"
              aria-pressed={navActive ? !navFree : undefined}
              className={`map-locate-btn w-12 h-12 rounded-lg border-2 flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F] ${
                navActive && !navFree ? 'bg-[#087F3F] border-[#087F3F] text-white' : 'bg-white border-white text-[#087F3F] hover:bg-[#F3F8F4]'
              }`}
            >
              <LocateFixed className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          {/* Rotator: in the navigation view it becomes a square the size of the
              map's diagonal, centred and rotated so the travel direction faces up. */}
          <div
            data-testid="map-rotator"
            data-bearing={Math.round(navActive ? bearing : 0)}
            className={navActive ? `map-rotator map-rotator--nav${navGesturing ? ' map-rotator--gesture' : ''}` : 'map-rotator'}
            style={navActive && rotatorSize > 0
              ? ({
                  width: planeSize,
                  height: planeSize,
                  transform: `translate(-50%, -50%) rotateX(${NAV_TILT_DEG}deg) rotate(${-bearing}deg)`,
                  '--map-bearing': `${bearing}deg`,
                } as React.CSSProperties)
              : undefined}
          >
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
            <MapEventsHandler
              onMapClick={() => {
                if (!panelOpen) return setListCollapsed(true)
                if (route) setSheetCollapsed(true)
                else handleClosePanel()
              }}
            />

            {filteredBusinesses.map((biz) => {
              if (biz.latitude == null || biz.longitude == null) return null
              // The search / municipality hide the other markers (never the place whose details are open).
              if (biz.id !== pinned?.id && !isPlaceVisible(biz)) return null
              return (
                <Marker
                  key={biz.id}
                  position={[biz.latitude, biz.longitude]}
                  icon={markerIconFor(biz, biz.id === pinned?.id || biz.id === listHoverId)}
                  eventHandlers={{
                    click: () => handleBusinessSelect(biz),
                    mouseover: (e) => {
                      if (navActive) return
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
            {markerLocation && (!navActive || navFree) && (
              <Marker
                position={[markerLocation.lat, markerLocation.lng]}
                icon={userMarkerIcon}
                zIndexOffset={10_000}
                interactive={false}
                keyboard={false}
                title="Your location"
              />
            )}
            <CenterOnUserOnce location={userLocation} skip={!!pinned || !!route} />
            <RecenterOnUser location={userLocation} signal={recenterSignal} />
            {!navActive && <FocusPlace target={focusTarget} />}
            {route && routeTo && (
              <RouteOverlay
                route={{ coords: progress?.remaining ?? route, fitCoords: route }}
                destination={{ lat: routeTo.lat, lng: routeTo.lng }}
                fit={!navActive}
              />
            )}
            <NavigationCamera
              active={navActive}
              location={markerLocation}
              bearing={bearing}
              screenOffset={navPlaneOffset}
              recenterSignal={navRecenterSignal}
              freeLook={navFree}
              onFreeLookChange={handleFreeLookChange}
              onBearingChange={setFreeBearing}
              onGestureChange={setNavGesturing}
              screenToPlanePoint={navScreenToPlanePoint}
            />
          </MapContainer>
          </div>
          {navActive && (
            <>
              {/* Soft horizon where the tilted map fades into the distance. */}
              <div aria-hidden="true" className="nav-horizon pointer-events-none absolute inset-x-0 top-0 z-[400] h-[22%]" />
              {/* Following: the tourist is a fixed puck lying on the tilted map, arrow up = travel direction. */}
              {!navFree && <RiderNavPuck offsetX={navScreenOffset.x} offsetY={navScreenOffset.y} />}
            </>
          )}

          {/* Hover Card */}
          <div
            ref={cardRef}
            style={cardStyle}
            data-testid="map-hover-card"
            aria-hidden={!hover}
            // While fading out the card still shows the last business: make it non-interactive.
            inert={!hover}
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
            className={`absolute z-[650] w-64 ${
              hover ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <div className="relative bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.35)] ring-1 ring-[#E5E9E7] h-[240px] overflow-hidden flex flex-col">
              <div className="relative w-full h-[60%] shrink-0 group">
                {shownHover?.b.category && (
                  <span className="absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-[#064E2E] text-[11px] font-semibold shadow-sm">
                    {shownHover.b.category.name}
                  </span>
                )}
                {currentImage ? (
                  <img src={toAssetUrl(currentImage)} alt={shownHover?.b.name ?? ''} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-amber-300 to-yellow-500" />
                )}
                {shownHover && cardImages.length > 1 && (
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
                    <p className="font-semibold text-gray-900 text-sm leading-snug truncate" title={shownHover?.b.name ?? ''}>
                      {shownHover?.b.name ?? 'Business name'}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                      {Number(shownHover?.b.reviews_avg_rating ?? 0) > 0 ? (
                        <>
                          <Star className="w-3.5 h-3.5 fill-[#F4B400] text-[#F4B400]" />
                          <span className="font-semibold text-gray-900">{Number(shownHover?.b.reviews_avg_rating).toFixed(1)}</span>
                          {shownHover?.b.reviews_count ? <span className="text-gray-500">({shownHover.b.reviews_count})</span> : null}
                        </>
                      ) : (
                        <span>No ratings yet</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    {shownHover && (
                      <button
                        type="button"
                        onClick={() => handleDirections(shownHover.b, { navigate: true })}
                        className="w-10 h-10 rounded-full bg-[#087F3F] text-white flex items-center justify-center pointer-events-auto shadow hover:bg-[#056B35] transition-colors"
                        aria-label="Navigate"
                        title="Navigate"
                      >
                        <Navigation className="w-5 h-5 fill-current" aria-hidden="true" />
                      </button>
                    )}
                    {shownHover && (
                      <button
                        type="button"
                        onClick={() => handleDirections(shownHover.b)}
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
                  <MapPin className="w-3.5 h-3.5 text-[#087F3F]" /> {typeof shownHover?.b.municipality === 'object' ? (shownHover?.b.municipality as { name: string })?.name : shownHover?.b.municipality ?? 'Oriental Mindoro'}
                </p>
              </div>
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
