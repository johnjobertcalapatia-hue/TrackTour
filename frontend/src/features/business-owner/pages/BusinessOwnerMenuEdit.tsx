import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, put } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ArrowLeft, Save, Image, X, Plus, Trash2, GripVertical, Play } from 'lucide-react'

/**
 * Matches the backend: up to 7 extra photos or videos (8 with the main image).
 * Photos JPG/PNG/WebP up to 5 MB; videos MP4/MOV/WebM up to 20 MB.
 */
const MAX_GALLERY_IMAGES = 7
const GALLERY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const GALLERY_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const GALLERY_TYPES = [...GALLERY_IMAGE_TYPES, ...GALLERY_VIDEO_TYPES]
const GALLERY_MAX_BYTES = 5 * 1024 * 1024
const GALLERY_VIDEO_MAX_BYTES = 20 * 1024 * 1024
/** The server accepts about 40 MB per save (PHP post_max_size); stay a little under it. */
const SAVE_MAX_BYTES = 38 * 1024 * 1024

interface Variation {
  id?: number
  name: string
  price: number
  compare_price: string
  imageFile: File | null
  imagePreview: string | null
  is_available: boolean
}

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  price: z.coerce.number().min(0, 'Price must be positive'),
  preparation_time: z.coerce.number().min(0, 'Must be 0 or more').max(240, 'Max 240 minutes').optional().or(z.literal('')),
  offering_category_id: z.coerce.number().min(1, 'Category is required'),
  is_available: z.boolean(),
  is_featured: z.boolean(),
  has_variations: z.boolean(),
})

type FormData = z.infer<typeof schema>

interface CategoryOption {
  id: number
  name: string
  icon: string | null
}

interface MenuItemDetail {
  id: number
  name: string
  description: string | null
  price: number
  compare_price: number | null
  preparation_time: number | null
  offering_category_id: number | null
  is_available: boolean
  is_featured: boolean
  has_variations: boolean
  image: string | null
  /** Extra food photos (besides the main image), shown to tourists in the dish photo carousel. */
  gallery?: { path: string; url: string; type?: 'image' | 'video' }[]
  variations: { id: number; name: string; price: number; compare_price: number | null; image: string | null; is_available: boolean }[]
}

function formatCurrency(amount: number): string {
  return '₱' + amount.toFixed(2)
}

