import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { MessageSquare } from 'lucide-react'

interface RiderMessage {
  id: number
  sender_name?: string
  sender_role?: string
  message: string
  created_at: string
  is_read?: boolean
}

export default function RiderMessages() {
  const { data, isLoading } = useQuery({
    queryKey: ['rider-messages'],
    queryFn: () => get<RiderMessage[]>('/rider/messages'),
  })

  if (isLoading) return <DashboardSkeleton />

  const messages = data ?? []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Messages</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Messages related to your rider account and deliveries</p>
      </div>

      {messages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
          <MessageSquare className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#6B7280]">No messages yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden">
          <div className="max-h-[600px] overflow-y-auto p-4 space-y-3">
            {messages.map((message) => (
              <div key={message.id} className="rounded-2xl bg-[#F3F8F5] px-4 py-3">
                <p className="text-sm text-[#17201B]">{message.message}</p>
                {(message.sender_name || message.created_at) && (
                  <p className="mt-1 text-xs text-[#9CA3AF]">
                    {message.sender_name ?? message.sender_role ?? 'TrackTour'} &bull; {message.created_at}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
