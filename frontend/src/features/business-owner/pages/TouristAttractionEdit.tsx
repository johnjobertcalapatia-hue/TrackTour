import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { get, post } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ArrowLeft, Save, MapPin } from 'lucide-react'

interface Municipality { id: number; name: string; barangays: { id: number; name: string }[] }
interface Business {
  id: number
  business_name: string
  business_description: string | null
  municipality_id: number | null
  barangay_id: number | null
  address: string | null
  contact_number: string | null
  email: string | null
  latitude: number | null
  longitude: number | null
  opening_time: string | null
  closing_time: string | null
  details?: Record<string, string>
  business_category_id: number
}

interface FormState {
  business_name: string
  business_description: string
  municipality_id: string
  barangay_id: string
  address: string
  contact_number: string
  email: string
  latitude: string
  longitude: string
  opening_time: string
  closing_time: string
  attraction_type: string
  entrance_fee: string
  best_time_to_visit: string
  activities: string
}

const inputClass = 'w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]'
const attractionTypes = ['Beach', 'Waterfall', 'Mountain', 'Nature', 'Historical Site', 'Cultural Site', 'Adventure', 'Viewpoint', 'Park', 'Other']

export default function TouristAttractionEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { data: business, isLoading } = useQuery({
    queryKey: ['bo-business', id],
    queryFn: () => get<Business>(`/business-owner/businesses/${id}`),
    enabled: Boolean(id),
  })
  const { data: meta } = useQuery({
    queryKey: ['tourist-attraction-edit-meta'],
    queryFn: () => get<{ municipalities: Municipality[] }>('/business-owner/businesses/create'),
  })

  useEffect(() => {
    if (business && !form) {
      setForm({
        business_name: business.business_name ?? '',
        business_description: business.business_description ?? '',
        municipality_id: String(business.municipality_id ?? ''),
        barangay_id: String(business.barangay_id ?? ''),
        address: business.address ?? '',
        contact_number: business.contact_number ?? '',
        email: business.email ?? '',
        latitude: String(business.latitude ?? ''),
        longitude: String(business.longitude ?? ''),
        opening_time: business.opening_time?.slice(0, 5) ?? '08:00',
        closing_time: business.closing_time?.slice(0, 5) ?? '17:00',
        attraction_type: business.details?.attraction_type ?? '',
        entrance_fee: business.details?.entrance_fee ?? '0',
        best_time_to_visit: business.details?.best_time_to_visit ?? '',
        activities: business.details?.activities ?? '',
      })
    }
  }, [business, form])

  const selectedMunicipality = useMemo(
    () => meta?.municipalities.find((item) => item.id === Number(form?.municipality_id)),
    [meta?.municipalities, form?.municipality_id],
  )

  const setField = (key: keyof FormState, value: string) => setForm((current) => current ? { ...current, [key]: value } : current)

  const mutation = useMutation({
    mutationFn: () => {
      if (!form || !id) throw new Error('Attraction data is unavailable.')
      return post(`/business-owner/businesses/${id}`, {
        ...form,
        business_category_id: 7,
        details: {
          attraction_type: form.attraction_type,
          entrance_fee: form.entrance_fee || '0',
          best_time_to_visit: form.best_time_to_visit,
          activities: form.activities,
        },
        _method: 'PUT',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-businesses'] })
      setSuccess('Tourist attraction updated successfully.')
      setError('')
    },
    onError: (requestError: any) => {
      const errors = requestError?.response?.data?.errors
      setError(errors ? Object.values(errors).flat().join(' ') : requestError?.response?.data?.message || 'Unable to update the tourist attraction.')
    },
  })

  if (isLoading || !form) return <DashboardSkeleton />
  if (!business) return <div className="py-20 text-center text-[#647067]">Tourist attraction not found.</div>

  return (
    <div className="max-w-5xl mx-auto">
      <Link to="/business-owner/businesses" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6"><ArrowLeft className="w-4 h-4" /> Back to My Businesses</Link>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Edit Tourist Attraction</h1>
        <p className="mt-1 text-sm text-[#647067]">Update beach and destination information. Tourist attractions do not use business logos or cover photos.</p>
      </div>
      <div className="space-y-4 mb-6">
        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
        {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}
      </div>
      <div className="space-y-6">
        <section className="bg-white rounded-2xl border border-[#E2E8E3] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Attraction Information</h2>
          <label className="block text-sm font-medium text-[#4B5563]">Tourist Spot Name<input className={`${inputClass} mt-1.5`} value={form.business_name} onChange={(e) => setField('business_name', e.target.value)} /></label>
          <label className="block text-sm font-medium text-[#4B5563]">Description<textarea className={`${inputClass} mt-1.5 resize-none`} rows={5} value={form.business_description} onChange={(e) => setField('business_description', e.target.value)} /></label>
          <label className="block text-sm font-medium text-[#4B5563]">Attraction Type<select className={`${inputClass} mt-1.5`} value={form.attraction_type} onChange={(e) => setField('attraction_type', e.target.value)}><option value="">Select attraction type</option>{attractionTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm font-medium text-[#4B5563]">Entrance Fee<input type="number" min="0" step="0.01" className={`${inputClass} mt-1.5`} value={form.entrance_fee} onChange={(e) => setField('entrance_fee', e.target.value)} /></label>
            <label className="block text-sm font-medium text-[#4B5563]">Best Time to Visit<input className={`${inputClass} mt-1.5`} value={form.best_time_to_visit} onChange={(e) => setField('best_time_to_visit', e.target.value)} /></label>
          </div>
          <label className="block text-sm font-medium text-[#4B5563]">Activities<textarea className={`${inputClass} mt-1.5 resize-none`} rows={3} value={form.activities} onChange={(e) => setField('activities', e.target.value)} /></label>
        </section>
        <section className="bg-white rounded-2xl border border-[#E2E8E3] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Location and Contact</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm font-medium text-[#4B5563]">Municipality<select className={`${inputClass} mt-1.5`} value={form.municipality_id} onChange={(e) => { setField('municipality_id', e.target.value); setField('barangay_id', '') }}><option value="">Select municipality</option>{meta?.municipalities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block text-sm font-medium text-[#4B5563]">Barangay<select className={`${inputClass} mt-1.5`} value={form.barangay_id} onChange={(e) => setField('barangay_id', e.target.value)}><option value="">Select barangay</option>{selectedMunicipality?.barangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          <label className="block text-sm font-medium text-[#4B5563]">Complete Address<input className={`${inputClass} mt-1.5`} value={form.address} onChange={(e) => setField('address', e.target.value)} /></label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm font-medium text-[#4B5563]">Latitude<input className={`${inputClass} mt-1.5`} value={form.latitude} onChange={(e) => setField('latitude', e.target.value)} /></label>
            <label className="block text-sm font-medium text-[#4B5563]">Longitude<input className={`${inputClass} mt-1.5`} value={form.longitude} onChange={(e) => setField('longitude', e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm font-medium text-[#4B5563]">Contact Number<input className={`${inputClass} mt-1.5`} value={form.contact_number} onChange={(e) => setField('contact_number', e.target.value)} /></label>
            <label className="block text-sm font-medium text-[#4B5563]">Business Email<input type="email" className={`${inputClass} mt-1.5`} value={form.email} onChange={(e) => setField('email', e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm font-medium text-[#4B5563]">Opening Time<input type="time" className={`${inputClass} mt-1.5`} value={form.opening_time} onChange={(e) => setField('opening_time', e.target.value)} /></label>
            <label className="block text-sm font-medium text-[#4B5563]">Closing Time<input type="time" className={`${inputClass} mt-1.5`} value={form.closing_time} onChange={(e) => setField('closing_time', e.target.value)} /></label>
          </div>
          <p className="text-xs text-[#647067] inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Coordinates are used for the beach marker on TrackTour maps.</p>
        </section>
        <div className="flex justify-end"><button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#16803C] text-white text-sm font-semibold hover:bg-[#126B32] disabled:opacity-60"><Save className="w-4 h-4" />{mutation.isPending ? 'Saving...' : 'Save Attraction'}</button></div>
      </div>
    </div>
  )
}
