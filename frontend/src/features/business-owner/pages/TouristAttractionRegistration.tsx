import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, post } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { beachPinIcon } from '@/shared/utils/pin-icon'
import { ArrowLeft, ArrowRight, Check, ChevronDown, ImagePlus, MapPin, Upload, X } from 'lucide-react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const CATEGORY_ID = 7
const MAX_PHOTOS = 10
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const DRAFT_STORAGE_KEY = 'tourist-attraction-registration-draft'

interface Barangay {
  id: number
  name: string
}

interface Municipality {
  id: number
  name: string
  barangays: Barangay[]
}

interface RegistrationMeta {
  municipalities: Municipality[]
}

interface FormState {
  name: string
  description: string
  attractionType: string
  address: string
  municipalityId: string
  barangayId: string
  latitude: string
  longitude: string
  entranceFee: string
  openingTime: string
  closingTime: string
  bestTime: string
  activities: string
  contactNumber: string
  email: string
  legalEntityType: string
  tin: string
  yearEstablished: string
}

const steps = ['Basic Info', 'Location', 'Photos', 'Details', 'Review']
const attractionTypes = ['Beach', 'Waterfall', 'Mountain', 'Nature', 'Historical Site', 'Cultural Site', 'Adventure', 'Viewpoint', 'Park', 'Other']
const defaultForm: FormState = {
  name: '',
  description: '',
  attractionType: '',
  address: '',
  municipalityId: '',
  barangayId: '',
  latitude: '',
  longitude: '',
  entranceFee: '0',
  openingTime: '',
  closingTime: '',
  bestTime: '',
  activities: '',
  contactNumber: '',
  email: '',
  legalEntityType: '',
  tin: '',
  yearEstablished: '',
}

interface RegistrationDraft {
  step: number
  form: FormState
}

function loadDraft(): RegistrationDraft {
  const stored = sessionStorage.getItem(DRAFT_STORAGE_KEY)
  if (!stored) return { step: 1, form: defaultForm }

  try {
    const draft = JSON.parse(stored) as Partial<RegistrationDraft>
    return {
      step: typeof draft.step === 'number' && draft.step >= 1 && draft.step <= 5 ? draft.step : 1,
      form: { ...defaultForm, ...(draft.form ?? {}) },
    }
  } catch {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    return { step: 1, form: defaultForm }
  }
}

function LocationMarker({ onChange }: { onChange: (lat: string, lng: string) => void }) {
  useMapEvents({
    click(event) {
      onChange(event.latlng.lat.toFixed(6), event.latlng.lng.toFixed(6))
    },
  })
  return null
}

function MapCenter({ latitude, longitude }: { latitude: string; longitude: string }) {
  const map = useMap()
  useEffect(() => {
    if (latitude && longitude) map.setView([Number(latitude), Number(longitude)], 16)
  }, [latitude, longitude, map])
  return null
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[#4B5563] mb-1.5">{label}{required && ' *'}</span>
      {children}
    </label>
  )
}

const inputClass = 'w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]'

