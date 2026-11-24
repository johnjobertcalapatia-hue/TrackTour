import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { get, post, apiErrorMessage } from '@/shared/services/api'

interface OrderRestaurant {
  business_id: number
  business_name: string
  room_id: number | null
  unread: number
}

/**
 * "Message the restaurant" on an order's details (chat per order). A group
 * order lists each restaurant; every one has its own conversation.
 */
export default function OrderMessageRestaurant({ orderId }: { orderId: number }) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['tourist-order-chats', orderId],
    queryFn: () => get<OrderRestaurant[]>(`/tourist/orders/${orderId}/chats`),
    retry: false,
  })

  const open = useMutation({
    mutationFn: (businessId: number) => post<{ room_id: number }>(`/tourist/orders/${orderId}/chats`, { business_id: businessId }),
    onSuccess: (res) => navigate(`/tourist/messages/${res.room_id}`),
  })

  const restaurants = Array.isArray(data) ? data : []
  if (restaurants.length === 0) return null

  return (
    <section aria-labelledby="order-message-title" className="rounded-2xl border border-[#E5E9E7] bg-white p-4 sm:p-5">
      <h2 id="order-message-title" className="text-base font-bold text-[#17201B]">Questions or concerns?</h2>
      <p className="mt-0.5 text-sm text-[#56615B]">Message the restaurant about this order. They reply in Messages.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {restaurants.map((r) => (
          <button
            key={r.business_id}
            type="button"
            onClick={() => open.mutate(r.business_id)}
            disabled={open.isPending}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#087F3F] px-4 text-sm font-semibold text-[#087F3F] transition hover:bg-[#E9F7EF] disabled:opacity-60"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {restaurants.length > 1 ? `Message ${r.business_name}` : 'Message the restaurant'}
            {r.unread > 0 && <span className="rounded-full bg-[#087F3F] px-1.5 text-[11px] text-white">{r.unread}<span className="sr-only"> unread</span></span>}
          </button>
        ))}
      </div>
      {open.isError && <p role="alert" className="mt-2 text-sm text-[#B42318]">{apiErrorMessage(open.error, 'Could not open the conversation. Please try again.')}</p>}
    </section>
  )
}
