import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put, post, del } from '@/shared/services/api'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'
import { formatCurrency, formatDate, formatDateTime, toAssetUrl } from '@/shared/utils'
import { Alert } from '@/shared/components/Alert'
import { Modal } from '@/shared/components/Modal'

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
  AlertTriangle, Globe, Link2, Phone, Mail, Landmark, Archive, RotateCcw, Search, Filter, Receipt, Wallet,
} from 'lucide-react'

type Tab = 'general' | 'location' | 'hours' | 'visibility' | 'documents' | 'archive' | 'promotions'
  | 'reviews' | 'analytics' | 'config' | 'staff' | 'payments' | 'payment-methods' | 'danger'

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
  { key: 'payment-methods', label: 'Payment Methods', icon: <Wallet className="w-4 h-4" /> },
  { key: 'payments', label: 'Payments', icon: <CreditCard className="w-4 h-4" /> },
  { key: 'danger', label: 'Danger', icon: <AlertTriangle className="w-4 h-4" /> },
]

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const TAB_TITLES: Record<Tab, string> = {
  general: 'Business Settings',
  location: 'Location',
  hours: 'Operating Hours',
  visibility: 'Visibility',
  documents: 'Documents',
  archive: 'Archive Vault',
  promotions: 'Promotions',
  reviews: 'Reviews',
  analytics: 'Analytics',
  config: 'Config',
  staff: 'Staff',
  payments: 'Payment Tracking',
  'payment-methods': 'Payment Methods',
  danger: 'Danger Zone',
}

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
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">{TAB_TITLES[activeTab]}</h1>
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
            {activeTab === 'payment-methods' && <PaymentMethodsSection business={business} />}
            {activeTab === 'payments' && <PaymentSettingsSection business={business} />}
            {activeTab === 'danger' && <DangerSection business={business} />}
            {!['general', 'location', 'hours', 'visibility', 'documents', 'archive', 'payment-methods', 'payments', 'danger'].includes(activeTab) && (
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

/* ─── Payment Methods Section ────────────────────────────── */
type PaymentOption = { key: string; label: string; desc: string; online: boolean }

const PAYMENT_OPTION_DEFS: PaymentOption[] = [
  { key: 'cash', label: 'Cash on Delivery', desc: 'Customer pays cash to the rider on delivery (or at pickup).', online: false },
  { key: 'gcash', label: 'GCash (Online)', desc: 'Customer prepays online via GCash through PayMongo.', online: true },
  { key: 'card', label: 'Card (Online)', desc: 'Customer prepays online via credit/debit card through PayMongo.', online: true },
]

interface PaymentRecord {
  id: number
  order_number: string
  group_reference: string | null
  customer_name: string | null
  placed_at: string
  payment_method: string
  payment_label: string
  payment_status: string
  order_status: string
  total: number
  paid_amount: number
  settlement_number: string | null
  settlement_amount: number | null
  settlement_status: string | null
  settled_at: string | null
}

interface PaymentSummary {
  orders_count: number
  total_received: number
  cash_count: number
  cash_total: number
  online_count: number
  online_total: number
  paid_count: number
  settled_amount: number
}

interface PaymentsResponseMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
  summary: PaymentSummary
}

interface PaymentDetailItem {
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
  status: string
}

interface PaymentDetail {
  id: number
  order_number: string
  group_reference: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  placed_at: string
  order_type: string | null
  delivery_speed: string | null
  order_status: string
  payment_method: string
  payment_label: string
  payment_status: string
  items: PaymentDetailItem[]
  totals: {
    subtotal: number
    delivery_fee: number
    rider_tip: number
    system_fee: number
    discount: number
    total: number
    paid_amount: number
    refunded_amount: number
    refund_status: string | null
  }
  delivery: {
    status: string
    dispatch_status: string | null
    address: string | null
    rider_name: string | null
    delivered_at: string | null
  } | null
  settlement: {
    settlement_number: string
    source: string
    payment_method: string
    settlement_base: number
    restaurant_amount: number
    platform_amount: number
    status: string
    settled_at: string | null
  } | null
}

function paymentStatusStyles(status: string): string {
  if (status === 'paid') return 'text-[#16803C] font-semibold'
  if (status === 'refunded') return 'text-[#647067]'
  return 'text-[#B45309]'
}

function PaymentTransactionModal({ businessId, record, onClose }: {
  businessId: number | undefined
  record: PaymentRecord
  onClose: () => void
}) {
  const { data: d, isLoading } = useQuery({
    queryKey: ['bo-payment-detail', businessId, record.id],
    queryFn: () => get<PaymentDetail>(`/business-owner/businesses/${businessId}/payments/${record.id}`),
    enabled: !!businessId,
  })

  return (
    <Modal show onClose={onClose} maxWidth="2xl">
      <div className="p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#16803C]/10">
              <Receipt className="w-5 h-5 text-[#16803C]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#17201A]">Transaction {record.order_number}</h3>
              <p className="text-xs text-[#647067]">Payment record details</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[#647067] hover:text-[#17201A] hover:bg-[#F1F4F1] rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading || !d ? (
          <div className="py-12 text-center">
            {isLoading ? (
              <>
                <div className="w-8 h-8 border-2 border-[#16803C] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-[#647067] mt-3">Loading transaction...</p>
              </>
            ) : (
              <p className="text-sm text-[#B91C1C]">Failed to load this transaction.</p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${d.payment_method === 'cash' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#EAF6ED] text-[#16803C]'}`}>
                {d.payment_label}
              </span>
              <span className={`text-xs font-medium ${paymentStatusStyles(d.payment_status)}`}>
                {d.payment_status === 'paid' ? 'Paid' : d.payment_status === 'refunded' ? 'Refunded' : 'Pending'}
              </span>
              <span className="text-xs text-[#647067] bg-[#F1F4F1] px-2.5 py-1 rounded-full">{d.order_status.replace(/_/g, ' ')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-[#E8ECE9] rounded-xl p-4">
                <p className="text-[11px] font-semibold text-[#8A948E] uppercase tracking-wide mb-2">Order</p>
                <p className="text-sm text-[#17201A]"><span className="text-[#8A948E]">Placed:</span> {formatDateTime(d.placed_at)}</p>
                <p className="text-sm text-[#17201A] mt-1"><span className="text-[#8A948E]">Type:</span> {d.order_type === 'pickup' ? 'Pickup' : 'Delivery'}</p>
                {d.delivery_speed && <p className="text-sm text-[#17201A] mt-1"><span className="text-[#8A948E]">Speed:</span> {d.delivery_speed}</p>}
                {d.group_reference && <p className="text-sm text-[#17201A] mt-1"><span className="text-[#8A948E]">Group:</span> {d.group_reference}</p>}
              </div>
              <div className="border border-[#E8ECE9] rounded-xl p-4">
                <p className="text-[11px] font-semibold text-[#8A948E] uppercase tracking-wide mb-2">Customer</p>
                <p className="text-sm font-medium text-[#17201A]">{d.customer_name || '—'}</p>
                {d.customer_email && <p className="text-xs text-[#647067] mt-0.5">{d.customer_email}</p>}
                {d.customer_phone && <p className="text-xs text-[#647067]">{d.customer_phone}</p>}
              </div>
            </div>

            {d.items.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[#8A948E] uppercase tracking-wide mb-2">Items from this business</p>
                <div className="border border-[#E8ECE9] rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-[#647067] bg-[#F7FAF7]">
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="px-4 py-2 font-medium">Qty</th>
                        <th className="px-4 py-2 font-medium text-right">Unit price</th>
                        <th className="px-4 py-2 font-medium text-right">Subtotal</th>
                        <th className="px-4 py-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((item, i) => (
                        <tr key={i} className="border-t border-[#F1F4F1]">
                          <td className="px-4 py-2.5 font-medium text-[#17201A]">{item.product_name}</td>
                          <td className="px-4 py-2.5 text-[#647067]">{item.quantity}</td>
                          <td className="px-4 py-2.5 text-right text-[#647067]">{formatCurrency(item.unit_price)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[#17201A]">{formatCurrency(item.subtotal)}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-[#647067]">{item.status.replace(/_/g, ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-[#E8ECE9] rounded-xl p-4">
                <p className="text-[11px] font-semibold text-[#8A948E] uppercase tracking-wide mb-2">Amount</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-[#647067]">Subtotal</span><span className="text-[#17201A]">{formatCurrency(d.totals.subtotal)}</span></div>
                  {d.totals.delivery_fee > 0 && <div className="flex justify-between"><span className="text-[#647067]">Delivery fee</span><span className="text-[#17201A]">{formatCurrency(d.totals.delivery_fee)}</span></div>}
                  {d.totals.rider_tip > 0 && <div className="flex justify-between"><span className="text-[#647067]">Rider tip</span><span className="text-[#17201A]">{formatCurrency(d.totals.rider_tip)}</span></div>}
                  {d.totals.system_fee > 0 && <div className="flex justify-between"><span className="text-[#647067]">System fee</span><span className="text-[#17201A]">{formatCurrency(d.totals.system_fee)}</span></div>}
                  {d.totals.discount > 0 && <div className="flex justify-between"><span className="text-[#647067]">Discount</span><span className="text-[#B45309]">−{formatCurrency(d.totals.discount)}</span></div>}
                  <div className="flex justify-between border-t border-[#E8ECE9] pt-1.5"><span className="font-medium text-[#17201A]">Total</span><span className="font-bold text-[#17201A]">{formatCurrency(d.totals.total)}</span></div>
                  <div className="flex justify-between"><span className="text-[#647067]">Paid amount</span><span className="font-semibold text-[#16803C]">{formatCurrency(d.totals.paid_amount)}</span></div>
                  {d.totals.refunded_amount > 0 && (
                    <div className="flex justify-between"><span className="text-[#647067]">Refunded{d.totals.refund_status ? ` (${d.totals.refund_status})` : ''}</span><span className="text-[#647067]">{formatCurrency(d.totals.refunded_amount)}</span></div>
                  )}
                </div>
              </div>

              <div className="border border-[#E8ECE9] rounded-xl p-4">
                <p className="text-[11px] font-semibold text-[#8A948E] uppercase tracking-wide mb-2">Settlement</p>
                {d.settlement ? (
                  <div className="space-y-1.5 text-sm">
                    <p className="text-xs text-[#647067]">#{d.settlement.settlement_number}</p>
                    <div className="flex justify-between"><span className="text-[#647067]">Base</span><span className="text-[#17201A]">{formatCurrency(d.settlement.settlement_base)}</span></div>
                    <div className="flex justify-between"><span className="text-[#647067]">Restaurant share</span><span className="font-semibold text-[#16803C]">{formatCurrency(d.settlement.restaurant_amount)}</span></div>
                    <div className="flex justify-between"><span className="text-[#647067]">Platform share</span><span className="text-[#17201A]">{formatCurrency(d.settlement.platform_amount)}</span></div>
                    {d.settlement.settled_at && <div className="flex justify-between"><span className="text-[#647067]">Settled</span><span className="text-[#17201A]">{formatDateTime(d.settlement.settled_at)}</span></div>}
                  </div>
                ) : (
                  <p className="text-sm text-[#9CA3AF]">Not settled yet. This record appears here once the order's settlement is posted.</p>
                )}
              </div>
            </div>

            {d.delivery && (
              <div className="border border-[#E8ECE9] rounded-xl p-4">
                <p className="text-[11px] font-semibold text-[#8A948E] uppercase tracking-wide mb-2">Delivery</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <p className="text-[#17201A]"><span className="text-[#8A948E]">Status:</span> {d.delivery.status.replace(/_/g, ' ')}</p>
                  {d.delivery.dispatch_status && <p className="text-[#17201A]"><span className="text-[#8A948E]">Dispatch:</span> {d.delivery.dispatch_status.replace(/_/g, ' ')}</p>}
                  {d.delivery.rider_name && <p className="text-[#17201A]"><span className="text-[#8A948E]">Rider:</span> {d.delivery.rider_name}</p>}
                  {d.delivery.delivered_at && <p className="text-[#17201A]"><span className="text-[#8A948E]">Delivered:</span> {formatDateTime(d.delivery.delivered_at)}</p>}
                  {d.delivery.address && <p className="text-[#17201A] sm:col-span-2"><span className="text-[#8A948E]">Address:</span> {d.delivery.address}</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function PaymentMethodsSection({ business }: { business: BusinessData | undefined }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [feedback, setFeedback] = useState<{ key: number; type: 'success' | 'error'; msg: string } | null>(null)
  const feedbackKey = useRef(0)

  const pushFeedback = (type: 'success' | 'error', msg: string) => {
    feedbackKey.current += 1
    setFeedback({ key: feedbackKey.current, type, msg })
  }

  useEffect(() => {
    const stored = business?.payment_methods
    const enabled = Array.isArray(stored) && stored.length > 0 ? stored : PAYMENT_OPTION_DEFS.map(o => o.key)
    const next: Record<string, boolean> = {}
    PAYMENT_OPTION_DEFS.forEach(o => { next[o.key] = enabled.includes(o.key) })
    setSelected(next)
  }, [business])

  const saveMutation = useMutation({
    mutationFn: (payment_methods: string[]) =>
      put(`/business-owner/businesses/${business?.id}/payment-methods`, { payment_methods }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', business?.id] })
      pushFeedback('success', 'Payment methods saved. Orders will only be accepted with the methods you enabled.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to save payment methods. Please try again.'
      pushFeedback('error', msg)
    },
  })

  const toggle = (key: string) => setSelected(prev => ({ ...prev, [key]: !prev[key] }))

  const enabledKeys = PAYMENT_OPTION_DEFS.map(o => o.key).filter(k => selected[k])
  const saving = saveMutation.isPending

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-1 flex items-center gap-2"><Wallet className="w-4 h-4 text-[#16803C]" /> Accepted Payment Methods</h2>
        <p className="text-xs text-[#647067] mb-5">Choose which payment methods customers may use to order from this business. Every order is recorded with the payment method used to pay for it.</p>
        {feedback && (
          <Alert key={feedback.key} type={feedback.type} message={feedback.msg} onDismiss={() => setFeedback(null)} />
        )}
        <div className="space-y-3">
          {PAYMENT_OPTION_DEFS.map(opt => (
            <div key={opt.key} className={`flex items-center justify-between p-4 rounded-xl border transition ${selected[opt.key] ? 'border-[#16803C]/40 bg-[#EAF6ED]' : 'border-[#E2E8E3] bg-white'}`}>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[#17201A]">{opt.label}</p>
                  {opt.online && <span className="text-xs text-[#16803C] bg-[#16803C]/10 px-2 py-0.5 rounded-full font-medium">Online</span>}
                </div>
                <p className="text-xs text-[#647067] mt-0.5">{opt.desc}</p>
              </div>
              <label className="relative inline-flex cursor-pointer shrink-0">
                <input type="checkbox" checked={!!selected[opt.key]} onChange={() => toggle(opt.key)} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-[#16803C]/25 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#16803C]" />
              </label>
            </div>
          ))}
        </div>
        {enabledKeys.length === 0 && (
          <p className="mt-3 text-xs text-[#B91C1C]">Enable at least one payment method so customers can place orders.</p>
        )}
        <div className="mt-5 flex justify-end">
          <button
            onClick={() => saveMutation.mutate(enabledKeys)}
            disabled={saving || enabledKeys.length === 0}
            className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Payment Methods'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PaymentSettingsSection({ business }: { business: BusinessData | undefined }) {
  const [methodFilter, setMethodFilter] = useState<'all' | 'cash' | 'online'>('all')
  const [viewing, setViewing] = useState<PaymentRecord | null>(null)

  const paymentsQuery = useQuery({
    queryKey: ['bo-payments', business?.id, methodFilter],
    queryFn: () =>
      get<{ data: { payments: PaymentRecord[] }; meta: PaymentsResponseMeta }>(
        `/business-owner/businesses/${business?.id}/payments`,
        { params: { perPage: '25', ...(methodFilter !== 'all' ? { payment_method: methodFilter } : {}) } }
      ),
    enabled: !!business?.id,
  })

  const records = paymentsQuery.data?.data?.payments ?? []
  const summary = paymentsQuery.data?.meta?.summary
  const total = paymentsQuery.data?.meta?.total
  const isLoading = paymentsQuery.isLoading

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <h2 className="text-sm font-semibold text-[#17201A] mb-1 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[#16803C]" /> Payment Tracking</h2>
        <p className="text-xs text-[#647067] mb-5">Every order placed with this business is recorded here with the payment method used, its payment status, and the amount received.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="border border-[#E8ECE9] rounded-xl p-4 bg-[#F7FAF7]">
            <p className="text-xs text-[#647067] font-medium">Total Received</p>
            <p className="text-lg font-bold text-[#17201A] mt-1">{formatCurrency(summary?.total_received ?? 0)}</p>
            <p className="text-[11px] text-[#8A948E] mt-0.5">{summary?.orders_count ?? 0} order{(summary?.orders_count ?? 0) === 1 ? '' : 's'}</p>
          </div>
          <div className="border border-[#E8ECE9] rounded-xl p-4">
            <p className="text-xs text-[#647067] font-medium">Cash on Delivery</p>
            <p className="text-lg font-bold text-[#B45309] mt-1">{formatCurrency(summary?.cash_total ?? 0)}</p>
            <p className="text-[11px] text-[#8A948E] mt-0.5">{summary?.cash_count ?? 0} COD order{(summary?.cash_count ?? 0) === 1 ? '' : 's'}</p>
          </div>
          <div className="border border-[#E8ECE9] rounded-xl p-4">
            <p className="text-xs text-[#647067] font-medium">Online Payments</p>
            <p className="text-lg font-bold text-[#16803C] mt-1">{formatCurrency(summary?.online_total ?? 0)}</p>
            <p className="text-[11px] text-[#8A948E] mt-0.5">{summary?.online_count ?? 0} online order{(summary?.online_count ?? 0) === 1 ? '' : 's'}</p>
          </div>
          <div className="border border-[#E8ECE9] rounded-xl p-4">
            <p className="text-xs text-[#647067] font-medium">Settled Earnings</p>
            <p className="text-lg font-bold text-[#17201A] mt-1">{formatCurrency(summary?.settled_amount ?? 0)}</p>
            <p className="text-[11px] text-[#8A948E] mt-0.5">Your share of settled orders</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="relative">
            <Filter className="w-4 h-4 text-[#647067] absolute left-3 top-1/2 -translate-y-1/2" />
            <select
              value={methodFilter}
              onChange={e => setMethodFilter(e.target.value as 'all' | 'cash' | 'online')}
              className="bg-white border border-[#E2E8E3] rounded-xl py-2 pl-9 pr-4 text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]"
            >
              <option value="all">All payment methods</option>
              <option value="cash">Cash on Delivery</option>
              <option value="online">Online (GCash / Card)</option>
            </select>
          </div>
          {isLoading ? (
            <span className="text-xs text-[#647067]">Loading records...</span>
          ) : (
            <span className="text-xs text-[#647067]">{total ?? 0} record{(total ?? 0) === 1 ? '' : 's'}</span>
          )}
        </div>

        {isLoading ? (
          <div className="py-10 text-center">
            <div className="w-8 h-8 border-2 border-[#16803C] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-[#647067] mt-3">Loading payment records...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="border border-dashed border-[#E2E8E3] rounded-xl p-10 text-center">
            <Receipt className="w-8 h-8 text-[#9CA3AF] mx-auto" />
            <p className="text-sm font-medium text-[#17201A] mt-3">
              {methodFilter === 'all' ? 'No payment records yet' : 'No records match this filter'}
            </p>
            <p className="text-xs text-[#647067] mt-1">
              {methodFilter === 'all'
                ? 'Payments appear here as soon as customers place orders with this business.'
                : 'Try switching the payment method filter to show all records.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#647067] border-b border-[#E8ECE9]">
                  <th className="pb-2 pr-4 font-medium">Order</th>
                  <th className="pb-2 pr-4 font-medium">Placed</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Method</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium text-right">Amount</th>
                  <th className="pb-2 pr-4 font-medium text-right">Settlement</th>
                  <th className="pb-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} className="border-b border-[#F1F4F1] last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-[#17201A]">{r.order_number}</p>
                      {r.group_reference && <p className="text-[11px] text-[#8A948E]">Group {r.group_reference}</p>}
                    </td>
                    <td className="py-3 pr-4 text-[#647067] whitespace-nowrap">{formatDate(r.placed_at)}</td>
                    <td className="py-3 pr-4 text-[#17201A]">{r.customer_name || '—'}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.payment_method === 'cash' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#EAF6ED] text-[#16803C]'}`}>
                        {r.payment_label}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs font-medium ${paymentStatusStyles(r.payment_status)}`}>
                        {r.payment_status === 'paid' ? 'Paid' : r.payment_status === 'refunded' ? 'Refunded' : 'Pending'}
                      </span>
                      <span className="text-[11px] text-[#8A948E] block">{r.order_status.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="py-3 pr-4 text-right font-semibold text-[#17201A]">{formatCurrency(r.total)}</td>
                    <td className="py-3 text-right">
                      {r.settlement_amount !== null ? (
                        <div>
                          <p className="text-sm font-semibold text-[#16803C]">{formatCurrency(r.settlement_amount)}</p>
                          <p className="text-[11px] text-[#8A948E]">{r.settlement_status || 'settled'}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-[#9CA3AF]">Not settled</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => setViewing(r)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#16803C] hover:text-[#126B32] hover:bg-[#EAF6ED] px-3 py-1.5 rounded-lg transition"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {viewing && (
        <PaymentTransactionModal businessId={business?.id} record={viewing} onClose={() => setViewing(null)} />
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
