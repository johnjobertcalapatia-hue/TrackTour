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
  title: z.string().min(2, 'Title must be at least 2 characters'),
  description: z.string().optional(),
  discount_type: z.enum(['percentage', 'fixed'] as const, 'Discount type is required'),
  discount_value: z.coerce.number().min(0.01, 'Discount value must be greater than 0'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  business_id: z.coerce.number().min(1, 'Business is required'),
})

type FormData = z.infer<typeof schema>

interface Promotion {
  id: number
  title: string
  description: string | null
  discount_type: string
  discount_value: number
  start_date: string
  end_date: string
  business_id: number
}

export default function BusinessOwnerPromotionEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const { data: promo, isLoading } = useQuery({
    queryKey: ['bo-promotion', id],
    queryFn: () => get<Promotion>(`/business-owner/promotions/${id}`),
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
    draftKey: 'bo-promotion-edit',
    formId: 'bo-promotion-edit',
    form,
  })

  useEffect(() => {
    if (promo) {
      reset({
        title: promo.title,
        description: promo.description ?? '',
        discount_type: promo.discount_type as 'percentage' | 'fixed',
        discount_value: promo.discount_value,
        start_date: promo.start_date,
        end_date: promo.end_date,
        business_id: promo.business_id,
      })
    }
  }, [promo])

  const mutation = useMutation({
    mutationFn: (data: FormData) => put(`/business-owner/promotions/${id}`, data),
    onSuccess: () => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ['bo-promotions'] })
      setSuccess('Promotion updated successfully.')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to update promotion.'),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!promo) return <div className="text-center py-20 text-[#647067]">Promotion not found.</div>

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/business-owner/promotions" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Promotions
      </Link>

      <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-2">Edit Promotion</h1>
      <p className="text-sm text-[#647067] mb-8">{promo.title}</p>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Promotion Details</h2>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Title</label>
            <input {...register('title')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            {errors.title && <p className="text-[#B91C1C] text-xs mt-1">{errors.title.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
            <textarea {...register('description')} rows={3} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Discount Type</label>
              <select {...register('discount_type')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount (₱)</option>
              </select>
              {errors.discount_type && <p className="text-[#B91C1C] text-xs mt-1">{errors.discount_type.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Discount Value</label>
              <input {...register('discount_value')} type="number" step="0.01" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.discount_value && <p className="text-[#B91C1C] text-xs mt-1">{errors.discount_value.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Start Date</label>
              <input {...register('start_date')} type="date" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.start_date && <p className="text-[#B91C1C] text-xs mt-1">{errors.start_date.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">End Date</label>
              <input {...register('end_date')} type="date" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              {errors.end_date && <p className="text-[#B91C1C] text-xs mt-1">{errors.end_date.message}</p>}
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
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl border border-[#D7E8DB] text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] transition">
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
