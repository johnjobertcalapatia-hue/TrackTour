import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import {
  ArrowLeft,
  MapPin,
  Star,
  Heart,
  Share2,
  Navigation,
  Clock,
  Ticket,
  Phone,
  Map as MapIcon,
  X,
  Mountain,
  Car,
  Loader2,
} from 'lucide-react'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { cn, formatCurrency, toAssetUrl } from '@/shared/utils'
import BookRideSheet from '../components/BookRideSheet'

interface Destination {
  id: number
  favoritable_type?: string
  name: string
  description: string
  address: string
  latitude: number
  longitude: number
  opening_hours: string | null
  entrance_fee: number
  contact_number: string | null
  images: string[]
  amenities: string[]
  rating?: number | null
  category: { id: number; name: string }
  municipality: { id: number; name: string }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function createSpotIcon() {
  return L.divIcon({
    className: 'spot-detail-marker',
    html: `<div style="width:40px;height:40px;background:#087F3F;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 4px 12px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;"><div style="width:13px;height:13px;background:#fff;border-radius:50%;transform:rotate(45deg);"></div></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  })
}

const spotIcon = createSpotIcon()

export default function TouristDestinationShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [favorited, setFavorited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [distance, setDistance] = useState<number | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [showRideSheet, setShowRideSheet] = useState(false)

  const openTouristMap = () => {
    if (!hasCoords) {
      window.open(mapUrl, '_blank', 'noopener,noreferrer')
      return
    }

    sessionStorage.setItem('tracktour_pending_map_destination', JSON.stringify({
      id: Number(id),
      name: destination?.name,
      latitude: Number(destination?.latitude),
      longitude: Number(destination?.longitude),
    }))
    navigate('/tourist/explore/map')
  }

  const { data: destination, isLoading } = useQuery({
    queryKey: ['tourist-destination-v2', id],
    queryFn: () => get<Destination>(`/tourist/destinations/${id}`),
  })

  useEffect(() => {
    if (!destination?.latitude || !destination?.longitude) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDistance(
          haversineKm(
            pos.coords.latitude,
            pos.coords.longitude,
            Number(destination.latitude),
            Number(destination.longitude)
          )
        )
      },
      () => {},
      { timeout: 10000, maximumAge: 300000 }
    )
  }, [destination])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    const next = !favorited
    setFavorited(next)
    try {
      await post('/tourist/favorites/toggle', {
        favoritable_type: destination?.favoritable_type ?? 'App\\Models\\TouristDestination',
        favoritable_id: Number(id),
      })
    } catch {
      setFavorited(!next)
    } finally {
      setSaving(false)
    }
  }

  const handleShare = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: destination?.name, url })
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url)
      }
    } catch {
      // user cancelled share
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!destination) return <div className="text-center py-20 text-[#68736D]">Destination not found.</div>

  const hasCoords = Boolean(destination.latitude && destination.longitude)
  const mapsQuery = hasCoords ? `${destination.latitude},${destination.longitude}` : encodeURIComponent(destination.name)
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${mapsQuery}`
  const mapUrl = hasCoords
    ? `https://www.google.com/maps?q=${destination.latitude},${destination.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination.name)}`

  return (
    <div className="min-h-screen bg-[#F7FAF7]">
      {/* Back bar */}
      <div className="sticky top-14 z-30 px-4 py-2 flex items-center justify-between bg-[#F7FAF7]/90 backdrop-blur-md">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-white border border-[#E5E9E7] shadow-sm flex items-center justify-center text-[#17201B] hover:border-[#087F3F]/50 transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleShare}
            aria-label="Share"
            className="w-9 h-9 rounded-full bg-white border border-[#E5E9E7] shadow-sm flex items-center justify-center text-[#17201B] hover:border-[#087F3F]/50 transition"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            aria-label="Save"
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center shadow-sm transition border',
              favorited
                ? 'bg-[#FFF7D6] border-[#F4B400] text-[#A66F00]'
                : 'bg-white border-[#E5E9E7] text-[#17201B] hover:border-[#087F3F]/50'
            )}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className={cn('w-4 h-4', favorited && 'fill-current')} />}
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="relative h-64 sm:h-80">
        {destination.images?.[0] ? (
          <img src={toAssetUrl(destination.images[0])} alt={destination.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#087F3F]/30 to-[#E9F7EF] flex items-center justify-center">
            <Mountain className="w-16 h-16 text-[#087F3F]/40" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#F7FAF7] via-transparent to-transparent" />
      </div>

      {/* Info */}
      <div className="px-4 -mt-10 relative z-10">
        <span className="inline-block bg-[#E9F7EF] text-[#087F3F] text-[11px] px-3 py-1 rounded-full font-semibold mb-2">
          {destination.category?.name || 'Tourist Spot'}
        </span>
        <h1 className="text-2xl font-bold text-[#17201B]">{destination.name}</h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm">
          <span className="flex items-center gap-1 text-[#17201B] font-medium">
            <MapPin className="w-4 h-4 text-[#087F3F]" />
            {destination.municipality?.name || destination.address}
          </span>
          {destination.rating != null && (
            <span className="flex items-center gap-1">
              <Star className="w-4 h-4 text-[#F4B400] fill-[#F4B400]" />
              <span className="font-semibold text-[#17201B]">{destination.rating.toFixed(1)}</span>
            </span>
          )}
          {distance != null && (
            <span className="text-[#68736D]">
              {distance < 1 ? '<1' : Math.round(distance)} km away
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 mt-5">
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={openTouristMap}
            className="flex flex-col items-center justify-center gap-1.5 py-3 bg-[#087F3F] text-white font-semibold rounded-xl text-xs hover:bg-[#056B35] transition"
          >
            <MapIcon className="w-5 h-5" />
            View on Map
          </button>
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center gap-1.5 py-3 bg-white border border-[#087F3F]/30 text-[#087F3F] font-semibold rounded-xl text-xs hover:bg-[#E9F7EF] transition"
          >
            <Navigation className="w-5 h-5" />
            Get Directions
          </a>
          <button
            onClick={handleSave}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 py-3 font-semibold rounded-xl text-xs transition border',
              favorited
                ? 'bg-[#FFF7D6] border-[#F4B400] text-[#A66F00]'
                : 'bg-white border-[#087F3F]/30 text-[#087F3F] hover:bg-[#E9F7EF]'
            )}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Heart className={cn('w-5 h-5', favorited && 'fill-current')} />}
            {favorited ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* About */}
      {destination.description && (
        <section className="px-4 mt-6">
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[#17201B] mb-2">About</h2>
            <p className="text-sm text-[#68736D] leading-relaxed">{destination.description}</p>
          </div>
        </section>
      )}

      {/* Details */}
      <section className="px-4 mt-4">
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-5 space-y-4">
          {destination.opening_hours && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-[#087F3F]" />
              </div>
              <div>
                <p className="text-[10px] text-[#68736D] uppercase tracking-wide font-semibold">Opening Hours</p>
                <p className="text-sm text-[#17201B] font-medium">{destination.opening_hours}</p>
              </div>
            </div>
          )}
          {destination.entrance_fee > 0 && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FFF7D6] flex items-center justify-center shrink-0">
                <Ticket className="w-4 h-4 text-[#A66F00]" />
              </div>
              <div>
                <p className="text-[10px] text-[#68736D] uppercase tracking-wide font-semibold">Entrance Fee</p>
                <p className="text-sm text-[#17201B] font-medium">{formatCurrency(destination.entrance_fee)}</p>
              </div>
            </div>
          )}
          {destination.address && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4 text-[#087F3F]" />
              </div>
              <div>
                <p className="text-[10px] text-[#68736D] uppercase tracking-wide font-semibold">Location</p>
                <p className="text-sm text-[#17201B] font-medium">{destination.address}</p>
              </div>
            </div>
          )}
          {destination.contact_number && (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4 text-[#087F3F]" />
              </div>
              <div>
                <p className="text-[10px] text-[#68736D] uppercase tracking-wide font-semibold">Contact</p>
                <p className="text-sm text-[#17201B] font-medium">{destination.contact_number}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Facilities */}
      {destination.amenities?.length > 0 && (
        <section className="px-4 mt-4">
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[#17201B] mb-3">Facilities</h2>
            <div className="flex flex-wrap gap-2">
              {destination.amenities.map((a, i) => (
                <span key={i} className="bg-[#E9F7EF] text-[#087F3F] text-xs px-3 py-1.5 rounded-full font-medium">
                  {a}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Extra photos */}
      {destination.images && destination.images.length > 1 && (
        <section className="px-4 mt-4">
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
            {destination.images.slice(1).map((img, i) => (
              <img key={i} src={toAssetUrl(img)} alt="" className="w-40 h-32 rounded-2xl object-cover bg-[#E5E9E7] shrink-0" />
            ))}
          </div>
        </section>
      )}

      {/* Book a Ride */}
      <div className="px-4 mt-6 pb-8">
        <button
          onClick={() => setShowRideSheet(true)}
          className="w-full py-3 bg-white border border-[#E5E9E7] text-[#17201B] font-semibold rounded-xl text-sm hover:border-[#087F3F]/50 hover:text-[#087F3F] transition flex items-center justify-center gap-2"
        >
          <Car className="w-4 h-4" /> Book a Ride
        </button>
      </div>

      {/* Legacy map modal fallback */}
      {showMap && hasCoords && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMap(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <h3 className="text-sm font-semibold text-[#17201B]">{destination.name}</h3>
              <button onClick={() => setShowMap(false)} className="p-2 rounded-full hover:bg-[#E9F7EF] transition">
                <X className="w-5 h-5 text-[#68736D]" />
              </button>
            </div>
            <div className="h-72 relative">
              <MapContainer
                center={[Number(destination.latitude), Number(destination.longitude)]}
                zoom={15}
                className="w-full h-full z-0"
                zoomControl={false}
                attributionControl={false}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"
                />
                <Marker position={[Number(destination.latitude), Number(destination.longitude)]} icon={spotIcon} />
              </MapContainer>
            </div>
            <div className="p-5">
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-[#087F3F] text-white font-semibold rounded-xl text-sm hover:bg-[#056B35] transition"
              >
                <Navigation className="w-4 h-4" /> Get Directions
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Ride sheet */}
      <BookRideSheet
        isOpen={showRideSheet}
        onClose={() => setShowRideSheet(false)}
        destination={destination.name}
        destinationCoords={hasCoords ? { lat: Number(destination.latitude), lng: Number(destination.longitude) } : undefined}
      />
    </div>
  )
}