import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PreparationCountdown } from '@/shared/components/PreparationCountdown'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import type { Order, OrderItem } from '@/shared/types'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Eye,
  Filter,
  Mail,
  MapPin,
  Phone,
  User,
} from 'lucide-react'

const ITEMS_PER_PAGE = 8

// Restaurant order flow (spec §13): no restaurant Accept/Reject exists —
// waiting_restaurant is shown as "Finding Rider"/"Pending" until a rider
// accepts, which is what starts preparation. Nothing on this page may offer
// an accept/reject control.
const STATUS_FILTERS = [
  'all',
  'waiting_restaurant',
  'preparing',
  'ready',
  'picked_up',
  'out_for_delivery',
  'delivered',
  'completed',
  'cancelled',
]

const TAB_LABELS: Record<string, string> = {
  waiting_restaurant: 'Pending',
}

/** Statuses where a running preparation countdown no longer means anything. */
const POST_PREP_STATUSES = ['ready', 'picked_up', 'in_transit', 'out_for_delivery', 'arrived_destination', 'delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected']

const SECTION_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-[#647067]'
const PANEL = 'rounded-xl border border-[#E2E8E3] bg-[#F9FBF9] px-3 py-2.5'

function tabLabel(status: string): string {
  if (status === 'all') return 'All'
  return TAB_LABELS[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

/** Priority tip display: Normal / ₱25 / ₱50 / ₱100 Fast (spec §13). */
function priorityLabel(order: Order): string {
  const tip = Number(order.rider_tip ?? 0)
  if (tip <= 0) return 'Normal'
  return tip >= 100 ? `₱${tip} Fast` : `₱${tip}`
}

/** Card-face timestamp: "Sep 23, 2026 • 03:17 PM". */
function faceDate(value: string): string {
  const d = new Date(value)
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${day} • ${time}`
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[#647067] shrink-0">{label}</span>
      <span className="text-right text-[#17201A] min-w-0">{children}</span>
    </div>
  )
}

/** One stacked food-item card inside an expanded order (one column). */
function ItemCard({ item }: { item: OrderItem }) {
  const qty = Number(item.quantity ?? 0)
  const unit = Number(item.unit_price ?? 0)
  const lineTotal = Number(item.total_price ?? unit * qty)

  return (
    <div className={PANEL}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[#17201A] min-w-0">{item.product_name}</p>
        <p className="text-sm font-semibold tabular-nums text-[#17201A] shrink-0">{formatCurrency(lineTotal)}</p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#647067]">
        <span>Qty {qty} × {formatCurrency(unit)}</span>
        {item.preparation_time != null && (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {item.preparation_time} min prep
          </span>
        )}
      </div>
      <div className="mt-2">
        <StatusBadge status={item.status ?? 'pending'} />
      </div>
    </div>
  )
}

function OrderCard({ order }: { order: Order }) {
  const [open, setOpen] = useState(false)

  const items = order.items ?? []
  const isPreparing = order.status === 'preparing'
  const prepStarted =
    isPreparing ||
    (Boolean(order.preparation_started_at) && !POST_PREP_STATUSES.includes(order.status))
  const notes = order.special_instructions ?? order.notes
  const tip = Number(order.rider_tip ?? 0)

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`order-details-${order.id}`}
        className="w-full text-left px-4 py-3 sm:px-5 transition hover:bg-[#F6F8F4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16803C]/40"
      >
        <p className={`${SECTION_TITLE}`}>
          Order #<span className="ml-1 text-[13px] font-bold normal-case tracking-normal text-[#17201A]">{order.order_number}</span>
        </p>
        <p className="mt-1 text-sm text-[#4B5563] truncate">{order.customer_name}</p>

        <div className="mt-2 flex items-center justify-between gap-3">
          <StatusBadge status={order.status} />
          <span className="shrink-0 text-sm font-semibold tabular-nums text-[#17201A]">
            {isPreparing ? (
              <PreparationCountdown readyAt={order.predicted_ready_at} className="font-mono text-[#16803C]" />
            ) : (
              formatCurrency(Number(order.total ?? 0))
            )}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-[#647067]">{faceDate(order.created_at)}</span>
          <ChevronDown
            className={`w-4 h-4 shrink-0 text-[#647067] transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>
      </button>

      {open && (
        <div id={`order-details-${order.id}`} className="border-t border-[#E2E8E3] px-4 py-4 sm:px-5 space-y-5">
          {/* Details — order id / group reference / status / priority / prep */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
            <MetaRow label="Order ID">
              <span className="font-medium">#{order.id}</span>
            </MetaRow>
            {order.group_reference_number && (
              <MetaRow label="Group Reference">
                <span className="text-xs font-semibold text-purple-700">{order.group_reference_number}</span>
              </MetaRow>
            )}
            <MetaRow label="Status">
              <StatusBadge status={order.status} />
            </MetaRow>
            <MetaRow label="Priority / Tip">
              <span className={tip > 0 ? 'font-semibold text-[#B45309]' : undefined}>{priorityLabel(order)}</span>
            </MetaRow>
            {order.order_type && (
              <MetaRow label="Order Type">
                <span className="capitalize">{order.order_type.replace(/_/g, ' ')}</span>
              </MetaRow>
            )}
            <MetaRow label="Placed">{formatDateTime(order.created_at)}</MetaRow>
            {prepStarted && (
              <MetaRow label="Time Remaining">
                <PreparationCountdown readyAt={order.predicted_ready_at} className="font-mono font-semibold text-[#16803C]" />
              </MetaRow>
            )}
            {!prepStarted && order.preparation_time != null && (
              <MetaRow label="Preparation Time">{order.preparation_time} min</MetaRow>
            )}
          </div>

          {order.status === 'waiting_restaurant' && (
            <p className="text-xs text-[#647067]">
              Finding a rider — preparation starts automatically once a rider accepts this delivery.
            </p>
          )}

          {/* Customer information */}
          <section>
            <h3 className={`${SECTION_TITLE} mb-2`}>Customer Information</h3>
            <div className={`${PANEL} space-y-1.5 text-sm`}>
              <p className="flex items-start gap-2 text-[#17201A]">
                <User className="w-4 h-4 shrink-0 text-[#647067] mt-0.5" />
                {order.customer_name}
              </p>
              {order.customer_email && (
                <p className="flex items-start gap-2 text-[#4B5563] break-all">
                  <Mail className="w-4 h-4 shrink-0 text-[#647067] mt-0.5" />
                  {order.customer_email}
                </p>
              )}
              {order.customer_phone && (
                <p className="flex items-start gap-2 text-[#4B5563]">
                  <Phone className="w-4 h-4 shrink-0 text-[#647067] mt-0.5" />
                  {order.customer_phone}
                </p>
              )}
              {order.delivery_address && (
                <p className="flex items-start gap-2 text-[#4B5563]">
                  <MapPin className="w-4 h-4 shrink-0 text-[#647067] mt-0.5" />
                  {order.delivery_address}
                </p>
              )}
            </div>
          </section>

          {/* Food items — always one column of stacked cards */}
          <section>
            <h3 className={`${SECTION_TITLE} mb-2`}>Items ({items.length})</h3>
            {items.length === 0 ? (
              <p className="text-sm text-[#647067]">No item detail available for this order.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          {/* Order total */}
          <section>
            <h3 className={`${SECTION_TITLE} mb-2`}>Order Total</h3>
            <div className={`${PANEL} space-y-1.5`}>
              <MetaRow label="Subtotal">{formatCurrency(Number(order.subtotal ?? 0))}</MetaRow>
              <MetaRow label="Delivery Fee">{formatCurrency(Number(order.delivery_fee ?? 0))}</MetaRow>
              {Number(order.discount ?? 0) > 0 && (
                <MetaRow label="Discount">
                  <span className="text-[#B91C1C]">-{formatCurrency(Number(order.discount))}</span>
                </MetaRow>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-[#E2E8E3] pt-1.5 text-sm">
                <span className="font-semibold text-[#17201A]">Total</span>
                <span className="font-bold tabular-nums text-[#16803C]">{formatCurrency(Number(order.total ?? 0))}</span>
              </div>
            </div>
          </section>

          {/* Notes (only when present) */}
          {notes && (
            <section>
              <h3 className={`${SECTION_TITLE} mb-2`}>Order Notes</h3>
              <p className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2 text-sm text-[#7A5A17]">
                {notes}
              </p>
            </section>
          )}

          <Link
            to={`/business-owner/orders/${order.id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#D7E8DB] bg-white px-4 py-2 text-xs font-semibold text-[#16803C] transition hover:bg-[#F3F8F4] sm:w-auto"
          >
            <Eye className="w-3.5 h-3.5" />
            View Order
          </Link>
        </div>
      )}
    </div>
  )
}

export default function BusinessOwnerOrders() {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-orders', selectedBusinessId, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedBusinessId) params.set('business_id', String(selectedBusinessId))
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const qs = params.toString()
      return get<{ data: Order[] }>(`/business-owner/orders${qs ? `?${qs}` : ''}`)
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const allOrders = data?.data ?? []
  const filtered = statusFilter === 'all' ? allOrders : allOrders.filter((o) => o.status === statusFilter)
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Orders</h1>
        <p className="mt-1 text-sm text-[#647067]">Incoming orders start preparing automatically once a rider accepts</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Filter className="w-4 h-4 text-[#647067]" />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === s
                ? 'bg-[#16803C] text-white'
                : 'bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4]'
            }`}
          >
            {tabLabel(s)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <p className="text-[#647067]">No orders found.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paginated.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
