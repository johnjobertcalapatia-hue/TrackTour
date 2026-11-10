import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { FoodItem } from '@/features/tourist/components/FoodMenuCard'
import OrderItemRow from '@/features/tourist/components/OrderItemRow'
import { fetchMyOrders, myOrdersKey, type OrderSection, type TabKey, type SectionTab } from '@/features/tourist/services/my-orders'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { apiErrorMessage, get } from '@/shared/services/api'
import { createCheckoutSession } from '@/shared/services/payment'
import { openExternalPage } from '@/shared/utils/external-redirect'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, formatCurrency, formatDateTime, toAssetUrl } from '@/shared/utils'
import { Banknote, Bike, CheckCircle2, ClipboardList, CreditCard, Loader2, MapPin, PackageCheck, Star, UtensilsCrossed } from 'lucide-react'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'to_pay', label: 'To Pay' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'to_receive', label: 'To Receive' },
  { key: 'to_review', label: 'To Review' },
]

const STATUS_TONE: Record<SectionTab, string> = {
  to_pay: 'bg-amber-100 text-amber-800',
  preparing: 'bg-[#E9F7EF] text-[#047332]',
  in_transit: 'bg-sky-100 text-sky-800',
  to_receive: 'bg-violet-100 text-violet-800',
  to_review: 'bg-[#E9F7EF] text-[#047332]',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
}

function isTabKey(v: string | null): v is TabKey {
  return TABS.some((t) => t.key === v)
}

/**
 * My Orders: tabs for each stage. Every checkout is one section with its
 * dishes listed one by one (image, details, quantity, price) and a single
 * delivery fee — a multi-restaurant checkout stays in one section.
 */
export default function TouristOrders({ embedded = false }: { embedded?: boolean } = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: TabKey = isTabKey(searchParams.get('tab')) ? (searchParams.get('tab') as TabKey) : 'all'

  const { data, isLoading, isError } = useQuery({
    queryKey: myOrdersKey(tab),
    queryFn: () => fetchMyOrders(tab),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })

  const selectTab = (key: TabKey) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (key === 'all') next.delete('tab')
      else next.set('tab', key)
      return next
    }, { replace: true })

  if (isLoading && !data) return <DashboardSkeleton />

  const sections = data?.sections ?? []
  const counts = data?.counts

  return (
    <div className="mx-auto w-full max-w-4xl">
      {!embedded && (
        <div className="mb-4">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">My Orders</h1>
          <p className="mt-1 text-sm text-[#56615B]">Follow each food order from payment to your review.</p>
        </div>
      )}

      {/* Stage tabs */}
      <div role="tablist" aria-label="Order status" className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => {
          const count = counts?.[t.key] ?? 0
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold transition whitespace-nowrap',
                active ? 'bg-[#087F3F] text-white' : 'bg-white border border-[#E5E9E7] text-[#3B4540] hover:border-[#087F3F]/40',
              )}
            >
              {t.label}
              {t.key !== 'all' && count > 0 && (
                <span className={cn('min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center', active ? 'bg-white text-[#087F3F]' : 'bg-[#087F3F] text-white')}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {isError ? (
        <p role="alert" className="text-sm text-[#B91C1C]">Couldn&apos;t load your orders. Please try again.</p>
      ) : sections.length === 0 ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-12 text-center">
          <ClipboardList className="w-12 h-12 text-[#56615B]/30 mx-auto mb-4" />
          {/* Same message on every tab with no orders. */}
          <p className="text-lg font-bold text-[#17201B]">No related orders</p>
          <p className="mt-1 text-sm text-[#56615B]">Start exploring for food to eat</p>
          <Link to="/tourist/food" className="mt-5 inline-flex h-10 px-5 items-center rounded-full bg-[#087F3F] text-white text-sm font-semibold hover:bg-[#056B35]">
            Explore food
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => <OrderSectionCard key={section.key} section={section} viewTab={tab} />)}
        </div>
      )}

      {/* On every tab, below the orders (or the empty message): dishes to order next. */}
      <SuggestedDishes />
    </div>
  )
}

