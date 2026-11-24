import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Wrench } from 'lucide-react'
import { get, post, apiErrorMessage } from '@/shared/services/api'
import { Skeleton } from '@/shared/components/Skeleton'
import {
  NOTICE_STATUS_LABEL, formatManila, type SystemNoticeSummary,
} from '@/features/business-owner/services/notifications'

const AUDIENCES = [
  { key: 'business_owners', label: 'Business owners (and their staff)' },
  { key: 'riders', label: 'Riders' },
  { key: 'tourists', label: 'Tourists' },
  { key: 'everyone', label: 'Everyone' },
]

const input = 'w-full rounded-xl border border-[#E2E8E3] bg-white px-3 py-2.5 text-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'

/**
 * System maintenance notices: the admin (Bansud Tourism Office) tells an
 * audience about planned downtime. Each recipient gets a notification under
 * System, and their portal shows a banner until the window ends.
 * Times are entered in Philippine time.
 */
export default function AdminSystemNotices() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ title: '', message: '', audience: 'business_owners', starts_at: '', ends_at: '' })
  const [confirming, setConfirming] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-system-notices'],
    queryFn: () => get<{ data: SystemNoticeSummary[] }>('/admin/system-notices'),
  })

  const create = useMutation({
    mutationFn: () => post<SystemNoticeSummary>('/admin/system-notices', form),
    onSuccess: (notice) => {
      setSent(`Notice sent to ${notice.recipients_count} user${notice.recipients_count === 1 ? '' : 's'}.`)
      setForm({ title: '', message: '', audience: form.audience, starts_at: '', ends_at: '' })
      setConfirming(false)
      queryClient.invalidateQueries({ queryKey: ['admin-system-notices'] })
    },
    onError: () => setConfirming(false),
  })

  const cancel = useMutation({
    mutationFn: (id: number) => post(`/admin/system-notices/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-system-notices'] }),
  })

  const timeError = form.starts_at && form.ends_at && form.ends_at <= form.starts_at ? 'The end must be after the start.' : null
  const ready = form.title.trim() && form.message.trim() && form.starts_at && form.ends_at && !timeError
  const audienceLabel = AUDIENCES.find((a) => a.key === form.audience)?.label.toLowerCase()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSent(null)
    if (ready) setConfirming(true)
  }

  const notices = data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><Wrench className="h-6 w-6" aria-hidden="true" /></span>
        <div>
          <h1 className="text-2xl font-bold text-[#17201B]">System Notices</h1>
          <p className="text-sm text-[#5E6B63]">Tell users about planned maintenance. They get a notification and a banner until it ends.</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)] sm:p-6" aria-label="New maintenance notice">
        <h2 className="text-base font-bold text-[#17201B]">New maintenance notice</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="notice-title" className="mb-1 block text-sm font-medium text-[#2F3B33]">Title</label>
            <input id="notice-title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Database upgrade" className={input} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="notice-message" className="mb-1 block text-sm font-medium text-[#2F3B33]">Message</label>
            <textarea id="notice-message" rows={3} maxLength={2000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What will be unavailable, and what users should do." className={input} />
          </div>
          <div>
            <label htmlFor="notice-audience" className="mb-1 block text-sm font-medium text-[#2F3B33]">Send to</label>
            <select id="notice-audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className={input}>
              {AUDIENCES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div className="hidden sm:block" />
          <div>
            <label htmlFor="notice-start" className="mb-1 block text-sm font-medium text-[#2F3B33]">Starts (PH time)</label>
            <input id="notice-start" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={input} />
          </div>
          <div>
            <label htmlFor="notice-end" className="mb-1 block text-sm font-medium text-[#2F3B33]">Ends (PH time)</label>
            <input id="notice-end" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} aria-invalid={Boolean(timeError)} aria-describedby={timeError ? 'notice-time-error' : undefined} className={input} />
          </div>
        </div>
        {timeError && <p id="notice-time-error" role="alert" className="text-sm text-[#B42318]">{timeError}</p>}
        {create.isError && <p role="alert" className="text-sm text-[#B42318]">{apiErrorMessage(create.error, 'The notice could not be sent.')}</p>}
        {sent && <p role="status" className="text-sm font-medium text-[#16803C]">{sent}</p>}

        {confirming ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#FFF8E6] p-3 text-sm text-[#5C4300]">
            <span className="flex-1">Send this notice to all {audienceLabel}? Everyone in that group is notified right away.</span>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-[#E2E8E3] bg-white px-3 py-2 font-medium text-[#2F3B33]">Back</button>
            <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="rounded-lg bg-[#16803C] px-3 py-2 font-semibold text-white disabled:opacity-60">
              {create.isPending ? 'Sending…' : 'Yes, send'}
            </button>
          </div>
        ) : (
          <button type="submit" disabled={!ready} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#16803C] px-4 text-sm font-semibold text-white transition hover:bg-[#0F6B31] disabled:opacity-50">
            <Send className="h-4 w-4" aria-hidden="true" /> Send notice
          </button>
        )}
      </form>

      <section aria-label="Sent notices" className="space-y-3">
        <h2 className="text-base font-bold text-[#17201B]">Sent notices</h2>
        {isLoading ? <Skeleton className="h-32 w-full" /> : notices.length === 0 ? (
          <p className="text-sm text-[#647067]">No notices sent yet.</p>
        ) : (
          <ul className="space-y-3">
            {notices.map((n) => {
              const live = n.status === 'scheduled' || n.status === 'in_progress'
              return (
                <li key={n.id} className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-[#17201B]">{n.title}</p>
                      <p className="text-xs text-[#647067]">{n.audience_label} · {n.recipients_count} recipients</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${live ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#F3F4F6] text-[#4B5563]'}`}>{NOTICE_STATUS_LABEL[n.status]}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[#2F3B33]">{n.message}</p>
                  <p className="mt-2 text-xs text-[#647067]">{formatManila(n.starts_at)} – {formatManila(n.ends_at)} (PH time)</p>
                  {live && (
                    <button
                      type="button"
                      onClick={() => { if (window.confirm(`Cancel "${n.title}"? The banner disappears for everyone.`)) cancel.mutate(n.id) }}
                      disabled={cancel.isPending}
                      className="mt-3 text-sm font-semibold text-[#B42318] hover:underline"
                    >
                      Cancel notice
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
