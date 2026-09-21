import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import {
  RefreshCw, Building2, Navigation, Truck, Search, Layers,
  CircleDot, ChevronDown, X, Locate, ZoomIn, ZoomOut
} from 'lucide-react'
import { get } from '@/shared/services/api'
import { cn } from '@/shared/utils'
import { pinIcon } from '@/shared/utils/pin-icon'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const ORIENTAL_MINDORO_CENTER: L.LatLngTuple = [12.8667, 121.4500]

interface BusinessPin {
  id: number; name: string; lat: number; lng: number
  address: string; category: string | null; status: string
}
interface DeliveryRoute {
  id: number; status: string; status_label: string; rider_id: number
  pickup: { lat: number; lng: number; address: string }
  delivery: { lat: number; lng: number; address: string }
  assigned_at: string | null
}
interface RiderPos {
  rider_id: number; lat: number; lng: number; recorded_at: string
}
interface MapData {
  businesses: BusinessPin[]
  active_deliveries: DeliveryRoute[]
  rider_locations: RiderPos[]
}

function createFlagIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
    html: `
      <div style="position:relative;width:28px;height:34px;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.3))">
        <svg viewBox="0 0 28 34" width="28" height="34">
          <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 20 14 20s14-9.5 14-20C28 6.3 21.7 0 14 0z" fill="${color}"/>
          <circle cx="14" cy="14" r="7" fill="white" opacity="0.3"/>
        </svg>
        <div style="position:absolute;top:6px;left:50%;transform:translateX(-50%);font-size:8px;font-weight:700;color:white;text-align:center;pointer-events:none;white-space:nowrap">${label}</div>
      </div>
    `,
  })
}

function createRiderIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
    html: `
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#16803C,#126B32);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;animation:pulse-ring 2s ease-in-out infinite">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
    `,
  })
}

const STATUS_COLORS: Record<string, string> = {
  assigned: '#f59e0b', en_route_pickup: '#f97316', arrived_pickup: '#eab308',
  tour_started: '#10b981', en_route_destination: '#06b6d4', arrived_destination: '#8b5cf6',
  waiting: '#9ca3af',
}

const pickupIcon = createFlagIcon('#f59e0b', 'P')
const destIcon = createFlagIcon('#f97316', 'D')
const riderIcon = createRiderIcon()

function MapControls() {
  const map = useMap()
  return (
    <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-1.5">
      <button onClick={() => map.zoomIn()} className="w-10 h-10 bg-white rounded-lg flex items-center justify-center transition-colors text-[#6B7280] hover:text-[#16803C] border border-[#E2E8E3] shadow-sm">
        <ZoomIn className="w-5 h-5" />
      </button>
      <button onClick={() => map.zoomOut()} className="w-10 h-10 bg-white rounded-lg flex items-center justify-center transition-colors text-[#6B7280] hover:text-[#16803C] border border-[#E2E8E3] shadow-sm">
        <ZoomOut className="w-5 h-5" />
      </button>
      <button onClick={() => map.setView(ORIENTAL_MINDORO_CENTER, 10)} className="w-10 h-10 bg-white rounded-lg flex items-center justify-center transition-colors text-[#6B7280] hover:text-[#16803C] border border-[#E2E8E3] shadow-sm">
        <Locate className="w-5 h-5" />
      </button>
    </div>
  )
}

function PopupCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-0 text-sm', className)}>{children}</div>
}

