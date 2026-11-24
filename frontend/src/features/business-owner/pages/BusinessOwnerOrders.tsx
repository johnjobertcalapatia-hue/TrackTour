import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiErrorMessage, get, patch, post } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PreparationCountdown } from '@/shared/components/PreparationCountdown'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { deriveReadyAt, formatCurrency, formatDateTime, toAssetUrl } from '@/shared/utils'
import { useBusinessPortal } from '../services/business-portal'
import { useBusinessSocketNotifier } from '@/shared/hooks/useBusinessSocketNotifier'
import type { Order, OrderItem } from '@/shared/types'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Banknote,
  Eye,
  Filter,
  Mail,
  MapPin,
  Phone,
  User,
  UtensilsCrossed,
  ClipboardList,
  Search,
  PackageCheck,
  Store,
  Bike,
} from 'lucide-react'

const ITEMS_PER_PAGE = 8

// Restaurant order flow (spec §13): no restaurant Accept/Reject exists —
// waiting_restaurant is shown as "Finding Rider"/"Pending" until a rider
// accepts, which is what starts preparation. Nothing on this page may offer
// an accept/reject control.
/**
 * Filter chips. Each key is a server-side status group
 * (BusinessOwnerOrderController::STATUS_GROUPS), so a chip shows every order in
 * that state, e.g. "On the way" = in transit / en route / arrived.
 */
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'on_the_way', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

/** Statuses where a running preparation countdown no longer means anything. */
const POST_PREP_STATUSES = ['ready', 'picked_up', 'in_transit', 'out_for_delivery', 'arrived_destination', 'delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected']

