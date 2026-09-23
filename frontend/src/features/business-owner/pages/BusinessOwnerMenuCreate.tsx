import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { post, get } from '@/shared/services/api'
import { usePersistFormRHF } from '@/shared/hooks/use-persist-form-rhf'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { Alert } from '@/shared/components/Alert'
import { ArrowLeft, Save, Image, X, Star, Tag } from 'lucide-react'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  price: z.coerce.number().min(0, 'Price must be positive'),
  preparation_time: z.coerce.number().min(0, 'Must be 0 or more').max(240, 'Max 240 minutes').optional().or(z.literal('')),
  compare_price: z.coerce.number().min(0).optional().or(z.literal('')),
  offering_category_id: z.coerce.number().min(1, 'Category is required'),
  is_available: z.boolean(),
  is_featured: z.boolean(),
})

type FormData = z.infer<typeof schema>

interface CategoryOption {
  id: number
  name: string
  icon: string | null
  is_available: boolean
}

function formatCurrency(amount: number): string {
  return '₱' + amount.toFixed(2)
}

function getDiscountPercent(price: number, comparePrice: number): number {
  if (!comparePrice || comparePrice <= price) return 0
  return Math.round(((comparePrice - price) / comparePrice) * 100)
}

export default function BusinessOwnerMenuCreate() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const businesses = useBusinessOwnerStore((s) => s.businesses)

  const form = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: {
      is_available: true,
      is_featured: false,
      compare_price: '' as any,
      preparation_time: '' as any,
    },
  })

  const { register, handleSubmit, control, formState: { errors } } = form

  const watched = useWatch({ control })

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'bo-menu-create',
    formId: 'bo-menu-create',
    form,
  })

  const businessId = selectedBusinessId ?? (businesses[0]?.id ?? 0)

  const { data: categories } = useQuery({
    queryKey: ['bo-menu-categories-options', businessId],
    queryFn: () => get<{ data: CategoryOption[] }>(`/business-owner/offerings/categories?business_id=${businessId}`),
    enabled: !!businessId,
  })

  const categoryOptions = categories?.data ?? []

  const mutation = useMutation({
    mutationFn: (formData: FormData) => {
      const payload = new window.FormData()
      payload.append('business_id', String(businessId))
      payload.append('name', formData.name)
      if (formData.description) payload.append('description', formData.description)
      payload.append('price', String(formData.price))
      if (formData.preparation_time) payload.append('preparation_time', String(formData.preparation_time))
      if (formData.compare_price) payload.append('compare_price', String(formData.compare_price))
      payload.append('offering_category_id', String(formData.offering_category_id))
      payload.append('is_available', formData.is_available ? '1' : '0')
      payload.append('is_featured', formData.is_featured ? '1' : '0')
      if (imageFile) payload.append('image', imageFile)

      return post('/business-owner/menu', payload)
    },
    onSuccess: () => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ['bo-menu-categories-options'] })
      navigate('/business-owner/menu')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to create menu item.'),
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }

  const clearImage = () => {
    setImageFile(null)
    setPreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const nameVal = (watched.name as string) || ''
  const priceVal = watched.price as number | undefined
  const comparePriceVal = watched.compare_price as number | string | undefined
  const descVal = (watched.description as string) || ''
  const availableVal = watched.is_available as boolean
  const featuredVal = watched.is_featured as boolean
  const numericPrice = typeof priceVal === 'number' ? priceVal : 0
  const numericCompare = typeof comparePriceVal === 'number' ? comparePriceVal : 0
  const discountPct = getDiscountPercent(numericPrice, numericCompare)

  return (
    <div>
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Add Menu Item</h1>
          <p className="text-sm text-[#647067] mt-1">Fill in the details to create a new menu item</p>
        </div>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ─── LEFT PANEL: Form ─── */}
          <div className="w-full lg:w-3/5 space-y-6">

            {/* Image Upload */}
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-[#17201A]">Food Image</h2>
                <p className="text-xs text-[#647067] mt-0.5">Upload a high-quality photo of the dish. Recommended size: 800x600px.</p>
              </div>
              <div>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-3 bg-white border border-dashed border-[#E2E8E3] hover:border-[#16803C]/50 rounded-xl text-sm text-[#17201A] hover:text-[#16803C] transition w-full">
                    <Image className="w-5 h-5" />
                    {imageFile ? imageFile.name : 'Upload food image'}
                  </button>
                  {previewUrl && (
                    <button type="button" onClick={clearImage} className="p-2 rounded-lg text-[#647067] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
              </div>
            </div>

            {/* Basic Info */}
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-[#17201A]">Basic Information</h2>
                <p className="text-xs text-[#647067] mt-0.5">Provide the essential details about the menu item.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Food Name</label>
                <input {...register('name')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" placeholder="e.g. Pancake Stack with Berries" />
                <p className="text-xs text-[#647067] mt-1">The name that will appear on the customer menu. Keep it clear and appetizing.</p>
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
                <p className="text-xs text-[#647067] mt-1">Group this item under a category so customers can browse by type.</p>
                {errors.offering_category_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.offering_category_id.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Price (₱)</label>
                  <input {...register('price')} type="number" step="0.01" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" placeholder="0.00" />
                  <p className="text-xs text-[#647067] mt-1">The final selling price customers will pay.</p>
                  {errors.price && <p className="text-[#B91C1C] text-xs mt-1">{errors.price.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Discount Price (₱)</label>
                  <input {...register('compare_price')} type="number" step="0.01" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" placeholder="Original price" />
                  <p className="text-xs text-[#647067] mt-1">Set a higher original price to show customers how much they save. Leave empty if not on sale.</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Preparation Time (minutes)</label>
                <input {...register('preparation_time')} type="number" min="0" max="240" placeholder="e.g. 30" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                <p className="text-xs text-[#647067] mt-1">How long the kitchen takes to prepare this dish. Drives the order preparation countdown.</p>
                {errors.preparation_time && <p className="text-[#B91C1C] text-xs mt-1">{errors.preparation_time.message}</p>}
              </div>

              {discountPct > 0 && (
                <div className="flex items-center gap-2 text-sm text-[#16803C] bg-[#EAF6ED] rounded-xl px-4 py-2">
                  <Tag className="w-4 h-4" />
                  {discountPct}% OFF — Customer pays <span className="font-semibold">{formatCurrency(numericPrice)}</span> instead of <span className="line-through text-[#647067]">{formatCurrency(numericCompare)}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
                <textarea {...register('description')} rows={4} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" placeholder="Describe what makes this dish special..." />
                <p className="text-xs text-[#647067] mt-1">A short description that highlights ingredients, flavor, and what makes this dish unique. Displayed below the item name on the menu card.</p>
              </div>
            </div>

            {/* Status & Tags */}
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-[#17201A]">Status & Visibility</h2>
                <p className="text-xs text-[#647067] mt-0.5">Control whether this item appears on the menu and its promotional flags.</p>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-[#4B5563] cursor-pointer">
                  <input type="checkbox" {...register('is_available')} className="w-4 h-4 rounded bg-white border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
                  Available for ordering
                </label>
                <label className="flex items-center gap-2 text-sm text-[#4B5563] cursor-pointer">
                  <input type="checkbox" {...register('is_featured')} className="w-4 h-4 rounded bg-white border-[#E2E8E3] text-[#A66F00] focus:ring-[#A66F00]/40" />
                  <Star className="w-3.5 h-3.5 text-[#A66F00]" />
                  Featured item
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pb-6">
              <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
                Cancel
              </button>
              <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition">
                <Save className="w-4 h-4" />
                {mutation.isPending ? 'Creating...' : 'Create Menu Item'}
              </button>
            </div>
          </div>

          {/* ─── RIGHT PANEL: Live Preview ─── */}
          <div className="w-full lg:w-2/5 lg:sticky lg:top-24 self-start">
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
              <h3 className="text-sm font-semibold text-[#647067] uppercase tracking-wider mb-4">Live Preview</h3>

              <div className="bg-white rounded-2xl border border-[#E2E8E3] overflow-hidden shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
                <div className="relative h-56 bg-[#F3F8F4]">
                  {previewUrl ? (
                    <img src={previewUrl} alt={nameVal} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[#647067]">
                      <Image className="w-10 h-10 mb-2" />
                      <span className="text-sm">No image</span>
                    </div>
                  )}

                  <div className="absolute top-3 left-3 bg-[#16803C] text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    NEW
                  </div>

                  {featuredVal && (
                    <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#F4B400] text-white text-xs font-bold px-2.5 py-1 rounded-full">
                      <Star className="w-3 h-3 fill-current" /> Featured
                    </div>
                  )}

                  {discountPct > 0 && (
                    <div className="absolute top-3 right-3 bg-[#B91C1C] text-white text-xs font-bold px-2.5 py-1 rounded-full">
                      {discountPct}% OFF
                    </div>
                  )}

                  {!availableVal && (
                    <div className="absolute bottom-3 left-3 bg-white/90 text-[#17201A] text-xs px-3 py-1 rounded-full backdrop-blur-sm border border-[#E2E8E3]">
                      Unavailable
                    </div>
                  )}
                </div>

                <div className="p-4 space-y-2">
                  <h3 className="font-semibold text-[#17201A] truncate">
                    {nameVal || 'Food Name'}
                  </h3>

                  {descVal ? (
                    <p className="text-sm text-[#647067] line-clamp-2">{descVal}</p>
                  ) : (
                    <p className="text-sm text-[#647067] italic">No description</p>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[#16803C] font-semibold text-lg">
                        {numericPrice > 0 ? formatCurrency(numericPrice) : '₱0.00'}
                      </span>
                      {numericCompare > numericPrice && (
                        <span className="text-sm text-[#647067] line-through">
                          {formatCurrency(numericCompare)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="pt-1">
                    {availableVal ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#EAF6ED] text-[#16803C]">
                        Available
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#B91C1C]">
                        Unavailable
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-[#647067] mt-3 text-center">
                Preview updates in real time as you fill in the form
              </p>
            </div>
          </div>

        </div>
      </form>
    </div>
  )
}