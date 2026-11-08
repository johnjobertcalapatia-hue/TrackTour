import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import {
  RefreshCw, Building2, Search, Layers, ChevronDown, X, Locate, ZoomIn, ZoomOut
} from 'lucide-react'
import { get } from '@/shared/services/api'
import { cn } from '@/shared/utils'
import { pinIcon } from '@/shared/utils/pin-icon'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const ORIENTAL_MINDORO_CENTER: L.LatLngTuple = [12.8667, 121.4500]

interface BusinessPin {
  id: number; name: string; lat: number; lng: number
  address: string | null; category: string | null; status: string
  municipality: string | null
}
interface MapData {
  businesses: BusinessPin[]
}

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

function FitBusinessBounds({ businesses }: { businesses: BusinessPin[] }) {
  const map = useMap()
  const fitted = useRef(false)

  useEffect(() => {
    if (businesses.length === 0 || fitted.current) return

    const bounds = L.latLngBounds(businesses.map((business) => [business.lat, business.lng]))
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 })
    fitted.current = true
  }, [businesses, map])

  return null
}

export default function AdminLiveMap() {
  const [data, setData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBusinesses, setShowBusinesses] = useState(true)
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
      (b) => b.name.toLowerCase().includes(q)
        || b.category?.toLowerCase().includes(q)
        || b.address?.toLowerCase().includes(q)
        || b.municipality?.toLowerCase().includes(q)
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
      `}</style>

      {/* Map */}
      <MapContainer center={ORIENTAL_MINDORO_CENTER} zoom={11} minZoom={7} className={`h-full w-full ${baseLayer === 'dark' ? 'map-dark-blue' : ''}`} zoomControl={false} attributionControl={false} wheelPxPerZoomLevel={250}>
        <FitBusinessBounds businesses={data?.businesses ?? []} />
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
            // Esri imagery over Bansud stops at zoom 18 (19+ = "Map data not yet available").
            maxNativeZoom={18}
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
                    {biz.municipality && <p className="text-xs text-[#6B7280] mt-0.5">{biz.municipality}</p>}
                  </div>
                  <div className="px-4 py-2.5">
                    <p className="text-xs text-[#6B7280] leading-relaxed">{biz.address || 'Address not provided'}</p>
                    <p className="text-xs text-[#6B7280] mt-1 capitalize">Status: {biz.status.replace(/_/g, ' ')}</p>
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
            </div>
          )}
        </div>
      </div>

      {/* Business count */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="bg-white rounded-xl px-5 py-2.5 flex items-center gap-2 border border-[#E2E8E3] shadow-tourism">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#16803C]" />
            <span className="text-xs text-[#6B7280]">Businesses</span>
            <span className="text-sm font-semibold text-[#17201A]">{data?.businesses.length ?? 0}</span>
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

    </div>
  )
}
