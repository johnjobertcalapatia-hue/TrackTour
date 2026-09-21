import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import {
  Search,
  MapPin,
  Mountain,
  Star,
  LayoutGrid,
  Map as MapIcon,
  ChevronRight,
} from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { cn, formatCurrency, toAssetUrl } from '@/shared/utils'

interface Destination {
  id: number
  name: string
  description: string
  address: string
  latitude: number
  longitude: number
  entrance_fee: number
  images: string[]
  amenities: string[]
  rating?: number | null
  category: { id: number; name: string; slug: string }
  municipality: { id: number; name: string }
}

interface DestinationCategory {
  id: number
  name: string
  slug: string
}

const DEFAULT_CENTER: [number, number] = [12.8667, 121.45]

function createPin(active: boolean) {
  const size = active ? 42 : 32
  return L.divIcon({
    className: 'spot-marker',
    html: `<div style="width:${size}px;height:${size}px;background:${active ? '#F4B400' : '#087F3F'};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 4px 12px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;"><div style="width:${active ? 14 : 11}px;height:${active ? 14 : 11}px;background:#fff;border-radius:50%;transform:rotate(45deg);"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
}

function MapController({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo(center, Math.max(map.getZoom(), 13), { duration: 0.6 })
  }, [center, map])
  return null
}

export default function TouristDestinations() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [view, setView] = useState<'grid' | 'map'>('grid')
  const [activeId, setActiveId] = useState<number | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER)

  const { data: categories } = useQuery({
    queryKey: ['tourist-destination-categories'],
    queryFn: () => get<DestinationCategory[]>('/tourist/destinations/categories'),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-destinations', category, search],
    queryFn: () => get<{ data: Destination[] }>('/tourist/destinations', { params: { category, search } }),
  })

  if (isLoading) return <DashboardSkeleton />

  const destinations = data?.data ?? []

  const handleSelect = (d: Destination) => {
    setActiveId(d.id)
    if (d.latitude && d.longitude) {
      setMapCenter([Number(d.latitude), Number(d.longitude)])
    }
  }

  return (
    <div className="min-h-screen bg-[#F7FAF7]">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Tourist Spots</h1>
        <p className="mt-1 text-sm text-[#68736D]">Discover beautiful places in Bansud and Oriental Mindoro</p>
      </div>

      {/* Search + view toggle */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#68736D]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tourist spots..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#68736D] focus:ring-2 focus:ring-[#087F3F]/40 focus:border-[#087F3F] outline-none transition"
          />
        </div>
        <div className="flex bg-[#E9F7EF] rounded-xl p-1 shrink-0">
          <button
            onClick={() => setView('grid')}
            aria-label="Grid view"
            className={cn(
              'p-2 rounded-lg transition',
              view === 'grid' ? 'bg-white text-[#087F3F] shadow-sm' : 'text-[#087F3F]/60 hover:text-[#087F3F]'
            )}
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setView('map')}
            aria-label="Map view"
            className={cn(
              'p-2 rounded-lg transition',
              view === 'map' ? 'bg-white text-[#087F3F] shadow-sm' : 'text-[#087F3F]/60 hover:text-[#087F3F]'
            )}
          >
            <MapIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        <button
          onClick={() => setCategory('')}
          className={cn(
            'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition',
            !category
              ? 'bg-[#087F3F] text-white shadow-sm shadow-[#087F3F]/25'
              : 'bg-white border border-[#E5E9E7] text-[#68736D] hover:border-[#087F3F]/50 hover:text-[#087F3F]'
          )}
        >
          All
        </button>
        {categories?.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(category === c.slug ? '' : c.slug)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition',
              category === c.slug
                ? 'bg-[#087F3F] text-white shadow-sm shadow-[#087F3F]/25'
                : 'bg-white border border-[#E5E9E7] text-[#68736D] hover:border-[#087F3F]/50 hover:text-[#087F3F]'
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {destinations.length === 0 ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-12 text-center">
          <Mountain className="w-12 h-12 text-[#68736D]/30 mx-auto mb-4" />
          <p className="text-[#68736D]">No tourist spots found matching your criteria.</p>
        </div>
      ) : view === 'map' ? (
        <div className="lg:flex lg:gap-4">
          {/* Desktop list */}
          <div className="hidden lg:block lg:w-80 lg:shrink-0 space-y-3 max-h-[calc(100vh-11rem)] overflow-y-auto pr-1">
            {destinations.map((d) => (
              <div
                key={d.id}
                onClick={() => handleSelect(d)}
                className={cn(
                  'flex items-center gap-3 p-3 bg-white border rounded-2xl cursor-pointer transition',
                  activeId === d.id
                    ? 'border-[#087F3F] ring-1 ring-[#087F3F]/25'
                    : 'border-[#E5E9E7] hover:border-[#087F3F]/40'
                )}
              >
                <img
                  src={toAssetUrl(d.images?.[0]) || '/assets/placeholder.svg'}
                  alt={d.name}
                  className="w-16 h-16 rounded-xl object-cover bg-[#E5E9E7] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#17201B] truncate">{d.name}</p>
                  <p className="flex items-center gap-1 text-xs text-[#68736D] mt-0.5 truncate">
                    <MapPin className="w-3 h-3 shrink-0" /> {d.municipality?.name || d.address}
                  </p>
                  {d.entrance_fee > 0 && (
                    <p className="text-xs text-[#087F3F] font-medium mt-0.5">Entrance: {formatCurrency(d.entrance_fee)}</p>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/tourist/destinations/${d.id}`)
                  }}
                  className="p-2 rounded-lg bg-[#087F3F] text-white shrink-0 hover:bg-[#056B35] transition"
                  aria-label={`View ${d.name}`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Map */}
          <div className="relative h-[60vh] lg:h-[calc(100vh-11rem)] lg:flex-1 rounded-2xl overflow-hidden border border-[#E5E9E7]">
            <MapContainer
              center={mapCenter}
              zoom={12}
              className="w-full h-full z-0"
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"
              />
              <MapController center={mapCenter} />
              {destinations.map((d) => {
                if (!d.latitude || !d.longitude) return null
                const pos: [number, number] = [Number(d.latitude), Number(d.longitude)]
                return (
                  <Marker
                    key={d.id}
                    position={pos}
                    icon={createPin(d.id === activeId)}
                    eventHandlers={{ click: () => handleSelect(d) }}
                  >
                    <Popup>
                      <div className="min-w-[180px]">
                        <p className="font-semibold text-gray-900 text-sm">{d.name}</p>
                        <p className="text-xs text-gray-600 mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {d.municipality?.name || d.address}
                        </p>
                        <button
                          onClick={() => navigate(`/tourist/destinations/${d.id}`)}
                          className="mt-2 text-xs text-[#087F3F] font-semibold hover:underline"
                        >
                          View Spot
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                )
              })}
            </MapContainer>

            {/* Mobile mini-card strip */}
            <div className="lg:hidden absolute bottom-3 left-3 right-3 z-[1000] flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {destinations.map((d) => (
                <div
                  key={d.id}
                  onClick={() => handleSelect(d)}
                  className={cn(
                    'w-60 shrink-0 bg-white/95 backdrop-blur border rounded-2xl p-1.5 flex items-center gap-2 cursor-pointer transition',
                    activeId === d.id ? 'border-[#087F3F] ring-1 ring-[#087F3F]/30' : 'border-[#E5E9E7]'
                  )}
                >
                  <img
                    src={toAssetUrl(d.images?.[0]) || '/assets/placeholder.svg'}
                    alt={d.name}
                    className="w-12 h-12 rounded-xl object-cover bg-[#E5E9E7] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#17201B] truncate">{d.name}</p>
                    <p className="text-[10px] text-[#68736D] truncate">{d.municipality?.name || d.address}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/tourist/destinations/${d.id}`)
                    }}
                    className="p-1.5 rounded-lg bg-[#087F3F] text-white shrink-0"
                    aria-label={`View ${d.name}`}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {destinations.map((d) => (
            <div
              key={d.id}
              onClick={() => navigate(`/tourist/destinations/${d.id}`)}
              className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden cursor-pointer hover:shadow-lg hover:border-[#087F3F]/40 transition-all group flex flex-col"
            >
              <div className="relative h-36 sm:h-40 bg-[#E5E9E7] overflow-hidden">
                {d.images?.[0] ? (
                  <img
                    src={toAssetUrl(d.images[0]) || '/assets/placeholder.svg'}
                    alt={d.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Mountain className="w-12 h-12 text-[#68736D]/30" />
                  </div>
                )}
                {d.category && (
                  <span className="absolute top-3 left-3 bg-[#087F3F] text-white text-[10px] px-2 py-1 rounded-full font-semibold">
                    {d.category.name}
                  </span>
                )}
                {d.rating != null && (
                  <span className="absolute bottom-3 left-3 flex items-center gap-1 bg-white/90 backdrop-blur text-[10px] font-semibold px-2 py-1 rounded-full">
                    <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" /> {d.rating.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="p-4 flex flex-col flex-1">
                <h3 className="font-semibold text-[#17201B] group-hover:text-[#087F3F] transition truncate">{d.name}</h3>
                <div className="flex items-center gap-1 mt-1 text-xs text-[#68736D]">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{d.municipality?.name || d.address}</span>
                </div>
                {d.entrance_fee > 0 && (
                  <p className="mt-2 text-xs text-[#087F3F] font-medium">Entrance Fee: {formatCurrency(d.entrance_fee)}</p>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/tourist/destinations/${d.id}`)
                  }}
                  className="mt-3 w-full py-2 bg-[#087F3F] text-white text-xs font-semibold rounded-lg hover:bg-[#056B35] transition"
                >
                  View Spot
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}