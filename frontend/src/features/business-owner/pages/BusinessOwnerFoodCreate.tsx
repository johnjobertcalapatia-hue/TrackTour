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
  business_id: z.coerce.number().min(1, 'Business is required'),
  is_available: z.boolean(),
})

type FormData = z.infer<typeof schema>

interface CategoryOption {
  id: number
  name: string
  icon: string | null
  is_available: boolean
}

export default function BusinessOwnerFoodCreate() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const form = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: { is_available: true },
  })

  const { register, handleSubmit, watch, formState: { errors } } = form

  const selectedBusinessId = watch('business_id')

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'bo-food-create',
    formId: 'bo-food-create',
    form,
  })

  const { data: businesses } = useQuery({
    queryKey: ['bo-businesses-list'],
    queryFn: () => get<{ id: number; name: string }[]>('/business-owner/businesses'),
  })

  const { data: categories } = useQuery({
    queryKey: ['bo-offering-categories-options', selectedBusinessId],
    queryFn: () => get<{ data: CategoryOption[] }>(`/business-owner/offerings/categories?business_id=${selectedBusinessId}`),
    enabled: !!selectedBusinessId,
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => post('/business-owner/food', data),
    onSuccess: () => {
      clearDraft()
      navigate('/business-owner/menu')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to create food item.'),
  })

  const categoryOptions = categories?.data ?? []

  return (
    <div className="max-w-6xl mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-2">Add Food Item</h1>
      <p className="text-sm text-[#647067] mb-8">Create a new food offering</p>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Food Details</h2>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Name</label>
            <input {...register('name')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            {errors.name && <p className="text-[#B91C1C] text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
            <textarea {...register('description')} rows={3} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Price (₱)</label>
              <input {...register('price')} type="number" step="0.01" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.price && <p className="text-[#B91C1C] text-xs mt-1">{errors.price.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Category</label>
              <select {...register('offering_category_id')}
                disabled={!selectedBusinessId || categoryOptions.length === 0}
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition disabled:bg-[#F3F8F4] disabled:text-[#9CA3AF]">
                <option value="">{selectedBusinessId ? 'Select category' : 'Select a business first'}</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ${c.name}` : c.name}{c.is_available ? '' : ' (Hidden)'}</option>
                ))}
              </select>
              {errors.offering_category_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.offering_category_id.message}</p>}
              {selectedBusinessId && categoryOptions.length === 0 && (
                <p className="text-[#647067] text-xs mt-1">
                  No categories yet.{' '}
                  <button type="button" onClick={() => navigate('/business-owner/offerings/categories')}
                    className="text-[#16803C] font-medium underline underline-offset-2">
                    Create categories here
                  </button>
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business</label>
            <select {...register('business_id')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
              <option value="">Select business</option>
              {businesses?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            {errors.business_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.business_id.message}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm text-[#4B5563]">
            <input type="checkbox" {...register('is_available')} className="w-4 h-4 rounded bg-white border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
            Available for ordering
          </label>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Creating...' : 'Create Food Item'}
          </button>
        </div>
      </form>
    </div>
  )
}
