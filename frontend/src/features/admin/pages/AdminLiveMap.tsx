import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Layers, List, Locate, RefreshCw, X, ZoomIn, ZoomOut } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { get } from '@/shared/services/api'
import { cn, getInitials, toAssetUrl } from '@/shared/utils'
import LiveMapPanel, { type RiderFilter, type TownRow } from '@/features/admin/live-map/LiveMapPanel'
import { useOfficePortal } from '@/features/admin/office-portal'
import RiderRouteLayer from '@/features/admin/live-map/RiderRouteLayer'
import { municipalityIcon, riderIcon, sosRadarIcon, touristIcon } from '@/features/admin/live-map/icons'
import { beachPinIcon, businessLogoIcon, pinIcon } from '@/shared/utils/pin-icon'
import { isTouristAttractionCategory } from '@/shared/utils/category'
import {
  routeWaypoints, sosPoint,
  type BusinessPin, type LiveRider, type LiveTourist, type MunicipalityPin, type PanelTab, type Selection, type SosPin,
} from '@/features/admin/live-map/types'

const ORIENTAL_MINDORO_CENTER: L.LatLngTuple = [12.8667, 121.45]
/** A GPS fix older than this is drawn faded: the rider's app may be closed. */
const STALE_MS = 10 * 60 * 1000
/** Below this zoom the map shows one marker per town (municipality) with a count. */
const TOWN_ZOOM = 12
/** Zoom used when a town is opened: the whole municipality centre in view. */
const TOWN_VIEW_ZOOM = 13

type BaseLayer = 'streets' | 'satellite' | 'dark'

const ctrlBtn = 'flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E8E3] bg-white text-[#6B7280] shadow-sm transition-colors hover:text-[#16803C]'

function MapControls({ live, onLive, refreshing, onRefresh, onWholeMindoro }: { live: boolean; onLive: () => void; refreshing: boolean; onRefresh: () => void; onWholeMindoro: () => void }) {
  const map = useMap()
  return (
    <div className="absolute bottom-6 right-4 z-[1000] flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={onLive}
        className={cn('rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm transition', live ? 'border-[#D7E8DB] bg-[#EAF6ED] text-[#16803C]' : 'border-[#E2E8E3] bg-white text-[#6B7280]')}
        aria-pressed={live}
      >
        <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full', live ? 'animate-pulse bg-[#16A34A]' : 'bg-[#9CA3AF]')} />
        {live ? 'Live' : 'Paused'}
      </button>
      <button type="button" onClick={onRefresh} className={ctrlBtn} aria-label="Refresh"><RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} /></button>
      <button type="button" onClick={() => map.zoomIn()} className={ctrlBtn} aria-label="Zoom in"><ZoomIn className="h-5 w-5" /></button>
      <button type="button" onClick={() => map.zoomOut()} className={ctrlBtn} aria-label="Zoom out"><ZoomOut className="h-5 w-5" /></button>
      <button type="button" onClick={onWholeMindoro} className={ctrlBtn} aria-label="Show all of Oriental Mindoro" title="Show all towns"><Locate className="h-5 w-5" /></button>
    </div>
  )
}

/**
 * Business marker: the same design as the tourist map. A place with a photo
 * (logo, else cover) gets the round photo pin with its name; an attraction
 * without a photo gets the beach pin; anything else the labelled red pin.
 */
function businessMarkerIcon(b: BusinessPin, selected: boolean): L.DivIcon {
  const photo = b.logo || b.cover_photo
  if (photo) return businessLogoIcon(toAssetUrl(photo), b.name, selected)
  if (isTouristAttractionCategory(b.category)) return beachPinIcon
  return pinIcon(b.name, selected)
}

/** Points of every town with coordinates: the "whole Mindoro" view. */
function townPoints(towns: MunicipalityPin[]): [number, number][] {
  return towns.filter((t) => t.lat !== null && t.lng !== null).map((t) => [t.lat!, t.lng!])
}

