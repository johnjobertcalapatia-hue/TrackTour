import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, put } from '@/shared/services/api'
import { usePersistFormRHF } from '@/shared/hooks/use-persist-form-rhf'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ArrowLeft, Save } from 'lucide-react'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  type: z.string().min(1, 'Type is required'),
  price: z.coerce.number().min(0, 'Price must be positive'),
  preparation_time: z.coerce.number().min(0, 'Must be 0 or more').max(240, 'Max 240 minutes').optional().or(z.literal('')),
  business_id: z.coerce.number().min(1, 'Business is required'),
  category_id: z.coerce.number().min(1, 'Category is required'),
})

type FormData = z.infer<typeof schema>

interface Offering {
  id: number
  name: string
  description: string | null
  type: string
  price: number
  preparation_time: number | null
  business_id: number
  category_id: number
}

interface OfferingCategory {
  id: number
  name: string
}

export default function BusinessOwnerOfferingEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { data: offering, isLoading } = useQuery({
    queryKey: ['bo-offering', id],
    queryFn: () => get<Offering>(`/business-owner/offerings/${id}`),
  })

  const { data: categories } = useQuery({
    queryKey: ['bo-offering-categories'],
    queryFn: () => get<{ data: OfferingCategory[] }>('/business-owner/offerings/categories'),
  })

  const { data: businesses } = useQuery({
    queryKey: ['bo-businesses-list'],
    queryFn: () => get<{ id: number; name: string }[]>('/business-owner/businesses'),
  })

  const form = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: {},
  })

  const { register, handleSubmit, reset, formState: { errors } } = form

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'bo-offering-edit',
    formId: 'bo-offering-edit',
    form,
  })

  useEffect(() => {
    if (offering) {
      reset({
        name: offering.name,
        description: offering.description ?? '',
        type: offering.type,
        price: offering.price,
        preparation_time: offering.preparation_time ?? '',
        business_id: offering.business_id,
        category_id: offering.category_id,
      })
    }
  }, [offering])

  const mutation = useMutation({
    mutationFn: (data: FormData) => put(`/business-owner/offerings/${id}`, data),
    onSuccess: () => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ['bo-offerings'] })
      setSuccess('Offering updated successfully.')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to update offering.'),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!offering) return <div className="text-center py-20 text-[#647067]">Offering not found.</div>

  const categoryList = categories?.data ?? []

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/business-owner/offerings" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Offerings
      </Link>

      <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-2">Edit Offering</h1>
      <p className="text-sm text-[#647067] mb-8">{offering.name}</p>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Offering Details</h2>

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
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Type</label>
              <select {...register('type')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                <option value="">Select type</option>
                <option value="service">Service</option>
                <option value="product">Product</option>
                <option value="package">Package</option>
                <option value="subscription">Subscription</option>
              </select>
              {errors.type && <p className="text-[#B91C1C] text-xs mt-1">{errors.type.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Price (₱)</label>
              <input {...register('price')} type="number" step="0.01" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.price && <p className="text-[#B91C1C] text-xs mt-1">{errors.price.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Preparation Time (minutes)</label>
            <input {...register('preparation_time')} type="number" min="0" max="240" placeholder="e.g. 30" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            <p className="text-xs text-[#647067] mt-1">How long the kitchen takes to prepare this dish. Drives the order preparation countdown.</p>
            {errors.preparation_time && <p className="text-[#B91C1C] text-xs mt-1">{errors.preparation_time.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Category</label>
              <select {...register('category_id')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                <option value="">Select category</option>
                {categoryList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.category_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.category_id.message}</p>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