export default function AdminLiveMap() {
  const [data, setData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBusinesses, setShowBusinesses] = useState(true)
  const [showDeliveries, setShowDeliveries] = useState(true)
  const [showRiders, setShowRiders] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [layersOpen, setLayersOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [baseLayer, setBaseLayer] = useState<'streets'|'satellite'|'dark'>('streets')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const result = await get<MapData>('/admin/map-data')
      setData(result)
    } catch (err) {
      console.error('Failed to fetch map data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (autoRefresh) intervalRef.current = setInterval(fetchData, 30000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, fetchData])

  const filteredBusinesses = useMemo(() => {
    if (!data) return []
    if (!search) return data.businesses
    const q = search.toLowerCase()
    return data.businesses.filter(
      (b) => b.name.toLowerCase().includes(q) || b.category?.toLowerCase().includes(q) || b.address.toLowerCase().includes(q)
    )
  }, [data, search])

  return (
    <div className="relative h-[calc(100vh-8rem)] -m-4 sm:-m-6 lg:-m-8 overflow-hidden">
      <style>{`
        .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important; border: 1px solid #E2E8E3 !important; padding: 0 !important; background: white !important; }
        .leaflet-popup-content { margin: 0 !important; min-width: 200px !important; color: #17201A !important; }
        .leaflet-popup-tip { box-shadow: none !important; border: 1px solid #E2E8E3 !important; background: white !important; }
        .leaflet-popup-close-button { color: #9CA3AF !important; font-size: 18px !important; padding: 6px 8px !important; }
        .leaflet-popup-close-button:hover { color: #16803C !important; }
        .leaflet-control-zoom { display: none !important; }
        @keyframes pulse-ring { 0%, 100% { box-shadow: 0 0 0 0 rgba(21,128,61,0.4); } 50% { box-shadow: 0 0 0 8px rgba(21,128,61,0); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fadeInUp 0.2s ease-out forwards; }
      `}</style>

      {/* Map */}
      <MapContainer center={ORIENTAL_MINDORO_CENTER} zoom={11} minZoom={7} className={`h-full w-full ${baseLayer === 'dark' ? 'map-dark-blue' : ''}`} zoomControl={false} attributionControl={false} wheelPxPerZoomLevel={250}>
        {baseLayer === 'streets' && (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxNativeZoom={19}
            maxZoom={22}
          />
        )}

        {baseLayer === 'satellite' && (
          <TileLayer
            attribution='&copy; Esri'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxNativeZoom={19}
            maxZoom={22}
          />
        )}

        {baseLayer === 'dark' && (
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            maxNativeZoom={19}
            maxZoom={22}
          />
        )}
        <MapControls />

        {showBusinesses && filteredBusinesses.map((biz) => (
          <Marker key={`biz-${biz.id}`} position={[biz.lat, biz.lng]} icon={pinIcon(biz.name)}>
            <Popup>
              <PopupCard>
                <div>
                  <div className="px-4 pt-3 pb-2 border-b border-[#E2E8E3]">
                    <p className="font-semibold text-[#17201A] text-sm">{biz.name}</p>
                    {biz.category && <p className="text-xs text-[#16803C] mt-0.5">{biz.category}</p>}
                  </div>
                  <div className="px-4 py-2.5">
                    <p className="text-xs text-[#6B7280] leading-relaxed">{biz.address}</p>
                  </div>
                </div>
              </PopupCard>
            </Popup>
          </Marker>
        ))}

        {showDeliveries && data?.active_deliveries.map((d) => (
          <Marker key={`dp-${d.id}`} position={[d.pickup.lat, d.pickup.lng]} icon={pickupIcon}>
            <Popup>
              <PopupCard>
                <div>
                  <div className="px-4 pt-3 pb-2 border-b border-[#E2E8E3]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.status] || '#9ca3af' }} />
                      <p className="font-semibold text-[#17201A] text-sm">Delivery #{d.id}</p>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: STATUS_COLORS[d.status] }}>{d.status_label}</p>
                  </div>
                  <div className="px-4 py-2.5 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#FFF7D6] flex items-center justify-center text-[#D97706] text-[9px] font-bold shrink-0 mt-0.5">P</span>
                      <p className="text-xs text-[#6B7280]">{d.pickup.address}</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#FFF7D6] flex items-center justify-center text-[#D97706] text-[9px] font-bold shrink-0 mt-0.5">D</span>
                      <p className="text-xs text-[#6B7280]">{d.delivery.address}</p>
                    </div>
                  </div>
                </div>
              </PopupCard>
            </Popup>
          </Marker>
        ))}

        {showDeliveries && data?.active_deliveries.map((d) => (
          <Marker key={`dd-${d.id}`} position={[d.delivery.lat, d.delivery.lng]} icon={destIcon}>
            <Popup>
              <PopupCard>
                <div>
                  <div className="px-4 pt-3 pb-2 border-b border-[#E2E8E3]">
                    <p className="font-semibold text-[#17201A] text-sm">Delivery #{d.id} Destination</p>
                  </div>
                  <div className="px-4 py-2.5">
                    <p className="text-xs text-[#6B7280]">{d.delivery.address}</p>
                  </div>
                </div>
              </PopupCard>
            </Popup>
          </Marker>
        ))}

        {showDeliveries && data?.active_deliveries.map((d) => (
          <Polyline
            key={`line-${d.id}`}
            positions={[[d.pickup.lat, d.pickup.lng], [d.delivery.lat, d.delivery.lng]]}
            pathOptions={{ color: '#EAB308', weight: 4, opacity: 0.9, dashArray: '8, 8' }}
          />
        ))}

        {showRiders && data?.rider_locations.map((r) => (
          <Marker key={`rider-${r.rider_id}`} position={[r.lat, r.lng]} icon={riderIcon}>
            <Popup>
              <PopupCard>
                <div>
                  <div className="px-4 pt-3 pb-2 border-b border-[#E2E8E3]">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#EAF6ED] flex items-center justify-center">
                        <Navigation className="w-3 h-3 text-[#16803C]" />
                      </div>
                      <div>
                        <p className="font-semibold text-[#17201A] text-sm">Rider #{r.rider_id}</p>
                        <p className="text-[10px] text-[#16803C]">Online</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-2.5">
                    <p className="text-xs text-[#6B7280]">
                      Last ping: {new Date(r.recorded_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </PopupCard>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Search bar - floating top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-md px-4">
        <div className="bg-white rounded-xl flex items-center gap-3 px-4 py-2.5 border border-[#E2E8E3] shadow-tourism">
          <Search className="w-5 h-5 text-[#9CA3AF] shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search businesses..."
            className="flex-1 text-sm text-[#17201A] placeholder-[#9CA3AF] outline-none bg-transparent"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-[#9CA3AF] hover:text-[#16803C]">
              <X className="w-4 h-4" />
            </button>
          )}
          {loading && (
            <RefreshCw className="w-4 h-4 text-[#16803C] animate-spin" />
          )}
        </div>
      </div>

      {/* Layer controls - floating bottom left */}
      <div className="absolute bottom-6 left-4 z-[1000]">
        <div className="bg-white rounded-xl overflow-hidden border border-[#E2E8E3] shadow-tourism">
          <button
            onClick={() => setLayersOpen(!layersOpen)}
            className="flex items-center gap-2 px-4 py-2.5 transition-colors w-full hover:bg-[#F9FAFB]"
          >
            <Layers className="w-4 h-4 text-[#6B7280]" />
            <span className="text-sm font-medium text-[#17201A]">Layers</span>
            <ChevronDown className={cn('w-4 h-4 text-[#6B7280] transition-transform', layersOpen && 'rotate-180')} />
          </button>
          {layersOpen && (
            <div className="border-t border-[#E2E8E3] px-4 py-3 space-y-2.5 animate-fade-in-up">
              <div className="flex gap-2">
                <button onClick={() => setBaseLayer('streets')} className={cn('px-3 py-1 rounded text-sm', baseLayer === 'streets' ? 'bg-[#16803C] text-white' : 'text-[#6B7280] hover:bg-[#F9FAFB]')}>Streets</button>
                <button onClick={() => setBaseLayer('satellite')} className={cn('px-3 py-1 rounded text-sm', baseLayer === 'satellite' ? 'bg-[#16803C] text-white' : 'text-[#6B7280] hover:bg-[#F9FAFB]')}>Satellite</button>
                <button onClick={() => setBaseLayer('dark')} className={cn('px-3 py-1 rounded text-sm', baseLayer === 'dark' ? 'bg-[#16803C] text-white' : 'text-[#6B7280] hover:bg-[#F9FAFB]')}>Dark</button>
              </div>
              <div className="h-px bg-[#E2E8E3]" />
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input type="checkbox" checked={showBusinesses} onChange={(e) => setShowBusinesses(e.target.checked)}
                  className="w-4 h-4 rounded border-[#D7E8DB] text-[#16803C] focus:ring-[#16803C]/30" />
                <Building2 className="w-4 h-4 text-[#16803C]" />
                <span className="text-sm text-[#17201A] group-hover:text-[#16803C]">Businesses</span>
                {data && <span className="ml-auto text-xs text-[#6B7280] bg-[#F9FAFB] px-1.5 py-0.5 rounded-full">{data.businesses.length}</span>}
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input type="checkbox" checked={showDeliveries} onChange={(e) => setShowDeliveries(e.target.checked)}
                  className="w-4 h-4 rounded border-[#D7E8DB] text-[#F59E0B] focus:ring-[#F59E0B]/30" />
                <Truck className="w-4 h-4 text-[#F59E0B]" />
                <span className="text-sm text-[#17201A] group-hover:text-[#16803C]">Deliveries</span>
                {data && <span className="ml-auto text-xs text-[#6B7280] bg-[#F9FAFB] px-1.5 py-0.5 rounded-full">{data.active_deliveries.length}</span>}
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input type="checkbox" checked={showRiders} onChange={(e) => setShowRiders(e.target.checked)}
                  className="w-4 h-4 rounded border-[#D7E8DB] text-[#16803C] focus:ring-[#16803C]/30" />
                <Navigation className="w-4 h-4 text-[#16803C]" />
                <span className="text-sm text-[#17201A] group-hover:text-[#16803C]">Riders</span>
                {data && <span className="ml-auto text-xs text-[#6B7280] bg-[#F9FAFB] px-1.5 py-0.5 rounded-full">{data.rider_locations.length}</span>}
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Stats bar - floating bottom center */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="bg-white rounded-xl px-5 py-2.5 flex items-center gap-6 border border-[#E2E8E3] shadow-tourism">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#16803C]" />
            <span className="text-xs text-[#6B7280]">Businesses</span>
            <span className="text-sm font-semibold text-[#17201A]">{data?.businesses.length ?? 0}</span>
          </div>
          <div className="w-px h-4 bg-[#E2E8E3]" />
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" />
            <span className="text-xs text-[#6B7280]">Deliveries</span>
            <span className="text-sm font-semibold text-[#17201A]">{data?.active_deliveries.length ?? 0}</span>
          </div>
          <div className="w-px h-4 bg-[#E2E8E3]" />
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#16803C]" />
            <span className="text-xs text-[#6B7280]">Riders</span>
            <span className="text-sm font-semibold text-[#17201A]">{data?.rider_locations.length ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Refresh & auto-refresh - floating top right (below zoom controls) */}
      <div className="absolute top-4 right-16 z-[1000] flex items-center gap-2">
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={cn(
            'px-3 py-2 text-xs font-medium rounded-lg transition-all',
            autoRefresh
              ? 'bg-[#EAF6ED] text-[#16803C] border border-[#D7E8DB] hover:bg-[#D7E8DB]'
              : 'bg-white text-[#6B7280] border border-[#E2E8E3] hover:bg-[#F9FAFB]'
          )}
        >
          {autoRefresh ? 'Live' : 'Paused'}
        </button>
        <button
          onClick={() => { setLoading(true); fetchData() }}
          className="w-10 h-10 bg-white rounded-lg flex items-center justify-center transition-colors text-[#6B7280] hover:text-[#16803C] border border-[#E2E8E3] shadow-sm"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Active deliveries list - floating top left below search */}
      {data && data.active_deliveries.length > 0 && (
        <div className="absolute top-18 left-4 z-[1000] w-72">
          <div className="bg-white rounded-xl overflow-hidden animate-fade-in-up border border-[#E2E8E3] shadow-tourism">
            <div className="px-4 py-2.5 border-b border-[#E2E8E3] flex items-center gap-2">
              <Truck className="w-4 h-4 text-[#F59E0B]" />
              <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Active Deliveries</span>
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-[#E2E8E3]">
              {data.active_deliveries.map((d) => (
                <div key={d.id} className="px-4 py-2.5 transition-colors hover:bg-[#F9FAFB]">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[d.status] }} />
                    <span className="text-sm font-medium text-[#17201A]">#{d.id}</span>
                    <span className="text-xs text-[#9CA3AF]">&rarr;</span>
                    <span className="text-xs" style={{ color: STATUS_COLORS[d.status] }}>{d.status_label}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-[#6B7280]">
                    <CircleDot className="w-3 h-3" />
                    <span className="truncate">{d.pickup.address}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
