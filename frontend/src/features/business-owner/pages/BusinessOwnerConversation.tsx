import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { get, post, apiErrorMessage } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import ChatThread, { type ChatMessageRow } from '@/shared/components/chat/ChatThread'
import { statusLabel, type ConversationSummary } from '@/features/business-owner/services/notifications'

/** Messages & Concerns → one customer conversation about an order. */
export default function BusinessOwnerConversation() {
  const { roomId } = useParams<{ roomId: string }>()
  const queryClient = useQueryClient()
  const key = ['bo-conversation', roomId]

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => get<{ conversation: ConversationSummary; messages: ChatMessageRow[] }>(`/business-owner/conversations/${roomId}`),
    refetchInterval: 10_000,
  })

  // Viewing marks it read: refresh the list, the tab counts and the bell.
  useEffect(() => {
    if (data) {
      queryClient.invalidateQueries({ queryKey: ['bo-conversations'] })
      queryClient.invalidateQueries({ queryKey: ['bo-notifications'] })
    }
  }, [data?.messages.length, queryClient]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (message: string) => post<ChatMessageRow>(`/business-owner/conversations/${roomId}/messages`, { message }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  if (isLoading) return <DashboardSkeleton />

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-2xl rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-10 text-center">
        <p className="text-lg font-bold text-[#17201B]">Conversation not found</p>
        <Link to="/business-owner/notifications?tab=messages" className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#16803C] px-5 text-sm font-semibold text-white">Back to messages</Link>
      </div>
    )
  }

  const c = data.conversation

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/business-owner/notifications?tab=messages" className="inline-flex items-center gap-2 text-sm font-semibold text-[#16803C] hover:text-[#0F6B31]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Messages & Concerns
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17201B]">{c.customer_name}</h1>
          <p className="text-sm text-[#5E6B63]">
            Order #{c.order_number} · {c.business_name}{c.order_status ? ` · ${statusLabel(c.order_status)}` : ''}
          </p>
        </div>
        {c.order_id && (
          <Link to={`/business-owner/orders/${c.order_id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#16803C] hover:underline">
            Open order <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </header>

      <ChatThread
        messages={data.messages}
        onSend={(text) => send.mutateAsync(text)}
        sending={send.isPending}
        error={send.isError ? apiErrorMessage(send.error, 'Your reply could not be sent. Please try again.') : null}
        emptyText="No messages yet."
        placeholder={`Reply to ${c.customer_name}…`}
      />
    </div>
  )
}
