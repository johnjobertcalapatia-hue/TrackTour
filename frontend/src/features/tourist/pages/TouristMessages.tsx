import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { MessageSquare, Send } from 'lucide-react'

interface Message {
  id: number
  sender_name: string
  sender_role: string
  message: string
  created_at: string
  is_read: boolean
}

export default function TouristMessages() {
  const queryClient = useQueryClient()
  const [newMessage, setNewMessage] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-messages'],
    queryFn: () => get<{ data: Message[] }>('/tourist/messages'),
  })

  const sendMutation = useMutation({
    mutationFn: (message: string) => post('/tourist/messages', { message }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist-messages'] })
      setNewMessage('')
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const messages = data?.data ?? []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Messages</h1>
        <p className="mt-1 text-sm text-gray-400">Your conversations with businesses</p>
      </div>

      {messages.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No messages yet. Start a conversation with a business.</p>
        </div>
      ) : (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender_role === 'tourist' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                  m.sender_role === 'tourist'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-800 text-gray-100'
                }`}>
                  <p className="text-sm">{m.message}</p>
                  <p className={`text-xs mt-1 ${m.sender_role === 'tourist' ? 'text-emerald-200' : 'text-gray-500'}`}>
                    {m.sender_name} &bull; {formatDateTime(m.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-800/50 p-4 flex items-center gap-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newMessage.trim()) {
                  sendMutation.mutate(newMessage.trim())
                }
              }}
              placeholder="Type a message..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-emerald-500/40 focus:outline-none transition"
            />
            <button
              onClick={() => {
                if (newMessage.trim()) sendMutation.mutate(newMessage.trim())
              }}
              disabled={sendMutation.isPending || !newMessage.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white p-2.5 rounded-xl transition disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
