import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, patch, del } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import { useActiveBusinessId } from '../services/use-active-business-id'
import {
  ArrowLeft, Upload, Trash2, Image as ImageIcon, X, Star, Eye, EyeOff,
  Film, AlertTriangle, CheckCircle2, Camera, Check, Lightbulb, BarChart3,
  Pencil, Plus, Clock, MapPin, Phone, Globe, Loader2, Utensils, Info,
} from 'lucide-react'

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
)

const InstagramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
)

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M16.6 3c.3 2.1 1.6 3.6 3.6 3.9v3.1c-1.3-.1-2.5-.5-3.6-1.1v6.9c0 3.5-2.8 5.8-6.1 5.2-2.7-.5-4.6-2.9-4.4-5.6.2-2.8 2.6-5 5.6-5 .3 0 .6 0 .9.1v3.2c-.3-.1-.6-.2-.9-.2-1.4 0-2.5 1.1-2.4 2.5.1 1.2 1.2 2.2 2.4 2.2 1.4 0 2.5-1.1 2.5-2.5V3h2.4z" />
  </svg>
)

interface GalleryImage {
  id: number
  file_path: string
  type: string
  title: string | null
  category: string | null
  caption: string | null
  sort_order: number
  featured: boolean
  visibility: string
  status: string
  created_at: string
}

interface BusinessData {
  id: number
  business_name: string
  business_description: string | null
  tagline: string | null
  welcome_message: string | null
  signature_dishes: string[] | null
  logo: string | null
  cover_photo: string | null
  contact_number: string | null
  email: string | null
  website: string | null
  facebook: string | null
  instagram: string | null
  other_social_media: string | null
  address: string | null
  opening_time: string | null
  closing_time: string | null
  business_days: string[] | null
  price_range: string | null
  average_rating: number
  review_count: number
  is_open: boolean
  category: string | { id: number; name: string } | null
  business_category_id: number | null
  municipality: string | { id: number; name: string } | null
  barangay: string | { id: number; name: string } | null
}

interface MenuItem {
  id: number
  name: string
  description: string | null
  price: number
  image: string | null
  category: { id: number; name: string } | string | null
  is_available: boolean
  is_featured: boolean
  status: string
}

interface MenuResponse {
  data: MenuItem[]
  meta?: {
    current_page: number
    last_page: number
    per_page: number
    total: number
    stats?: Record<string, number>
    categories?: { id: string; name: string }[]
  }
}

interface ReviewItem {
  id: number
  rating: number
  comment: string | null
  user_name: string
  created_at: string
}

interface Category {
  id: number
  name: string
}

interface ProfileDraft {
  business_name: string
  tagline: string
  welcome_message: string
  business_description: string
  address: string
  contact_number: string
  opening_time: string
  closing_time: string
  facebook: string
  instagram: string
  website: string
  other_social_media: string
  business_category_id: number | null
}

type DraftStringKeys = Exclude<keyof ProfileDraft, 'business_category_id'>
type EditField = 'name' | 'tagline' | 'welcome' | 'description' | 'address' | 'phone' | 'hours' | 'socials' | null
type TabKey = 'about' | 'menu' | 'gallery' | 'reviews'

const GALLERY_CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'signature_dish', label: 'Signature Dishes' },
  { value: 'best_seller', label: 'Best Sellers' },
  { value: 'new_menu', label: 'New Menu' },
  { value: 'promotion', label: 'Promotions' },
  { value: 'dessert', label: 'Desserts' },
  { value: 'drink', label: 'Drinks' },
  { value: 'interior', label: 'Interior' },
  { value: 'dining_area', label: 'Dining Area' },
  { value: 'event', label: 'Events' },
  { value: 'behind_the_scenes', label: 'Behind the Scenes' },
  { value: 'food', label: 'Food' },
  { value: 'restaurant', label: 'Restaurant' },
]

const POST_CATEGORIES = GALLERY_CATEGORIES.filter((c) => c.value !== 'all')

const PRICE_RANGE_LABELS: Record<string, string> = {
  budget: 'Budget',
  affordable: 'Affordable',
  mid_range: 'Mid-Range',
  premium: 'Premium',
  luxury: 'Luxury',
}

const TIPS = [
  'Use high-quality images for your logo and banner.',
  'Add a short and catchy welcome message.',
  'Ensure your signature dishes are properly highlighted.',
  'Keep your opening hours updated.',
  'Upload at least 5 gallery posts.',
  'Add your social media links.',
]

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
  { key: 'menu', label: 'Menu', icon: <Utensils className="w-4 h-4" /> },
  { key: 'gallery', label: 'Gallery', icon: <ImageIcon className="w-4 h-4" /> },
  { key: 'reviews', label: 'Reviews', icon: <Star className="w-4 h-4" /> },
]