export default function BusinessOwnerMenuEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Extra photos: existing ones the owner removed (sent as remove_gallery[]) and new uploads (gallery_images[]).
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [removedGallery, setRemovedGallery] = useState<string[]>([])
  const [newGallery, setNewGallery] = useState<{ file: File; preview: string }[]>([])
  const [galleryError, setGalleryError] = useState('')

  const [variations, setVariations] = useState<Variation[]>([])

  const { data: item, isLoading } = useQuery({
    queryKey: ['bo-menu-item', id],
    queryFn: () => get<MenuItemDetail>(`/business-owner/menu/${id}`),
  })

  const { data: categories } = useQuery({
    queryKey: ['bo-menu-categories-options'],
    queryFn: () => get<{ data: CategoryOption[] }>(`/business-owner/offerings/categories`),
  })

  const categoryOptions = categories?.data ?? []

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema as any),
  })

  const watched = watch()

  useEffect(() => {
    if (item) {
      reset({
        name: item.name,
        description: item.description ?? '',
        price: item.price,
        preparation_time: item.preparation_time ?? '',
        offering_category_id: item.offering_category_id ?? 0,
        is_available: item.is_available,
        is_featured: item.is_featured,
        has_variations: item.has_variations ?? false,
      })
      if (item.image) setPreview(item.image)
      if (item.variations && item.variations.length > 0) {
        setVariations(item.variations.map((v) => ({
          id: v.id,
          name: v.name,
          price: v.price,
          compare_price: v.compare_price != null ? String(v.compare_price) : '',
          imageFile: null,
          imagePreview: v.image,
          is_available: v.is_available,
        })))
      }
    }
  }, [item])

  const mutation = useMutation({
    mutationFn: (data: any) => put(`/business-owner/menu/${id}`, data),
    onSuccess: () => {
      setSuccess('Menu item updated successfully.')
      newGallery.forEach((g) => URL.revokeObjectURL(g.preview))
      setNewGallery([])
      setRemovedGallery([])
      queryClient.invalidateQueries({ queryKey: ['bo-menu'] })
      queryClient.invalidateQueries({ queryKey: ['bo-menu-item', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-menu-categories-options'] })
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to update menu item.'),
  })

  const keptGallery = (item?.gallery ?? []).filter((g) => !removedGallery.includes(g.path))
  const galleryCount = keptGallery.length + newGallery.length
  const galleryRemaining = MAX_GALLERY_IMAGES - galleryCount
  const newGalleryBytes = newGallery.reduce((sum, g) => sum + g.file.size, 0)
  const saveTooLarge = newGalleryBytes > SAVE_MAX_BYTES

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow picking the same files again
    setGalleryError('')
    const accepted: { file: File; preview: string }[] = []
    for (const file of files) {
      if (!GALLERY_TYPES.includes(file.type)) {
        setGalleryError('Photos must be JPG, PNG or WebP; videos MP4, MOV or WebM.')
        continue
      }
      const isVideo = GALLERY_VIDEO_TYPES.includes(file.type)
      if (file.size > (isVideo ? GALLERY_VIDEO_MAX_BYTES : GALLERY_MAX_BYTES)) {
        setGalleryError(`"${file.name}" is larger than ${isVideo ? '20' : '5'} MB.`)
        continue
      }
      if (accepted.length >= galleryRemaining) {
        setGalleryError(`You can add up to ${MAX_GALLERY_IMAGES} more photos or videos.`)
        break
      }
      accepted.push({ file, preview: URL.createObjectURL(file) })
    }
    if (accepted.length) setNewGallery((prev) => [...prev, ...accepted])
  }

  const removeNewGallery = (index: number) => {
    setNewGallery((prev) => {
      URL.revokeObjectURL(prev[index]!.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const url = URL.createObjectURL(file)
    setPreview(url)
  }

  const clearImage = () => {
    setImageFile(null)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addVariation = () => {
    setVariations((prev) => [...prev, { name: '', price: 0, compare_price: '', imageFile: null, imagePreview: null, is_available: true }])
  }

  const updateVariation = (index: number, field: keyof Variation, value: any) => {
    setVariations((prev) => prev.map((v, i) => i === index ? { ...v, [field]: value } : v))
  }

  const removeVariation = (index: number) => {
    setVariations((prev) => prev.filter((_, i) => i !== index))
  }

  if (isLoading) return <DashboardSkeleton />
  if (!item) return <div className="text-center py-20 text-[#647067]">Menu item not found.</div>

  const hasVariations = watched.has_variations as boolean
  const priceVal = watched.price as number | undefined
  const numericPrice = typeof priceVal === 'number' ? priceVal : 0

  const minVariationPrice = hasVariations && variations.length > 0
    ? Math.min(...variations.map((v) => v.price).filter((p) => p > 0))
    : 0
  const maxVariationPrice = hasVariations && variations.length > 0
    ? Math.max(...variations.map((v) => v.price))
    : 0

  return (
    <div>
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-4 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Edit Menu Item</h1>
          <p className="text-sm text-[#647067] mt-1">{item.name}</p>
        </div>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <form onSubmit={handleSubmit((data) => {
        const payload = new window.FormData()
        payload.append('name', data.name)
        if (data.description) payload.append('description', data.description)
        payload.append('price', String(data.price))
        if (data.preparation_time) payload.append('preparation_time', String(data.preparation_time))
        payload.append('offering_category_id', String(data.offering_category_id))
        payload.append('is_available', data.is_available ? '1' : '0')
        payload.append('is_featured', data.is_featured ? '1' : '0')
        payload.append('has_variations', data.has_variations ? '1' : '0')
        if (imageFile) payload.append('image', imageFile)
        newGallery.forEach((g) => payload.append('gallery_images[]', g.file))
        removedGallery.forEach((path) => payload.append('remove_gallery[]', path))

        if (data.has_variations && variations.length > 0) {
          variations.forEach((v, i) => {
            if (v.id) payload.append(`variations[${i}][id]`, String(v.id))
            payload.append(`variations[${i}][name]`, v.name)
            payload.append(`variations[${i}][price]`, String(v.price))
            if (v.compare_price) payload.append(`variations[${i}][compare_price]`, v.compare_price)
            payload.append(`variations[${i}][is_available]`, v.is_available ? '1' : '0')
            if (v.imageFile) payload.append(`variations[${i}][image]`, v.imageFile)
          })
        }

        mutation.mutate(payload)
      })} className="space-y-6 max-w-3xl">

        {/* Image Upload */}
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Food Image</h2>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-3 bg-white border border-dashed border-[#E2E8E3] hover:border-[#16803C]/50 rounded-xl text-sm text-[#17201A] hover:text-[#16803C] transition w-full">
              <Image className="w-5 h-5" />
              {imageFile ? imageFile.name : (item.image ? 'Change image' : 'Upload food image')}
            </button>
            {preview && (
              <button type="button" onClick={clearImage} className="p-2 rounded-lg text-[#647067] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition shrink-0">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
          {preview && (
            <div className="mt-3 relative w-48 h-36 rounded-xl overflow-hidden border border-[#E2E8E3]">
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            </div>
          )}

          {/* More photos: tourists swipe through them on the dish page. */}
          <div className="pt-5 border-t border-[#E2E8E3]" aria-labelledby="more-photos-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="more-photos-title" className="text-sm font-semibold text-[#17201A]">More photos &amp; videos</h3>
              <span className="text-xs text-[#647067]" data-testid="gallery-count">{galleryCount} / {MAX_GALLERY_IMAGES}</span>
            </div>
            <p className="text-xs text-[#647067] mt-1">
              Add up to {MAX_GALLERY_IMAGES} more photos or short videos of this dish (photos: JPG, PNG or WebP up to 5 MB; videos: MP4, MOV or WebM up to 20 MB). Tourists can swipe through them when viewing the food item.
            </p>

            <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3" aria-label="More photos and videos">
              {keptGallery.map((g, i) => (
                <li key={g.path} className="relative aspect-square rounded-xl overflow-hidden border border-[#E2E8E3]">
                  {g.type === 'video' ? (
                    <>
                      <video src={g.url} muted playsInline preload="metadata" aria-label={`Video ${i + 2} of ${item.name}`} className="w-full h-full object-cover bg-black" />
                      <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-semibold"><Play className="w-3 h-3 fill-current" aria-hidden="true" /> Video</span>
                    </>
                  ) : (
                    <img src={g.url} alt={`Photo ${i + 2} of ${item.name}`} className="w-full h-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => setRemovedGallery((prev) => [...prev, g.path])}
                    aria-label={`Remove ${g.type === 'video' ? 'video' : 'photo'} ${i + 2}`}
                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 text-[#B91C1C] flex items-center justify-center shadow hover:bg-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
              {newGallery.map((g, i) => (
                <li key={g.preview} className="relative aspect-square rounded-xl overflow-hidden border-2 border-dashed border-[#16803C]/50">
                  {g.file.type.startsWith('video/') ? (
                    <video src={g.preview} muted playsInline preload="metadata" aria-label={`New video: ${g.file.name}`} className="w-full h-full object-cover bg-black" />
                  ) : (
                    <img src={g.preview} alt={`New photo: ${g.file.name}`} className="w-full h-full object-cover" />
                  )}
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-[#16803C] text-white text-[10px] font-semibold">New</span>
                  <button
                    type="button"
                    onClick={() => removeNewGallery(i)}
                    aria-label={`Remove new ${g.file.type.startsWith('video/') ? 'video' : 'photo'} ${g.file.name}`}
                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 text-[#B91C1C] flex items-center justify-center shadow hover:bg-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
              {galleryRemaining > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="w-full aspect-square rounded-xl border border-dashed border-[#E2E8E3] hover:border-[#16803C]/50 text-[#647067] hover:text-[#16803C] flex flex-col items-center justify-center gap-1 text-xs font-medium transition"
                  >
                    <Plus className="w-5 h-5" aria-hidden="true" />
                    Add photos or videos
                  </button>
                </li>
              )}
            </ul>
            <input
              ref={galleryInputRef}
              type="file"
              accept={GALLERY_TYPES.join(',')}
              multiple
              onChange={handleGallerySelect}
              className="hidden"
              data-testid="gallery-input"
            />
            {galleryError && <p role="alert" className="text-[#B91C1C] text-xs mt-2">{galleryError}</p>}
            {saveTooLarge && (
              <p role="alert" data-testid="gallery-too-large" className="text-[#B45309] text-xs mt-2">
                These new files add up to more than 38 MB, which is too much for one save. Save a few now, then add the rest.
              </p>
            )}
            {(newGallery.length > 0 || removedGallery.length > 0) && (
              <p className="text-xs text-[#647067] mt-2">Photo changes are saved when you click Save Changes.</p>
            )}
          </div>
        </div>

        {/* Basic Info */}
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Item Details</h2>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Item Name</label>
            <input {...register('name')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            {errors.name && <p className="text-[#B91C1C] text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Item Category</label>
            <select {...register('offering_category_id')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
              <option value="">Select category</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.name}` : c.name}</option>
              ))}
            </select>
            {errors.offering_category_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.offering_category_id.message}</p>}
          </div>

          {!hasVariations && (
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Price (₱)</label>
              <input {...register('price')} type="number" step="0.01" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.price && <p className="text-[#B91C1C] text-xs mt-1">{errors.price.message}</p>}
            </div>
          )}

          {hasVariations && (
            <div className="bg-[#F3F8F4] border border-[#D7E8DB] rounded-xl px-4 py-3 text-sm text-[#16803C]">
              Price is set per variation below. The base price field is disabled.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Preparation Time (minutes)</label>
            <input {...register('preparation_time')} type="number" min="0" max="240" placeholder="e.g. 30" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            <p className="text-xs text-[#647067] mt-1">How long the kitchen takes to prepare this dish. Drives the order preparation countdown.</p>
            {errors.preparation_time && <p className="text-[#B91C1C] text-xs mt-1">{errors.preparation_time.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Item Description</label>
            <textarea {...register('description')} rows={3} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-[#4B5563]">
              <input type="checkbox" {...register('is_available')} className="w-4 h-4 rounded bg-white border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
              Available
            </label>
            <label className="flex items-center gap-2 text-sm text-[#4B5563]">
              <input type="checkbox" {...register('is_featured')} className="w-4 h-4 rounded bg-white border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
              Featured
            </label>
          </div>
        </div>

        {/* Variations */}
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#17201A]">Variations</h2>
              <p className="text-xs text-[#647067] mt-0.5">Add different types/sizes for this item.</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                {...register('has_variations')}
                className="w-4 h-4 rounded bg-white border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40"
              />
              <span className="text-sm text-[#4B5563]">Has Variations</span>
            </label>
          </div>

          {hasVariations && (
            <div className="space-y-4">
              {variations.map((v, i) => (
                <div key={i} className="border border-[#E2E8E3] rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-[#9CA3AF]" />
                      <span className="text-sm font-medium text-[#4B5563]">Variation {i + 1}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={v.is_available}
                          onChange={(e) => updateVariation(i, 'is_available', e.target.checked)}
                          className="w-3.5 h-3.5 rounded bg-white border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40"
                        />
                        <span className="text-xs text-[#647067]">Active</span>
                      </label>
                      <button type="button" onClick={() => removeVariation(i)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <label className="block text-xs text-[#647067] mb-1">Name</label>
                      <input
                        type="text"
                        value={v.name}
                        onChange={(e) => updateVariation(i, 'name', e.target.value)}
                        placeholder="e.g. 500ml"
                        className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#647067] mb-1">Price (₱)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={v.price || ''}
                        onChange={(e) => updateVariation(i, 'price', Number(e.target.value))}
                        placeholder="0.00"
                        className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#647067] mb-1">Sale Price (₱)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={v.compare_price}
                        onChange={(e) => updateVariation(i, 'compare_price', e.target.value)}
                        placeholder="Optional"
                        className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[#647067] mb-1">Image (optional)</label>
                    <div className="flex items-center gap-3">
                      <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-white border border-dashed border-[#E2E8E3] hover:border-[#16803C]/50 rounded-xl text-xs text-[#647067] hover:text-[#16803C] transition cursor-pointer">
                        <Image className="w-3.5 h-3.5" />
                        {v.imageFile ? v.imageFile.name : (v.imagePreview ? 'Change image' : 'Upload image')}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) {
                              updateVariation(i, 'imageFile', file)
                              updateVariation(i, 'imagePreview', URL.createObjectURL(file))
                            }
                          }}
                          className="hidden"
                        />
                      </label>
                      {v.imagePreview && (
                        <img src={v.imagePreview} alt="" className="w-10 h-10 rounded-lg object-cover border border-[#E2E8E3]" />
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <button type="button" onClick={addVariation} className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[#D7E8DB] hover:border-[#16803C]/50 rounded-xl text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] transition">
                <Plus className="w-4 h-4" /> Add Variation
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending || saveTooLarge} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
