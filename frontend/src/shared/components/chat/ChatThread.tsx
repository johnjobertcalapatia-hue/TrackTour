import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { formatDateTime } from '@/shared/utils'

export interface ChatMessageRow {
  id: number
  message: string
  is_mine: boolean
  sender_name: string
  created_at: string | null
}

const MAX_LENGTH = 2000

/**
 * One order conversation (chat per order): the messages, oldest first, and a
 * composer. Enter sends, Shift+Enter starts a new line. Shared by the owner's
 * Messages & Concerns and the tourist's Messages.
 */
export default function ChatThread({
  messages,
  onSend,
  sending,
  error,
  emptyText,
  placeholder = 'Write a message…',
}: {
  messages: ChatMessageRow[]
  onSend: (text: string) => Promise<unknown>
  sending: boolean
  error?: string | null
  emptyText: string
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const value = text.trim()
    if (!value || sending) return
    try {
      await onSend(value)
      setText('')
    } catch {
      // The page shows the error; keep the text so nothing is lost.
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex flex-col rounded-[20px] border border-[#E2E8E3] bg-[#fff] shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
      <div className="max-h-[55vh] min-h-[240px] space-y-3 overflow-y-auto p-4 sm:p-5" role="log" aria-label="Messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#647067]">{emptyText}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.is_mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${m.is_mine ? 'bg-[#0F4D2B] text-white' : 'bg-[#F1F5F2] text-[#17201B]'}`}>
                {!m.is_mine && <p className="mb-0.5 text-[11px] font-semibold text-[#16803C]">{m.sender_name}</p>}
                <p className="whitespace-pre-wrap break-words text-sm">{m.message}</p>
                {m.created_at && (
                  <p className={`mt-1 text-[10px] ${m.is_mine ? 'text-white/70' : 'text-[#647067]'}`}>{formatDateTime(m.created_at)}</p>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-[#EEF2EF] p-3 sm:p-4">
        {error && <p role="alert" className="mb-2 text-xs font-medium text-[#B42318]">{error}</p>}
        <div className="flex items-end gap-2">
          <label htmlFor="chat-composer" className="sr-only">Message</label>
          <textarea
            id="chat-composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={MAX_LENGTH}
            placeholder={placeholder}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-[#E2E8E3] px-3 py-2.5 text-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#16803C] px-4 text-sm font-semibold text-white transition hover:bg-[#0F6B31] disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden="true" /> Send
          </button>
        </div>
        {text.length > MAX_LENGTH - 200 && <p className="mt-1 text-right text-[11px] text-[#647067]">{text.length}/{MAX_LENGTH}</p>}
      </form>
    </div>
  )
}