/**
 * Default view: all towns in frame (zoomed out, so town markers show). A
 * municipal office's map has only its own town: open on it at street level.
 */
function FitWholeMindoro({ towns }: { towns: MunicipalityPin[] }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    const pts = townPoints(towns)
    if (pts.length === 0 || fitted.current) return
    if (pts.length === 1) map.setView(pts[0]!, TOWN_VIEW_ZOOM)
    else map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: TOWN_ZOOM - 2 })
    fitted.current = true
  }, [towns, map])
  return null
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
  useEffect(() => { onZoom(map.getZoom()) }, [map, onZoom])
  return null
}

/** Flies to the selection once per selection (a rider's whole route when on a trip). */
function FocusSelection({ target }: { target: { key: string; points: [number, number][] } | null }) {
  const map = useMap()
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    if (!target) { lastKey.current = null; return }
    if (target.key === lastKey.current || target.points.length === 0) return
    lastKey.current = target.key
    if (target.points.length === 1) map.flyTo(target.points[0]!, Math.max(map.getZoom(), 15), { duration: 0.8 })
    else map.flyToBounds(L.latLngBounds(target.points), { padding: [60, 60], maxZoom: 16, duration: 0.8 })
  }, [target, map])
  return null
}

/** Leaflet needs a size recalculation when the panel opens/closes on small screens. */
function InvalidateOnChange({ dep }: { dep: unknown }) {
  const map = useMap()
  useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 200); return () => clearTimeout(t) }, [dep, map])
  return null
}

