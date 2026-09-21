import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put, post, del } from '@/shared/services/api'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'
import { toAssetUrl } from '@/shared/utils'
import { Alert } from '@/shared/components/Alert'

interface SwitcherBusiness {
  id: number
  name: string
  category: string
  status: string
  logo: string | null
  module_codes?: string[]
}

interface SwitcherData {
  businesses: SwitcherBusiness[]
  selected_business_id: number | null
}
import {
  ArrowLeft, Save, Building2, MapPin, Clock, Eye, FileText, Image as ImageIcon,
  Star, BarChart3, Settings, CreditCard, Users, Trash2, Upload, X, Plus,
  AlertTriangle, Globe, Link2, Phone, Mail, Landmark, Archive, RotateCcw, Search, Filter,
} from 'lucide-react'

type Tab = 'general' | 'location' | 'hours' | 'visibility' | 'documents' | 'archive' | 'promotions'
  | 'reviews' | 'analytics' | 'config' | 'staff' | 'payments' | 'danger'

interface BusinessData {
  id: number
  business_name: string
  business_description: string | null
  tagline: string | null
  logo: string | null
  cover_photo: string | null
  contact_number: string | null
  email: string | null
  website: string | null
  facebook: string | null
  instagram: string | null
  address: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  opening_time: string | null
  closing_time: string | null
  business_days: string[] | null
  business_hours: Record<string, { open: string; close: string }[]> | null
  is_open: boolean
  is_accepting_orders: boolean
  availability: string
  open_status: { status: string; label: string }
  schedule_summary: string
  force_closed: boolean | null
  status: string
  category: string
  business_category_id: number
  municipality: string
  barangay: string
  price_range: string | null
  accepts_reservation: boolean
  facilities: string[] | null
  services: string[] | null
  payment_methods: string[] | null
}