function InlineEdit({
  mode, active, value, placeholder, textarea, onEdit, onCancel, onSave, inputValue, setInputValue, className,
}: {
  mode: 'edit' | 'preview'
  active: boolean
  value: string
  placeholder?: string
  textarea?: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  inputValue: string
  setInputValue: (v: string) => void
  className?: string
}) {
  if (active) {
    const base = 'w-full bg-white border border-[#16803C] focus:ring-2 focus:ring-[#16803C]/25 rounded-lg text-sm text-[#111827] placeholder-[#9CA3AF] transition px-3 py-2'
    return (
      <div className="mt-1">
        {textarea ? (
          <textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} rows={4} className={`${base} resize-none`} autoFocus placeholder={placeholder} maxLength={2000} />
        ) : (
          <input value={inputValue} onChange={(e) => setInputValue(e.target.value)} className={base} autoFocus placeholder={placeholder} maxLength={255} />
        )}
        <div className="flex items-center justify-end gap-2 mt-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#4B5563] text-xs font-medium transition">Cancel</button>
          <button onClick={onSave} className="px-3 py-1.5 rounded-lg bg-[#16803C] hover:bg-[#126B32] text-white text-xs font-semibold transition">Save</button>
        </div>
      </div>
    )
  }
  return (
    <div className="group flex items-center gap-1.5">
      <span className={`${value ? (className ?? '') : 'italic text-[#9CA3AF]'}`}>{value || placeholder || ''}</span>
      {mode === 'edit' && (
        <button onClick={onEdit} className="transition text-[#16803C] p-0.5 hover:bg-[#EAF6ED] rounded" title="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

const toHm = (t?: string | null) => (t && t.length >= 5 ? t.slice(0, 5) : '')

const fmtTime = (t?: string | null) => {
  if (!t) return ''
  const [h = 0, m = 0] = t.split(':').map(Number)
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

const fmtPrice = (price?: number | null) => {
  const n = Number(price || 0)
  return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')

const emptyDraft = (): ProfileDraft => ({
  business_name: '',
  tagline: '',
  welcome_message: '',
  business_description: '',
  address: '',
  contact_number: '',
  opening_time: '',
  closing_time: '',
  facebook: '',
  instagram: '',
  website: '',
  other_social_media: '',
  business_category_id: null,
})

export default function BusinessOwnerBusinessGallery() {
  const { id: urlId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const businessId = useActiveBusinessId(urlId)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (businessId !== null && urlId !== String(businessId)) {
      navigate(`/business-owner/businesses/${businessId}/gallery`, { replace: true })
    }
  }, [businessId, urlId, navigate])

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [activeTab, setActiveTab] = useState<TabKey>('about')
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft())
  const [signatureDishes, setSignatureDishes] = useState<string[]>([])
  const [newDish, setNewDish] = useState('')
  const [dirty, setDirty] = useState(false)

  const [editingField, setEditingField] = useState<EditField>(null)
  const [editText, setEditText] = useState('')
  const [editOpen, setEditOpen] = useState('')
  const [editClose, setEditClose] = useState('')
  const [editSocials, setEditSocials] = useState({ facebook: '', instagram: '', website: '', other: '' })

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const [filterCategory, setFilterCategory] = useState('all')
  const [postModalOpen, setPostModalOpen] = useState(false)
  const [postTitle, setPostTitle] = useState('')
  const [postCaption, setPostCaption] = useState('')
  const [postCategory, setPostCategory] = useState('signature_dish')
  const [postStatus, setPostStatus] = useState('published')
  const [postFiles, setPostFiles] = useState<File[]>([])
  const [postPreviews, setPostPreviews] = useState<string[]>([])
  const [postVideo, setPostVideo] = useState<File | null>(null)

  const [editingItem, setEditingItem] = useState<GalleryImage | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editCaption, setEditCaption] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editVisibility, setEditVisibility] = useState('public')
  const [editStatus, setEditStatus] = useState('published')
  const [deletingItem, setDeletingItem] = useState<GalleryImage | null>(null)

  const [editingDish, setEditingDish] = useState<MenuItem | null>(null)
  const [dishName, setDishName] = useState('')
  const [dishPrice, setDishPrice] = useState('')
  const [dishDescription, setDishDescription] = useState('')
  const [dishImageFile, setDishImageFile] = useState<File | null>(null)

  const [logoModal, setLogoModal] = useState(false)
  const [bannerModal, setBannerModal] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)

  const galleryInputRef = useRef<HTMLInputElement>(null)
  const galleryVideoInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const dishImageInputRef = useRef<HTMLInputElement>(null)

  const { data: business, isLoading: businessLoading } = useQuery({
    queryKey: ['bo-business', businessId],
    queryFn: () => get<BusinessData>(`/business-owner/businesses/${businessId}`),
    enabled: businessId !== null,
  })

  const { data: createMeta } = useQuery({
    queryKey: ['bo-create-meta'],
    queryFn: () => get<{ categories: Category[] }>('/business-owner/businesses/create'),
  })
  const categories = createMeta?.categories ?? []

  const { data: images, isLoading: galleryLoading } = useQuery({
    queryKey: ['bo-business-gallery', businessId, filterCategory],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filterCategory !== 'all') params.append('category', filterCategory)
      const query = params.toString() ? `?${params.toString()}` : ''
      return get<GalleryImage[]>(`/business-owner/businesses/${businessId}/gallery${query}`)
    },
    enabled: businessId !== null,
  })

  const { data: menuRes } = useQuery({
    queryKey: ['bo-menu', businessId],
    queryFn: () => get<MenuResponse>(`/business-owner/menu?business_id=${businessId}&per_page=50`),
    enabled: businessId !== null,
  })
  const menuItems = menuRes?.data ?? []

  const { data: reviewsRes } = useQuery({
    queryKey: ['bo-business-reviews', businessId],
    queryFn: () => get<{ reviews: ReviewItem[] }>(`/business-owner/businesses/${businessId}/reviews`),
    enabled: businessId !== null,
  })
  const reviews = reviewsRes?.reviews ?? []

  useEffect(() => {
    if (business) {
      setDraft({
        business_name: business.business_name || '',
        tagline: business.tagline || '',
        welcome_message: business.welcome_message || '',
        business_description: business.business_description || '',
        address: business.address || '',
        contact_number: business.contact_number || '',
        opening_time: toHm(business.opening_time),
        closing_time: toHm(business.closing_time),
        facebook: business.facebook || '',
        instagram: business.instagram || '',
        website: business.website || '',
        other_social_media: business.other_social_media || '',
        business_category_id: business.business_category_id ?? null,
      })
      setSignatureDishes(business.signature_dishes || [])
      setDirty(false)
    }
  }, [business])

  const uploadLogoMutation = useMutation({
    mutationFn: (formData: FormData) => post(`/business-owner/businesses/${businessId}/logo`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', businessId] })
      setLogoModal(false); setLogoFile(null); setLogoPreview(null)
      if (logoInputRef.current) logoInputRef.current.value = ''
      showToast('Logo uploaded successfully')
    },
    onError: () => showToast('Failed to upload logo', 'error'),
  })

  const removeLogoMutation = useMutation({
    mutationFn: () => del(`/business-owner/businesses/${businessId}/logo`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', businessId] })
      setLogoModal(false); setLogoFile(null); setLogoPreview(null)
      showToast('Logo removed')
    },
    onError: () => showToast('Failed to remove logo', 'error'),
  })

  const uploadCoverMutation = useMutation({
    mutationFn: (formData: FormData) => post(`/business-owner/businesses/${businessId}/cover-photo`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', businessId] })
      setBannerModal(false); setBannerFile(null); setBannerPreview(null)
      if (coverInputRef.current) coverInputRef.current.value = ''
      showToast('Banner uploaded successfully')
    },
    onError: () => showToast('Failed to upload banner', 'error'),
  })

  const removeCoverMutation = useMutation({
    mutationFn: () => del(`/business-owner/businesses/${businessId}/cover-photo`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', businessId] })
      setBannerModal(false); setBannerFile(null); setBannerPreview(null)
      showToast('Banner removed')
    },
    onError: () => showToast('Failed to remove banner', 'error'),
  })

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => post(`/business-owner/businesses/${businessId}/gallery`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business-gallery', businessId] })
      closePostModal()
      showToast('Gallery post published successfully')
    },
    onError: () => showToast('Failed to upload photos', 'error'),
  })

  const videoMutation = useMutation({
    mutationFn: (formData: FormData) => post(`/business-owner/businesses/${businessId}/gallery/video`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business-gallery', businessId] })
      closePostModal()
      showToast('Video uploaded successfully')
    },
    onError: () => showToast('Failed to upload video', 'error'),
  })

  const featureMutation = useMutation({
    mutationFn: (mediaId: number) => patch(`/business-owner/businesses/${businessId}/gallery/${mediaId}/feature`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bo-business-gallery', businessId] }); showToast('Featured status updated') },
    onError: () => showToast('Failed to update featured status', 'error'),
  })

  const visibilityMutation = useMutation({
    mutationFn: (mediaId: number) => patch(`/business-owner/businesses/${businessId}/gallery/${mediaId}/visibility`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bo-business-gallery', businessId] }); showToast('Visibility updated') },
    onError: () => showToast('Failed to update visibility', 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ mediaId, data }: { mediaId: number; data: Record<string, string> }) =>
      put(`/business-owner/businesses/${businessId}/gallery/${mediaId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business-gallery', businessId] })
      setEditingItem(null)
      showToast('Media updated successfully')
    },
    onError: () => showToast('Failed to update media', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (mediaId: number) => del(`/business-owner/businesses/${businessId}/gallery/${mediaId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business-gallery', businessId] })
      setDeletingItem(null)
      showToast('Gallery post archived successfully')
    },
    onError: () => showToast('Failed to delete media', 'error'),
  })

  const dishUpdateMutation = useMutation({
    mutationFn: ({ id, formData, data }: { id: number; formData: FormData | null; data?: Record<string, unknown> }) =>
      formData ? put(`/business-owner/menu/${id}`, formData) : put(`/business-owner/menu/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-menu', businessId] })
      setEditingDish(null); setDishImageFile(null)
      if (dishImageInputRef.current) dishImageInputRef.current.value = ''
      showToast('Dish updated successfully')
    },
    onError: () => showToast('Failed to update dish', 'error'),
  })

  const openEditor = (field: Exclude<EditField, null>) => {
    setEditingField(field)
    switch (field) {
      case 'name': setEditText(draft.business_name); break
      case 'tagline': setEditText(draft.tagline); break
      case 'welcome': setEditText(draft.welcome_message); break
      case 'description': setEditText(draft.business_description); break
      case 'address': setEditText(draft.address); break
      case 'phone': setEditText(draft.contact_number); break
      case 'hours': setEditOpen(draft.opening_time); setEditClose(draft.closing_time); break
      case 'socials': setEditSocials({ facebook: draft.facebook, instagram: draft.instagram, website: draft.website, other: draft.other_social_media }); break
    }
  }

  const closeEditor = () => setEditingField(null)

  const applyEditor = (d: ProfileDraft): ProfileDraft => {
    switch (editingField) {
      case 'name': return { ...d, business_name: editText }
      case 'tagline': return { ...d, tagline: editText }
      case 'welcome': return { ...d, welcome_message: editText }
      case 'description': return { ...d, business_description: editText }
      case 'address': return { ...d, address: editText }
      case 'phone': return { ...d, contact_number: editText }
      case 'hours': return { ...d, opening_time: editOpen, closing_time: editClose }
      case 'socials': return { ...d, facebook: editSocials.facebook, instagram: editSocials.instagram, website: editSocials.website, other_social_media: editSocials.other }
      default: return d
    }
  }

  const saveEditor = () => {
    if (!editingField) return
    const next = applyEditor(draft)
    const requiredEmpty =
      (editingField === 'name' && !editText.trim()) ||
      (editingField === 'description' && !editText.trim()) ||
      (editingField === 'address' && !editText.trim()) ||
      (editingField === 'phone' && !editText.trim()) ||
      (editingField === 'hours' && (!editOpen || !editClose))
    if (requiredEmpty) { closeEditor(); return }
    setDraft(next)
    setDirty(true)
    closeEditor()
  }

  const addDish = () => {
    const dish = newDish.trim()
    if (!dish) return
    setSignatureDishes((prev) => (prev.includes(dish) ? prev : [...prev, dish]))
    setNewDish('')
    setDirty(true)
  }

  const removeDish = (dish: string) => {
    setSignatureDishes((prev) => prev.filter((x) => x !== dish))
    setDirty(true)
  }

  const saveAllMutation = useMutation({
    mutationFn: async () => {
      const b = business
      if (!b) return
      let eff = draft
      if (editingField) {
        eff = applyEditor(draft)
        setDraft(eff)
      }
      const general: Record<string, unknown> = {}
      const optional = new Set(['tagline', 'website', 'facebook', 'instagram', 'other_social_media'])
      const diff = (key: DraftStringKeys, orig: string | null | undefined) => {
        const d = eff[key]
        if (d !== (orig ?? '')) general[key] = optional.has(key) ? (d || null) : d
      }
      diff('business_name', b.business_name)
      diff('tagline', b.tagline)
      diff('business_description', b.business_description)
      diff('address', b.address)
      diff('contact_number', b.contact_number)
      diff('facebook', b.facebook)
      diff('instagram', b.instagram)
      diff('website', b.website)
      diff('other_social_media', b.other_social_media)
      if (eff.opening_time !== toHm(b.opening_time) || eff.closing_time !== toHm(b.closing_time)) {
        general.opening_time = eff.opening_time
        general.closing_time = eff.closing_time
      }
      const calls: Promise<unknown>[] = []
      if (Object.keys(general).length > 0) {
        calls.push(put(`/business-owner/businesses/${businessId}`, general))
      }
      const sigChanged = JSON.stringify(signatureDishes) !== JSON.stringify(b.signature_dishes || [])
      const welcomeChanged = eff.welcome_message !== (b.welcome_message ?? '')
      if (sigChanged || welcomeChanged) {
        calls.push(put(`/business-owner/businesses/${businessId}/profile`, {
          welcome_message: eff.welcome_message.trim() || null,
          signature_dishes: signatureDishes.length ? signatureDishes : null,
        }))
      }
      if (calls.length) await Promise.all(calls)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-business', businessId] })
      setDirty(false)
      closeEditor()
      showToast('All changes are saved')
    },
    onError: () => showToast('Failed to save changes', 'error'),
  })

  const discardChanges = () => {
    if (!business) return
    setDraft({
      business_name: business.business_name || '',
      tagline: business.tagline || '',
      welcome_message: business.welcome_message || '',
      business_description: business.business_description || '',
      address: business.address || '',
      contact_number: business.contact_number || '',
      opening_time: toHm(business.opening_time),
      closing_time: toHm(business.closing_time),
      facebook: business.facebook || '',
      instagram: business.instagram || '',
      website: business.website || '',
      other_social_media: business.other_social_media || '',
      business_category_id: business.business_category_id ?? null,
    })
    setSignatureDishes(business.signature_dishes || [])
    setNewDish('')
    setDirty(false)
    closeEditor()
  }

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const handleBannerFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBannerFile(file)
    setBannerPreview(URL.createObjectURL(file))
  }

  const uploadLogo = () => {
    if (!logoFile) return
    const fd = new FormData()
    fd.append('logo', logoFile)
    uploadLogoMutation.mutate(fd)
  }

  const uploadBanner = () => {
    if (!bannerFile) return
    const fd = new FormData()
    fd.append('cover_photo', bannerFile)
    uploadCoverMutation.mutate(fd)
  }

  const handlePostFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setPostFiles(files)
    setPostPreviews(files.map((f) => URL.createObjectURL(f) as string))
  }

  const removePostPreview = (index: number) => {
    const url = postPreviews[index]
    if (url) URL.revokeObjectURL(url)
    setPostFiles((prev) => prev.filter((_, i) => i !== index))
    setPostPreviews((prev) => prev.filter((_, i) => i !== index))
  }

  const closePostModal = () => {
    setPostModalOpen(false)
    setPostTitle(''); setPostCaption(''); setPostCategory('signature_dish'); setPostStatus('published')
    setPostFiles([]); setPostPreviews([]); setPostVideo(null)
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (galleryVideoInputRef.current) galleryVideoInputRef.current.value = ''
  }

  const submitPost = () => {
    if (!postTitle.trim()) { showToast('Title is required', 'error'); return }
    if (postFiles.length) {
      const fd = new FormData()
      postFiles.forEach((f) => fd.append('images[]', f))
      fd.append('title', postTitle)
      if (postCaption) fd.append('caption', postCaption)
      fd.append('category', postCategory)
      fd.append('status', postStatus)
      uploadMutation.mutate(fd)
    } else if (postVideo) {
      const fd = new FormData()
      fd.append('video', postVideo)
      fd.append('title', postTitle)
      if (postCaption) fd.append('caption', postCaption)
      videoMutation.mutate(fd)
    } else {
      showToast('Upload a photo or video', 'error')
    }
  }

  const openEditPost = (img: GalleryImage) => {
    setEditingItem(img)
    setEditTitle(img.title || '')
    setEditCaption(img.caption || '')
    setEditCategory(img.category || '')
    setEditVisibility(img.visibility || 'public')
    setEditStatus(img.status || 'published')
  }

  const handleUpdateItem = () => {
    if (!editingItem) return
    updateMutation.mutate({
      mediaId: editingItem.id,
      data: { title: editTitle, caption: editCaption, category: editCategory, visibility: editVisibility, status: editStatus },
    })
  }

  const openDishEdit = (dish: MenuItem) => {
    setEditingDish(dish)
    setDishName(dish.name)
    setDishPrice(String(dish.price ?? ''))
    setDishDescription(dish.description || '')
    setDishImageFile(null)
  }

  const saveDish = () => {
    if (!editingDish) return
    if (!dishName.trim()) { showToast('Dish name is required', 'error'); return }
    const base: Record<string, unknown> = { name: dishName.trim(), price: dishPrice || '0', description: dishDescription || '' }
    if (dishImageFile) {
      const fd = new FormData()
      fd.append('name', dishName.trim())
      fd.append('price', dishPrice || '0')
      fd.append('description', dishDescription || '')
      fd.append('image', dishImageFile)
      dishUpdateMutation.mutate({ id: editingDish.id, formData: fd })
    } else {
      dishUpdateMutation.mutate({ id: editingDish.id, formData: null, data: base })
    }
  }

  const visibleImages = images?.filter((img) => img.status !== 'archived') || []

  const completionItems = [
    { label: 'Logo Uploaded', done: !!business?.logo },
    { label: 'Banner Uploaded', done: !!business?.cover_photo },
    { label: 'Welcome Message Added', done: !!business?.welcome_message },
    { label: 'Category Selected', done: !!business?.business_category_id },
    { label: 'Opening Hours Added', done: !!(business?.opening_time && business?.closing_time) },
    { label: 'At Least 3 Signature Dishes', done: (business?.signature_dishes?.length ?? 0) >= 3 },
    { label: 'Gallery Posts', done: (images?.length || 0) > 0 },
    { label: 'Social Links Added', done: !!(business?.facebook || business?.instagram || business?.website || business?.other_social_media) },
  ]
  const completionPercent = Math.round((completionItems.filter((i) => i.done).length / completionItems.length) * 100)

  const municipalityName = typeof business?.municipality === 'object' ? business?.municipality?.name : business?.municipality
const categoryName = categories.find((c) => c.id === draft.business_category_id)?.name
  || (typeof business?.category === 'object' ? business?.category?.name : business?.category)
  || 'Select category'
  const businessDays = Array.isArray(business?.business_days) ? business?.business_days : []

  const socials = [
    { key: 'facebook', label: 'Facebook', value: draft.facebook, Icon: FacebookIcon as React.ComponentType<{ className?: string }> },
    { key: 'instagram', label: 'Instagram', value: draft.instagram, Icon: InstagramIcon as React.ComponentType<{ className?: string }> },
    { key: 'other', label: 'TikTok', value: draft.other_social_media, Icon: TikTokIcon as React.ComponentType<{ className?: string }> },
    { key: 'website', label: 'Website', value: draft.website, Icon: Globe },
  ]

  const saving = saveAllMutation.isPending

  if (businessId === null || (businessLoading && !business)) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-[#E5E7EB] rounded-lg" />
          <div className="h-48 bg-[#E5E7EB] rounded-2xl" />
          <div className="h-64 bg-[#E5E7EB] rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {toast && (
        <div className="fixed top-4 right-4 z-[60]">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border ${
            toast.type === 'success' ? 'bg-emerald-600 border-emerald-700 text-white' : 'bg-red-600 border-red-700 text-white'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <Link to="/business-owner/businesses" className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#16803C] mb-3 transition">
            <ArrowLeft className="w-4 h-4" /> Back to Businesses
          </Link>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#111827]">Restaurant Profile</h1>
          <p className="text-sm text-[#4B5563] mt-1">This is how your customers see your restaurant.</p>
        </div>
        <div className="flex items-center gap-1 bg-[#F3F4F6] rounded-xl p-1 self-start">
          <button
            onClick={() => setMode('preview')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              mode === 'preview' ? 'bg-white text-[#16803C] shadow-sm' : 'text-[#6B7280] hover:text-[#16803C]'
            }`}
          >
            <Eye className="w-4 h-4" /> Preview Mode
          </button>
          <button
            onClick={() => setMode('edit')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              mode === 'edit' ? 'bg-white text-[#16803C] shadow-sm' : 'text-[#6B7280] hover:text-[#16803C]'
            }`}
          >
            <Pencil className="w-4 h-4" /> Edit Mode
          </button>
        </div>
      </div>

      {mode === 'edit' && (
        <div className={`mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border px-4 py-3 ${
          saving ? 'border-blue-200 bg-blue-50' : dirty ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
        }`}>
          <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin text-[#16803C]" /> Saving...</>
            ) : dirty ? (
              <><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> You have unsaved changes</>
            ) : (
              <><CheckCircle2 className="w-4 h-4 text-emerald-600" /> All changes are saved</>
            )}
          </div>
          {dirty && (
            <div className="flex items-center gap-2">
              <button onClick={discardChanges} disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] disabled:opacity-50 text-[#4B5563] text-sm font-medium transition">
                Discard Changes
              </button>
              <button onClick={() => saveAllMutation.mutate()} disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Changes
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.1)] overflow-hidden">
            <div className="relative h-48 bg-gradient-to-br from-[#16803C]/10 via-[#EAF6ED] to-[#0B5C2B]/20">
              {business?.cover_photo ? (
                <img src={toAssetUrl(business.cover_photo)} alt="Banner" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                  <Camera className="w-8 h-8 text-[#9CA3AF]" />
                  <span className="text-sm text-[#6B7280]">No banner yet</span>
                </div>
              )}
              {mode === 'edit' && (
                <button onClick={() => setBannerModal(true)}
                  className="absolute top-3 right-3 inline-flex items-center gap-2 bg-white/95 hover:bg-white px-3 py-2 rounded-xl shadow-sm text-[#16803C] text-xs font-semibold transition">
                  <Camera className="w-4 h-4" /> Change Banner
                </button>
              )}
            </div>

            <div className="px-6 pb-6 -mt-12 relative">
              <div className="flex items-end gap-4 mb-3">
                <div className="group relative w-24 h-24 rounded-2xl border-[3px] border-white shadow-lg overflow-hidden bg-[#F3F4F6] flex-shrink-0">
                  {business?.logo ? (
                    <img src={toAssetUrl(business.logo)} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Camera className="w-8 h-8 text-[#9CA3AF]" /></div>
                  )}
                  {mode === 'edit' && (
                    <div onClick={() => setLogoModal(true)}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1 cursor-pointer">
                      <Pencil className="w-4 h-4 text-white" />
                      <span className="text-[10px] text-white font-medium">Change Logo</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-2xl font-bold text-[#111827]">
                <InlineEdit mode={mode} active={editingField === 'name'} value={draft.business_name} placeholder="Restaurant Name"
                  onEdit={() => openEditor('name')} onCancel={closeEditor} onSave={saveEditor} inputValue={editText} setInputValue={setEditText} />
              </div>
              <div className="text-sm text-[#4B5563] mt-0.5 max-w-2xl">
                <InlineEdit mode={mode} active={editingField === 'tagline'} value={draft.tagline} placeholder="Add a short tagline..."
                  onEdit={() => openEditor('tagline')} onCancel={closeEditor} onSave={saveEditor} inputValue={editText} setInputValue={setEditText} />
              </div>

              <div className="flex items-center gap-2 text-sm text-[#4B5563] mt-1.5">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="font-semibold text-[#111827]">{business?.average_rating?.toFixed(1) || '0.0'}</span>
                <span className="text-[#9CA3AF]">({business?.review_count || 0})</span>
                <span className="text-[#9CA3AF]">•</span>
                <span>{categoryName}</span>
              </div>

              <div className="mt-3 text-[#4B5563] text-sm max-w-2xl">
                <InlineEdit mode={mode} active={editingField === 'description'} value={draft.business_description} placeholder="Write a short description of your restaurant..." textarea
                  onEdit={() => openEditor('description')} onCancel={closeEditor} onSave={saveEditor} inputValue={editText} setInputValue={setEditText} />
              </div>

              <div className="mt-3 text-sm text-[#4B5563] max-w-2xl">
                <InlineEdit mode={mode} active={editingField === 'welcome'} value={draft.welcome_message} placeholder="Add a welcome message..."
                  onEdit={() => openEditor('welcome')} onCancel={closeEditor} onSave={saveEditor} inputValue={editText} setInputValue={setEditText} />
              </div>

              <div className="mt-4 space-y-2.5 text-sm text-[#4B5563]">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#16803C] flex-shrink-0" />
                  <InlineEdit mode={mode} active={editingField === 'address'} value={draft.address} placeholder="Add your location"
                    onEdit={() => openEditor('address')} onCancel={closeEditor} onSave={saveEditor} inputValue={editText} setInputValue={setEditText} />
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#16803C] flex-shrink-0" />
                  {editingField === 'hours' ? (
                    <div className="mt-0.5">
                      <div className="flex items-center gap-2">
                        <input type="time" value={editOpen} onChange={(e) => setEditOpen(e.target.value)} className="bg-white border border-[#16803C] rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/25 transition" />
                        <span className="text-[#9CA3AF]">to</span>
                        <input type="time" value={editClose} onChange={(e) => setEditClose(e.target.value)} className="bg-white border border-[#16803C] rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/25 transition" />
                      </div>
                      <div className="flex items-center justify-end gap-2 mt-1.5">
                        <button onClick={closeEditor} className="px-3 py-1.5 rounded-lg bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#4B5563] text-xs font-medium transition">Cancel</button>
                        <button onClick={saveEditor} className="px-3 py-1.5 rounded-lg bg-[#16803C] hover:bg-[#126B32] text-white text-xs font-semibold transition">Save</button>
                      </div>
                    </div>
                  ) : (
                    <span className="group inline-flex items-center gap-1.5">
                      <span className={draft.opening_time && draft.closing_time ? '' : 'italic text-[#9CA3AF]'}>
                        {draft.opening_time && draft.closing_time ? `Open ${fmtTime(draft.opening_time)} - ${fmtTime(draft.closing_time)}` : 'Set opening hours'}
                      </span>
                      {mode === 'edit' && (
                        <button onClick={() => openEditor('hours')} className="transition text-[#16803C] p-0.5 hover:bg-[#EAF6ED] rounded">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-[#16803C] flex-shrink-0" />
                  <InlineEdit mode={mode} active={editingField === 'phone'} value={draft.contact_number} placeholder="Add a contact number"
                    onEdit={() => openEditor('phone')} onCancel={closeEditor} onSave={saveEditor} inputValue={editText} setInputValue={setEditText} />
                </div>
              </div>

              <div className="mt-4">
                {editingField === 'socials' ? (
                  <div className="max-w-sm bg-white border border-[#16803C] rounded-xl p-3 space-y-2">
                    {[
                      { key: 'facebook', label: 'Facebook', ph: 'https://facebook.com/...' },
                      { key: 'instagram', label: 'Instagram', ph: 'https://instagram.com/...' },
                      { key: 'website', label: 'Website', ph: 'https://yourwebsite.com' },
                      { key: 'other', label: 'TikTok / Other', ph: 'https://tiktok.com/@...' },
                    ].map((s) => (
                      <div key={s.key}>
                        <label className="block text-xs font-medium text-[#4B5563] mb-1">{s.label}</label>
                        <input value={editSocials[s.key as keyof typeof editSocials]} onChange={(e) => setEditSocials((p) => ({ ...p, [s.key]: e.target.value }))}
                          placeholder={s.ph} className="w-full bg-white border border-[#D1D5DB] rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                      </div>
                    ))}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button onClick={closeEditor} className="px-3 py-1.5 rounded-lg bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#4B5563] text-xs font-medium transition">Cancel</button>
                      <button onClick={saveEditor} className="px-3 py-1.5 rounded-lg bg-[#16803C] hover:bg-[#126B32] text-white text-xs font-semibold transition">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="group inline-flex items-center gap-1.5">
                    <div className="flex items-center gap-2">
                      {socials.filter((s) => s.value).length === 0 && <span className="text-sm italic text-[#9CA3AF]">No social links yet</span>}
                      {socials.filter((s) => s.value).map((s) => (
                        <a key={s.key} href={s.value} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#F3F8F4] border border-[#D7E8DB] text-[#16803C] hover:bg-[#EAF6ED] transition" title={s.label}>
                          <s.Icon className="w-4 h-4" />
                        </a>
                      ))}
                    </div>
                    {mode === 'edit' && (
                      <button onClick={() => openEditor('socials')} className="transition text-[#16803C] p-0.5 hover:bg-[#EAF6ED] rounded">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.1)] p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-[#111827] flex items-center gap-2"><Utensils className="w-5 h-5 text-[#16803C]" /> Signature Dishes</h2>
              {mode === 'edit' && (
                <div className="flex gap-2">
                  <input value={newDish} onChange={(e) => setNewDish(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDish()}
                    placeholder="Add a signature dish..."
                    className="flex-1 sm:w-64 px-4 py-2.5 bg-white border border-[#D1D5DB] rounded-xl text-sm text-[#111827] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  <button onClick={addDish} disabled={!newDish.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
                    <Plus className="w-4 h-4" /> Add Dish
                  </button>
                </div>
              )}
            </div>
            {signatureDishes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {signatureDishes.map((dish) => (
                  <span key={dish} className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg text-sm">
                    {dish}
                    {mode === 'edit' && (
                      <button onClick={() => removeDish(dish)} className="hover:text-emerald-900 transition"><X className="w-3.5 h-3.5" /></button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#6B7280]">No signature dishes yet{mode === 'edit' ? ' — add your best dishes above.' : '.'}</p>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.1)] overflow-hidden">
            <div className="flex border-b border-[#E5E7EB] px-4 overflow-x-auto">
              {TABS.map((tab) => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition ${
                    activeTab === tab.key ? 'border-[#16803C] text-[#16803C]' : 'border-transparent text-[#6B7280] hover:text-[#16803C]'
                  }`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            <div className="p-6">
              {activeTab === 'about' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[#111827] mb-2">About Us</h3>
                    <InlineEdit mode={mode} active={editingField === 'description'} value={draft.business_description} placeholder="Write about your restaurant..." textarea
                      onEdit={() => openEditor('description')} onCancel={closeEditor} onSave={saveEditor} inputValue={editText} setInputValue={setEditText} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#111827] mb-2">Opening Days</h3>
                    {businessDays.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {businessDays.map((d) => (
                          <span key={d} className="px-2.5 py-1 rounded-lg bg-[#F3F4F6] border border-[#E5E7EB] text-xs text-[#4B5563]">{d}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[#6B7280]">No opening days set.</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[#111827] mb-1">Opening Hours</h3>
                      <p className="text-sm text-[#4B5563]">{draft.opening_time && draft.closing_time ? `${fmtTime(draft.opening_time)} - ${fmtTime(draft.closing_time)}` : 'Not set'}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[#111827] mb-1">Contact Number</h3>
                      <p className="text-sm text-[#4B5563]">{draft.contact_number || 'Not set'}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[#111827] mb-1">Address</h3>
                      <p className="text-sm text-[#4B5563]">{draft.address ? `${draft.address}${municipalityName ? `, ${municipalityName}` : ''}` : 'Not set'}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[#111827] mb-1">Price Range</h3>
                      <p className="text-sm text-[#4B5563]">{business?.price_range ? PRICE_RANGE_LABELS[business.price_range] || business.price_range : 'Not set'}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#111827] mb-2">Social Media</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {socials.filter((s) => s.value).length === 0 && <span className="text-sm text-[#6B7280]">No social links added.</span>}
                      {socials.filter((s) => s.value).map((s) => (
                        <a key={s.key} href={s.value} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F3F8F4] border border-[#D7E8DB] text-[#16803C] text-xs font-medium hover:bg-[#EAF6ED] transition">
                          <s.Icon className="w-3.5 h-3.5" /> {s.label}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'menu' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[#111827]">Menu Items</h3>
                    <button onClick={() => navigate('/business-owner/menu')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] text-white text-sm font-semibold transition">
                      <Plus className="w-4 h-4" /> Add Dish
                    </button>
                  </div>
                  {menuItems.length === 0 ? (
                    <div className="text-center py-10">
                      <Utensils className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
                      <p className="text-sm text-[#6B7280]">No menu items yet. Add your dishes in the Menu module.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {menuItems.map((dish) => (
                        <div key={dish.id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden group">
                          <div className="aspect-[4/3] bg-[#F3F4F6] overflow-hidden relative">
                            {dish.image ? <img src={toAssetUrl(dish.image)} alt={dish.name} className="w-full h-full object-cover" /> : (
                              <div className="w-full h-full flex items-center justify-center"><Utensils className="w-8 h-8 text-[#9CA3AF]" /></div>
                            )}
                            {dish.is_featured && (
                              <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-amber-400 text-white px-2 py-0.5 rounded-md text-[10px] font-semibold">
                                <Star className="w-3 h-3 fill-white" /> Featured
                              </span>
                            )}
                          </div>
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-semibold text-[#111827]">{dish.name}</span>
                              <span className="text-sm font-bold text-[#16803C] flex-shrink-0">{fmtPrice(dish.price)}</span>
                            </div>
                            <p className="text-xs text-[#6B7280] mt-1 line-clamp-2">{dish.description || 'No description'}</p>
                            {mode === 'edit' && (
                              <button onClick={() => openDishEdit(dish)}
                                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F3F8F4] border border-[#D7E8DB] text-[#16803C] text-xs font-semibold hover:bg-[#EAF6ED] transition">
                                <Pencil className="w-3 h-3" /> Edit
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'gallery' && (
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <h3 className="text-sm font-semibold text-[#111827]">Gallery Posts</h3>
                    {mode === 'edit' && (
                      <button onClick={() => setPostModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] text-white text-sm font-semibold transition">
                        <Plus className="w-4 h-4" /> Add Post
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {GALLERY_CATEGORIES.map((c) => (
                      <button key={c.value} onClick={() => setFilterCategory(c.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                          filterCategory === c.value ? 'bg-[#16803C] text-white' : 'bg-[#F9FAFB] text-[#4B5563] border border-[#E5E7EB] hover:text-[#16803C] hover:bg-white'
                        }`}>{c.label}</button>
                    ))}
                  </div>
                  {galleryLoading ? (
                    <div className="animate-pulse grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="aspect-square bg-[#E5E7EB] rounded-xl" />)}
                    </div>
                  ) : visibleImages.length === 0 ? (
                    <div className="text-center py-10">
                      <ImageIcon className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
                      <p className="text-sm text-[#6B7280]">No gallery posts yet.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {visibleImages.map((img) => (
                        <div key={img.id} className="group relative aspect-square rounded-xl overflow-hidden bg-[#F3F4F6] border border-[#E5E7EB]">
                          {img.type === 'Promotional Video' ? (
                            <video src={toAssetUrl(img.file_path)} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                          ) : (
                            <img src={toAssetUrl(img.file_path)} alt={img.title || ''} className="w-full h-full object-cover" />
                          )}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 flex items-center justify-between">
                            <span className="text-white text-[11px] font-medium truncate">{img.title || 'Untitled'}</span>
                            {img.featured && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                          </div>
                          {mode === 'edit' && (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                              <button onClick={() => openEditPost(img)} title="Edit"
                                className="w-9 h-9 rounded-lg bg-white text-[#16803C] hover:bg-[#EAF6ED] flex items-center justify-center transition"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => featureMutation.mutate(img.id)} title="Feature"
                                className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${img.featured ? 'bg-amber-400 text-white' : 'bg-white text-[#4B5563] hover:bg-[#EAF6ED]'}`}><Star className="w-4 h-4" /></button>
                              <button onClick={() => visibilityMutation.mutate(img.id)} title="Visibility"
                                className="w-9 h-9 rounded-lg bg-white text-[#4B5563] hover:bg-[#EAF6ED] flex items-center justify-center transition">
                                {img.visibility === 'public' ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                              </button>
                              <button onClick={() => setDeletingItem(img)} title="Archive"
                                className="w-9 h-9 rounded-lg bg-white text-red-600 hover:bg-red-50 flex items-center justify-center transition"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'reviews' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[#111827]">Customer Reviews</h3>
                    <span className="inline-flex items-center gap-1.5 text-sm text-[#4B5563]">
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                      <span className="font-semibold">{business?.average_rating?.toFixed(1) || '0.0'}</span>
                      <span className="text-[#9CA3AF]">({business?.review_count || reviews.length})</span>
                    </span>
                  </div>
                  {reviews.length === 0 ? (
                    <div className="text-center py-10">
                      <Star className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
                      <p className="text-sm text-[#6B7280]">No customer reviews yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {reviews.map((r) => (
                        <div key={r.id} className="flex gap-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4">
                          <div className="w-10 h-10 rounded-full bg-[#16803C] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {(r.user_name || 'A').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-[#111827]">{r.user_name}</span>
                              <span className="text-xs text-[#9CA3AF]">{fmtDate(r.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-0.5 mt-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star key={n} className={`w-3.5 h-3.5 ${n <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-[#D1D5DB] fill-[#D1D5DB]'}`} />
                              ))}
                            </div>
                            {r.comment && <p className="text-sm text-[#4B5563] mt-1.5">{r.comment}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          </div>

        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.1)] overflow-hidden">
            <div className="p-4 border-b border-[#E5E7EB] flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2"><Eye className="w-4 h-4 text-[#16803C]" /> Customer Preview</h2>
              <a href={`/tourist/explore/${businessId}`} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-[#16803C] hover:underline whitespace-nowrap">View More</a>
            </div>
            <div className="p-4">
              <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
                <div className="h-20 bg-gradient-to-br from-[#16803C]/15 via-[#EAF6ED] to-[#0B5C2B]/25">
                  {business?.cover_photo ? <img src={toAssetUrl(business.cover_photo)} alt="" className="w-full h-full object-cover" /> : null}
                </div>
                <div className="px-4 pb-4 -mt-6">
                  <div className="w-12 h-12 rounded-xl border-2 border-white shadow bg-white overflow-hidden flex items-center justify-center">
                    {business?.logo ? <img src={toAssetUrl(business.logo)} alt="" className="w-full h-full object-cover" /> : <Camera className="w-5 h-5 text-[#9CA3AF]" />}
                  </div>
                  <p className="font-semibold text-[#111827] text-sm mt-2 truncate">{draft.business_name || 'Restaurant Name'}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5 line-clamp-2">{draft.tagline || draft.business_description || 'No tagline yet'}</p>
                  <div className="flex items-center gap-1 text-xs text-[#4B5563] mt-1.5">
                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span className="font-semibold">{business?.average_rating?.toFixed(1) || '0.0'}</span>
                    <span className="text-[#9CA3AF]">({business?.review_count || 0})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.1)] p-5">
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2 mb-3"><BarChart3 className="w-4 h-4 text-[#16803C]" /> Profile Completion</h2>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-16 h-16 flex-shrink-0">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#E5E7EB" strokeWidth="4" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#16803C" strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${completionPercent} ${100 - completionPercent}`} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#16803C]">{completionPercent}%</span>
              </div>
              {(() => {
                const remaining = completionItems.filter((i) => !i.done).length
                return <p className="text-sm text-[#6B7280]">{remaining === 0 ? 'Your profile is complete!' : `Complete ${remaining} more item${remaining === 1 ? '' : 's'} to boost your profile.`}</p>
              })()}
            </div>
            <ul className="space-y-2">
              {completionItems.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-sm">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${item.done ? 'bg-emerald-100 text-emerald-600' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>
                    {item.done ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                  </span>
                  <span className={`${item.done ? 'text-[#4B5563]' : 'text-[#9CA3AF]'}`}>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.1)] p-5">
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4 text-amber-400" /> Tips</h2>
            <ul className="space-y-2">
              {TIPS.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-[#4B5563]">
                  <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {logoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setLogoModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#111827]">Change Logo</h3>
              <button onClick={() => setLogoModal(false)} className="text-[#9CA3AF] hover:text-[#111827] transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center justify-center mb-4">
              <div className="w-24 h-24 rounded-2xl bg-[#F3F4F6] border border-[#E5E7EB] overflow-hidden flex items-center justify-center">
                {logoPreview || business?.logo ? (
                  <img src={logoPreview || toAssetUrl(business?.logo) || ''} alt="Logo preview" className="w-full h-full object-cover" />
                ) : (
                  <Camera className="w-8 h-8 text-[#9CA3AF]" />
                )}
              </div>
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoFile}
              className="block w-full text-sm text-[#4B5563] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#EAF6ED] file:text-[#16803C] file:font-semibold hover:file:bg-[#D7E8DB] transition mb-4" />
            <div className="flex items-center gap-2">
              <button onClick={uploadLogo} disabled={!logoFile || uploadLogoMutation.isPending}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
                {uploadLogoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
              </button>
              {business?.logo && (
                <button onClick={() => removeLogoMutation.mutate()} disabled={removeLogoMutation.isPending} title="Remove logo"
                  className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 text-sm font-semibold transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {bannerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBannerModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#111827]">Change Banner</h3>
              <button onClick={() => setBannerModal(false)} className="text-[#9CA3AF] hover:text-[#111827] transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="rounded-xl overflow-hidden bg-[#F3F4F6] border border-[#E5E7EB] mb-4">
              <div className="h-32 w-full">
                {bannerPreview || business?.cover_photo ? (
                  <img src={bannerPreview || toAssetUrl(business?.cover_photo) || ''} alt="Banner preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Camera className="w-8 h-8 text-[#9CA3AF]" /></div>
                )}
              </div>
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" onChange={handleBannerFile}
              className="block w-full text-sm text-[#4B5563] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#EAF6ED] file:text-[#16803C] file:font-semibold hover:file:bg-[#D7E8DB] transition mb-4" />
            <div className="flex items-center gap-2">
              <button onClick={uploadBanner} disabled={!bannerFile || uploadCoverMutation.isPending}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
                {uploadCoverMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
              </button>
              {business?.cover_photo && (
                <button onClick={() => removeCoverMutation.mutate()} disabled={removeCoverMutation.isPending} title="Remove banner"
                  className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 text-sm font-semibold transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {postModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closePostModal}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#111827]">Create Gallery Post</h3>
              <button onClick={closePostModal} className="text-[#9CA3AF] hover:text-[#111827] transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Title *</label>
                <input value={postTitle} onChange={(e) => setPostTitle(e.target.value)} placeholder="e.g. Our best-selling adobo"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Category</label>
                  <select value={postCategory} onChange={(e) => setPostCategory(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                    {POST_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Status</label>
                  <select value={postStatus} onChange={(e) => setPostStatus(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Caption</label>
                <textarea value={postCaption} onChange={(e) => setPostCaption(e.target.value)} rows={3} placeholder="Tell customers about this post..."
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 resize-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5"><ImageIcon className="w-3.5 h-3.5 inline mr-1" />Photos</label>
                <input ref={galleryInputRef} type="file" accept="image/*" multiple onChange={handlePostFiles}
                  className="block w-full text-sm text-[#4B5563] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#EAF6ED] file:text-[#16803C] file:font-semibold hover:file:bg-[#D7E8DB] transition" />
                {postPreviews.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {postPreviews.map((src, i) => (
                      <div key={src} className="relative w-20 h-20 rounded-xl overflow-hidden border border-[#E5E7EB]">
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => removePostPreview(i)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5"><Film className="w-3.5 h-3.5 inline mr-1" />Video</label>
                <input ref={galleryVideoInputRef} type="file" accept="video/*" onChange={(e) => setPostVideo(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-[#4B5563] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#EAF6ED] file:text-[#16803C] file:font-semibold hover:file:bg-[#D7E8DB] transition" />
                {postVideo && <p className="text-xs text-[#16803C] mt-1.5">{postVideo.name}</p>}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button onClick={closePostModal} className="px-4 py-2.5 rounded-xl bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#4B5563] text-sm font-medium transition">Cancel</button>
              <button onClick={submitPost} disabled={uploadMutation.isPending || videoMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
                {(uploadMutation.isPending || videoMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingItem(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#111827]">Edit Post</h3>
              <button onClick={() => setEditingItem(null)} className="text-[#9CA3AF] hover:text-[#111827] transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Title</label>
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Caption</label>
                <textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value)} rows={3}
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 resize-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Category</label>
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                  {POST_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Visibility</label>
                  <select value={editVisibility} onChange={(e) => setEditVisibility(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Status</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button onClick={() => setEditingItem(null)} className="px-4 py-2.5 rounded-xl bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#4B5563] text-sm font-medium transition">Cancel</button>
              <button onClick={handleUpdateItem} disabled={updateMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeletingItem(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-[#111827] mb-1">Archive Gallery Post?</h3>
            <p className="text-sm text-[#6B7280] mb-6">This post will no longer be visible to your customers. You can restore it later from the Archive.</p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDeletingItem(null)} className="px-4 py-2.5 rounded-xl bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#4B5563] text-sm font-medium transition">Cancel</button>
              <button onClick={() => deleteMutation.mutate(deletingItem.id)} disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold transition">
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {editingDish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingDish(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#111827]">Edit Dish</h3>
              <button onClick={() => setEditingDish(null)} className="text-[#9CA3AF] hover:text-[#111827] transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Dish Name *</label>
                <input value={dishName} onChange={(e) => setDishName(e.target.value)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Price</label>
                <input value={dishPrice} onChange={(e) => setDishPrice(e.target.value)} type="number" min="0" step="0.01"
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Description</label>
                <textarea value={dishDescription} onChange={(e) => setDishDescription(e.target.value)} rows={3}
                  className="w-full bg-white border border-[#D1D5DB] rounded-xl text-sm px-4 py-2.5 resize-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#4B5563] mb-1.5">Image</label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-xl bg-[#F3F4F6] border border-[#E5E7EB] overflow-hidden flex items-center justify-center flex-shrink-0">
                    {dishImageFile ? (
                      <img src={URL.createObjectURL(dishImageFile)} alt="" className="w-full h-full object-cover" />
                    ) : editingDish.image ? (
                      <img src={toAssetUrl(editingDish.image)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Utensils className="w-5 h-5 text-[#9CA3AF]" />
                    )}
                  </div>
                  <input ref={dishImageInputRef} type="file" accept="image/*" onChange={(e) => setDishImageFile(e.target.files?.[0] ?? null)}
                    className="flex-1 text-sm text-[#4B5563] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#EAF6ED] file:text-[#16803C] file:font-semibold hover:file:bg-[#D7E8DB] transition" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button onClick={() => setEditingDish(null)} className="px-4 py-2.5 rounded-xl bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#4B5563] text-sm font-medium transition">Cancel</button>
              <button onClick={saveDish} disabled={dishUpdateMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
                {dishUpdateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Dish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}