export default function AdminLiveMap() {
  const [tab, setTab] = useState<PanelTab>('businesses')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [municipality, setMunicipality] = useState('')
  const [riderFilter, setRiderFilter] = useState<RiderFilter>('all')
  const [selection, setSelection] = useState<Selection>(null)
  const [live, setLive] = useState(true)
  const [layersOpen, setLayersOpen] = useState(false)
  const [baseLayer, setBaseLayer] = useState<BaseLayer>('streets')
  const [panelOpen, setPanelOpen] = useState(true)
  const [zoom, setZoom] = useState(10)
  const [map, setMap] = useState<L.Map | null>(null)
  // Bansud: /admin (district-wide). Municipal office: /municipal (its own town).
  const portal = useOfficePortal()

  const businessesQ = useQuery({
    queryKey: ['admin-live-map', portal.api, 'businesses'],
    queryFn: () => get<{ businesses: BusinessPin[]; municipalities?: MunicipalityPin[] }>(`${portal.api}/map-data`),
    refetchInterval: live ? 60_000 : false,
  })
  const ridersQ = useQuery({
    queryKey: ['admin-live-map', portal.api, 'riders'],
    queryFn: () => get<LiveRider[]>(`${portal.api}/live/riders`),
    // Riders report GPS about every 5 seconds while on duty.
    refetchInterval: live ? (tab === 'riders' ? 5_000 : 15_000) : false,
  })
  // Plan Stage 3: a municipal office sees its own town's SOS alerts; Bansud sees all.
  const sosQ = useQuery({
    queryKey: ['admin-live-map', portal.api, 'sos'],
    queryFn: () => get<{ data: SosPin[] }>(`${portal.api}/live/sos`, { params: { filter: 'active' } }),
    refetchInterval: live ? 10_000 : false,
  })

  const touristsQ = useQuery({
    queryKey: ['admin-live-map', portal.api, 'tourists'],
    queryFn: () => get<LiveTourist[]>(`${portal.api}/live/tourists`),
    // Tourists who opted in report about every 30 seconds.
    refetchInterval: live ? (tab === 'tourists' ? 15_000 : 30_000) : false,
  })

  const allBusinesses = businessesQ.data?.businesses ?? []
  const towns = useMemo(() => businessesQ.data?.municipalities ?? [], [businessesQ.data])
  const allRiders = useMemo(() => (Array.isArray(ridersQ.data) ? ridersQ.data : []), [ridersQ.data])
  const allSos = useMemo(() => (Array.isArray(sosQ.data?.data) ? sosQ.data!.data : []), [sosQ.data])
  // Tourists carry no municipality: place each one in the nearest town centre.
  const allTourists = useMemo(() => {
    const list = Array.isArray(touristsQ.data) ? touristsQ.data : []
    const centres = towns.filter((t) => t.lat !== null && t.lng !== null)
    return list.map((t) => {
      let best: string | null = null
      let bestD = Infinity
      for (const c of centres) {
        const d = (c.lat! - t.location.lat) ** 2 + ((c.lng! - t.location.lng) * Math.cos((t.location.lat * Math.PI) / 180)) ** 2
        if (d < bestD) { bestD = d; best = c.name }
      }
      return { ...t, municipality: best }
    })
  }, [touristsQ.data, towns])

  const categories = useMemo(() => [...new Set(allBusinesses.map((b) => b.category).filter((c): c is string => !!c))].sort(), [allBusinesses])

  const q = search.trim().toLowerCase()
  const matches = (...values: (string | null | undefined)[]) => !q || values.some((v) => v?.toLowerCase().includes(q))

  const businesses = useMemo(() => allBusinesses.filter((b) =>
    (!category || b.category === category)
    && (!municipality || b.municipality === municipality)
    && matches(b.name, b.category, b.address, b.municipality),
  ), [allBusinesses, category, municipality, q])

  const ridersInScope = useMemo(() => allRiders.filter((r) =>
    (!municipality || r.municipality === municipality)
    && matches(r.name, r.plate_number, r.phone, r.trip?.order_number, r.trip?.customer_name),
  ), [allRiders, municipality, q])
  const riders = useMemo(() => ridersInScope.filter((r) => riderFilter === 'all' || r.activity === riderFilter), [ridersInScope, riderFilter])
  const riderCounts = useMemo(() => {
    const c: Record<RiderFilter, number> = { all: ridersInScope.length, available: 0, busy: 0, delivering: 0, transporting: 0 }
    for (const r of ridersInScope) c[r.activity] += 1
    return c
  }, [ridersInScope])

  const tourists = useMemo(() => allTourists.filter((t) =>
    (!municipality || t.municipality === municipality) && matches(t.name, t.phone, t.municipality),
  ), [allTourists, municipality, q])

  // Per-town counts for the town markers: same filters as the list, minus the town.
  const townCounts = useMemo(() => {
    const counts = new Map<string, number>()
    const add = (m: string | null) => { if (m) counts.set(m, (counts.get(m) ?? 0) + 1) }
    if (tab === 'businesses') {
      for (const b of allBusinesses) if ((!category || b.category === category) && matches(b.name, b.category, b.address, b.municipality)) add(b.municipality)
    } else if (tab === 'riders') {
      for (const r of allRiders) if ((riderFilter === 'all' || r.activity === riderFilter) && matches(r.name, r.plate_number, r.phone, r.trip?.order_number, r.trip?.customer_name)) add(r.municipality)
    } else {
      for (const t of allTourists) if (matches(t.name, t.phone, t.municipality)) add(t.municipality ?? null)
    }
    return counts
  }, [tab, allBusinesses, allRiders, allTourists, category, riderFilter, q])

  // Category chips: counts within the current town and search.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of allBusinesses) {
      if (!b.category) continue
      if (municipality && b.municipality !== municipality) continue
      if (!matches(b.name, b.category, b.address, b.municipality)) continue
      counts.set(b.category, (counts.get(b.category) ?? 0) + 1)
    }
    return categories.map((name) => ({ name, count: counts.get(name) ?? 0 }))
  }, [allBusinesses, categories, municipality, q])

  const townRows: TownRow[] = useMemo(
    () => towns.map((t) => ({ name: t.name, logo: t.logo, count: townCounts.get(t.name) ?? 0 })),
    [towns, townCounts],
  )

  // SOS alerts are never filtered: every active one stays on the map.
  const sos = allSos
  /** Riders who pressed SOS themselves → their open alert. */
  const riderSos = useMemo(() => {
    const m = new Map<number, SosPin>()
    for (const s of allSos) if (s.raised_by_role === 'rider' && s.rider_id) m.set(s.rider_id, s)
    return m
  }, [allSos])

  const fitWholeMindoro = () => {
    const pts = townPoints(towns)
    if (map && pts.length) map.flyToBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: TOWN_ZOOM - 2, duration: 0.8 })
  }
  const showWholeMindoro = () => { setMunicipality(''); setSelection(null); fitWholeMindoro() }

  /**
   * Zoom to a town and filter the panel to it. The view centres on the
   * municipality's own coordinates (the town, not one of its businesses);
   * only a town without coordinates falls back to framing its items.
   */
  const goToTown = (name: string) => {
    setMunicipality(name)
    setSelection(null)
    setPanelOpen(true)
    if (!map) return
    const town = towns.find((t) => t.name === name)
    if (town && town.lat !== null && town.lng !== null) {
      map.flyTo([town.lat, town.lng], TOWN_VIEW_ZOOM, { duration: 0.9 })
      return
    }
    const pts: [number, number][] = tab === 'riders'
      ? allRiders.filter((r) => r.municipality === name && r.location).map((r) => [r.location!.lat, r.location!.lng])
      : tab === 'tourists'
        ? allTourists.filter((t) => t.municipality === name).map((t) => [t.location.lat, t.location.lng])
        : allBusinesses.filter((b) => b.municipality === name).map((b) => [b.lat, b.lng])
    if (pts.length) map.flyToBounds(L.latLngBounds(pts), { padding: [80, 80], maxZoom: TOWN_VIEW_ZOOM, duration: 0.9 })
  }
  const chooseMunicipality = (name: string) => (name ? goToTown(name) : showWholeMindoro())

  const changeTab = (t: PanelTab) => { setTab(t); setSelection(null); setSearch('') }
  const select = (s: Selection) => {
    setSelection(s)
    // An SOS marker opens its detail without changing the Places / Riders view.
    if (s && s.kind !== 'sos') setTab(s.kind === 'business' ? 'businesses' : s.kind === 'tourist' ? 'tourists' : 'riders')
    if (s) setPanelOpen(true)
  }

  const selectedRider = selection?.kind === 'rider' ? allRiders.find((r) => r.id === selection.id) : undefined
  const focusTarget = useMemo(() => {
    if (!selection) return null
    if (selection.kind === 'business') {
      const b = allBusinesses.find((x) => x.id === selection.id)
      return b ? { key: `b${b.id}`, points: [[b.lat, b.lng]] as [number, number][] } : null
    }
    if (selection.kind === 'sos') {
      const s = allSos.find((x) => x.id === selection.id)
      const p = s ? sosPoint(s) : null
      return p ? { key: `s${selection.id}`, points: [p] } : null
    }
    if (selection.kind === 'tourist') {
      const t = allTourists.find((x) => x.id === selection.id)
      return t ? { key: `t${t.id}`, points: [[t.location.lat, t.location.lng]] as [number, number][] } : null
    }
    if (!selectedRider) return null
    const pts = selectedRider.trip ? routeWaypoints(selectedRider) : selectedRider.location ? [[selectedRider.location.lat, selectedRider.location.lng] as [number, number]] : []
    return { key: `r${selectedRider.id}`, points: pts }
  }, [selection, allBusinesses, allSos, allTourists, selectedRider])

  const refreshing = businessesQ.isFetching || ridersQ.isFetching || sosQ.isFetching || touristsQ.isFetching
  const refresh = () => { void businessesQ.refetch(); void ridersQ.refetch(); void sosQ.refetch(); void touristsQ.refetch() }
  const loading = businessesQ.isLoading || ridersQ.isLoading || sosQ.isLoading || touristsQ.isLoading

  const showRiders = tab === 'riders'
  const showBusinesses = tab === 'businesses'
  const showTourists = tab === 'tourists'
  const showTowns = zoom < TOWN_ZOOM

  return (
    // isolate: keeps Leaflet's panes (z 400+) and the map controls (z-[1000]) inside this page,
    // so the admin header's account menu (Office Profile, Logout) opens above the map.
    <div className="relative isolate -m-4 flex h-[calc(100vh-8rem)] overflow-hidden sm:-m-6 lg:-m-8">
      <style>{`
        .leaflet-control-zoom { display: none !important; }
        .admin-live-rider, .admin-live-stop, .admin-live-business, .admin-live-sos, .admin-live-town, .admin-live-tourist { background: transparent; border: 0; }
        .sos-radar { position:relative; width:120px; height:120px; pointer-events:none; }
        .sos-radar span { position:absolute; left:50%; top:50%; width:120px; height:120px; margin:-60px 0 0 -60px; border-radius:50%; border:3px solid var(--c); background:color-mix(in srgb, var(--c) 18%, transparent); opacity:0; animation: sosRadar 2.4s ease-out infinite; }
        .sos-radar span:nth-child(2) { animation-delay:.8s } .sos-radar span:nth-child(3) { animation-delay:1.6s }
        .sos-radar b { pointer-events:auto; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:38px; height:38px; border-radius:50%; background:var(--c); color:#fff; border:3px solid #fff; box-shadow:0 0 0 4px color-mix(in srgb, var(--c) 35%, transparent), 0 4px 12px rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; font:800 10px/1 Poppins, system-ui, sans-serif; letter-spacing:.04em; }
        @keyframes sosRadar { 0% { transform:scale(.15); opacity:.9 } 100% { transform:scale(1); opacity:0 } }
      `}</style>

      {/* Left panel */}
      <aside
        className={cn(
          'z-[1100] w-[380px] max-w-[90vw] shrink-0 border-r border-[#E7E2D6] bg-[#FAF7F0]',
          'absolute inset-y-0 left-0 shadow-xl transition-transform lg:static lg:shadow-none',
          panelOpen ? 'translate-x-0' : '-translate-x-full lg:hidden',
        )}
      >
        <LiveMapPanel
          tab={tab} onTab={changeTab}
          search={search} onSearch={setSearch}
          category={category} onCategory={setCategory} categories={categoryCounts}
          municipality={municipality} onMunicipality={chooseMunicipality} towns={townRows}
          riderFilter={riderFilter} onRiderFilter={setRiderFilter}
          businesses={businesses} riders={riders} sos={sos} tourists={tourists}
          counts={{ businesses: allBusinesses.length, riders: allRiders.length, tourists: allTourists.length }}
          riderCounts={riderCounts}
          selection={selection} onSelect={select}
          loading={loading}
        />
        <button type="button" onClick={() => setPanelOpen(false)} className="absolute right-2 top-2 rounded-lg p-1.5 text-[#6B7280] hover:bg-white lg:hidden" aria-label="Close panel">
          <X className="h-4 w-4" />
        </button>
      </aside>

      {/* Map */}
      <div className="relative min-w-0 flex-1">
        <MapContainer ref={setMap} center={ORIENTAL_MINDORO_CENTER} zoom={10} minZoom={7} className={cn('h-full w-full', baseLayer === 'dark' && 'map-dark-blue')} zoomControl={false} attributionControl={false} scrollWheelZoom wheelPxPerZoomLevel={100} wheelDebounceTime={80} zoomSnap={0.5} zoomDelta={1}>
          <FitWholeMindoro towns={towns} />
          <ZoomWatcher onZoom={setZoom} />
          <FocusSelection target={focusTarget} />
          <InvalidateOnChange dep={panelOpen} />
          {baseLayer === 'streets' && <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={22} />}
          {/* Esri imagery over Bansud stops at zoom 18. */}
          {baseLayer === 'satellite' && <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={18} maxZoom={22} />}
          {baseLayer === 'dark' && <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" maxNativeZoom={19} maxZoom={22} />}

          <MapControls live={live} onLive={() => setLive((v) => !v)} refreshing={refreshing} onRefresh={refresh} onWholeMindoro={showWholeMindoro} />

          {showTowns && towns.map((t) => (t.lat === null || t.lng === null ? null : (
            <Marker
              key={`town-${t.id}`}
              position={[t.lat, t.lng]}
              icon={municipalityIcon({ name: t.name, logo: t.logo ? toAssetUrl(t.logo) : null, count: townCounts.get(t.name) ?? 0, selected: municipality === t.name })}
              eventHandlers={{ click: () => goToTown(t.name) }}
              zIndexOffset={municipality === t.name ? 300 : 0}
            >
              <Tooltip direction="top" offset={[0, -24]}>
                {t.name}: {townCounts.get(t.name) ?? 0} {tab === 'riders' ? 'riders on duty' : 'businesses'} (click to zoom in)
              </Tooltip>
            </Marker>
          )))}

          {showBusinesses && businesses.map((b) => {
            const selected = selection?.kind === 'business' && selection.id === b.id
            if (showTowns && !selected) return null
            return (
              <Marker key={`b-${b.id}`} position={[b.lat, b.lng]} icon={businessMarkerIcon(b, selected)} zIndexOffset={selected ? 500 : 0}
                eventHandlers={{ click: () => select({ kind: 'business', id: b.id }) }}>
              </Marker>
            )
          })}

          {/* A route only for the rider you select, and only while on a trip. */}
          {showRiders && selectedRider?.trip && (
            <RiderRouteLayer key={`route-${selectedRider.id}-${selectedRider.trip.id}`} rider={selectedRider} selected />
          )}
          {showRiders && riders.map((r) => {
            if (!r.location || riderSos.has(r.id)) return null
            const selected = selection?.kind === 'rider' && selection.id === r.id
            if (showTowns && !selected) return null
            const stale = !r.location.at || Date.now() - new Date(r.location.at).getTime() > STALE_MS
            return (
              <Marker
                key={`r-${r.id}`}
                position={[r.location.lat, r.location.lng]}
                icon={riderIcon({ photo: r.photo ? toAssetUrl(r.photo) : null, initials: getInitials(r.name), activity: r.activity, name: r.name, selected, stale })}
                zIndexOffset={selected ? 1000 : 200}
                eventHandlers={{ click: () => select({ kind: 'rider', id: r.id }) }}
              >
                {!selected && <Tooltip direction="top" offset={[0, -20]}>{r.name}</Tooltip>}
              </Marker>
            )
          })}

          {showTourists && tourists.map((t) => {
            const selected = selection?.kind === 'tourist' && selection.id === t.id
            if (showTowns && !selected) return null
            return (
              <Marker
                key={`t-${t.id}`}
                position={[t.location.lat, t.location.lng]}
                icon={touristIcon({ photo: t.photo ? toAssetUrl(t.photo) : null, initials: getInitials(t.name ?? undefined), name: t.name ?? 'Tourist', selected })}
                zIndexOffset={selected ? 1000 : 150}
                eventHandlers={{ click: () => select({ kind: 'tourist', id: t.id }) }}
              >
                {!selected && <Tooltip direction="top" offset={[0, -18]}>{t.name ?? 'Tourist'}</Tooltip>}
              </Marker>
            )
          })}

          {/* A rider who pressed SOS: their own marker with red radar waves, on every tab and zoom. */}
          {allRiders.map((r) => {
            if (!r.location || !riderSos.has(r.id)) return null
            const alert = riderSos.get(r.id)!
            const selected = selection?.kind === 'rider' && selection.id === r.id
            return (
              <Marker
                key={`r-sos-${r.id}`}
                position={[r.location.lat, r.location.lng]}
                icon={riderIcon({ photo: r.photo ? toAssetUrl(r.photo) : null, initials: getInitials(r.name), activity: r.activity, name: r.name, selected, stale: false, sos: true })}
                zIndexOffset={3000}
                eventHandlers={{ click: () => select({ kind: 'rider', id: r.id }) }}
              >
                <Tooltip direction="top" offset={[0, -26]}>SOS {alert.reference} · rider {r.name}</Tooltip>
              </Marker>
            )
          })}

          {/* SOS radar stays visible on every tab: an emergency must never be filtered away.
              A tourist's SOS is pinned on the tourist; a rider's SOS is drawn on the rider marker above
              (this pin is only its fallback when that rider has no GPS position). */}
          {allSos.map((s) => {
            if (s.raised_by_role === 'rider' && s.rider_id && allRiders.some((r) => r.id === s.rider_id && r.location)) return null
            const p = sosPoint(s)
            if (!p) return null
            return (
              <Marker key={`sos-${s.id}`} position={p} icon={sosRadarIcon(s.status === 'pending')} zIndexOffset={2000}
                eventHandlers={{ click: () => select({ kind: 'sos', id: s.id }) }}>
                <Tooltip direction="top" offset={[0, -22]}>SOS {s.reference} · {s.reporter.name ?? 'Unknown'}</Tooltip>
              </Marker>
            )
          })}
        </MapContainer>

        {!panelOpen && (
          <button type="button" onClick={() => setPanelOpen(true)} className="absolute left-4 top-4 z-[1000] flex items-center gap-2 rounded-xl border border-[#E2E8E3] bg-white px-3.5 py-2.5 text-sm font-semibold text-[#17201A] shadow-sm">
            <List className="h-4 w-4 text-[#16803C]" /> Show list
          </button>
        )}
        {panelOpen && (
          <button type="button" onClick={() => setPanelOpen(false)} className="absolute left-4 top-4 z-[1000] hidden items-center gap-2 rounded-xl border border-[#E2E8E3] bg-white px-3 py-2 text-xs font-semibold text-[#374151] shadow-sm lg:flex" aria-label="Hide panel">
            <X className="h-3.5 w-3.5" /> Hide list
          </button>
        )}

        {/* Base layer */}
        <div className="absolute bottom-6 left-4 z-[1000]">
          <div className="overflow-hidden rounded-xl border border-[#E2E8E3] bg-white shadow-sm">
            <button type="button" onClick={() => setLayersOpen(!layersOpen)} className="flex w-full items-center gap-2 px-4 py-2.5 hover:bg-[#F9FAFB]">
              <Layers className="h-4 w-4 text-[#6B7280]" />
              <span className="text-sm font-medium text-[#17201A]">Layers</span>
              <ChevronDown className={cn('h-4 w-4 text-[#6B7280] transition-transform', layersOpen && 'rotate-180')} />
            </button>
            {layersOpen && (
              <div className="flex gap-2 border-t border-[#E2E8E3] px-4 py-3">
                {(['streets', 'satellite', 'dark'] as const).map((l) => (
                  <button key={l} type="button" onClick={() => setBaseLayer(l)} className={cn('rounded px-3 py-1 text-sm capitalize', baseLayer === l ? 'bg-[#16803C] text-white' : 'text-[#6B7280] hover:bg-[#F9FAFB]')}>{l}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Legend (riders view) */}
        {showRiders && (
          <div className="absolute left-1/2 top-4 z-[1000] hidden -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-[#E2E8E3] bg-white/95 px-4 py-2 text-[11px] font-medium text-[#374151] shadow-sm md:flex">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#16A34A]" />Online</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#EA580C]" />Delivering</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2563EB]" />Transporting</span>
            <span className="whitespace-nowrap text-[#6B7280]">Select a rider to see the route</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#DC2626]" />SOS</span>
          </div>
        )}
      </div>
    </div>
  )
}