interface ArchivedItem {
  id: number
  type: string
  name: string
  business_id: number
  deleted_at: string
}

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
  { key: 'location', label: 'Location', icon: <MapPin className="w-4 h-4" /> },
  { key: 'hours', label: 'Hours', icon: <Clock className="w-4 h-4" /> },
  { key: 'visibility', label: 'Visibility', icon: <Eye className="w-4 h-4" /> },
  { key: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" /> },
  { key: 'archive', label: 'Archive Vault', icon: <Archive className="w-4 h-4" /> },
  { key: 'promotions', label: 'Promotions', icon: <Star className="w-4 h-4" /> },
  { key: 'reviews', label: 'Reviews', icon: <Star className="w-4 h-4" /> },
  { key: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" /> },
  { key: 'config', label: 'Config', icon: <Settings className="w-4 h-4" /> },
  { key: 'staff', label: 'Staff', icon: <Users className="w-4 h-4" /> },
  { key: 'payments', label: 'Payments', icon: <CreditCard className="w-4 h-4" /> },
  { key: 'danger', label: 'Danger', icon: <AlertTriangle className="w-4 h-4" /> },
]

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const PAYMENT_OPTIONS = ['Cash', 'GCash', 'Maya', 'Credit Card', 'Debit Card', 'Bank Transfer']
const FACILITY_OPTIONS = ['WiFi', 'Parking', 'Air Conditioning', 'Outdoor Seating', 'Delivery', 'Takeout', 'Reservations', 'Live Music', 'TV/Screen', 'Private Room']
const PRICE_RANGES = ['budget', 'affordable', 'mid_range', 'premium', 'luxury']

export default function BusinessOwnerSettings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { selectedBusinessId, businesses, setBusinesses, setSelectedBusinessId } = useBusinessOwnerStore()

  // Fallback: if store is empty, fetch businesses and auto-select
  const { data: switcherData } = useQuery({
    queryKey: ['bo-businesses-switcher'],
    queryFn: () => get<SwitcherData>('/business-owner/businesses/switcher'),
    enabled: businesses.length === 0,
  })

  useEffect(() => {
    if (switcherData?.businesses) {
      setBusinesses(switcherData.businesses)
      if (switcherData.businesses.length === 1 && !selectedBusinessId) {
        setSelectedBusinessId(switcherData.businesses[0].id)
      }
    }
  }, [switcherData, setBusinesses, setSelectedBusinessId, selectedBusinessId])

  const tabParam = searchParams.get('tab') as Tab | null
  const activeTab: Tab = TABS.some(t => t.key === tabParam) ? tabParam! : 'general'

  const setActiveTab = (tab: Tab) => {
    setSearchParams({ tab })
  }

  const activeId = selectedBusinessId

  const { data: business, isLoading } = useQuery({
    queryKey: ['bo-business', activeId],
    queryFn: () => get<BusinessData>(`/business-owner/businesses/${activeId}`),
    enabled: !!activeId,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => put(`/business-owner/businesses/${activeId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', activeId] })
      queryClient.invalidateQueries({ queryKey: ['bo-businesses'] })
    },
  })

  const logoMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('logo', file)
      return post(`/business-owner/businesses/${activeId}/logo`, fd)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-business', activeId] }),
  })

  const coverMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('cover_photo', file)
      return post(`/business-owner/businesses/${activeId}/cover-photo`, fd)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-business', activeId] }),
  })

  const disabled = !activeId

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Business Settings</h1>
        <p className="mt-1 text-sm text-[#647067]">Configure your business preferences</p>
      </div>

      {disabled && (
        <div className="mb-6 bg-[#FFF7D6] border border-[#F4B400]/40 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#A66F00] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#7A5B00]">Register your business first</p>
            <p className="text-xs text-[#A66F00] mt-0.5">You need to create and register a business before you can configure its settings.</p>
            <Link to="/business-owner/businesses/create" className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-[#16803C] hover:text-[#126B32] transition">
              <Plus className="w-3 h-3" />Create Business
            </Link>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] p-12 text-center">
            <div className="w-8 h-8 border-2 border-[#16803C] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-[#647067] mt-3">Loading settings...</p>
          </div>
        ) : (
          <div className={disabled ? 'relative pointer-events-none select-none opacity-60' : ''}>
            {disabled && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl">
                <span className="bg-white/80 backdrop-blur-sm text-[#647067] text-sm font-medium px-4 py-2 rounded-xl border border-[#E2E8E3] shadow-sm">
                  Select or register a business to edit settings
                </span>
              </div>
            )}
            {activeTab === 'general' && <GeneralSection business={business} mutation={updateMutation} logoMutation={logoMutation} coverMutation={coverMutation} />}
            {activeTab === 'location' && <LocationSection business={business} mutation={updateMutation} />}
            {activeTab === 'hours' && <HoursSection business={business} mutation={updateMutation} />}
            {activeTab === 'visibility' && <VisibilitySection business={business} />}
            {activeTab === 'documents' && <DocumentsSection businessId={activeId} />}
            {activeTab === 'archive' && <ArchiveVaultSection />}
            {activeTab === 'danger' && <DangerSection business={business} />}
            {!['general', 'location', 'hours', 'visibility', 'documents', 'archive', 'danger'].includes(activeTab) && (
              <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
                <Settings className="w-10 h-10 text-[#647067] mx-auto mb-3" />
                <p className="text-sm text-[#647067]">This section is coming soon.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── General Section ────────────────────────────────────── */
function GeneralSection({ business, mutation, logoMutation, coverMutation }: {
  business: BusinessData | undefined
  mutation: ReturnType<typeof useMutation>
  logoMutation: ReturnType<typeof useMutation>
  coverMutation: ReturnType<typeof useMutation>
}) {
  const [form, setForm] = useState({
    business_name: '', business_description: '', tagline: '',
    contact_number: '', email: '', website: '',
    facebook: '', instagram: '', price_range: '',
  })
  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (business) {
      setForm({
        business_name: business.business_name || '',
        business_description: business.business_description || '',
        tagline: business.tagline || '',
        contact_number: business.contact_number || '',
        email: business.email || '',
        website: business.website || '',
        facebook: business.facebook || '',
        instagram: business.instagram || '',
        price_range: business.price_range || '',
      })
    }
  }, [business])

  const handle = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="space-y-6">
      {/* Cover + Logo */}
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8E3]">
          <h2 className="text-sm font-semibold text-[#17201A]">Branding</h2>
        </div>
        <div className="p-6">
          <div className="relative h-32 rounded-xl overflow-hidden bg-gradient-to-br from-[#EAF6ED] to-[#F3F8F4] mb-4">
            {business?.cover_photo ? (
              <img src={toAssetUrl(business.cover_photo)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-[#647067]">No cover photo</div>
            )}
            <button onClick={() => coverRef.current?.click()} className="absolute top-2 right-2 bg-black/50 text-white rounded-lg px-3 py-1.5 text-xs hover:bg-black/70 transition">
              <Upload className="w-3 h-3 inline mr-1" />Change Cover
            </button>
            <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) coverMutation.mutate(e.target.files[0]) }} />
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-xl bg-[#E2E8E3] overflow-hidden border-4 border-white shadow">
                {business?.logo ? (
                  <img src={toAssetUrl(business.logo)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Building2 className="w-8 h-8 text-[#647067]" /></div>
                )}
              </div>
              <button onClick={() => logoRef.current?.click()} className="absolute -bottom-1 -right-1 w-7 h-7 bg-[#16803C] text-white rounded-full flex items-center justify-center hover:bg-[#126B32] transition">
                <Upload className="w-3 h-3" />
              </button>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) logoMutation.mutate(e.target.files[0]) }} />
            </div>
            <div>
              <p className="text-sm font-medium text-[#17201A]">{business?.business_name}</p>
              <p className="text-xs text-[#647067]">{business?.category}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Business Info */}
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-4">Business Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Business Name" value={form.business_name} onChange={v => handle('business_name', v)} />
          <Field label="Tagline" value={form.tagline} onChange={v => handle('tagline', v)} placeholder="e.g. Taste the best" />
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
            <textarea rows={3} value={form.business_description} onChange={e => handle('business_description', e.target.value)} className="w-full bg-white border border-[#E2E8E3] rounded-xl px-4 py-2.5 text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]" placeholder="Describe your business..." />
          </div>
          <Field label="Contact Number" value={form.contact_number} onChange={v => handle('contact_number', v)} icon={<Phone className="w-4 h-4 text-[#647067]" />} />
          <Field label="Email" value={form.email} onChange={v => handle('email', v)} type="email" icon={<Mail className="w-4 h-4 text-[#647067]" />} />
          <Field label="Website" value={form.website} onChange={v => handle('website', v)} icon={<Globe className="w-4 h-4 text-[#647067]" />} />
          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Price Range</label>
            <select value={form.price_range} onChange={e => handle('price_range', e.target.value)} className="w-full bg-white border border-[#E2E8E3] rounded-xl px-4 py-2.5 text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]">
              <option value="">Select...</option>
              {PRICE_RANGES.map(p => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={() => mutation.mutate(form)} disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            <Save className="w-4 h-4" />{mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Social Media */}
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-4 flex items-center gap-2"><Link2 className="w-4 h-4 text-[#16803C]" /> Social Media</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Facebook" value={form.facebook} onChange={v => handle('facebook', v)} placeholder="Facebook URL" />
          <Field label="Instagram" value={form.instagram} onChange={v => handle('instagram', v)} placeholder="Instagram URL" />
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={() => mutation.mutate({ facebook: form.facebook, instagram: form.instagram })} disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            <Save className="w-4 h-4" />Save Social Links
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Location Section ────────────────────────────────────── */
function LocationSection({ business, mutation }: { business: BusinessData | undefined; mutation: ReturnType<typeof useMutation> }) {
  const [form, setForm] = useState({ address: '', landmark: '', latitude: '', longitude: '' })

  useEffect(() => {
    if (business) {
      setForm({
        address: business.address || '',
        landmark: business.landmark || '',
        latitude: business.latitude?.toString() || '',
        longitude: business.longitude?.toString() || '',
      })
    }
  }, [business])

  const handle = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
      <h2 className="text-sm font-semibold text-[#17201A] mb-4 flex items-center gap-2"><MapPin className="w-4 h-4 text-[#16803C]" /> Location</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Street Address</label>
          <textarea rows={2} value={form.address} onChange={e => handle('address', e.target.value)} className="w-full bg-white border border-[#E2E8E3] rounded-xl px-4 py-2.5 text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]" placeholder="Enter full address" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Landmark" value={form.landmark} onChange={v => handle('landmark', v)} placeholder="Near..." icon={<Landmark className="w-4 h-4 text-[#647067]" />} />
          <div />
          <Field label="Latitude" value={form.latitude} onChange={v => handle('latitude', v)} placeholder="e.g. 9.8472" />
          <Field label="Longitude" value={form.longitude} onChange={v => handle('longitude', v)} placeholder="e.g. 123.9894" />
        </div>
        {form.latitude && form.longitude && (
          <div className="rounded-xl overflow-hidden border border-[#E2E8E3] h-48 bg-[#F3F8F4] flex items-center justify-center">
            <p className="text-xs text-[#647067]">Map preview ({form.latitude}, {form.longitude})</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={() => mutation.mutate({ address: form.address, landmark: form.landmark, latitude: form.latitude || null, longitude: form.longitude || null })} disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
          <Save className="w-4 h-4" />{mutation.isPending ? 'Saving...' : 'Save Location'}
        </button>
      </div>
    </div>
  )
}

/* ─── Hours Section ────────────────────────────────────── */
type DayPeriod = { open: string; close: string }
type HoursForm = Record<string, { enabled: boolean; periods: DayPeriod[] }>

function HoursSection({ business }: { business: BusinessData | undefined; mutation: ReturnType<typeof useMutation> }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<HoursForm>({})
  const [forceClosed, setForceClosed] = useState(false)
  const [feedback, setFeedback] = useState<{ key: number; type: 'success' | 'error'; msg: string } | null>(null)
  const feedbackKey = useRef(0)

  const pushFeedback = (type: 'success' | 'error', msg: string) => {
    feedbackKey.current += 1
    setFeedback({ key: feedbackKey.current, type, msg })
  }

  useEffect(() => {
    const hours = business?.business_hours || {}
    const next: HoursForm = {}
    DAYS.forEach(d => {
      const periods = Array.isArray(hours[d]) ? hours[d] : []
      next[d] = {
        enabled: periods.length > 0,
        periods: periods.length > 0 ? periods : [{ open: '08:00', close: '17:00' }],
      }
    })
    setForm(next)
    setForceClosed(!!business?.force_closed)
  }, [business])

  const saveMutation = useMutation({
    mutationFn: (data: { business_hours: Record<string, DayPeriod[]>; force_closed: boolean }) =>
      put(`/business-owner/businesses/${business?.id}/hours`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', business?.id] })
      pushFeedback('success', 'Restaurant hours and status saved successfully.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to save. Please check your entries and try again.'
      pushFeedback('error', msg)
    },
  })

  const buildPayload = () => {
      const business_hours: Record<string, DayPeriod[]> = {}
      DAYS.forEach(d => {
        business_hours[d] = form[d]?.enabled
          ? form[d].periods.map(p => ({ open: p.open.slice(0, 5), close: p.close.slice(0, 5) }))
          : []
      })
      return { business_hours, force_closed: forceClosed }
    }

  const clearFeedback = () => setFeedback(null)

  const setDayEnabled = (d: string, enabled: boolean) => {
    clearFeedback()
    setForm(prev => ({ ...prev, [d]: { ...prev[d], enabled } }))
  }

  const updatePeriod = (d: string, idx: number, field: keyof DayPeriod, value: string) => {
    clearFeedback()
    setForm(prev => {
      const periods = prev[d].periods.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
      return { ...prev, [d]: { ...prev[d], periods } }
    })
  }

  const addPeriod = (d: string) => {
    clearFeedback()
    setForm(prev => ({
      ...prev,
      [d]: { ...prev[d], periods: [...prev[d].periods, { open: '08:00', close: '17:00' }] },
    }))
  }

  const removePeriod = (d: string, idx: number) => {
    clearFeedback()
    setForm(prev => ({
      ...prev,
      [d]: { ...prev[d], periods: prev[d].periods.filter((_, i) => i !== idx) },
    }))
  }

  const toggleForceClosed = () => {
    clearFeedback()
    setForceClosed(f => !f)
  }

  const saving = saveMutation.isPending

  return (
    <div className="space-y-6">
      {/* Temporary closure override */}
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-1 flex items-center gap-2"><Clock className="w-4 h-4 text-[#16803C]" /> Restaurant Status</h2>
        <p className="text-xs text-[#647067] mb-4">Choose how your availability is determined.</p>
        {feedback && (
          <Alert key={feedback.key} type={feedback.type} message={feedback.msg} onDismiss={() => setFeedback(null)} />
        )}
        <div className="space-y-3">
          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${!forceClosed ? 'border-[#16803C]/40 bg-[#EAF6ED]' : 'border-[#E2E8E3]'}`}>
            <input type="radio" className="mt-0.5 text-[#16803C] focus:ring-[#16803C]/25" checked={!forceClosed} onChange={() => toggleForceClosed()} />
            <div>
              <p className="text-sm font-medium text-[#17201A]">Automatic — Follow business hours</p>
              <p className="text-xs text-[#647067]">Open/closed is determined automatically by your schedule below.</p>
            </div>
          </label>
          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${forceClosed ? 'border-red-300 bg-red-50' : 'border-[#E2E8E3]'}`}>
            <input type="radio" className="mt-0.5 text-red-600 focus:ring-red-200" checked={forceClosed} onChange={() => toggleForceClosed()} />
            <div>
                <p className="text-sm font-medium text-[#17201A]">Temporarily Closed</p>
                <p className="text-xs text-[#647067]">Close immediately, even during your normal opening hours.</p>
              </div>
            </label>
          </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveMutation.mutate(buildPayload())}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Status'}
          </button>
        </div>
      </div>

      {/* Per-day multi-period schedule */}
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-1 flex items-center gap-2"><Clock className="w-4 h-4 text-[#16803C]" /> Opening Hours</h2>
        <p className="text-xs text-[#647067] mb-5">Set one or more operating periods per day. Leave a day unchecked to close it.</p>
        <div className="space-y-4">
          {DAYS.map(d => {
            const day = form[d]
            if (!day) return null
            return (
              <div key={d} className="border border-[#E8ECE9] rounded-xl p-4">
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <input type="checkbox" checked={day.enabled} onChange={e => setDayEnabled(d, e.target.checked)} className="w-4 h-4 rounded border-[#D1D5DB] text-[#16803C] focus:ring-[#16803C]/25" />
                  <span className="text-sm font-medium text-[#17201A] capitalize w-28">{d}</span>
                  {day.enabled ? (
                    <span className="text-xs text-[#16803C] bg-[#EAF6ED] px-2 py-0.5 rounded-full font-medium">Open</span>
                  ) : (
                    <span className="text-xs text-[#647067] bg-[#F3F4F6] px-2 py-0.5 rounded-full font-medium">Closed</span>
                  )}
                </label>
                {day.enabled && (
                  <div className="space-y-2 ml-10">
                    {day.periods.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input type="time" value={p.open} onChange={e => updatePeriod(d, idx, 'open', e.target.value)} className="bg-white border border-[#E2E8E3] rounded-lg px-3 py-1.5 text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25" />
                        <span className="text-[#647067] text-sm">to</span>
                        <input type="time" value={p.close} onChange={e => updatePeriod(d, idx, 'close', e.target.value)} className="bg-white border border-[#E2E8E3] rounded-lg px-3 py-1.5 text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25" />
                        {day.periods.length > 1 && (
                          <button onClick={() => removePeriod(d, idx)} className="p-1.5 text-[#B91C1C] hover:bg-red-50 rounded-lg transition" title="Remove period">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => addPeriod(d)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#16803C] hover:text-[#126B32] transition">
                      <Plus className="w-3.5 h-3.5" /> Add opening period
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={() => saveMutation.mutate(buildPayload())}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Hours'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Visibility Section ────────────────────────────────── */
function VisibilitySection({ business }: { business: BusinessData | undefined }) {
  const status = business?.open_status?.status ?? (business?.is_open ? 'open' : 'closed')
  const statusLabel = business?.open_status?.label ?? (business?.is_open ? 'Open now' : 'Closed')

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-4 flex items-center gap-2"><Eye className="w-4 h-4 text-[#16803C]" /> Business Status</h2>
        <div className="flex items-center justify-between py-3 border-b border-[#E2E8E3]">
          <div>
            <p className="text-sm font-medium text-[#17201A]">Current availability</p>
            <p className="text-xs text-[#647067]">{business?.schedule_summary || business?.business_days?.join(', ') || 'No hours configured'}</p>
          </div>
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${
            status === 'open' ? 'bg-[#EAF6ED] text-[#16803C]' :
            status === 'temporarily_closed' ? 'bg-red-50 text-[#B91C1C]' :
            'bg-[#F3F4F6] text-[#647067]'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              status === 'open' ? 'bg-[#16803C]' :
              status === 'temporarily_closed' ? 'bg-[#B91C1C]' :
              'bg-[#647067]'
            }`} />
            {statusLabel}
          </span>
        </div>
        <p className="text-xs text-[#647067] mt-3">
          Availability is determined automatically by your business hours, unless you set the business to Temporarily Closed in the Hours tab.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-4">Accept Settings</h2>
        <div className="space-y-3">
          {[
            { label: 'Accept Bookings', desc: 'Allow customers to make reservations', defaultOn: true },
            { label: 'Accept Orders', desc: 'Allow online food/service orders', defaultOn: false },
            { label: 'Accept Walk-ins', desc: 'Welcome walk-in customers', defaultOn: true },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-3 border-b border-[#E2E8E3] last:border-0">
              <div>
                <p className="text-sm font-medium text-[#17201A]">{item.label}</p>
                <p className="text-xs text-[#647067]">{item.desc}</p>
              </div>
              <label className="relative inline-flex cursor-pointer">
                <input type="checkbox" defaultChecked={item.defaultOn} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-[#16803C]/25 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#16803C]" />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Documents Section ────────────────────────────────── */
function DocumentsSection({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['bo-documents', businessId],
    queryFn: () => get<{ documents: Array<{ id: number; document_number: string | null; verification_status: string; file_path: string | null; created_at: string }> }>(`/business-owner/businesses/${businessId}/documents`),
  })

  const deleteMutation = useMutation({
    mutationFn: (docId: number) => del(`/business-owner/businesses/${businessId}/documents/${docId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-documents', businessId] }),
  })

  if (isLoading) return <LoadingCard />

  const docs = data?.documents ?? []

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
      <h2 className="text-sm font-semibold text-[#17201A] mb-4 flex items-center gap-2"><FileText className="w-4 h-4 text-[#16803C]" /> Documents</h2>
      {docs.length === 0 ? (
        <p className="text-sm text-[#647067] text-center py-6">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-3">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between py-3 border-b border-[#E2E8E3] last:border-0">
              <div>
                <p className="text-sm font-medium text-[#17201A]">{doc.document_number || 'Untitled Document'}</p>
                <p className="text-xs text-[#647067]">Uploaded {new Date(doc.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  doc.verification_status === 'approved' ? 'bg-green-100 text-green-700' :
                  doc.verification_status === 'flagged' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {doc.verification_status}
                </span>
                <button onClick={() => deleteMutation.mutate(doc.id)} className="text-[#B91C1C] hover:text-red-700 transition p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Danger Zone ────────────────────────────────────────── */
function DangerSection({ business }: { business: BusinessData | undefined }) {
  return (
    <div className="bg-white rounded-2xl border border-red-200 shadow-[0_6px_18px_rgba(185,28,28,0.06)] p-6">
      <h2 className="text-sm font-semibold text-red-700 mb-4 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Danger Zone</h2>
      <div className="space-y-4">
        <div className="flex items-center justify-between py-3 border-b border-red-100">
          <div>
            <p className="text-sm font-medium text-[#17201A]">Archive Business</p>
            <p className="text-xs text-[#647067]">Hide this business from public view</p>
          </div>
          <button className="px-4 py-2 rounded-xl border border-[#E2E8E3] text-sm text-[#647067] hover:bg-[#F3F8F4] transition">Archive</button>
        </div>
        <div className="flex items-center justify-between py-3 border-b border-red-100">
          <div>
            <p className="text-sm font-medium text-[#17201A]">Transfer Ownership</p>
            <p className="text-xs text-[#647067]">Transfer this business to another account</p>
          </div>
          <button className="px-4 py-2 rounded-xl border border-[#E2E8E3] text-sm text-[#647067] hover:bg-[#F3F8F4] transition">Transfer</button>
        </div>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-red-700">Delete Business</p>
            <p className="text-xs text-[#647067]">Permanently delete this business and all its data</p>
          </div>
          <button className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm hover:bg-red-700 transition">Delete</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Archive Vault Section ────────────────────────────────── */
function ArchiveVaultSection() {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery<{ items: ArchivedItem[] }>({
    queryKey: ['bo-archive'],
    queryFn: () => get<{ items: ArchivedItem[] }>('/business-owner/archive'),
  })

  const items = data?.items ?? []

  const filtered = items.filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const restoreMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: number }) =>
      post(`/business-owner/archive/${type}/${id}/restore`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-archive'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: number }) =>
      del(`/business-owner/archive/${type}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-archive'] }),
  })

  const types = Array.from(new Set(items.map((i) => i.type)))

  const typeConfig: Record<string, { label: string; color: string }> = {
    offering: { label: 'Offering', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
    promotion: { label: 'Promotion', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
    order: { label: 'Order', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
    booking: { label: 'Booking', color: 'text-[#A66F00] bg-[#FFF7D6] border-[#F4B400]/40' },
    staff: { label: 'Staff', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
    media: { label: 'Media', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
    category: { label: 'Category', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
    document: { label: 'Document', color: 'text-[#647067] bg-[#F3F4F6] border-[#E5E7EB]' },
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-4 lg:p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#647067]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archived items..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
            />
          </div>
          <div className="relative w-full sm:w-48">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#647067]" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition appearance-none"
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>{typeConfig[t]?.label ?? t}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <LoadingCard />
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <Archive className="w-12 h-12 text-[#647067] mx-auto mb-3" />
          <p className="text-[#647067] font-medium">No archived items found</p>
          <p className="text-sm text-[#647067] mt-1">Archived items from all modules will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-[#F6F8F4] border-b border-[#E2E8E3]">
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Name</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Type</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Archived At</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {filtered.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="hover:bg-[#F6F8F4] transition-colors">
                    <td className="px-5 py-3.5 font-medium text-[#17201A]">{item.name}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${typeConfig[item.type]?.color ?? 'text-[#647067] bg-[#F3F4F6] border-[#E5E7EB]'}`}>
                        {typeConfig[item.type]?.label ?? item.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[#647067] text-xs">
                      {new Date(item.deleted_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => restoreMutation.mutate({ type: item.type, id: item.id })}
                          className="p-2 text-[#16803C] hover:bg-[#EAF6ED] rounded-lg transition-colors"
                          title="Restore"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Permanently delete this item? This cannot be undone.')) {
                              deleteMutation.mutate({ type: item.type, id: item.id })
                            }
                          }}
                          className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg transition-colors"
                          title="Permanently Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Shared Components ────────────────────────────────── */
function Field({ label, value, onChange, type = 'text', placeholder, icon }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; icon?: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#4B5563] mb-1.5">{label}</label>
      <div className="relative">
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</div>}
        <input
          type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className={`w-full bg-white border border-[#E2E8E3] rounded-xl py-2.5 text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] ${icon ? 'pl-10 pr-4' : 'px-4'}`}
        />
      </div>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8E3] p-12 text-center">
      <div className="w-8 h-8 border-2 border-[#16803C] border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-sm text-[#647067] mt-3">Loading...</p>
    </div>
  )
}
