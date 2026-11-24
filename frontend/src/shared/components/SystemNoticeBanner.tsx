import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wrench, X } from 'lucide-react'
import { get } from '@/shared/services/api'

interface ActiveNotice {
  id: number
  title: string
  message: string
  starts_at: string
  ends_at: string
  status: 'scheduled' | 'in_progress'
}

const DISMISSED_KEY = 'tt-dismissed-notices'

const manila = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function readDismissed(): number[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]')
  } catch {
    return []
  }
}

/**
 * System maintenance banner: notices the admin sent to this user's role, shown
 * until the maintenance window ends. Dismissing hides it for this session only.
 */
export default function SystemNoticeBanner() {
  const [dismissed, setDismissed] = useState<number[]>(readDismissed)
  const { data } = useQuery({
    queryKey: ['system-notices-active'],
    queryFn: () => get<ActiveNotice[]>('/system-notices/active'),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  const notices = (Array.isArray(data) ? data : []).filter((n) => !dismissed.includes(n.id))
  if (notices.length === 0) return null

  const dismiss = (id: number) => {
    const next = [...dismissed, id]
    setDismissed(next)
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  return (
    <div className="space-y-2">
      {notices.map((n) => (
        <div key={n.id} role="status" className="flex items-start gap-3 rounded-xl border border-[#F5D58A] bg-[#FFF8E6] px-4 py-3 text-sm text-[#5C4300]">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-bold">{n.status === 'in_progress' ? 'Maintenance in progress' : 'Scheduled maintenance'}: {n.title}.</span>{' '}
            {manila(n.starts_at)} – {manila(n.ends_at)} (PH time). <span className="text-[#7A5B00]">{n.message}</span>
          </p>
          <button type="button" onClick={() => dismiss(n.id)} aria-label={`Dismiss notice: ${n.title}`} className="rounded p-0.5 hover:bg-[#F5D58A]/50">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
