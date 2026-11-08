import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarCheck, CreditCard, MapPin, Phone, User } from 'lucide-react'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import OrderItemRow from '@/features/tourist/components/OrderItemRow'
import { fetchMyOrders, findSection, myOrdersKey } from '@/features/tourist/services/my-orders'

const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash on delivery', cod: 'Cash on delivery', gcash: 'GCash', paymongo: 'Online payment' }

/**
 * Order details (opened from a dish in My Orders, e.g. To Review): order id,
 * delivery date, recipient name and number, delivery address, every dish
 * (photo, info, quantity, price; tap → food item page) and the total payment.
 */
export default function TouristOrderDetails() {
  const { id } = useParams<{ id: string }>()
  const orderId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()

  const { data, isLoading } = useQuery({ queryKey: myOrdersKey('all'), queryFn: () => fetchMyOrders('all') })
  const section = findSection(data?.sections, orderId)

  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/tourist/activities?view=orders'))

  if (isLoading && !data) return <DashboardSkeleton />

  if (!section) {
    return (
      <div className="mx-auto max-w-3xl bg-white border border-[#E5E9E7] rounded-2xl p-10 text-center">
        <p className="text-lg font-bold text-[#17201B]">Order not found</p>
        <Link to="/tourist/activities?view=orders" className="mt-4 inline-flex h-10 px-5 items-center rounded-full bg-[#087F3F] text-white text-sm font-semibold">My orders</Link>
      </div>
    )
  }

  const delivered = section.tab === 'to_review' || section.tab === 'completed'
  const payment = section.payment_method ? PAYMENT_LABEL[section.payment_method.toLowerCase()] ?? section.payment_method : null

  return (
    <main aria-label="Order details" className="mx-auto w-full max-w-3xl space-y-4">
      <button type="button" onClick={goBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#087F3F] hover:text-[#056B35]">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
      </button>

      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-[#17201B]">Order details</h1>
          <p className="text-sm text-[#56615B]">Order ID <span className="font-semibold text-[#17201B]">#{section.reference}</span></p>
        </div>
        <span className="inline-flex items-center h-7 px-3 rounded-full text-xs font-bold bg-[#E9F7EF] text-[#047332]">{section.status_label}</span>
      </header>

      {/* Delivery information */}
      <section aria-labelledby="delivery-info-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
        <h2 id="delivery-info-title" className="text-base font-bold text-[#17201B] mb-3">Delivery information</h2>
        <dl className="space-y-2.5 text-sm">
          <div className="flex items-start gap-3">
            <CalendarCheck className="w-4 h-4 mt-0.5 text-[#087F3F] shrink-0" aria-hidden="true" />
            <dt className="sr-only">Delivery date</dt>
            <dd className="text-[#17201B]">
              {section.delivered_at ? <>Delivered {formatDateTime(section.delivered_at)}</> : <span className="text-[#56615B]">Not delivered yet</span>}
            </dd>
          </div>
          <div className="flex items-start gap-3">
            <User className="w-4 h-4 mt-0.5 text-[#087F3F] shrink-0" aria-hidden="true" />
            <dt className="sr-only">Recipient</dt>
            <dd className="text-[#17201B] font-semibold">{section.customer_name || '—'}</dd>
          </div>
          <div className="flex items-start gap-3">
            <Phone className="w-4 h-4 mt-0.5 text-[#087F3F] shrink-0" aria-hidden="true" />
            <dt className="sr-only">Phone number</dt>
            <dd className="text-[#17201B]">{section.customer_phone || '—'}</dd>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 mt-0.5 text-[#087F3F] shrink-0" aria-hidden="true" />
            <dt className="sr-only">Delivery address</dt>
            <dd className="text-[#17201B]">{section.delivery_address || '—'}</dd>
          </div>
        </dl>
        {section.delivery_proof_url && (
          <figure className="mt-4">
            <img
              src={section.delivery_proof_url}
              alt="Photo of your delivered food, taken by the rider"
              className="w-full max-h-72 rounded-xl object-cover border border-[#E5E9E7]"
            />
            <figcaption className="mt-1.5 text-xs text-[#56615B]">Proof of delivery taken by your rider</figcaption>
          </figure>
        )}
      </section>

      {/* Items (tap → food item page) */}
      <section aria-labelledby="order-items-title" className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden">
        <h2 id="order-items-title" className="text-base font-bold text-[#17201B] px-4 sm:px-5 pt-4">Items</h2>
        <ul className="divide-y divide-[#EEF2EF]" aria-label="Items">
          {section.items.map((item) => (
            <OrderItemRow
              key={item.id}
              item={item}
              to={item.offering_id ? `/tourist/food/item/${item.offering_id}` : undefined}
              showActions={delivered}
              reviewTo={`/tourist/orders/${item.order_id}/items/${item.id}/review`}
            />
          ))}
        </ul>
      </section>

      {/* Payment */}
      <section aria-labelledby="payment-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
        <h2 id="payment-title" className="text-base font-bold text-[#17201B] mb-3">Payment</h2>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between text-[#56615B]"><dt>Subtotal</dt><dd>{formatCurrency(section.subtotal)}</dd></div>
          <div className="flex justify-between text-[#56615B]"><dt>Delivery fee</dt><dd>{formatCurrency(section.delivery_fee)}</dd></div>
          {section.rider_tip > 0 && <div className="flex justify-between text-[#56615B]"><dt>Rider tip</dt><dd>{formatCurrency(section.rider_tip)}</dd></div>}
          <div className="flex justify-between pt-2 border-t border-[#EEF2EF] text-base font-extrabold text-[#17201B]"><dt>Total payment</dt><dd>{formatCurrency(section.total)}</dd></div>
          {payment && (
            <div className="flex items-center gap-2 pt-1 text-xs text-[#56615B]">
              <CreditCard className="w-3.5 h-3.5" aria-hidden="true" /> Paid with {payment}
            </div>
          )}
        </dl>
      </section>
    </main>
  )
}
