import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Search, type LucideIcon } from 'lucide-react'
import { Modal } from '@/shared/components/Modal'
import { cn } from '@/shared/utils'
import type { ListMeta, ModerationAction } from '@/features/municipal/types'

export const card = 'bg-white border border-[#E7E2D6] rounded-2xl shadow-tourism'
export const inputClass =
  'w-full bg-white border border-[#E7E2D6] rounded-xl text-sm text-[#1C2B22] placeholder-[#66736B] focus:outline-none focus:ring-2 focus:ring-[#2E8B57]/40 focus:border-[#2E8B57] px-3 py-2.5'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-[#1C2B22]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm lg:text-base text-[#66736B]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'green',
  onClick,
}: {
  label: string
  value: number | string
  hint?: string
  icon: LucideIcon
  tone?: 'green' | 'amber' | 'blue' | 'red'
  onClick?: () => void
}) {
  const tones = {
    green: 'bg-[#E6F2EB] text-[#2E8B57]',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-sky-50 text-sky-600',
    red: 'bg-red-50 text-red-600',
  }
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(card, 'p-5 text-left w-full', onClick && 'transition hover:border-[#2E8B57] hover:shadow-md')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-[#66736B]">{label}</p>
          <p className="mt-1 text-2xl font-bold text-[#1C2B22]">{value}</p>
          {hint && <p className="mt-1 text-xs text-[#66736B]">{hint}</p>}
        </div>
        <span className={cn('w-10 h-10 shrink-0 rounded-xl flex items-center justify-center', tones[tone])}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </span>
      </div>
    </Wrapper>
  )
}

export interface StatusOption {
  value: string
  label: string
  count?: number
}

/** Search box plus status tabs, shared by every municipal list page. */
export function ListFilters({
  search,
  onSearch,
  placeholder,
  status,
  onStatus,
  options,
}: {
  search: string
  onSearch: (value: string) => void
  placeholder: string
  status?: string
  onStatus?: (value: string) => void
  options?: StatusOption[]
}) {
  return (
    <div className={cn(card, 'mb-5 p-4 space-y-3')}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#66736B]" aria-hidden="true" />
        <input
          type="search"
          aria-label={placeholder}
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className={cn(inputClass, 'pl-10')}
        />
      </div>
      {options && onStatus && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={status === opt.value}
              onClick={() => onStatus(opt.value)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                status === opt.value
                  ? 'bg-[#2E8B57] border-[#2E8B57] text-white'
                  : 'bg-white border-[#CFE5D7] text-[#2E8B57] hover:bg-[#F1F7F3]'
              )}
            >
              {opt.label}
              {opt.count !== undefined && <span className="ml-1.5 opacity-80">{opt.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Pagination({ meta, onPage, noun }: { meta?: ListMeta; onPage: (page: number) => void; noun: string }) {
  if (!meta || meta.last_page <= 1) return null
  const from = (meta.current_page - 1) * meta.per_page + 1
  const to = Math.min(meta.current_page * meta.per_page, meta.total)
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <p className="text-sm text-[#66736B]">
        Showing {from}–{to} of {meta.total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => onPage(meta.current_page - 1)}
          disabled={meta.current_page === 1}
          className="p-2 rounded-lg bg-white border border-[#CFE5D7] text-[#2E8B57] hover:bg-[#F1F7F3] disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm text-[#66736B]">
          Page {meta.current_page} of {meta.last_page}
        </span>
        <button
          type="button"
          aria-label="Next page"
          onClick={() => onPage(meta.current_page + 1)}
          disabled={meta.current_page === meta.last_page}
          className="p-2 rounded-lg bg-white border border-[#CFE5D7] text-[#2E8B57] hover:bg-[#F1F7F3] disabled:opacity-40"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className={cn(card, 'p-12 text-center')}>
      <Icon className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" aria-hidden="true" />
      <p className="text-[#66736B]">{message}</p>
    </div>
  )
}

const ACTION_STYLES: Record<ModerationAction, string> = {
  approve: 'bg-[#2E8B57] hover:bg-[#257347] text-white',
  reactivate: 'bg-[#2E8B57] hover:bg-[#257347] text-white',
  reject: 'bg-white border border-red-200 text-red-600 hover:bg-red-50',
  suspend: 'bg-white border border-red-200 text-red-600 hover:bg-red-50',
}

export const ACTION_LABELS: Record<ModerationAction, string> = {
  approve: 'Approve',
  reject: 'Reject',
  suspend: 'Suspend',
  reactivate: 'Reactivate',
}

/** Which moderation actions apply to an account in a given status. */
export function accountActions(status: string): ModerationAction[] {
  switch (status) {
    case 'pending_review':
      return ['approve', 'reject']
    case 'approved':
      return ['suspend']
    case 'suspended':
      return ['reactivate']
    case 'rejected':
      return ['approve']
    default:
      return []
  }
}

export function ActionButton({
  action,
  onClick,
  disabled,
  label,
}: {
  action: ModerationAction
  onClick: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50', ACTION_STYLES[action])}
    >
      {label ?? ACTION_LABELS[action]}
    </button>
  )
}

/**
 * Confirmation dialog for a moderation action. Reject and suspend require a
 * reason; the server enforces the same rule.
 */
export function ModerationDialog({
  open,
  action,
  subject,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean
  action: ModerationAction | null
  subject: string
  pending: boolean
  error?: string
  onCancel: () => void
  onConfirm: (remarks: string) => void
}) {
  const [remarks, setRemarks] = useState('')
  if (!action) return null
  const needsReason = action === 'reject' || action === 'suspend'
  const close = () => {
    setRemarks('')
    onCancel()
  }

  return (
    <Modal show={open} onClose={close} maxWidth="md">
      <form
        className="p-6 bg-white"
        onSubmit={(e) => {
          e.preventDefault()
          if (needsReason && !remarks.trim()) return
          onConfirm(remarks.trim())
        }}
      >
        <h2 className="text-lg font-semibold text-[#1C2B22]">
          {ACTION_LABELS[action]} {subject}?
        </h2>
        <p className="mt-1 text-sm text-[#66736B]">
          {needsReason
            ? 'The reason is saved in the audit log and shown to the account holder.'
            : 'This change is recorded in the audit log.'}
        </p>
        <label className="block mt-4 text-sm font-medium text-[#1C2B22]" htmlFor="moderation-remarks">
          {needsReason ? 'Reason (required)' : 'Remarks (optional)'}
        </label>
        <textarea
          id="moderation-remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          maxLength={1000}
          required={needsReason}
          className={cn(inputClass, 'mt-1')}
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-[#E7E2D6] text-[#1C2B22] hover:bg-[#F1F7F3]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || (needsReason && !remarks.trim())}
            className={cn('px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50', ACTION_STYLES[action])}
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            {ACTION_LABELS[action]}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-[#F1EDE3] last:border-0 text-sm">
      <dt className="text-[#66736B]">{label}</dt>
      <dd className="text-[#1C2B22] text-right font-medium break-all">{value || '—'}</dd>
    </div>
  )
}

const ONLINE_RIDER_STATUSES = ['online', 'available', 'busy']

export function RiderPresence({ status }: { status?: string | null }) {
  const online = !!status && ONLINE_RIDER_STATUSES.includes(status)
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', online ? 'text-[#2E8B57]' : 'text-[#66736B]')}>
      <span className={cn('w-2 h-2 rounded-full', online ? 'bg-[#2E8B57]' : 'bg-[#C4CBC6]')} />
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Offline'}
    </span>
  )
}