const SECTION_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-[#647067]'
const PANEL = 'rounded-xl border border-[#E2E8E3] bg-[#F9FBF9] px-3 py-2.5'

/**
 * COD "paid before ready" (rider trip flow, Stage B): for a cash-on-delivery
 * order the rider pays each restaurant at pickup, and the restaurant must
 * confirm "Payment received" before its food can be marked ready (the server
 * refuses with 422 otherwise). Sent by GET /business-owner/orders for the
 * owner's own restaurants in the order.
 */
type RestaurantPurchase = {
  business_id: number
  status: 'paid' | 'pending'
  purchase_amount?: number | null
  payment_confirmed_at?: string | null
  rider_arrived_at?: string | null
  can_confirm_payment?: boolean
}
type ListOrder = Order & {
  payment_method?: string | null
  restaurant_purchases?: RestaurantPurchase[]
  /** Staff only: other restaurants share this order; their items are not listed. */
  shared_with_other_restaurants?: boolean
  /** Staff only: their restaurant's "Handed to rider" record. */
  my_handover?: { confirmed_at: string; confirmed_by: number } | null
  delivery?: { rider?: { name?: string | null; first_name?: string | null; phone?: string | null } | null } | null
}

/** Item states that count as "done" for the restaurant (handover is possible). */
const ITEM_DONE = ['ready', 'picked_up', 'in_transit', 'delivered', 'completed']
const ITEM_INACTIVE = ['cancelled', 'rejected']

/** This restaurant's items' total (staff in a shared order). */
function itemsTotal(items: OrderItem[]): number {
  return items
    .filter((i) => !ITEM_INACTIVE.includes(i.status ?? ''))
    .reduce((sum, i) => sum + Number(i.total_price ?? Number(i.unit_price ?? 0) * Number(i.quantity ?? 0)), 0)
}

const PAYMENT_LOCK_HINT = 'Confirm "Payment received" from the rider first'

function isCodDelivery(order: ListOrder): boolean {
  return order.order_type === 'delivery' && order.payment_method === 'cash'
}

/** This restaurant's COD payment record for the item (null when it doesn't apply). */
function purchaseForItem(order: ListOrder, item: OrderItem): RestaurantPurchase | null {
  if (!isCodDelivery(order)) return null
  const businessId = item.business_id ?? order.business_id
  return order.restaurant_purchases?.find((p) => p.business_id === businessId) ?? null
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

/** Per-item predicted readiness: each dish gets its own clock from its own
 * preparation window (preparation_started_at + preparation_time), rather than
 * sharing the order-level countdown. */
function itemPredictedReadyAt(item: OrderItem): string | null {
  if (item.status !== 'preparing') return null
  if (!item.preparation_started_at || item.preparation_time == null) return null
  return new Date(new Date(item.preparation_started_at).getTime() + item.preparation_time * 60_000).toISOString()
}

/** One stacked food-item card inside an expanded order (one column). */
function ItemCard({ order, item }: { order: ListOrder; item: OrderItem }) {
  const qty = Number(item.quantity ?? 0)
  const unit = Number(item.unit_price ?? 0)
  const lineTotal = Number(item.total_price ?? unit * qty)
  const img = item.offering?.image || item.offering?.images?.[0]
  const queryClient = useQueryClient()
  const { prefix, can } = useBusinessPortal()

  const canPrepare = can('orders.update') && ['accepted', 'preparing'].includes(order.status)
  const isItemReady = item.status === 'ready'
  const purchase = purchaseForItem(order, item)
  const awaitingPayment = !!purchase && !purchase.payment_confirmed_at
  const itemReadyAt = useMemo(() => itemPredictedReadyAt(item), [item])

  const markItemReady = useMutation({
    mutationFn: () =>
      patch(`${prefix}/orders/${order.id}/items/${item.id}/status`, { status: 'ready' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-orders'] }),
  })

  return (
    <div className={PANEL}>
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          {img ? (
            <img
              src={toAssetUrl(img)}
              alt={item.product_name}
              className="w-11 h-11 rounded-lg object-cover"
            />
          ) : (
            <div className="w-11 h-11 bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] rounded-lg flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-[#087F3F]/40" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
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
            {itemReadyAt && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-[#16803C]">
                <PreparationCountdown readyAt={itemReadyAt} className="font-mono" />
              </span>
            )}
          </div>
          {canPrepare && !isItemReady && (
            <>
              <button
                type="button"
                onClick={() => markItemReady.mutate()}
                disabled={markItemReady.isPending || awaitingPayment}
                title={awaitingPayment ? PAYMENT_LOCK_HINT : undefined}
                className="mt-2 inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg bg-[#16803C] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {markItemReady.isPending ? 'Marking…' : 'Mark Ready for Pickup'}
              </button>
              {awaitingPayment && (
                <p className="mt-1 text-[11px] text-[#B45309]">{PAYMENT_LOCK_HINT}.</p>
              )}
            </>
          )}
          {markItemReady.isError && (
            <p role="alert" className="mt-1 text-[11px] font-medium text-[#B91C1C]">
              {apiErrorMessage(markItemReady.error, "Couldn't mark this item ready. Please try again.")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * COD orders: this restaurant's payment from the rider. "Payment received"
 * appears once the rider has checked in here; it unlocks Mark Ready.
 */
function CodPaymentPanel({ order }: { order: ListOrder }) {
  const queryClient = useQueryClient()
  const { prefix, can } = useBusinessPortal()
  const purchases = order.restaurant_purchases ?? []
  const confirm = useMutation({
    mutationFn: (businessId: number) =>
      post(`${prefix}/orders/${order.id}/cod-payment-received`, { business_id: businessId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
      queryClient.invalidateQueries({ queryKey: ['bo-order', String(order.id)] })
    },
  })
  if (!isCodDelivery(order) || purchases.length === 0) return null

  return (
    <section>
      <h3 className={`${SECTION_TITLE} mb-2`}>Rider Payment (Cash on Delivery)</h3>
      <div className="space-y-2">
        {purchases.map((p) => {
          const amount = p.purchase_amount != null ? formatCurrency(Number(p.purchase_amount)) : null
          return (
            <div key={p.business_id} className={`${PANEL} space-y-1.5`}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5 text-[#17201A]">
                  <Banknote className="w-4 h-4 text-[#647067]" aria-hidden="true" />
                  {amount ?? 'Payment'}
                </span>
                <span className={`text-xs font-semibold ${p.payment_confirmed_at ? 'text-[#16803C]' : 'text-[#B45309]'}`}>
                  {p.payment_confirmed_at ? 'Payment received' : 'Awaiting rider payment'}
                </span>
              </div>
              {p.payment_confirmed_at ? (
                <p className="text-[11px] text-[#16803C]">Confirmed {formatDateTime(p.payment_confirmed_at)} — you can mark the food ready.</p>
              ) : p.can_confirm_payment && !can('payments.confirm_rider_cash') ? (
                <p className="text-[11px] text-[#4B5563]">
                  The rider is at your restaurant. A teammate who handles cash confirms the payment.
                </p>
              ) : p.can_confirm_payment ? (
                <>
                  <p className="text-[11px] text-[#4B5563]">
                    The rider is at your restaurant.{amount ? ` Collect ${amount}` : ''}, then confirm.
                  </p>
                  <button
                    type="button"
                    onClick={() => confirm.mutate(p.business_id)}
                    disabled={confirm.isPending}
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg bg-[#16803C] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50"
                  >
                    {confirm.isPending ? 'Confirming…' : 'Payment received'}
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-[#8A948E]">
                  Waiting for the rider to arrive and pay. The food can be marked ready after you confirm the payment.
                </p>
              )}
            </div>
          )
        })}
        {confirm.isError && (
          <p role="alert" className="text-[11px] font-medium text-[#B91C1C]">
            {apiErrorMessage(confirm.error, "Couldn't confirm the payment. Please try again.")}
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * Staff (Staff Management section 5): "Handed to rider" once the rider has
 * accepted and every one of this restaurant's items is ready. A record only;
 * the rider still confirms the pickup on their side.
 */
function HandoverPanel({ order }: { order: ListOrder }) {
  const queryClient = useQueryClient()
  const { prefix, isStaff, can } = useBusinessPortal()
  const handover = useMutation({
    mutationFn: () => post<{ already_confirmed: boolean }>(`${prefix}/orders/${order.id}/handover`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-orders'] }),
  })
  if (!isStaff || order.order_type !== 'delivery') return null

  const rider = order.delivery?.rider
  const riderName = rider?.first_name || rider?.name || null
  const mine = (order.items ?? []).filter((i) => !ITEM_INACTIVE.includes(i.status ?? ''))
  const allReady = mine.length > 0 && mine.every((i) => ITEM_DONE.includes(i.status ?? ''))
  const canHandover = can('handover.confirm') && !!rider && allReady && !order.my_handover

  return (
    <section>
      <h3 className={`${SECTION_TITLE} mb-2`}>Rider Handover</h3>
      <div className={`${PANEL} space-y-1.5 text-sm`}>
        <p className="flex items-center gap-2 text-[#17201A]">
          <Bike className="h-4 w-4 shrink-0 text-[#647067]" aria-hidden="true" />
          {riderName ? `${riderName}${rider?.phone ? ` · ${rider.phone}` : ''}` : 'Waiting for a rider'}
        </p>
        {order.my_handover ? (
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#16803C]" data-testid={`handover-done-${order.id}`}>
            <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" /> Handed to the rider {formatDateTime(order.my_handover.confirmed_at)}
          </p>
        ) : canHandover ? (
          <button
            type="button"
            onClick={() => handover.mutate()}
            disabled={handover.isPending}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#16803C] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50 sm:w-auto"
          >
            <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {handover.isPending ? 'Saving…' : 'Handed to rider'}
          </button>
        ) : riderName && !allReady ? (
          <p className="text-[11px] text-[#8A948E]">Hand the food over once all your items are ready.</p>
        ) : null}
        {handover.isError && (
          <p role="alert" className="text-[11px] font-medium text-[#B91C1C]">
            {apiErrorMessage(handover.error, "Couldn't record the handover. Please try again.")}
          </p>
        )}
      </div>
    </section>
  )
}

function OrderCard({ order }: { order: ListOrder }) {
  const [open, setOpen] = useState(false)
  const { prefix } = useBusinessPortal()
  // Staff in a shared (group) order see only their own items, so they get
  // their items' total, not the whole order's.
  const shared = Boolean(order.shared_with_other_restaurants)

  const items = order.items ?? []
  const isPreparing = order.status === 'preparing'
  const prepStarted =
    isPreparing ||
    (Boolean(order.preparation_started_at) && !POST_PREP_STATUSES.includes(order.status))
  const notes = order.special_instructions ?? order.notes
  const tip = Number(order.rider_tip ?? 0)

  return (
    <div data-testid={`order-card-${order.id}`} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
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
        {shared && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#B45309]">
            <Store className="h-3 w-3" aria-hidden="true" /> Shared order: other restaurants prepare their own items
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          <StatusBadge status={order.status} />
          <span className="shrink-0 text-sm font-semibold tabular-nums text-[#17201A]">
            {isPreparing ? (
              <PreparationCountdown readyAt={order.predicted_ready_at} className="font-mono text-[#16803C]" />
            ) : (
              formatCurrency(shared ? itemsTotal(items) : Number(order.total ?? 0))
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
                <PreparationCountdown readyAt={deriveReadyAt(order)} className="font-mono font-semibold text-[#16803C]" />
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

          <CodPaymentPanel order={order} />

          <HandoverPanel order={order} />

          {/* Food items — always one column of stacked cards */}
          <section>
            <h3 className={`${SECTION_TITLE} mb-2`}>Items ({items.length})</h3>
            {items.length === 0 ? (
              <p className="text-sm text-[#647067]">No item detail available for this order.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <ItemCard key={item.id} order={order} item={item} />
                ))}
              </div>
            )}
          </section>

          {/* Order total (a shared order: this restaurant's items only) */}
          <section>
            <h3 className={`${SECTION_TITLE} mb-2`}>{shared ? 'Your Items' : 'Order Total'}</h3>
            {shared ? (
              <div className={PANEL}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-[#17201A]">Your items</span>
                  <span className="font-bold tabular-nums text-[#16803C]">{formatCurrency(itemsTotal(items))}</span>
                </div>
              </div>
            ) : (
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
            )}
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
            to={`${prefix}/orders/${order.id}`}
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
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const { prefix, isStaff, businessId: selectedBusinessId } = useBusinessPortal()
  const queryClient = useQueryClient()

  // Search after a short pause in typing; a new search starts at page 1.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [searchInput])

  // P11.8 — live updates on the Orders page: when a rider accepts (order →
  // preparing + countdown armed) or the countdown auto-fires at 00:00 (→
  // ready), the authorized business room forwards the canonical
  // order/delivery/delivery-assigned events and this page refetches instead of
  // waiting for a manual refresh. HTTP is the recovery mechanism, and the
  // notifier degrades silently when the socket/token is unavailable.
  // Staff have no business socket token: their list refreshes every 30 s.
  const { connection } = useBusinessSocketNotifier({
    businessId: isStaff ? null : (selectedBusinessId ?? null),
    onStatusEvent: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    }, [queryClient]),
  })

  // Filtering and paging happen on the server, so every order is reachable
  // (previously only the latest 20 were loaded and filtered in the browser).
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bo-orders', prefix, selectedBusinessId, statusFilter, search, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), perPage: String(ITEMS_PER_PAGE) })
      if (selectedBusinessId && !isStaff) params.set('business_id', String(selectedBusinessId))
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search) params.set('search', search)
      return get<{ data: Order[]; meta?: { current_page: number; last_page: number; total: number; status_counts?: Record<string, number> } }>(`${prefix}/orders?${params.toString()}`)
    },
    placeholderData: (previous) => previous,
    refetchInterval: isStaff ? 30_000 : false,
  })

  if (isLoading) return <DashboardSkeleton />

  const orders = data?.data ?? []
  const meta = data?.meta
  const total = meta?.total ?? orders.length
  const totalPages = Math.max(1, meta?.last_page ?? 1)
  const current = Math.min(page, totalPages)
  const counts = meta?.status_counts
  const filtersOn = statusFilter !== 'all' || Boolean(search)

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><ClipboardList className="h-6 w-6" aria-hidden="true" /></span>
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Orders</h1>
            <p className="mt-1 text-sm text-[#5E6B63]">
              {isStaff ? "Your restaurant's items in each order. " : ''}Incoming orders start preparing automatically once a rider accepts
            </p>
          </div>
        </div>
        {connection === 'connected' && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#EAF6ED] px-2.5 py-1 text-[11px] font-medium text-[#16803C]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16803C] animate-pulse" />
            Live
          </p>
        )}
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <Filter className="w-4 h-4 text-[#647067]" aria-hidden="true" />
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={statusFilter === f.key}
              onClick={() => { setStatusFilter(f.key); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                statusFilter === f.key
                  ? 'bg-[#16803C] text-white'
                  : 'bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4]'
              }`}
            >
              {f.label}
              {counts && <span className={`ml-1.5 tabular-nums ${statusFilter === f.key ? 'text-white/80' : 'text-[#647067]'}`}>{counts[f.key] ?? 0}</span>}
            </button>
          ))}
        </div>
        <label className="relative block w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search order # or customer…"
            aria-label="Search orders"
            className="w-full rounded-xl border border-[#E2E8E3] bg-white py-2.5 pl-9 pr-3 text-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25"
          />
        </label>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <p className="text-[#647067]">{filtersOn ? 'No orders match these filters.' : 'No orders found.'}</p>
          {filtersOn && (
            <button type="button" onClick={() => { setStatusFilter('all'); setSearchInput(''); setSearch(''); setPage(1) }} className="mt-3 text-sm font-semibold text-[#16803C] hover:underline">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={`space-y-3 transition-opacity ${isFetching ? 'opacity-60' : ''}`} aria-busy={isFetching}>
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-[#647067]">
              Showing {(current - 1) * ITEMS_PER_PAGE + 1}–{Math.min(current * ITEMS_PER_PAGE, total)} of {total}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button aria-label="Previous page" onClick={() => setPage(Math.max(1, current - 1))} disabled={current === 1} className="p-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {current} of {totalPages}</span>
                <button aria-label="Next page" onClick={() => setPage(Math.min(totalPages, current + 1))} disabled={current === totalPages} className="p-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
