import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'
import { get } from '@/shared/services/api'
import { Skeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import type { ConversationSummary } from '@/features/business-owner/services/notifications'

/**
 * Messages & Concerns: one conversation per customer order (chat per order),
 * newest activity first. Customers start them from their order details.
 */
export default function OwnerConversationList() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['bo-conversations', page],
    queryFn: () => get<{ data: ConversationSummary[]; meta?: { current_page: number; last_page: number; total: number } }>(`/business-owner/conversations?page=${page}`),
    refetchInterval: 20_000,
    placeholderData: (previous) => previous,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />

  const rooms = data?.data ?? []
  const totalPages = Math.max(1, data?.meta?.last_page ?? 1)

  if (rooms.length === 0) {
    return (
      <div className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-12 text-center shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
        <MessageSquare className="mx-auto mb-4 h-12 w-12 text-[#9CA3AF]" aria-hidden="true" />
        <p className="font-semibold text-[#17201B]">No customer messages yet</p>
        <p className="mt-1 text-sm text-[#647067]">Customers can message you about their order from the order details page.</p>
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-2" aria-label="Customer conversations">
        {rooms.map((room) => (
          <li key={room.id}>
            <Link
              to={`/business-owner/notifications/messages/${room.id}`}
              className={`flex items-start gap-4 rounded-[20px] border bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)] transition hover:border-[#16803C]/50 ${room.unread ? 'border-[#E2E8E3] border-l-4 border-l-[#16803C]' : 'border-[#E2E8E3]'}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EAF6ED] text-sm font-bold text-[#16803C]" aria-hidden="true">
                {room.customer_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-sm ${room.unread ? 'font-bold text-[#17201A]' : 'font-semibold text-[#4B5563]'}`}>{room.customer_name}</span>
                  <span className="text-xs text-[#647067]">Order #{room.order_number} · {room.business_name}</span>
                </span>
                <span className="mt-1 line-clamp-1 block text-sm text-[#647067]">
                  {room.last_message_mine && <span className="font-medium">You: </span>}
                  {room.last_message}
                </span>
                {room.last_message_at && <span className="mt-1.5 block text-xs text-[#647067]">{formatDateTime(room.last_message_at)}</span>}
              </span>
              {room.unread > 0 && (
                <span className="shrink-0 rounded-full bg-[#16803C] px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
                  {room.unread}<span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
          <button type="button" aria-label="Next page" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </>
  )
}
