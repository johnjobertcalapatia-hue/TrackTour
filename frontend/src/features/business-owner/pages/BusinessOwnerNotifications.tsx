import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, ChevronLeft, ChevronRight, ChevronRight as Open } from 'lucide-react'
import { get, patch } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import OwnerConversationList from '@/features/business-owner/components/notifications/OwnerConversationList'
import OwnerReviewsPanel from '@/features/business-owner/components/notifications/OwnerReviewsPanel'
import {
  CATEGORY_ICON, NOTIFICATION_TABS, type NotificationList, type NotificationTab,
} from '@/features/business-owner/services/notifications'

const PER_PAGE = 10
const TAB_KEYS = NOTIFICATION_TABS.map((t) => t.key)

/**
 * Notifications module: tabs for All, Orders & Bookings, Messages & Concerns
 * (chat per order), Reviews & Ratings and System (maintenance notices). Each
 * notification card opens its own detail page.
 */
export default function BusinessOwnerNotifications() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as NotificationTab | null
  const tab: NotificationTab = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'all'
  const [page, setPage] = useState(1)
  const listTab = tab === 'all' || tab === 'orders' || tab === 'system'

  // Unread counts for every tab (one small request; same key prefix as the bell).
  const { data: countsData } = useQuery({
    queryKey: ['bo-notifications', 'counts'],
    queryFn: () => get<NotificationList>('/business-owner/notifications?perPage=1'),
  })
  const counts = countsData?.meta?.unread_counts

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bo-notifications', 'list', tab, page],
    queryFn: () => get<NotificationList>(`/business-owner/notifications?category=${tab}&page=${page}&perPage=${PER_PAGE}`),
    enabled: listTab,
    placeholderData: (previous) => previous,
  })

  const markAll = useMutation({
    mutationFn: () => patch('/business-owner/notifications/read-all', { category: tab }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-notifications'] }),
  })

  const selectTab = (key: NotificationTab) => {
    setPage(1)
    setParams(key === 'all' ? {} : { tab: key })
  }

  const unreadHere = counts?.[tab] ?? 0
  const notifications = data?.data ?? []
  const totalPages = Math.max(1, data?.meta?.last_page ?? 1)
  const total = data?.meta?.total ?? notifications.length

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><Bell className="h-6 w-6" aria-hidden="true" /></span>
          <div>
            <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">Notifications</h1>
            <p className="mt-1 text-sm text-[#5E6B63]">
              {counts?.all ? `${counts.all} unread` : 'All caught up'} · orders, customer messages, reviews and system notices
            </p>
          </div>
        </div>
        {unreadHere > 0 && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-[#D7E8DB] bg-white px-4 py-2.5 text-sm font-medium text-[#16803C] transition hover:bg-[#F3F8F4]"
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark {tab === 'all' ? 'all' : 'these'} as read
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Notification types" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {NOTIFICATION_TABS.map((t) => {
          const active = t.key === tab
          const n = counts?.[t.key] ?? 0
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                active ? 'bg-[#0F4D2B] text-white' : 'border border-[#D7E8DB] bg-white text-[#2F4A3A] hover:bg-[#F3F8F4]'
              }`}
            >
              {t.label}
              {n > 0 && (
                <span aria-label={`${n} unread`} className={`min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums ${active ? 'bg-[#FACC15] text-[#17201B]' : 'bg-[#EAF6ED] text-[#16803C]'}`}>
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'messages' && <OwnerConversationList />}
      {tab === 'reviews' && <OwnerReviewsPanel />}

      {listTab && (isLoading ? <DashboardSkeleton /> : notifications.length === 0 ? (
        <div className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-12 text-center shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
          <Bell className="mx-auto mb-4 h-12 w-12 text-[#9CA3AF]" aria-hidden="true" />
          <p className="text-[#647067]">{tab === 'system' ? 'No system notices yet.' : tab === 'orders' ? 'No order or booking notifications yet.' : 'No notifications yet.'}</p>
        </div>
      ) : (
        <>
          <ul className={`space-y-2 transition-opacity ${isFetching ? 'opacity-60' : ''}`} aria-busy={isFetching}>
            {notifications.map((n) => {
              const Icon = CATEGORY_ICON[n.category] ?? Bell
              const unread = !n.read_at
              return (
                <li key={n.id}>
                  <Link
                    to={`/business-owner/notifications/${n.id}`}
                    className={`flex items-start gap-4 rounded-[20px] border bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)] transition hover:border-[#16803C]/50 ${
                      unread ? 'border-[#E2E8E3] border-l-4 border-l-[#16803C]' : 'border-[#E2E8E3]'
                    }`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${unread ? 'bg-[#EAF6ED] text-[#16803C]' : 'bg-[#F3F4F6] text-[#647067]'}`}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${unread ? 'font-bold text-[#17201A]' : 'font-semibold text-[#4B5563]'}`}>
                        {n.title}{unread && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm text-[#647067]">{n.message}</span>
                      <span className="mt-2 block text-xs text-[#647067]">{formatDateTime(n.created_at)}</span>
                    </span>
                    {unread && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#16803C]" aria-hidden="true" />}
                    <Open className="mt-1 h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-[#647067]">
              Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
                <button type="button" aria-label="Next page" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </>
      ))}
    </div>
  )
}
