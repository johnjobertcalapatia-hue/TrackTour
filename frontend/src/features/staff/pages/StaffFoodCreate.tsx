import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { post, get } from '@/shared/services/api'
import { usePersistFormRHF } from '@/shared/hooks/use-persist-form-rhf'
import { Alert } from '@/shared/components/Alert'
import { ArrowLeft, Save } from 'lucide-react'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  price: z.coerce.number().min(0, 'Price must be positive'),
  offering_category_id: z.coerce.number().min(1, 'Category is required'),
  is_available: z.boolean(),
  is_featured: z.boolean(),
})

type FormData = z.infer<typeof schema>

interface CategoryOption {
  id: number
  name: string
  icon: string | null
}

export default function StaffFoodCreate() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const form = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: { is_available: true, is_featured: false },
  })

  const { register, handleSubmit, formState: { errors } } = form

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'staff-food-create',
    formId: 'staff-food-create',
    form,
  })

  const { data: categories } = useQuery({
    queryKey: ['staff-menu-categories'],
    queryFn: () => get<{ data: CategoryOption[] }>('/staff/menu/categories'),
  })

  const categoryOptions = categories?.data ?? []

  const mutation = useMutation({
    mutationFn: (data: FormData) => post('/staff/menu', data),
    onSuccess: () => {
      clearDraft()
      navigate('/staff/menu')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to create menu item.'),
  })

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl lg:text-3xl font-bold text-gray-100 mb-2">Add Menu Item</h1>
      <p className="text-sm text-gray-400 mb-8">Create a new menu item</p>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-100">Item Details</h2>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
            <input {...register('name')} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:ring-2 focus:ring-emerald-500/40 focus:outline-none" />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
            <textarea {...register('description')} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:ring-2 focus:ring-emerald-500/40 focus:outline-none resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Price (₱)</label>
              <input {...register('price')} type="number" step="0.01" className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:ring-2 focus:ring-emerald-500/40 focus:outline-none" />
              {errors.price && <p className="text-red-400 text-xs mt-1">{errors.price.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Category</label>
              <select {...register('offering_category_id')} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:ring-2 focus:ring-emerald-500/40 focus:outline-none">
                <option value="">Select category</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.name}` : c.name}</option>
                ))}
              </select>
              {errors.offering_category_id && <p className="text-red-400 text-xs mt-1">{errors.offering_category_id.message}</p>}
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

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl border border-gray-700 text-sm font-medium text-gray-300 hover:bg-gray-800 transition">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Creating...' : 'Create Item'}
          </button>
        </div>
      </form>
    </div>
  )
}
