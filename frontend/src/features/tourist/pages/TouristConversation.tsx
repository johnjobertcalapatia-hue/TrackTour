import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { get, post, apiErrorMessage } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import ChatThread, { type ChatMessageRow } from '@/shared/components/chat/ChatThread'
import type { TouristConversationSummary } from '@/features/tourist/pages/TouristMessages'

/** One conversation with a restaurant about an order (chat per order). */
export default function TouristConversation() {
  const { roomId } = useParams<{ roomId: string }>()
  const queryClient = useQueryClient()
  const key = ['tourist-chat', roomId]

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => get<{ conversation: TouristConversationSummary; messages: ChatMessageRow[] }>(`/tourist/chats/${roomId}`),
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (data) queryClient.invalidateQueries({ queryKey: ['tourist-chats'] })
  }, [data?.messages.length, queryClient]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (message: string) => post<ChatMessageRow>(`/tourist/chats/${roomId}/messages`, { message }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  if (isLoading) return <DashboardSkeleton />

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-[#E5E9E7] bg-white p-10 text-center lg:mx-0">
        <p className="text-lg font-bold text-[#17201B]">Conversation not found</p>
        <Link to="/tourist/messages" className="mt-4 inline-flex h-10 items-center rounded-full bg-[#087F3F] px-5 text-sm font-semibold text-white">Messages</Link>
      </div>
    )
  }

  const c = data.conversation

  return (
    <main aria-label="Conversation" className="mx-auto w-full max-w-3xl space-y-4 lg:mx-0">
      <Link to="/tourist/messages" className="inline-flex items-center gap-2 text-sm font-semibold text-[#087F3F] hover:text-[#056B35]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Messages
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-[#17201B]">{c.business_name}</h1>
        <p className="text-sm text-[#56615B]">
          About order <Link to={`/tourist/orders/${c.order_id}/details`} className="font-semibold text-[#087F3F] hover:underline">#{c.order_number}</Link>
        </p>
      </header>
      <ChatThread
        messages={data.messages}
        onSend={(text) => send.mutateAsync(text)}
        sending={send.isPending}
        error={send.isError ? apiErrorMessage(send.error, 'Your message could not be sent. Please try again.') : null}
        emptyText="Ask about your order, report a concern, or make a request. The restaurant will reply here."
        placeholder={`Message ${c.business_name ?? 'the restaurant'}…`}
      />
    </main>
  )
}
