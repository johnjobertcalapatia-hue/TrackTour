import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Bell, Star } from 'lucide-react'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import {
  CATEGORY_ICON, NOTICE_STATUS_LABEL, NOTIFICATION_TABS, formatManila, statusLabel,
  type NotificationSubject, type OwnerNotification,
} from '@/features/business-owner/services/notifications'

const card = 'rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)] sm:p-6'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-[#647067]">{label}</dt>
      <dd className="text-right font-medium text-[#17201B]">{children}</dd>
    </div>
  )
}

function OpenLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-[#16803C] px-4 text-sm font-semibold text-white transition hover:bg-[#0F6B31]">
      {children} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  )
}

function StarsText({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-4 w-4 ${i <= value ? 'fill-[#F5B301] text-[#F5B301]' : 'text-[#D1D5DB]'}`} aria-hidden="true" />)}
    </span>
  )
}

function SubjectCard({ subject }: { subject: NotificationSubject }) {
  switch (subject.kind) {
    case 'order':
      return (
        <section aria-label="Order" className={card}>
          <h2 className="text-base font-bold text-[#17201B]">Order #{subject.order_number}</h2>
          <dl className="mt-3 divide-y divide-[#F0F3F1]">
            <Row label="Status">{statusLabel(subject.status)}</Row>
            {subject.customer_name && <Row label="Customer">{subject.customer_name}</Row>}
            {subject.payment_method && <Row label="Payment">{subject.payment_method.toUpperCase()} · {statusLabel(subject.payment_status ?? '')}</Row>}
            {subject.created_at && <Row label="Placed">{formatDateTime(subject.created_at)}</Row>}
          </dl>
          {subject.items.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-[#17201B]">Your items</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {subject.items.map((item, i) => (
                  <li key={i} className="flex justify-between gap-3"><span>{item.quantity}× {item.name}</span><span className="tabular-nums">{formatCurrency(item.subtotal)}</span></li>
                ))}
              </ul>
              <p className="mt-2 flex justify-between border-t border-[#EEF2EF] pt-2 text-sm font-bold"><span>Total for your items</span><span className="tabular-nums">{formatCurrency(subject.items_total)}</span></p>
              {subject.shared_with_other_restaurants && <p className="mt-2 text-xs text-[#647067]">This is a group order. Other restaurants' items are not shown.</p>}
            </>
          )}
          <OpenLink to={subject.link}>Open order</OpenLink>
        </section>
      )
    case 'booking':
      return (
        <section aria-label="Booking" className={card}>
          <h2 className="text-base font-bold text-[#17201B]">Booking #{subject.booking_number}</h2>
          <dl className="mt-3 divide-y divide-[#F0F3F1]">
            <Row label="Status">{statusLabel(subject.status)}</Row>
            {subject.customer_name && <Row label="Guest">{subject.customer_name}</Row>}
            {subject.business_name && <Row label="Business">{subject.business_name}</Row>}
            {subject.check_in_date && <Row label="Check-in">{subject.check_in_date}</Row>}
            {subject.check_out_date && <Row label="Check-out">{subject.check_out_date}</Row>}
            <Row label="Total">{formatCurrency(subject.total_amount)}</Row>
          </dl>
          <OpenLink to={subject.link}>Open booking</OpenLink>
        </section>
      )
    case 'conversation':
      return (
        <section aria-label="Conversation" className={card}>
          <h2 className="text-base font-bold text-[#17201B]">{subject.customer_name}</h2>
          <p className="text-xs text-[#647067]">Order #{subject.order_number} · {subject.business_name}</p>
          <ul className="mt-4 space-y-2">
            {subject.recent.map((m) => (
              <li key={m.id} className={`flex ${m.is_mine ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.is_mine ? 'bg-[#0F4D2B] text-white' : 'bg-[#F1F5F2] text-[#17201B]'}`}>{m.message}</p>
              </li>
            ))}
          </ul>
          <OpenLink to={subject.link}>Reply</OpenLink>
        </section>
      )
    case 'review':
      return (
        <section aria-label="Review" className={card}>
          <h2 className="text-base font-bold text-[#17201B]">Review from {subject.customer_name}</h2>
          <p className="text-xs text-[#647067]">{subject.business_name}{subject.order_number ? ` · Order #${subject.order_number}` : ''}</p>
          {subject.restaurant && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-[#17201B]">Restaurant</p>
              <StarsText value={subject.restaurant.rating} />
              {subject.restaurant.comment && <p className="mt-1 text-sm text-[#2F3B33]">{subject.restaurant.comment}</p>}
            </div>
          )}
          {subject.dishes.length > 0 && (
            <ul className="mt-4 space-y-3">
              {subject.dishes.map((d, i) => (
                <li key={i} className="border-t border-[#EEF2EF] pt-3">
                  <p className="text-sm font-semibold text-[#17201B]">{d.name}</p>
                  <StarsText value={d.rating} />
                  {d.comment && <p className="mt-1 text-sm text-[#2F3B33]">{d.comment}</p>}
                  {d.images.length > 0 && (
                    <div className="mt-2 flex gap-2">{d.images.map((src) => <img key={src} src={src} alt={`Photo of ${d.name}`} className="h-16 w-16 rounded-lg object-cover" />)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <OpenLink to={subject.link}>All reviews</OpenLink>
        </section>
      )
    case 'system_notice':
      return (
        <section aria-label="Maintenance notice" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[#17201B]">{subject.title}</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${subject.status === 'cancelled' || subject.status === 'ended' ? 'bg-[#F3F4F6] text-[#4B5563]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>
              {NOTICE_STATUS_LABEL[subject.status]}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-[#2F3B33]">{subject.message}</p>
          <dl className="mt-4 divide-y divide-[#F0F3F1]">
            <Row label="Starts">{formatManila(subject.starts_at)}</Row>
            <Row label="Ends">{formatManila(subject.ends_at)}</Row>
          </dl>
          {subject.status === 'cancelled' && <p className="mt-3 text-sm font-medium text-[#16803C]">This maintenance was cancelled. Nothing will be interrupted.</p>}
        </section>
      )
  }
}

/** Detail page for one notification: the full message and the record it is about. */
export default function BusinessOwnerNotificationDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bo-notification', id],
    queryFn: () => get<{ notification: OwnerNotification; subject: NotificationSubject | null }>(`/business-owner/notifications/${id}`),
  })

  // Opening it marks it read on the server: refresh the counts and the bell.
  useEffect(() => {
    if (data) queryClient.invalidateQueries({ queryKey: ['bo-notifications'] })
  }, [data, queryClient])

  if (isLoading) return <DashboardSkeleton />

  if (isError || !data) {
    return (
      <div className={`${card} mx-auto max-w-2xl text-center`}>
        <p className="text-lg font-bold text-[#17201B]">Notification not found</p>
        <Link to="/business-owner/notifications" className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#16803C] px-5 text-sm font-semibold text-white">Back to notifications</Link>
      </div>
    )
  }

  const { notification: n, subject } = data
  const Icon = CATEGORY_ICON[n.category] ?? Bell
  const tab = NOTIFICATION_TABS.find((t) => t.key === n.category)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={tab ? `/business-owner/notifications?tab=${tab.key}` : '/business-owner/notifications'} className="inline-flex items-center gap-2 text-sm font-semibold text-[#16803C] hover:text-[#0F6B31]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Notifications
      </Link>

      <article className={card}>
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EAF6ED] text-[#16803C]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            {tab && <p className="text-xs font-semibold uppercase tracking-wide text-[#16803C]">{tab.label}</p>}
            <h1 className="mt-0.5 text-xl font-bold text-[#17201B]">{n.title}</h1>
            <p className="mt-1 text-xs text-[#647067]">{formatDateTime(n.created_at)}</p>
          </div>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm text-[#2F3B33]">{n.message}</p>
      </article>

      {subject ? <SubjectCard subject={subject} /> : n.has_detail && (
        <p className="text-sm text-[#647067]">The details of this notification are no longer available.</p>
      )}
    </div>
  )
}