function OrderSectionCard({ section, viewTab }: { section: OrderSection; viewTab: TabKey }) {
  return (
    <article aria-label={`Order ${section.reference}`} className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden">
      {/* Header: one order number for the whole checkout */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-[#EEF2EF]">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#17201B]">Order #{section.reference}</p>
          {section.placed_at && <p className="text-xs text-[#56615B]">{formatDateTime(section.placed_at)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {section.cod_due && (
            <span className="inline-flex items-center gap-1 h-7 px-3 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
              <Banknote className="w-3.5 h-3.5" aria-hidden="true" /> Cash on delivery
            </span>
          )}
          <span className={cn('inline-flex items-center h-7 px-3 rounded-full text-xs font-bold', STATUS_TONE[section.tab])}>
            {section.status_label}
          </span>
        </div>
      </header>

      {section.cod_due && viewTab === 'to_pay' && (
        <p className="flex items-start gap-2 px-4 sm:px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-sm text-amber-900">
          <Banknote className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Pay <strong>{formatCurrency(section.total)}</strong> in cash to your rider when your order arrives.</span>
        </p>
      )}

      {/* Items, one by one. Photo / name / details open the order details. */}
      <ul className="divide-y divide-[#EEF2EF]" aria-label="Items">
        {section.items.map((item) => (
          <OrderItemRow
            key={item.id}
            item={item}
            to={`/tourist/orders/${item.order_id}/details`}
            showActions={section.tab === 'to_review'}
            reviewTo={`/tourist/orders/${item.order_id}/items/${item.id}/review`}
          />
        ))}
      </ul>

      {/* Totals: a single delivery fee per checkout */}
      <dl className="px-4 sm:px-5 py-3 space-y-1 text-sm bg-[#FAFCFA] border-t border-[#EEF2EF]">
        <div className="flex justify-between text-[#56615B]"><dt>Subtotal</dt><dd>{formatCurrency(section.subtotal)}</dd></div>
        <div className="flex justify-between text-[#56615B]"><dt>Delivery fee</dt><dd>{formatCurrency(section.delivery_fee)}</dd></div>
        {section.rider_tip > 0 && (
          <div className="flex justify-between text-[#56615B]"><dt>Rider tip</dt><dd>{formatCurrency(section.rider_tip)}</dd></div>
        )}
        <div className="flex justify-between font-bold text-[#17201B]"><dt>Total</dt><dd>{formatCurrency(section.total)}</dd></div>
      </dl>

      <SectionActions section={section} />
    </article>
  )
}

function SectionActions({ section }: { section: OrderSection }) {
  const progressUrl = `/tourist/orders/${section.primary_order_id}/progress`


  const button = 'inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full text-sm font-semibold transition'


  return (
    <div className="px-4 sm:px-5 py-3 border-t border-[#EEF2EF] flex flex-wrap items-center justify-end gap-2">
      {section.tab === 'in_transit' && section.rider && (
        <p className="mr-auto flex items-center gap-2 text-sm text-[#3B4540]">
          <Bike className="w-4 h-4 text-[#087F3F]" aria-hidden="true" /> {section.rider.name} is on the way
        </p>
      )}

      {section.tab === 'to_pay' && <CompletePaymentButton section={section} className={button} />}
      {section.tab === 'to_review' && (
        <Link to={`/tourist/orders/${section.primary_order_id}/details`} className={cn(button, 'border border-[#087F3F] text-[#087F3F] hover:bg-[#E9F7EF]')}>
          View order details
        </Link>
      )}
      {section.tab === 'preparing' && (
        <Link to={progressUrl} className={cn(button, 'border border-[#087F3F] text-[#087F3F] hover:bg-[#E9F7EF]')}>View progress</Link>
      )}
      {section.tab === 'in_transit' && (
        <Link to={progressUrl} className={cn(button, 'bg-[#087F3F] text-white hover:bg-[#056B35]')}>
          <MapPin className="w-4 h-4" aria-hidden="true" /> Track rider on map
        </Link>
      )}
      {section.tab === 'to_receive' && (
        <>
          <Link to={progressUrl} className={cn(button, 'border border-[#087F3F] text-[#087F3F] hover:bg-[#E9F7EF]')}>
            <MapPin className="w-4 h-4" aria-hidden="true" /> View on map
          </Link>
          {/* The rider completes the delivery with a photo at your address
              (decision 2026-11-08); no tourist confirmation is needed. */}
          <span className="inline-flex items-center gap-1.5 text-sm text-[#3B4540]">
            <PackageCheck className="w-4 h-4 text-[#087F3F]" aria-hidden="true" /> Your rider will confirm delivery on arrival
          </span>
        </>
      )}
      {section.tab === 'completed' && (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#047332]">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Reviewed — thank you!
        </span>
      )}
      {section.tab === 'cancelled' && <span className="text-sm text-[#56615B]">This order was {section.status_label.toLowerCase()}.</span>}
    </div>
  )
}

/**
 * "Complete payment" for an unpaid online (GCash) order: opens a new PayMongo
 * checkout for the whole checkout (the group checkout for a multi-restaurant
 * order) and sends the tourist to PayMongo's page, where they enter their
 * name and GCash number. PayMongo then returns them to /payment/callback.
 * A fresh checkout is opened each time: an earlier one may have expired or
 * been cancelled, and the server refuses one that is already paid.
 */
function CompletePaymentButton({ section, className }: { section: OrderSection; className: string }) {
  const [error, setError] = useState<string | null>(null)
  const pay = useMutation({
    mutationFn: () => (section.group_order_id
      ? createCheckoutSession('group_order', section.group_order_id, 'gcash')
      : createCheckoutSession('order', section.primary_order_id, 'gcash')),
    onSuccess: (data) => {
      if (data?.checkout_url) {
        openExternalPage(data.checkout_url)
      } else {
        setError("Couldn't open the payment page. Please try again.")
      }
    },
    onError: (e) => setError(apiErrorMessage(e, "Couldn't open the payment page. Please try again.")),
  })
  // Stays "Opening…" after success too: the browser is leaving for PayMongo.
  const busy = pay.isPending || (pay.isSuccess && !error)

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null)
          pay.mutate()
        }}
        disabled={busy}
        className={cn(className, 'bg-[#F4B400] text-[#17201B] hover:bg-[#E0A500] disabled:opacity-70')}
      >
        {busy
          ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Opening payment…</>
          : <><CreditCard className="w-4 h-4" aria-hidden="true" /> Complete payment</>}
      </button>
      {error && <p role="alert" className="text-xs font-medium text-[#B91C1C]">{error}</p>}
    </div>
  )
}

