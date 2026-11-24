import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'

export interface TouristConversationSummary {
  id: number
  order_id: number | null
  order_number: string | null
  business_name: string | null
  last_message: string | null
  last_message_at: string | null
  last_message_mine: boolean
  unread: number
}

/**
 * Messages: your conversations with restaurants about your orders (chat per
 * order). Start one from an order's details page.
 */
export default function TouristMessages() {
  const { data, isLoading } = useQuery({
    queryKey: ['tourist-chats'],
    queryFn: () => get<TouristConversationSummary[]>('/tourist/chats'),
    refetchInterval: 20_000,
  })

  if (isLoading) return <DashboardSkeleton />

  const rooms = (Array.isArray(data) ? data : []).filter((r) => r.last_message)

  return (
    <div className="mx-auto max-w-3xl lg:mx-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-[#68736D]">Your conversations with restaurants about your orders</p>
      </div>

      {rooms.length === 0 ? (
        <div className="rounded-2xl border border-[#E5E9E7] bg-white p-12 text-center">
          <MessageSquare className="mx-auto mb-4 h-12 w-12 text-[#9CA3AF]" aria-hidden="true" />
          <p className="font-semibold text-[#17201B]">No messages yet</p>
          <p className="mt-1 text-sm text-[#68736D]">Have a concern about an order? Open it in My Orders and tap “Message the restaurant”.</p>
          <Link to="/tourist/activities?view=orders" className="mt-4 inline-flex h-10 items-center rounded-full bg-[#087F3F] px-5 text-sm font-semibold text-white">My orders</Link>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Conversations">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                to={`/tourist/messages/${room.id}`}
                className={`flex items-start gap-3 rounded-2xl border bg-white p-4 transition hover:border-[#087F3F]/50 ${room.unread ? 'border-[#E5E9E7] border-l-4 border-l-[#087F3F]' : 'border-[#E5E9E7]'}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF] text-sm font-bold text-[#087F3F]" aria-hidden="true">
                  {(room.business_name ?? 'R').charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`text-sm ${room.unread ? 'font-bold text-[#17201B]' : 'font-semibold text-[#3F4A44]'}`}>{room.business_name}</span>
                    <span className="text-xs text-[#68736D]">Order #{room.order_number}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-sm text-[#68736D]">
                    {room.last_message_mine && <span className="font-medium">You: </span>}{room.last_message}
                  </span>
                  {room.last_message_at && <span className="mt-1 block text-xs text-[#68736D]">{formatDateTime(room.last_message_at)}</span>}
                </span>
                {room.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-[#087F3F] px-2 py-0.5 text-[11px] font-bold text-white">{room.unread}<span className="sr-only"> unread</span></span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
