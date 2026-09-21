import { useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, put } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { ArrowLeft, Save, Upload, X } from 'lucide-react'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  price: z.coerce.number().min(0, 'Price must be positive'),
  category: z.string().min(1, 'Category is required'),
  is_available: z.boolean(),
  is_featured: z.boolean(),
})

type FormData = z.infer<typeof schema>

const categories = ['Appetizer', 'Main Course', 'Dessert', 'Beverage', 'Snack', 'Special']

interface MenuItem {
  id: number
  name: string
  description: string | null
  price: number
  category: string
  is_available: boolean
  is_featured: boolean
  image_url: string | null
  status: string
  created_at: string
  updated_at: string
}

export default function StaffMenuEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const { data: item, isLoading } = useQuery({
    queryKey: ['staff-menu-item', id],
    queryFn: () => get<MenuItem>(`/staff/menu/${id}`),
  })

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema as any),
    values: item ? {
      name: item.name,
      description: item.description ?? '',
      price: item.price,
      category: item.category,
      is_available: item.is_available,
      is_featured: item.is_featured,
    } : undefined,
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const formData = new FormData()
      formData.append('name', data.name)
      if (data.description) formData.append('description', data.description)
      formData.append('price', String(data.price))
      formData.append('category', data.category)
      formData.append('is_available', data.is_available ? '1' : '0')
      formData.append('is_featured', data.is_featured ? '1' : '0')
      if (imageFile) formData.append('image', imageFile)
      formData.append('_method', 'PUT')
      return put(`/staff/menu/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-menu-item', id] })
      navigate('/staff/menu')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to update menu item.'),
  })

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const removeImage = () => {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const existingImage = item?.image_url && !imagePreview ? item.image_url : null

  if (isLoading) return <DashboardSkeleton />
  if (!item) return <div className="text-center py-20 text-gray-400">Menu item not found.</div>

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/staff/menu" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Menu
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Edit Menu Item</h1>
        <StatusBadge status={item.status} size="md" />
      </div>
      <p className="text-sm text-gray-400 mb-8">Update the details for {item.name}</p>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-100">Item Details</h2>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Name</label>
            <input {...register('name')} className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-emerald-500/50" />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
            <textarea {...register('description')} rows={3} className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-emerald-500/50 resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Price (₱)</label>
              <input {...register('price')} type="number" step="0.01" className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-emerald-500/50" />
              {errors.price && <p className="text-red-400 text-xs mt-1">{errors.price.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Category</label>
              <select {...register('category')} className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm text-gray-100 focus:ring-2 focus:ring-emerald-500/50">
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {errors.category && <p className="text-red-400 text-xs mt-1">{errors.category.message}</p>}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" {...register('is_available')} className="w-4 h-4 rounded bg-gray-800 border-gray-700 text-emerald-500 focus:ring-emerald-500/40" />
              Available
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" {...register('is_featured')} className="w-4 h-4 rounded bg-gray-800 border-gray-700 text-emerald-500 focus:ring-emerald-500/40" />
              Featured
            </label>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 p-6">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">Image</h2>

          {(imagePreview || existingImage) ? (
            <div className="relative inline-block">
              <img src={imagePreview || existingImage!} alt="Menu item" className="w-48 h-48 object-cover rounded-xl border border-gray-700/50" />
              <button
                type="button"
                onClick={removeImage}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center text-white transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-48 h-48 border-2 border-dashed border-gray-700/50 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-emerald-500/50 transition"
            >
              <Upload className="w-8 h-8 text-gray-500" />
              <span className="text-xs text-gray-500">Click to upload</span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />

          {(imagePreview || existingImage) && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition"
            >
              <Upload className="w-4 h-4" />
              Replace image
            </button>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          <Link to="/staff/menu" className="px-5 py-2.5 rounded-xl border border-gray-700 text-sm font-medium text-gray-300 hover:bg-gray-800 transition">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