/** Under the empty message: popular dishes to start an order from. */
function SuggestedDishes() {
  // Every dish, page by page (the API returns 12 per page): more load as the
  // tourist scrolls to the end, or with "Show more dishes".
  const query = useInfiniteQuery({
    queryKey: ['tourist-orders-suggested-food-all'],
    queryFn: ({ pageParam }) => get<{ data: FoodItem[]; meta?: { current_page: number; last_page: number } }>('/tourist/food', {
      params: { sort: 'popular', page: pageParam },
    }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta && last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
    staleTime: 5 * 60 * 1000,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Same dish can't appear twice even if pages shift while loading.
  const seen = new Set<number>()
  const dishes = (query.data?.pages ?? []).flatMap((p) => p.data ?? []).filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
  if (dishes.length === 0) return null

  return (
    <section aria-labelledby="suggested-dishes-title" className="mt-6">
      <h2 id="suggested-dishes-title" className="text-lg font-bold text-[#17201B] mb-3">Popular dishes</h2>
      <div className="food-list-grid">
        {dishes.map((food) => <SuggestedDishCard key={food.id} food={food} />)}
      </div>
      {hasNextPage && (
        <div ref={sentinelRef} className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="h-10 px-6 rounded-full border border-[#087F3F] text-[#087F3F] text-sm font-semibold hover:bg-[#E9F7EF] disabled:opacity-60"
          >
            {isFetchingNextPage ? 'Loading…' : 'Show more dishes'}
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * Dish card for suggestions: photo, name, restaurant · category, the dish's
 * real star rating, how many were sold, and price. No cart buttons: the whole
 * card opens the food item page.
 */
function SuggestedDishCard({ food }: { food: FoodItem }) {
  const rating = food.food_rating != null && food.food_rating > 0 ? food.food_rating : null
  const sold = food.sold_count ?? 0
  const category = typeof food.category === 'string' ? food.category : null

  return (
    <Link
      to={`/tourist/food/item/${food.id}`}
      aria-label={`${food.name}, ${formatCurrency(Number(food.price))}`}
      className="food-list-card group flex flex-col bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:border-[#087F3F]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#087F3F] focus-visible:ring-offset-2 transition"
    >
      <div className="aspect-[4/3] overflow-hidden bg-[#E9F7EF]">
        {food.image ? (
          <img src={toAssetUrl(food.image)} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <UtensilsCrossed className="w-10 h-10 text-[#087F3F]/30" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="text-[15px] font-bold text-[#17201B] leading-snug line-clamp-1">{food.name}</h3>
        <p className="text-xs text-[#56615B] truncate">{[food.business_name, category].filter(Boolean).join(' · ')}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#56615B]">
          {rating !== null ? (
            <span className="inline-flex items-center gap-1" aria-label={`Rated ${rating.toFixed(1)} out of 5 from ${food.food_rating_count ?? 0} review${food.food_rating_count === 1 ? '' : 's'}`}>
              <Star className="w-3.5 h-3.5 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" />
              <span className="font-bold text-[#17201B]">{rating.toFixed(1)}</span>
              <span>({food.food_rating_count ?? 0})</span>
            </span>
          ) : (
            <span>No ratings yet</span>
          )}
          {sold > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{sold.toLocaleString()} sold</span>
            </>
          )}
        </div>
        <p className="mt-auto pt-2 text-base font-extrabold text-[#087F3F]">{formatCurrency(Number(food.price))}</p>
      </div>
    </Link>
  )
}
