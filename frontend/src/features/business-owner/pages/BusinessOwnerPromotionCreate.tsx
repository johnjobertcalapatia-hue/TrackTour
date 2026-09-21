import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, post } from '@/shared/services/api'
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

interface Business {
  id: number
  name: string
}

export default function BusinessOwnerPromotionCreate() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')

  const { data: businesses, isLoading: loadingBusinesses } = useQuery({
    queryKey: ['bo-businesses-select'],
    queryFn: () => get<{ data: Business[] }>('/business-owner/businesses'),
  })

  const form = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: { discount_type: 'percentage' },
  })

  const { register, handleSubmit, formState: { errors } } = form

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'bo-promotion-create',
    formId: 'bo-promotion-create',
    form,
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => post('/business-owner/promotions', data),
    onSuccess: () => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ['bo-promotions'] })
      navigate('/business-owner/promotions')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to create promotion.'),
  })

  if (loadingBusinesses) return <DashboardSkeleton />

  const businessList = businesses?.data ?? []

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/business-owner/promotions" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Promotions
      </Link>

      <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-2">Create Promotion</h1>
      <p className="text-sm text-[#647067] mb-8">Create a new promotion to attract customers</p>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-5">
          <h2 className="text-lg font-semibold text-[#17201A]">Promotion Details</h2>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Title</label>
            <input {...register('title')} placeholder="e.g. Summer Sale" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            {errors.title && <p className="text-[#B91C1C] text-xs mt-1">{errors.title.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
            <textarea {...register('description')} rows={3} placeholder="Describe the promotion..." className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
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
              <input {...register('discount_value')} type="number" step="0.01" placeholder="0" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
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
              {businessList.map((b) => (
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
            {mutation.isPending ? 'Creating...' : 'Create Promotion'}
          </button>
        </div>
      </form>
    </div>
  )
}
