import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CalendarClock, Pencil, Plus, Square, Tag } from 'lucide-react'
import { del, get, post } from '@/shared/services/api'
import { apiErrorMessage } from '@/shared/services/api'
import { Modal } from '@/shared/components/Modal'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, toAssetUrl } from '@/shared/utils'
import { useBusinessPortal } from '../../services/business-portal'
import {
  SALE_STATUS_LABEL, SALE_STATUS_STYLE, formatManilaDateTime, type DishSaleSummary,
} from '../../services/promotions'

type Confirm = { kind: 'end' | 'archive'; sale: DishSaleSummary } | null

/** Dish sales: running, scheduled and finished, with End now / Archive. */
export default function SalesPanel() {
  const portal = useBusinessPortal()
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [error, setError] = useState('')
  const businessParam = portal.businessId ? `?business_id=${portal.businessId}` : ''

  const { data, isLoading } = useQuery({
    queryKey: ['bo-dish-sales', portal.prefix, portal.businessId],
    queryFn: () => get<DishSaleSummary[]>(`${portal.prefix}/dish-sales${businessParam}`),
  })

  const action = useMutation({
    mutationFn: ({ kind, sale }: NonNullable<Confirm>) => kind === 'end'
      ? post(`${portal.prefix}/dish-sales/${sale.id}/end`)
      : del(`${portal.prefix}/dish-sales/${sale.id}`),
    onSuccess: () => {
      setConfirm(null)
      queryClient.invalidateQueries({ queryKey: ['bo-dish-sales'] })
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not update the sale. Please try again.')),
  })

  if (isLoading) return <DashboardSkeleton />
  const sales = data ?? []
  const current = sales.filter((s) => s.status === 'active' || s.status === 'scheduled')
  const finished = sales.filter((s) => s.status === 'ended' || s.status === 'stopped')

  return (
    <section aria-labelledby="sales-heading">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="sales-heading" className="text-lg font-bold text-[#17201B]">Dish sales</h2>
          <p className="text-sm text-[#5E6B63]">Lower the price of chosen dishes for a period. Customers pay the sale price at checkout; your earnings are worked out on it.</p>
        </div>
        <Link to={`${portal.prefix}/promotions/sales/new`} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32]">
          <Plus className="h-4 w-4" aria-hidden="true" /> New sale
        </Link>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {sales.length === 0 ? (
        <div className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-10 text-center">
          <Tag className="mx-auto mb-3 h-10 w-10 text-[#9CA3AF]" aria-hidden="true" />
          <p className="font-semibold text-[#17201B]">No sales yet</p>
          <p className="mt-1 text-sm text-[#647067]">Create a sale to put dishes on discount, then share it in a post.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {current.length > 0 && <SaleList title="Running and scheduled" sales={current} onConfirm={setConfirm} />}
          {finished.length > 0 && <SaleList title="Finished" sales={finished} onConfirm={setConfirm} />}
        </div>
      )}

      <Modal show={confirm !== null} onClose={() => setConfirm(null)} maxWidth="sm">
        {confirm && (
          <div className="p-6">
            <h3 className="mb-2 text-lg font-semibold text-[#17201B]">{confirm.kind === 'end' ? 'End this sale now?' : 'Archive this sale?'}</h3>
            <p className="mb-6 text-sm text-[#647067]">
              {confirm.kind === 'end'
                ? `"${confirm.sale.title}" stops now and its dishes go back to their menu price for new orders. Orders already placed keep their sale price.`
                : `"${confirm.sale.title}" is removed from your list${confirm.sale.status === 'active' ? ' and stops now' : ''}. Orders already placed keep their sale price. An archived sale cannot be restored.`}
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-xl border border-[#D7E8DB] px-4 py-2 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4]">Cancel</button>
              <button type="button" onClick={() => action.mutate(confirm)} disabled={action.isPending} className="rounded-xl bg-[#B42318] px-4 py-2 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50">
                {action.isPending ? 'Saving…' : confirm.kind === 'end' ? 'End sale' : 'Archive'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}

function SaleList({ title, sales, onConfirm }: { title: string; sales: DishSaleSummary[]; onConfirm: (c: Confirm) => void }) {
  const portal = useBusinessPortal()
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#5E6B63]">{title}</h3>
      <ul className="grid gap-5 lg:grid-cols-2">
        {sales.map((sale) => {
          const editable = sale.status === 'active' || sale.status === 'scheduled'
          return (
            <li key={sale.id} className="min-w-0 rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-[#17201B]">{sale.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${SALE_STATUS_STYLE[sale.status]}`}>{SALE_STATUS_LABEL[sale.status]}</span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[#5E6B63]">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatManilaDateTime(sale.starts_at)} – {formatManilaDateTime(sale.ends_at)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#FDECEC] px-2.5 py-1 text-xs font-bold text-[#B42318]">{sale.label}</span>
              </div>

              <ul className="mt-4 space-y-1.5" aria-label={`Dishes in ${sale.title}`}>
                {sale.dishes.slice(0, 4).map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    {d.image ? <img src={toAssetUrl(d.image)} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" /> : <span className="h-7 w-7 shrink-0 rounded-md bg-[#F3F8F4]" />}
                    <span className="min-w-0 flex-1 truncate text-[#17201B]">{d.name}</span>
                    <s className="text-xs text-[#5E6B63]">{formatCurrency(d.price)}</s>
                    <span className="font-semibold text-[#087F3F]">{formatCurrency(d.sale_price)}</span>
                  </li>
                ))}
                {sale.dishes.length > 4 && <li className="text-xs text-[#5E6B63]">+{sale.dishes.length - 4} more</li>}
              </ul>

              {editable && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[#EEF2EF] pt-4">
                  <Link to={`${portal.prefix}/promotions/sales/${sale.id}/edit`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#16803C] hover:bg-[#EAF6ED]">
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                  </Link>
                  <button type="button" onClick={() => onConfirm({ kind: 'end', sale })} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#B42318] hover:bg-[#FDECEC]">
                    <Square className="h-4 w-4" aria-hidden="true" /> End now
                  </button>
                  <button type="button" onClick={() => onConfirm({ kind: 'archive', sale })} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#5E6B63] hover:bg-[#F3F8F4]">
                    <Archive className="h-4 w-4" aria-hidden="true" /> Archive
                  </button>
                </div>
              )}
              {!editable && (
                <div className="mt-4 flex border-t border-[#EEF2EF] pt-4">
                  <button type="button" onClick={() => onConfirm({ kind: 'archive', sale })} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#5E6B63] hover:bg-[#F3F8F4]">
                    <Archive className="h-4 w-4" aria-hidden="true" /> Archive
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
