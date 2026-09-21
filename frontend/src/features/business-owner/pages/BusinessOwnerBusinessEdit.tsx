import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, post } from '@/shared/services/api'
import { useActiveBusinessId } from '../services/use-active-business-id'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ArrowLeft, Save, MapPin, Phone, Mail, Globe, Building2, Clock } from 'lucide-react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const Facebook = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
)

const Instagram = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
)

const businessIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

const schema = z.object({
  business_name: z.string().min(2, 'Name must be at least 2 characters'),
  business_description: z.string().min(10, 'Description must be at least 10 characters'),
  business_category_id: z.coerce.number().min(1, 'Category is required'),
  municipality_id: z.coerce.number().min(1, 'Municipality is required'),
  barangay_id: z.coerce.number().min(1, 'Barangay is required'),
  address: z.string().min(1, 'Street Address is required'),
  contact_number: z.string().min(1, 'Contact number is required'),
  email: z.string().email('Invalid email address'),
  website: z.string().url('Invalid URL').or(z.literal('')),
  facebook: z.string().url('Invalid Facebook URL').or(z.literal('')),
  instagram: z.string().url('Invalid Instagram URL').or(z.literal('')),
  opening_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format (HH:MM)'),
  closing_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format (HH:MM)'),
  business_days: z.array(z.string()).min(1, 'Select at least one operational day'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
})

type FormData = z.infer<typeof schema>

interface Category { id: number; name: string }
interface Barangay { id: number; name: string }
interface Municipality { id: number; name: string; barangays: Barangay[] }

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function LocationMarker({ lat, lng, setPosition }: { lat: number; lng: number; setPosition: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      setPosition(e.latlng.lat, e.latlng.lng)
    },
  })

  return lat && lng ? (
    <Marker
      position={[lat, lng]}
      icon={businessIcon}
      draggable={true}
      eventHandlers={{
        dragend(e) {
          const marker = e.target
          const position = marker.getLatLng()
          setPosition(position.lat, position.lng)
        }
      }}
    />
  ) : null
}

