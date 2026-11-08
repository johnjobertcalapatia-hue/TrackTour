import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Home, Pencil, Plus, Trash2 } from 'lucide-react'
import { del, get, put } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, toAssetUrl } from '@/shared/utils'
import { useActiveResort } from '@/features/business-owner/services/use-active-resort'
import { BOOKING_MODE_LABEL, priceLabel, togglePublishedFormData, type OfferingOptions, type OwnerOffering } from '@/features/business-owner/services/resort-offerings'

const apiMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

/**
 * Cottages, activities and other bookable offerings of the active resort
 * (dynamic resort system, Stage 5): publish/unpublish, edit, delete.
 */
export default function BusinessOwnerResortOfferings() {
  const { businessId, business, isResort } = useActiveResort()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const key = ['bo-resort-offerings', businessId]

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => get<{ offerings: OwnerOffering[]; options: OfferingOptions }>(`/business-owner/businesses/${businessId}/resort-offerings`),
    enabled: Boolean(businessId && isResort),
  })

  const togglePublish = useMutation({
    mutationFn: (o: OwnerOffering) => put(`/business-owner/businesses/${businessId}/resort-offerings/${o.id}`, togglePublishedFormData(o)),
    onSuccess: (_d, o) => {
      setMessage({ type: 'success', text: o.is_published ? `"${o.name}" is now hidden from tourists.` : `"${o.name}" is now visible to tourists.` })
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (e) => setMessage({ type: 'error', text: apiMessage(e, 'Could not change visibility.') }),
  })

  const remove = useMutation({
    mutationFn: (o: OwnerOffering) => del(`/business-owner/businesses/${businessId}/resort-offerings/${o.id}`),
    onSuccess: (_d, o) => {
      setMessage({ type: 'success', text: `"${o.name}" was removed.` })
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (e) => setMessage({ type: 'error', text: apiMessage(e, 'Could not remove this offering.') }),
  })

  if (!isResort) {
    return <Alert type="info" message={`Cottages & offerings are for Resort businesses${business ? `. "${business.name}" is a ${business.category}.` : '.'}`} />
  }
  if (isLoading) return <DashboardSkeleton />

  const offerings = data?.offerings ?? []
  const published = offerings.filter((o) => o.is_published).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Cottages &amp; Offerings</h1>
          <p className="text-sm text-[#647067] mt-1">
            Everything tourists can reserve at {business?.name}: cottages, rooms, pool access, activities, packages and more.
            {offerings.length > 0 && ` ${published} of ${offerings.length} published.`}
          </p>
        </div>
        <Link to="/business-owner/resort/offerings/new" className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add offering
        </Link>
      </div>

      {message && <Alert type={message.type} message={message.text} onDismiss={() => setMessage(null)} />}

      {offerings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-[#C9D6CD] p-10 text-center">
          <Home className="w-10 h-10 text-[#16803C]/40 mx-auto mb-3" aria-hidden="true" />
          <p className="text-lg font-semibold text-[#17201A]">No offerings yet</p>
          <p className="text-sm text-[#647067] mt-1">Add your cottages, pool access, activities or packages so tourists can see what you offer.</p>
          <Link to="/business-owner/resort/offerings/new" className="mt-4 inline-flex items-center gap-2 bg-[#16803C] text-white px-4 py-2.5 rounded-xl text-sm font-semibold">
            <Plus className="w-4 h-4" aria-hidden="true" /> Add your first offering
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Offerings">
          {offerings.map((o) => (
            <li key={o.id} className="bg-white rounded-2xl border border-[#E2E8E3] p-4 flex gap-4">
              <div className="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-[#F0FAF3] flex items-center justify-center">
                {o.images[0] ? <img src={toAssetUrl(o.images[0].path)} alt="" className="w-full h-full object-cover" /> : <Home className="w-7 h-7 text-[#16803C]/40" aria-hidden="true" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#16803C]">{o.category_label}</p>
                  <span className={cn('h-5 px-2 rounded-full text-[11px] font-bold leading-5', o.is_published ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F3F4F6] text-[#4B5563]')}>
                    {o.is_published ? 'Published' : 'Draft'}
                  </span>
                </div>
                <h2 className="text-base font-semibold text-[#17201A] truncate">{o.name}</h2>
                <p className="text-sm font-bold text-[#126B32]">{priceLabel(o)}</p>
                <p className="text-xs text-[#647067]">
                  {BOOKING_MODE_LABEL[o.booking_mode]} · {o.inventory_quantity} {o.inventory_mode === 'units' ? 'units' : o.inventory_mode === 'capacity' ? 'capacity' : 'per slot'}
                  {o.max_guests ? ` · up to ${o.max_guests} guests` : ''}
                  {!o.bookable_independently && o.requires_offering_name ? ` · only with ${o.requires_offering_name}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Actions for ${o.name}`}>
                  <button type="button" onClick={() => togglePublish.mutate(o)} disabled={togglePublish.isPending} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#E2E8E3] text-xs font-semibold text-[#17201A] hover:border-[#16803C]">
                    {o.is_published ? <><EyeOff className="w-3.5 h-3.5" aria-hidden="true" /> Unpublish</> : <><Eye className="w-3.5 h-3.5" aria-hidden="true" /> Publish</>}
                  </button>
                  <Link to={`/business-owner/resort/offerings/${o.id}/edit`} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#E2E8E3] text-xs font-semibold text-[#17201A] hover:border-[#16803C]">
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => { if (window.confirm(`Remove "${o.name}"? Tourists will no longer see it.`)) remove.mutate(o) }}
                    disabled={remove.isPending}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#E2E8E3] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