export default function TouristAttractionRegistration() {
  const navigate = useNavigate()
  const [initialDraft] = useState(loadDraft)
  const [step, setStep] = useState(initialDraft.step)
  const [form, setForm] = useState<FormState>(initialDraft.form)
  const [mainPhoto, setMainPhoto] = useState<File | null>(null)
  const [additionalPhotos, setAdditionalPhotos] = useState<File[]>([])
  const [mainPreview, setMainPreview] = useState('')
  const [additionalPreviews, setAdditionalPreviews] = useState<string[]>([])
  const [error, setError] = useState('')
  const [attractionTypeOpen, setAttractionTypeOpen] = useState(false)
  const [mapSearch, setMapSearch] = useState('')
  const [mapSearching, setMapSearching] = useState(false)
  const [mapSearchError, setMapSearchError] = useState('')
  const mainPhotoRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ step, form }))
  }, [step, form])

  const { data: meta, isLoading: metaLoading } = useQuery({
    queryKey: ['tourist-attraction-registration-meta'],
    queryFn: () => get<RegistrationMeta>('/business-owner/businesses/create'),
  })

  const municipalities = useMemo(() => meta?.municipalities ?? [], [meta?.municipalities])
  const selectedMunicipality = useMemo(
    () => municipalities.find((municipality) => municipality.id === Number(form.municipalityId)),
    [form.municipalityId, municipalities],
  )

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const reverseGeocode = async (latitude: string, longitude: string) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!response.ok) throw new Error('Reverse geocoding failed')
      const result = await response.json() as { display_name?: string }
      if (result.display_name) setField('address', result.display_name)
    } catch {
      setMapSearchError('The address could not be retrieved. You can enter it manually.')
    }
  }

  const setLocation = (latitude: string, longitude: string) => {
    setField('latitude', latitude)
    setField('longitude', longitude)
    void reverseGeocode(latitude, longitude)
  }

  const searchMapLocation = async () => {
    const query = mapSearch.trim()
    if (!query) {
      setMapSearchError('Enter a place or address to search.')
      return
    }

    setMapSearching(true)
    setMapSearchError('')
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=${encodeURIComponent(query)}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!response.ok) throw new Error('Map search failed')
      const results = await response.json() as Array<{ lat: string; lon: string; display_name?: string }>
      const result = results[0]
      if (!result) {
        setMapSearchError('Location not found. Try a more specific place or address.')
        return
      }

      const latitude = Number(result.lat).toFixed(6)
      const longitude = Number(result.lon).toFixed(6)
      setField('latitude', latitude)
      setField('longitude', longitude)
      if (result.display_name) setField('address', result.display_name)
    } catch {
      setMapSearchError('Map search is unavailable. Please try again or place the marker manually.')
    } finally {
      setMapSearching(false)
    }
  }

  const addMainPhoto = (file: File | undefined) => {
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > MAX_IMAGE_SIZE) {
      setError('The main photo must be a JPG or PNG file no larger than 5 MB.')
      return
    }
    setError('')
    setMainPhoto(file)
    setMainPreview(URL.createObjectURL(file))
  }

  const addAdditionalPhotos = (files: FileList | null) => {
    if (!files) return
    const selected = Array.from(files).filter((file) => ['image/jpeg', 'image/png'].includes(file.type) && file.size <= MAX_IMAGE_SIZE)
    if (selected.length !== files.length) {
      setError('Additional photos must be JPG or PNG files no larger than 5 MB each.')
      return
    }
    const availableSlots = MAX_PHOTOS - (mainPhoto ? 1 : 0) - additionalPhotos.length
    if (selected.length > availableSlots) {
      setError(`You can upload up to ${MAX_PHOTOS} photos in total.`)
      return
    }
    setError('')
    setAdditionalPhotos((current) => [...current, ...selected])
    setAdditionalPreviews((current) => [...current, ...selected.map((file) => URL.createObjectURL(file))])
  }

  const removeAdditionalPhoto = (index: number) => {
    setAdditionalPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))
    setAdditionalPreviews((current) => current.filter((_, photoIndex) => photoIndex !== index))
  }

  const validateStep = () => {
    if (step === 1 && (!form.name.trim() || !form.description.trim() || !form.attractionType)) {
      setError('Please complete the attraction name, description, and attraction type.')
      return false
    }
    if (step === 2 && (!form.address.trim() || !form.municipalityId || !form.barangayId || !form.latitude || !form.longitude)) {
      setError('Please complete the address, municipality, barangay, and map coordinates.')
      return false
    }
    if (step === 3 && !mainPhoto) {
      setError('A main photo is required.')
      return false
    }
    if (step === 4) {
      if (!form.contactNumber.trim() || !form.email.trim()) {
        setError('Contact number and email are required for business registration.')
        return false
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        setError('Please enter a valid business email address.')
        return false
      }
      if (form.openingTime && form.closingTime && form.closingTime <= form.openingTime) {
        setError('Closing time must be later than opening time.')
        return false
      }
      if (!form.legalEntityType || !form.tin.trim() || !form.yearEstablished) {
        setError('Legal entity, TIN, and year established are required for business registration.')
        return false
      }
    }
    if (step === 5 && (!mainPhoto || !form.contactNumber.trim() || !form.email.trim() || !form.legalEntityType || !form.tin.trim() || !form.yearEstablished)) {
      setError('Please go back and complete all required registration fields, including the main photo.')
      return false
    }
    setError('')
    return true
  }

  const next = () => {
    if (validateStep()) setStep((current) => Math.min(5, current + 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const back = () => {
    setError('')
    setStep((current) => Math.max(1, current - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = new FormData()
      payload.append('business_name', form.name)
      payload.append('business_description', form.description)
      payload.append('business_category_id', String(CATEGORY_ID))
      payload.append('municipality_id', form.municipalityId)
      payload.append('barangay_id', form.barangayId)
      payload.append('address', form.address)
      payload.append('contact_number', form.contactNumber)
      payload.append('email', form.email)
      payload.append('latitude', form.latitude)
      payload.append('longitude', form.longitude)
      payload.append('opening_time', form.openingTime || '08:00')
      payload.append('closing_time', form.closingTime || '17:00')
      payload.append('business_days[]', 'monday')
      payload.append('business_days[]', 'tuesday')
      payload.append('business_days[]', 'wednesday')
      payload.append('business_days[]', 'thursday')
      payload.append('business_days[]', 'friday')
      payload.append('business_days[]', 'saturday')
      payload.append('business_days[]', 'sunday')
      payload.append('legal_entity_type', form.legalEntityType)
      payload.append('tin', form.tin)
      payload.append('year_established', form.yearEstablished)
      payload.append('details[attraction_type]', form.attractionType)
      payload.append('details[entrance_fee]', form.entranceFee || '0')
      payload.append('details[best_time_to_visit]', form.bestTime)
      payload.append('details[activities]', form.activities)
      if (mainPhoto) payload.append('logo', mainPhoto)
      additionalPhotos.forEach((photo) => payload.append('gallery[]', photo))
      return post('/business-owner/businesses', payload)
    },
    onSuccess: () => {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY)
      navigate('/business-owner/businesses')
    },
    onError: (requestError: any) => {
      const response = requestError?.response?.data
      const validationErrors = response?.errors as Record<string, string[]> | undefined
      const messages = validationErrors
        ? Object.values(validationErrors).flat().filter(Boolean)
        : []
      setError(messages.length > 0 ? messages.join(' ') : response?.message || 'Unable to create the tourist attraction.')
    },
  })

  if (metaLoading) return <div className="p-10 text-center text-sm text-[#647067]">Loading registration form...</div>

  const latitude = form.latitude || '12.8667'
  const longitude = form.longitude || '121.4500'
  const locationName = [form.address, selectedMunicipality?.name, 'Oriental Mindoro'].filter(Boolean).join(', ')

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Register Tourist Attraction</h1>
        <p className="mt-1 text-sm text-[#647067]">Create a tourist spot listing for visitors to discover on TrackTour.</p>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl p-5 mb-6 shadow-tourism">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {steps.map((label, index) => {
            const number = index + 1
            return (
              <div key={label} className="flex items-center min-w-max">
                <button type="button" onClick={() => number < step && setStep(number)} className={`flex items-center gap-2 text-sm font-medium ${number <= step ? 'text-[#16803C]' : 'text-[#9CA3AF]'}`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${number < step ? 'bg-[#16803C] text-white' : number === step ? 'bg-[#EAF6ED] text-[#16803C] ring-2 ring-[#16803C]' : 'bg-[#F1F3F1] text-[#9CA3AF]'}`}>
                    {number < step ? <Check className="w-4 h-4" /> : number}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
                {number < steps.length && <span className="w-8 sm:w-16 h-px bg-[#D7E8DB] mx-2" />}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mb-6">
        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl p-6 lg:p-8 shadow-tourism">
        {step === 1 && (
          <div className="space-y-5">
            <div><h2 className="text-xl font-bold text-[#17201A]">Basic Information</h2><p className="text-sm text-[#647067] mt-1">Tell tourists about your attraction.</p></div>
            <Field label="Tourist Spot Name" required><input className={inputClass} value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="e.g. Bulalacao Beaches" /></Field>
            <Field label="Description" required><textarea className={`${inputClass} resize-none`} rows={5} value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Describe your tourist attraction..." /></Field>
            <Field label="Attraction Type" required>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAttractionTypeOpen((open) => !open)}
                  className={`${inputClass} flex items-center justify-between text-left ${form.attractionType ? 'text-[#16803C]' : 'text-[#9CA3AF]'}`}
                  aria-haspopup="listbox"
                  aria-expanded={attractionTypeOpen}
                >
                  <span>{form.attractionType || 'Select attraction type'}</span>
                  <ChevronDown className={`w-4 h-4 text-[#16803C] transition-transform ${attractionTypeOpen ? 'rotate-180' : ''}`} />
                </button>
                {attractionTypeOpen && (
                  <div className="absolute bottom-full z-20 mb-1 w-full overflow-hidden rounded-xl border border-[#BFE3CB] bg-white shadow-lg">
                    {attractionTypes.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          setField('attractionType', type)
                          setAttractionTypeOpen(false)
                        }}
                        className={`block w-full px-4 py-2.5 text-left text-sm transition-colors ${
                          form.attractionType === type
                            ? 'bg-[#EAF6ED] font-medium text-[#16803C]'
                            : 'text-[#17201A] hover:bg-[#F3F8F4] hover:text-[#16803C]'
                        }`}
                        role="option"
                        aria-selected={form.attractionType === type}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div><h2 className="text-xl font-bold text-[#17201A]">Location</h2><p className="text-sm text-[#647067] mt-1">Set the exact location used by the attraction map marker.</p></div>
            <Field label="Address" required><input className={inputClass} value={form.address} onChange={(event) => setField('address', event.target.value)} placeholder="Enter complete address" /></Field>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Municipality / City" required><select className={inputClass} value={form.municipalityId} onChange={(event) => { setField('municipalityId', event.target.value); setField('barangayId', '') }}><option value="">Select municipality</option>{municipalities.map((municipality) => <option key={municipality.id} value={municipality.id}>{municipality.name}</option>)}</select></Field>
              <Field label="Barangay" required><select className={inputClass} value={form.barangayId} onChange={(event) => setField('barangayId', event.target.value)} disabled={!selectedMunicipality}><option value="">Select barangay</option>{selectedMunicipality?.barangays?.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}</select></Field>
              <Field label="Province"><input className={`${inputClass} bg-[#F6F8F4]`} value="Oriental Mindoro" readOnly /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Latitude" required><input className={inputClass} value={form.latitude} onChange={(event) => setField('latitude', event.target.value)} placeholder="12.866700" /></Field>
              <Field label="Longitude" required><input className={inputClass} value={form.longitude} onChange={(event) => setField('longitude', event.target.value)} placeholder="121.450000" /></Field>
            </div>
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className={`${inputClass} flex-1`}
                  value={mapSearch}
                  onChange={(event) => setMapSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void searchMapLocation()
                    }
                  }}
                  placeholder="Search a place or address..."
                />
                <button
                  type="button"
                  onClick={() => void searchMapLocation()}
                  disabled={mapSearching}
                  className="px-5 py-3 rounded-xl bg-[#16803C] text-white text-sm font-medium hover:bg-[#126B32] disabled:opacity-60"
                >
                  {mapSearching ? 'Searching...' : 'Search Map'}
                </button>
              </div>
              {mapSearchError && <p className="text-xs text-red-600">{mapSearchError}</p>}
            </div>
            <div className="h-72 rounded-xl overflow-hidden border border-[#D7E8DB]">
              <MapContainer center={[Number(latitude), Number(longitude)]} zoom={form.latitude ? 16 : 10} className="h-full w-full">
                <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapCenter latitude={form.latitude} longitude={form.longitude} />
                <LocationMarker onChange={setLocation} />
                {form.latitude && form.longitude && <Marker position={[Number(form.latitude), Number(form.longitude)]} icon={beachPinIcon} />}
              </MapContainer>
            </div>
            <p className="text-xs text-[#647067] inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Click the map to pick the exact attraction location.</p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div><h2 className="text-xl font-bold text-[#17201A]">Photos</h2><p className="text-sm text-[#647067] mt-1">Add photos tourists can see. You can upload up to 10 photos.</p></div>
            <div>
              <Field label="Main Photo" required>
                <button type="button" onClick={() => mainPhotoRef.current?.click()} className="w-full h-56 border-2 border-dashed border-[#D7E8DB] rounded-xl bg-[#F6F8F4] hover:bg-[#EAF6ED] transition overflow-hidden">
                  {mainPreview ? <img src={mainPreview} alt="Main attraction preview" className="w-full h-full object-cover" /> : <span className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[#647067]"><Upload className="w-8 h-8 text-[#16803C]" />Upload Main Photo</span>}
                </button>
                <input ref={mainPhotoRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => addMainPhoto(event.target.files?.[0])} />
              </Field>
            </div>
            <div>
              <Field label={`Additional Photos (${additionalPhotos.length}/${MAX_PHOTOS - (mainPhoto ? 1 : 0)})`}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {additionalPreviews.map((preview, index) => <div key={preview} className="relative aspect-square rounded-xl overflow-hidden border border-[#D7E8DB]"><img src={preview} alt="" className="w-full h-full object-cover" /><button type="button" onClick={() => removeAdditionalPhoto(index)} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white"><X className="w-3 h-3" /></button></div>)}
                  {additionalPhotos.length < MAX_PHOTOS - (mainPhoto ? 1 : 0) && <button type="button" onClick={() => galleryRef.current?.click()} className="aspect-square rounded-xl border-2 border-dashed border-[#D7E8DB] flex flex-col items-center justify-center gap-1 text-xs text-[#647067] hover:bg-[#F6F8F4]"><ImagePlus className="w-6 h-6 text-[#16803C]" />Add Photo</button>}
                </div>
                <input ref={galleryRef} type="file" multiple accept="image/jpeg,image/png" className="hidden" onChange={(event) => addAdditionalPhotos(event.target.files)} />
              </Field>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div><h2 className="text-xl font-bold text-[#17201A]">Attraction Details</h2><p className="text-sm text-[#647067] mt-1">Give tourists useful information before they visit.</p></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Entrance Fee"><input type="number" min="0" step="0.01" className={inputClass} value={form.entranceFee} onChange={(event) => setField('entranceFee', event.target.value)} placeholder="0.00" /></Field>
              <Field label="Contact Number" required><input className={inputClass} value={form.contactNumber} onChange={(event) => setField('contactNumber', event.target.value)} placeholder="09XXXXXXXXX" /></Field>
              <Field label="Opening Time"><input type="time" className={inputClass} value={form.openingTime} onChange={(event) => setField('openingTime', event.target.value)} /></Field>
              <Field label="Closing Time"><input type="time" className={inputClass} value={form.closingTime} onChange={(event) => setField('closingTime', event.target.value)} /></Field>
            </div>
            <Field label="Business Email" required><input type="email" className={inputClass} value={form.email} onChange={(event) => setField('email', event.target.value)} placeholder="attraction@example.com" /></Field>
            <Field label="Best Time to Visit"><input className={inputClass} value={form.bestTime} onChange={(event) => setField('bestTime', event.target.value)} placeholder="e.g. December to May" /></Field>
            <Field label="Activities"><textarea className={`${inputClass} resize-none`} rows={3} value={form.activities} onChange={(event) => setField('activities', event.target.value)} placeholder="Swimming, hiking, sightseeing..." /></Field>
            <div className="border-t border-[#E2E8E3] pt-5">
              <h3 className="text-sm font-semibold text-[#16803C] mb-3">Business Registration Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Legal Entity" required><select className={inputClass} value={form.legalEntityType} onChange={(event) => setField('legalEntityType', event.target.value)}><option value="">Select type</option><option>Sole Proprietorship</option><option>Partnership</option><option>Corporation</option><option>OPC</option></select></Field>
                <Field label="TIN" required><input className={inputClass} value={form.tin} onChange={(event) => setField('tin', event.target.value)} placeholder="Tax Identification Number" /></Field>
                <Field label="Year Established" required><input type="number" className={inputClass} value={form.yearEstablished} onChange={(event) => setField('yearEstablished', event.target.value)} placeholder="2026" /></Field>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <div><h2 className="text-xl font-bold text-[#17201A]">Review & Submit</h2><p className="text-sm text-[#647067] mt-1">Check your information before creating the attraction.</p></div>
            {mainPreview && <img src={mainPreview} alt="Main attraction" className="w-full h-56 object-cover rounded-xl" />}
            <div><h3 className="text-2xl font-bold text-[#17201A]">{form.name || 'Unnamed attraction'}</h3><p className="text-sm text-[#16803C] mt-1">Tourist Attraction · {form.attractionType || 'Type not selected'}</p></div>
            <ReviewRow label="Description" value={form.description} />
            <ReviewRow label="Location" value={locationName || 'Not specified'} />
            <ReviewRow label="Coordinates" value={`${form.latitude || '—'}, ${form.longitude || '—'}`} />
            <ReviewRow label="Entrance Fee" value={`₱${Number(form.entranceFee || 0).toFixed(2)}`} />
            <ReviewRow label="Opening Hours" value={form.openingTime && form.closingTime ? `${form.openingTime} - ${form.closingTime}` : 'Not specified'} />
            <ReviewRow label="Best Time to Visit" value={form.bestTime || 'Not specified'} />
            <ReviewRow label="Activities" value={form.activities || 'Not specified'} />
            <ReviewRow label="Contact" value={`${form.contactNumber || '—'} · ${form.email || '—'}`} />
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-[#E2E8E3] flex justify-between gap-3">
          <button type="button" onClick={back} disabled={step === 1 || mutation.isPending} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#D7E8DB] text-sm font-medium text-[#647067] disabled:opacity-40"><ArrowLeft className="w-4 h-4" /> Back</button>
          {step < 5 ? <button type="button" onClick={next} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#16803C] text-white text-sm font-medium hover:bg-[#126B32]"><span>Next</span><ArrowRight className="w-4 h-4" /></button> : <button type="button" onClick={() => { if (validateStep()) mutation.mutate() }} disabled={mutation.isPending} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#16803C] text-white text-sm font-medium hover:bg-[#126B32] disabled:opacity-60"><Check className="w-4 h-4" />{mutation.isPending ? 'Creating...' : 'Create Attraction'}</button>}
        </div>
      </div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-[#E2E8E3] pb-3"><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">{label}</p><p className="mt-1 text-sm text-[#17201A] whitespace-pre-line">{value}</p></div>
}