export default function BusinessOwnerBusinessEdit() {
  const { id: urlId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const businessId = useActiveBusinessId(urlId)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (businessId !== null && urlId !== String(businessId)) {
      navigate(`/business-owner/businesses/${businessId}/edit`, { replace: true })
    }
  }, [businessId, urlId, navigate])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { data: biz, isLoading } = useQuery({
    queryKey: ['bo-business', businessId],
    queryFn: () => get<any>(`/business-owner/businesses/${businessId}`),
    enabled: businessId !== null,
  })

  const { data: meta } = useQuery({
    queryKey: ['bo-business-edit-meta'],
    queryFn: () => get<{ categories: Category[]; municipalities: Municipality[] }>('/business-owner/businesses/create'),
  })

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema as any),
    values: biz ? {
      business_name: biz.business_name ?? biz.name ?? '',
      business_description: biz.business_description ?? biz.description ?? '',
      business_category_id: biz.business_category_id ?? biz.category_id ?? 0,
      municipality_id: biz.municipality_id ?? 0,
      barangay_id: biz.barangay_id ?? 0,
      address: biz.address ?? '',
      contact_number: biz.contact_number ?? biz.phone ?? '',
      email: biz.email ?? '',
      website: biz.website ?? '',
      facebook: biz.facebook ?? '',
      instagram: biz.instagram ?? '',
      opening_time: biz.opening_time ? biz.opening_time.substring(0, 5) : '08:00',
      closing_time: biz.closing_time ? biz.closing_time.substring(0, 5) : '17:00',
      business_days: Array.isArray(biz.business_days) ? biz.business_days : [],
      latitude: biz.latitude ?? 13.0673,
      longitude: biz.longitude ?? 121.4939,
    } : undefined,
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      // Use _method spoofing to send PUT request securely with post() helper
      const payload = {
        ...data,
        _method: 'PUT'
      }
      return post(`/business-owner/businesses/${businessId}`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', businessId] })
      queryClient.invalidateQueries({ queryKey: ['bo-businesses'] })
      setSuccess('Business updated successfully.')
      setError('')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Failed to update business.')
    },
  })

  const selectedMunicipality = watch('municipality_id')
  const barangays = meta?.municipalities?.find((m) => m.id === Number(selectedMunicipality))?.barangays ?? []

  const latVal = watch('latitude') ?? 13.0673
  const lngVal = watch('longitude') ?? 121.4939

  const setCoordinates = (lat: number, lng: number) => {
    setValue('latitude', Number(lat.toFixed(6)))
    setValue('longitude', Number(lng.toFixed(6)))
  }

  if (isLoading) return <DashboardSkeleton />
  if (!biz) return <div className="text-center py-20 text-[#647067]">Business not found.</div>

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/business-owner/businesses" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to My Businesses
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] flex items-center justify-center text-[#16803C]">
          <Building2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Edit Business Profile</h1>
          <p className="text-sm text-[#647067]">Update details for {biz.business_name ?? biz.name}</p>
        </div>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Form Settings & Mapping */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-6">
            <h2 className="text-lg font-semibold text-[#17201A] border-b border-[#E2E8E3] pb-3">Basic Information</h2>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business Name</label>
              <input {...register('business_name')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.business_name && <p className="text-[#B91C1C] text-xs mt-1">{errors.business_name.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Category</label>
              <select {...register('business_category_id')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                <option value="">Select category</option>
                {meta?.categories?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.business_category_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.business_category_id.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
              <textarea {...register('business_description')} rows={4} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
              {errors.business_description && <p className="text-[#B91C1C] text-xs mt-1">{errors.business_description.message}</p>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-6">
            <h2 className="text-lg font-semibold text-[#17201A] border-b border-[#E2E8E3] pb-3">Operational Location</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Municipality</label>
                <select {...register('municipality_id')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                  <option value="">Select Municipality</option>
                  {meta?.municipalities?.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                {errors.municipality_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.municipality_id.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Barangay</label>
                <select {...register('barangay_id')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                  <option value="">Select Barangay</option>
                  {barangays.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {errors.barangay_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.barangay_id.message}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Street Address</label>
              <input {...register('address')} placeholder="Building No, Street, Barangay" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.address && <p className="text-[#B91C1C] text-xs mt-1">{errors.address.message}</p>}
            </div>

            {/* Coordinates Selector with Leaflet Map */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-[#4B5563]">Geographic Coordinates</label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[#647067] mb-1">Latitude</label>
                  <input {...register('latitude')} type="number" step="any" className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  {errors.latitude && <p className="text-[#B91C1C] text-xs mt-1">{errors.latitude.message}</p>}
                </div>
                <div>
                  <label className="block text-xs text-[#647067] mb-1">Longitude</label>
                  <input {...register('longitude')} type="number" step="any" className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  {errors.longitude && <p className="text-[#B91C1C] text-xs mt-1">{errors.longitude.message}</p>}
                </div>
              </div>

              <div className="h-64 rounded-xl overflow-hidden border border-[#E2E8E3] relative mt-2">
                <MapContainer center={[latVal, lngVal]} zoom={13} minZoom={2} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                  <LocationMarker lat={latVal} lng={lngVal} setPosition={setCoordinates} />
                </MapContainer>
              </div>
              <p className="text-[11px] text-[#647067]"><MapPin className="w-3.5 h-3.5 inline mr-1" />Click on the map or drag the marker to adjust coordinates.</p>
            </div>
          </div>
        </div>

        {/* Right Column: Contact Details, Hours, & Days */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#17201A] border-b border-[#E2E8E3] pb-2">Hours of Operation</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#647067] mb-1">Opening Time</label>
                <div className="relative">
                  <Clock className="w-3.5 h-3.5 text-[#647067] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input {...register('opening_time')} type="time" className="w-full pl-8 pr-2 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                </div>
                {errors.opening_time && <p className="text-[#B91C1C] text-[10px] mt-1">{errors.opening_time.message}</p>}
              </div>

              <div>
                <label className="block text-xs text-[#647067] mb-1">Closing Time</label>
                <div className="relative">
                  <Clock className="w-3.5 h-3.5 text-[#647067] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input {...register('closing_time')} type="time" className="w-full pl-8 pr-2 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                </div>
                {errors.closing_time && <p className="text-[#B91C1C] text-[10px] mt-1">{errors.closing_time.message}</p>}
              </div>
            </div>
          </div>

          {/* Operational Days Card */}
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#17201A] border-b border-[#E2E8E3] pb-2">Business Days</h3>
            <div className="space-y-2 max-h-56 overflow-y-auto scrollbar-thin">
              {DAYS_OF_WEEK.map((day) => (
                <label key={day} className="flex items-center gap-2.5 py-1 px-1 hover:bg-[#F6F8F4] rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    value={day}
                    {...register('business_days')}
                    className="w-4 h-4 rounded bg-[#F3F8F4] border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40"
                  />
                  <span className="text-xs text-[#4B5563]">{day}</span>
                </label>
              ))}
            </div>
            {errors.business_days && <p className="text-[#B91C1C] text-[10px] mt-1">{errors.business_days.message}</p>}
          </div>

          {/* Contact Details Card */}
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#17201A] border-b border-[#E2E8E3] pb-2">Contact & Social Channels</h3>
            
            <div>
              <label className="block text-xs text-[#647067] mb-1">Contact Number</label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-[#647067] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input {...register('contact_number')} placeholder="Mobile/Telephone" className="w-full pl-8 pr-2 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              {errors.contact_number && <p className="text-[#B91C1C] text-xs mt-1">{errors.contact_number.message}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#647067] mb-1">Business Email</label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-[#647067] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input {...register('email')} type="email" placeholder="contact@business.com" className="w-full pl-8 pr-2 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              {errors.email && <p className="text-[#B91C1C] text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#647067] mb-1">Website URL</label>
              <div className="relative">
                <Globe className="w-3.5 h-3.5 text-[#647067] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input {...register('website')} placeholder="https://example.com" className="w-full pl-8 pr-2 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              {errors.website && <p className="text-[#B91C1C] text-xs mt-1">{errors.website.message}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#647067] mb-1">Facebook Page</label>
              <div className="relative">
                <Facebook className="w-3.5 h-3.5 text-[#647067] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input {...register('facebook')} placeholder="https://facebook.com/page" className="w-full pl-8 pr-2 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              {errors.facebook && <p className="text-[#B91C1C] text-xs mt-1">{errors.facebook.message}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#647067] mb-1">Instagram Profile</label>
              <div className="relative">
                <Instagram className="w-3.5 h-3.5 text-[#647067] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input {...register('instagram')} placeholder="https://instagram.com/user" className="w-full pl-8 pr-2 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              {errors.instagram && <p className="text-[#B91C1C] text-xs mt-1">{errors.instagram.message}</p>}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl border border-[#D7E8DB] text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] transition w-full text-center">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending} className="inline-flex items-center justify-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition w-full">
              <Save className="w-4 h-4" />
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

      </form>
    </div>
  )
}
