import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Banknote, Bug, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Cog, FileWarning, History, KeyRound, Loader2, RotateCcw, Search,
  ShieldX, Stethoscope, Truck, Undo2, X, type LucideIcon,
} from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { Modal } from '@/shared/components/Modal'
import { cn } from '@/shared/utils'

const API = '/admin/system/incidents'
const TZ = 'Asia/Manila'

type Status = 'open' | 'recorded' | 'resolved' | 'dismissed'
type Severity = 'info' | 'warning' | 'error' | 'critical'

export interface Incident {
  id: number
  category: string
  code: string
  severity: Severity
  status: Status
  title: string
  message: string | null
  context: Record<string, unknown> | null
  user: { id: number; name: string; role: string } | null
  ip_address: string | null
  method: string | null
  path: string | null
  subject: { type: string; id: number } | null
  occurred_at: string
  resolved_at: string | null
  resolved_by: string | null
  resolution: string | null
}

interface IncidentDetail extends Incident {
  similar: {
    total: number
    open: number
    first_at: string | null
    last_at: string | null
    recent: { id: number; title: string; status: Status; occurred_at: string; resolved_at: string | null; resolved_by: string | null; resolution: string | null }[]
  }
  /** Every fix / dismiss / reopen on this incident, oldest first. */
  history: { action: 'resolved' | 'dismissed' | 'reopened'; description: string | null; by: string | null; at: string | null }[]
}

interface ListMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
  by_category: Record<string, number>
  stats: { open: number; today: number; failed_logins_today: number; resolved_this_week: number }
}

export const CATEGORIES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'auth', label: 'Logins', icon: KeyRound },
  { key: 'access', label: 'Access denied', icon: ShieldX },
  { key: 'upload', label: 'Uploads', icon: FileWarning },
  { key: 'payment', label: 'Payments', icon: Banknote },
  { key: 'refund', label: 'Refunds', icon: Undo2 },
  { key: 'dispatch', label: 'Deliveries', icon: Truck },
  { key: 'jobs', label: 'Background tasks', icon: Cog },
  { key: 'server', label: 'Server errors', icon: Bug },
  { key: 'diagnostics', label: 'Diagnostics', icon: Stethoscope },
]
const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))

const STATUS: Record<Status, { label: string; tone: string }> = {
  open: { label: 'Needs fixing', tone: 'bg-red-50 text-red-700 ring-red-200' },
  recorded: { label: 'History only', tone: 'bg-[#F1EDE3] text-[#5B5446] ring-[#E7E2D6]' },
  resolved: { label: 'Fixed', tone: 'bg-[#E6F2EB] text-[#1E6B40] ring-[#CFE5D7]' },
  dismissed: { label: 'Dismissed', tone: 'bg-white text-[#66736B] ring-[#E7E2D6]' },
}
const STATUS_FILTERS: { key: '' | Status; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Needs fixing' },
  { key: 'recorded', label: 'History only' },
  { key: 'resolved', label: 'Fixed' },
  { key: 'dismissed', label: 'Dismissed' },
]
const SEVERITY: Record<Severity, { label: string; dot: string }> = {
  info: { label: 'Low', dot: 'bg-[#9A9282]' },
  warning: { label: 'Medium', dot: 'bg-[#D99A00]' },
  error: { label: 'High', dot: 'bg-red-500' },
  critical: { label: 'Critical', dot: 'bg-red-800' },
}

/** What the office should do about each kind of incident (plain words). */
export function responsibleAction(code: string): string {
  if (code.startsWith('diagnostics_')) return 'Open System Diagnostics and use the suggested fix. This closes automatically once the check passes again.'
  return ({
    login_failed: 'No action needed unless it keeps happening for one account — then contact the account owner.',
    login_blocked: 'The account is temporarily locked. If the owner did not try to sign in, reset their password.',
    login_rate_limited: 'Many attempts came from one device. If it repeats, someone may be guessing passwords — review the account.',
    account_locked: 'Contact the account owner. If they did not try to sign in, reset their password and check the account.',
    access_denied: 'Usually a wrong link. If it keeps happening for one account, check that account’s role.',
    upload_rejected: 'Ask the person to upload a supported file (JPG or PNG photo, PDF document) within the size limit.',
    upload_failed: 'Ask your technical person to check file storage (System Diagnostics → File storage).',
    payment_failed: 'No action unless many payments fail — then check that GCash / PayMongo is working.',
    refund_failed: 'Try the refund again from the order, or contact the customer about their refund.',
    dispatch_no_rider: 'Contact the customer and the restaurant: find a rider, or cancel and refund the order.',
    dispatch_invalid_pickup: 'Correct the restaurant’s map location, then send the order to riders again.',
    job_failed: 'Retry it from System Diagnostics → Background tasks. If it fails again, tell your technical person.',
    server_error: 'Share the technical details with your technical person. Mark as fixed once they confirm.',
  } as Record<string, string>)[code] ?? 'Review what happened and mark it as fixed or dismissed.'
}

const dateKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const fmt = (iso: string | null, withYear = false) =>
  iso ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(iso)) : '—'

/**
 * Incident History (Settings → Incident History): every failure the system
 * recorded — failed logins, rejected uploads, failed payments and refunds,
 * dispatch failures, server errors, failed tasks and diagnostics problems —
 * with filters, and the record of how each one was fixed.
 */
export default function AdminIncidentHistory() {
  const [params, setParams] = useSearchParams()
  const [openId, setOpenId] = useState<number | null>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')

  const filters = {
    category: params.get('category') ?? '',
    status: params.get('status') ?? '',
    severity: params.get('severity') ?? '',
    q: params.get('q') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Number(params.get('page') ?? 1),
  }
  const categories = filters.category ? filters.category.split(',') : []
  const today = dateKey(new Date())
  const daysAgo = (n: number) => dateKey(new Date(Date.now() - n * 86_400_000))
  const datePreset = !filters.from && !filters.to ? 'all'
    : filters.to === today && filters.from === today ? 'today'
      : filters.to === today && filters.from === daysAgo(6) ? '7'
        : filters.to === today && filters.from === daysAgo(29) ? '30' : 'custom'
  const [customOpen, setCustomOpen] = useState(datePreset === 'custom')
  const active = Boolean(filters.category || filters.status || filters.severity || filters.q || filters.from || filters.to)

  const update = (patch: Partial<Record<keyof typeof filters, string | number>>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries({ ...patch, page: patch.page ?? 1 })) {
      if (v === '' || v === undefined || (k === 'page' && Number(v) === 1)) next.delete(k)
      else next.set(k, String(v))
    }
    setParams(next, { replace: true })
  }

  const query: Record<string, string | number> = { page: filters.page }
  for (const k of ['category', 'status', 'severity', 'q', 'from', 'to'] as const) if (filters[k]) query[k] = filters[k]

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['admin-incidents', query],
    queryFn: () => get<{ data: Incident[]; meta: ListMeta }>(API, { params: query }),
    placeholderData: keepPreviousData,
  })

  const toggleCategory = (key: string) =>
    update({ category: (categories.includes(key) ? categories.filter((c) => c !== key) : [...categories, key]).join(',') })

  const preset = (days: number) => {
    const to = new Date()
    const from = new Date(Date.now() - (days - 1) * 86_400_000)
    update({ from: dateKey(from), to: dateKey(to) })
  }

  const meta = data?.meta
  const rows = data?.data ?? []
  const total = meta?.total ?? 0
  const allCount = meta ? Object.values(meta.by_category).reduce((a, b) => a + b, 0) : 0

  return (
    <div className="space-y-5">
      {/* Summary */}
      <section aria-label="Incident summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Needs fixing" value={meta?.stats.open} icon={AlertTriangle} tone="red" onClick={() => update({ status: 'open' })} />
        <SummaryCard label="Recorded today" value={meta?.stats.today} icon={CalendarDays} onClick={() => preset(1)} />
        <SummaryCard label="Failed logins today" value={meta?.stats.failed_logins_today} icon={KeyRound} onClick={() => { update({ category: 'auth', from: dateKey(new Date()), to: dateKey(new Date()) }) }} />
        <SummaryCard label="Fixed this week" value={meta?.stats.resolved_this_week} icon={CheckCircle2} tone="green" onClick={() => update({ status: 'resolved' })} />
      </section>

      {/* Filters */}
      <section aria-label="Filters" className="space-y-3 rounded-2xl border border-[#E7E2D6] bg-white p-4">
        <form
          className="relative"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            update({ q: search.trim() })
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA39D]" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search incidents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, person, email, IP address or page…"
            className="w-full rounded-xl border border-[#E7E2D6] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#2E8B57] focus:ring-2 focus:ring-[#2E8B57]/20"
          />
        </form>

        <FilterRow label="Date">
          {([['all', 'All time'], ['today', 'Today'], ['7', '7 days'], ['30', '30 days']] as const).map(([key, label]) => (
            <Chip
              key={key}
              on={datePreset === key && !customOpen}
              onClick={() => {
                setCustomOpen(false)
                if (key === 'all') update({ from: '', to: '' })
                else update({ from: key === 'today' ? today : daysAgo(key === '7' ? 6 : 29), to: today })
              }}
            >
              {label}
            </Chip>
          ))}
          <Chip on={customOpen || datePreset === 'custom'} onClick={() => setCustomOpen(true)}>Custom range</Chip>
          {(customOpen || datePreset === 'custom') && (
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="From date" value={filters.from} max={filters.to || today} onChange={(e) => update({ from: e.target.value })} className="rounded-lg border border-[#E7E2D6] px-2 py-1 text-sm" />
              <span className="text-[#66736B]">to</span>
              <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} max={today} onChange={(e) => update({ to: e.target.value })} className="rounded-lg border border-[#E7E2D6] px-2 py-1 text-sm" />
            </span>
          )}
        </FilterRow>

        <FilterRow label="Type">
          <Chip on={categories.length === 0} onClick={() => update({ category: '' })}>
            All types {meta && <span className="ml-1 opacity-80">{allCount}</span>}
          </Chip>
          {CATEGORIES.map((c) => {
            const on = categories.includes(c.key)
            const Icon = c.icon
            return (
              <Chip key={c.key} on={on} onClick={() => toggleCategory(c.key)}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {c.label}
                <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', on ? 'bg-white/20' : 'bg-[#F1EDE3]')}>{meta?.by_category[c.key] ?? 0}</span>
              </Chip>
            )
          })}
        </FilterRow>

        <FilterRow label="Status">
          {STATUS_FILTERS.map((st) => (
            <Chip key={st.key || 'all'} on={filters.status === st.key} onClick={() => update({ status: st.key })}>{st.label}</Chip>
          ))}
        </FilterRow>

        <FilterRow label="Severity">
          <Chip on={!filters.severity} onClick={() => update({ severity: '' })}>Any</Chip>
          {(Object.keys(SEVERITY) as Severity[]).map((sv) => (
            <Chip key={sv} on={filters.severity === sv} onClick={() => update({ severity: sv })}>
              <span className={cn('h-2 w-2 rounded-full', SEVERITY[sv].dot)} aria-hidden="true" /> {SEVERITY[sv].label}
            </Chip>
          ))}
        </FilterRow>

        {active && (
          <div className="flex justify-end">
            <button type="button" onClick={() => { setSearch(''); setCustomOpen(false); setParams(new URLSearchParams(), { replace: true }) }} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2E8B57] hover:underline">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear filters
            </button>
          </div>
        )}
      </section>

      {/* List */}
      <section aria-label="Incidents" className="overflow-hidden rounded-2xl border border-[#E7E2D6] bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-[#F1EDE3] px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#1C2B22]">
            <History className="h-4 w-4 text-[#2E8B57]" aria-hidden="true" /> {total.toLocaleString()} {total === 1 ? 'record' : 'records'}{active ? ' match the filters' : ''}
          </h2>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-[#66736B]" aria-label="Loading" />}
        </header>
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-[#66736B]"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</p>
        ) : error ? (
          <p className="py-16 text-center text-sm text-red-600">{apiErrorMessage(error, 'Could not load the incident history.')}</p>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-[#2E8B57]" aria-hidden="true" />
            {active ? (
              <p className="mt-2 text-sm text-[#66736B]">Nothing matches these filters.</p>
            ) : (
              <>
                <p className="mt-2 text-sm font-semibold text-[#1C2B22]">No incidents recorded yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-[#66736B]">
                  Failed logins, rejected uploads, failed payments and refunds, delivery problems, server errors and diagnostics findings will appear here automatically as they happen.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[#F1EDE3]">
            {rows.map((i) => {
              const cat = CATEGORY[i.category]
              const Icon = cat?.icon ?? Bug
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => setOpenId(i.id)} aria-label={`${i.title}, ${STATUS[i.status].label}`} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-[#FAF7F0]">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1EDE3] text-[#3F4B43]"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#1C2B22]">{i.title}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold ring-1', STATUS[i.status].tone)}>{STATUS[i.status].label}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#66736B]">
                        <span>{fmt(i.occurred_at)}</span>
                        <span>{cat?.label ?? i.category}</span>
                        <span className="inline-flex items-center gap-1"><span className={cn('h-2 w-2 rounded-full', SEVERITY[i.severity].dot)} aria-hidden="true" />{SEVERITY[i.severity].label}</span>
                        <span>{i.user ? `${i.user.name} (${i.user.role.replace(/_/g, ' ')})` : 'No account'}</span>
                        {i.ip_address && <span>IP {i.ip_address}</span>}
                      </span>
                    </span>
                    <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-[#9AA39D]" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {meta && meta.last_page > 1 && (
          <footer className="flex items-center justify-between gap-3 border-t border-[#F1EDE3] px-5 py-3 text-sm">
            <span className="text-[#66736B]">
              Showing {(meta.current_page - 1) * meta.per_page + 1}–{Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total.toLocaleString()}
            </span>
            <span className="flex gap-2">
              <button type="button" disabled={meta.current_page <= 1} onClick={() => update({ page: meta.current_page - 1 })} className="inline-flex items-center gap-1 rounded-lg border border-[#E7E2D6] px-3 py-1.5 font-medium disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Newer</button>
              <button type="button" disabled={meta.current_page >= meta.last_page} onClick={() => update({ page: meta.current_page + 1 })} className="inline-flex items-center gap-1 rounded-lg border border-[#E7E2D6] px-3 py-1.5 font-medium disabled:opacity-40">Older <ChevronRight className="h-4 w-4" /></button>
            </span>
          </footer>
        )}
      </section>

      {openId !== null && <IncidentDialog id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />}
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-[#F1EDE3] pt-3 sm:flex-row sm:items-start">
      <span className="w-20 shrink-0 pt-1.5 text-xs font-semibold uppercase tracking-wider text-[#66736B]">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2" role="group" aria-label={label}>{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1', on ? 'bg-[#2E8B57] text-white ring-[#2E8B57]' : 'bg-white text-[#3F4B43] ring-[#E7E2D6] hover:bg-[#FAF7F0]')}
    >
      {children}
    </button>
  )
}

function SummaryCard({ label, value, icon: Icon, tone, onClick }: { label: string; value?: number; icon: LucideIcon; tone?: 'red' | 'green'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-2xl border border-[#E7E2D6] bg-white p-4 text-left transition hover:border-[#CFE5D7] hover:shadow-sm">
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', tone === 'red' ? 'bg-red-50 text-red-600' : tone === 'green' ? 'bg-[#E6F2EB] text-[#2E8B57]' : 'bg-[#F1EDE3] text-[#3F4B43]')}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-2xl font-bold tabular-nums text-[#1C2B22]">{value ?? '—'}</span>
        <span className="block text-xs font-medium text-[#66736B]">{label}</span>
      </span>
    </button>
  )
}

function IncidentDialog({ id, onClose, onOpen }: { id: number; onClose: () => void; onOpen: (id: number) => void }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'view' | 'fix' | 'dismiss'>('view')
  const [note, setNote] = useState('')
  const [similar, setSimilar] = useState(false)
  // Reopen asks first: right after "Save as fixed" the Reopen button appears in
  // the same spot, so a double-click used to reopen what was just fixed.
  const [confirmReopen, setConfirmReopen] = useState(false)

  const { data: i, isLoading } = useQuery({ queryKey: ['admin-incident', id], queryFn: () => get<IncidentDetail>(`${API}/${id}`) })

  const act = useMutation({
    mutationFn: (vars: { action: 'resolve' | 'dismiss' | 'reopen'; body?: Record<string, unknown> }) => post<Incident>(`${API}/${id}/${vars.action}`, vars.body ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-incidents'] })
      queryClient.invalidateQueries({ queryKey: ['admin-incident', id] })
      setMode('view')
      setNote('')
      setSimilar(false)
      setConfirmReopen(false)
    },
  })

  const canClose = i && (i.status === 'open' || i.status === 'recorded')
  const details = i?.context ? Object.entries(i.context).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) : []

  return (
    <Modal show onClose={onClose} maxWidth="2xl">
      <div className="bg-white p-6" role="document" aria-label="Incident details">
        {isLoading || !i ? (
          <p className="flex items-center gap-2 py-10 text-sm text-[#66736B]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#66736B]">{CATEGORY[i.category]?.label ?? i.category} · {SEVERITY[i.severity].label} seriousness</p>
                <h2 className="text-lg font-bold text-[#1C2B22]">{i.title}</h2>
                <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ring-1', STATUS[i.status].tone)}>{STATUS[i.status].label}</span>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-[#FAF7F0]"><X className="h-5 w-5" /></button>
            </div>

            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <Block title="Timestamps">
                <Line label="Happened">{fmt(i.occurred_at, true)}</Line>
                {i.resolved_at && <Line label={i.status === 'dismissed' ? 'Dismissed' : 'Fixed'}>{fmt(i.resolved_at, true)}</Line>}
                {i.similar.total > 1 && <Line label="Repeated">{i.similar.total} times · first {fmt(i.similar.first_at)} · last {fmt(i.similar.last_at)}</Line>}
              </Block>
              <Block title="Affected module">
                <Line label="Area">{CATEGORY[i.category]?.label ?? i.category}</Line>
                {i.path && <Line label="Page">{i.method} {i.path}</Line>}
                {i.subject && <Line label="Record">{i.subject.type} #{i.subject.id}</Line>}
                <Line label="Who">{i.user ? `${i.user.name} (${i.user.role.replace(/_/g, ' ')})` : 'No account'}{i.ip_address ? ` · IP ${i.ip_address}` : ''}</Line>
              </Block>
              <Block title="Description" className="sm:col-span-2">
                <p className="text-[#1C2B22]">{i.message ?? i.title}</p>
              </Block>
              <Block title="Responsible action" className="sm:col-span-2">
                <p className="text-[#1C2B22]">{responsibleAction(i.code)}</p>
                {i.resolved_by && <p className="mt-1 text-xs text-[#66736B]">Handled by {i.resolved_by}.</p>}
              </Block>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#66736B]">Resolution history</p>
              <ol className="mt-2 space-y-2 border-l-2 border-[#E7E2D6] pl-4" aria-label="Resolution history">
                <li className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#9A9282] ring-2 ring-white" aria-hidden="true" />
                  <span className="font-semibold text-[#1C2B22]">Recorded automatically</span> <span className="text-xs text-[#66736B]">· {fmt(i.occurred_at, true)}</span>
                </li>
                {i.history.map((h, n) => (
                  <li key={n} className="relative text-sm">
                    <span className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', h.action === 'resolved' ? 'bg-[#2E8B57]' : h.action === 'reopened' ? 'bg-[#D99A00]' : 'bg-[#9AA39D]')} aria-hidden="true" />
                    <span className="font-semibold text-[#1C2B22]">{h.action === 'resolved' ? 'Marked as fixed' : h.action === 'dismissed' ? 'Dismissed' : 'Reopened'}</span>
                    <span className="text-xs text-[#66736B]"> · {[h.by, fmt(h.at, true)].filter(Boolean).join(' · ')}</span>
                    {h.description && <p className="text-xs text-[#3F4B43]">{h.description}</p>}
                  </li>
                ))}
                {i.history.length === 0 && i.resolution && (
                  <li className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#2E8B57] ring-2 ring-white" aria-hidden="true" />
                    <span className="font-semibold text-[#1C2B22]">{i.status === 'dismissed' ? 'Dismissed' : 'Closed'}</span>
                    <span className="text-xs text-[#66736B]"> · {[i.resolved_by ?? 'System', fmt(i.resolved_at, true)].join(' · ')}</span>
                    <p className="text-xs text-[#3F4B43]">{i.resolution}</p>
                  </li>
                )}
                <li className="relative text-sm">
                  <span className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', i.status === 'open' ? 'bg-red-500' : i.status === 'resolved' ? 'bg-[#2E8B57]' : 'bg-[#9AA39D]')} aria-hidden="true" />
                  Now: <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold ring-1', STATUS[i.status].tone)}>{STATUS[i.status].label}</span>
                  {i.status === 'resolved' && i.resolution && i.history.length > 0 && <p className="text-xs text-[#3F4B43]">Fix note: {i.resolution}</p>}
                </li>
              </ol>
            </div>

            {details.length > 0 && (
              <details className="mt-4 rounded-xl bg-[#FAF7F0] p-3 text-xs text-[#3F4B43]">
                <summary className="cursor-pointer font-semibold text-[#1C2B22]">Technical details</summary>
                <dl className="mt-2 space-y-1">
                  {details.map(([k, v]) => (
                    <div key={k} className="flex gap-2"><dt className="shrink-0 font-semibold">{k.replace(/_/g, ' ')}:</dt><dd className="break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
                  ))}
                </dl>
              </details>
            )}

            {i.similar.recent.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#66736B]">Same problem, earlier</p>
                <ul className="mt-1 divide-y divide-[#F1EDE3] rounded-xl border border-[#F1EDE3]">
                  {i.similar.recent.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => onOpen(s.id)} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-[#FAF7F0]">
                        <span>{fmt(s.occurred_at, true)}</span>
                        <span className="flex items-center gap-2">
                          {s.resolution && <span className="max-w-[260px] truncate text-[#66736B]" title={s.resolution}>{s.resolved_by ? `${s.resolved_by}: ` : ''}{s.resolution}</span>}
                          <span className={cn('rounded-full px-2 py-0.5 font-bold ring-1', STATUS[s.status].tone)}>{STATUS[s.status].label}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mode !== 'view' && (
              <form
                className="mt-4 space-y-2 rounded-xl border border-[#E7E2D6] p-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  act.mutate({ action: mode === 'fix' ? 'resolve' : 'dismiss', body: { note: note.trim() || undefined, include_similar: similar } })
                }}
              >
                <label className="block text-sm font-semibold text-[#1C2B22]">
                  {mode === 'fix' ? 'What was done to fix it?' : 'Why is no action needed? (optional)'}
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    required={mode === 'fix'}
                    minLength={mode === 'fix' ? 3 : undefined}
                    placeholder={mode === 'fix' ? 'e.g. Restarted the database service; asked the owner to upload a smaller photo.' : 'e.g. The customer mistyped their password.'}
                    className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-2 text-sm font-normal outline-none focus:border-[#2E8B57]"
                  />
                </label>
                {i.similar.total > 1 && (
                  <label className="flex items-center gap-2 text-sm text-[#3F4B43]">
                    <input type="checkbox" checked={similar} onChange={(e) => setSimilar(e.target.checked)} className="accent-[#2E8B57]" />
                    Also close the other {i.similar.total - 1} times this happened
                  </label>
                )}
                {act.isError && <p className="text-sm text-red-600">{apiErrorMessage(act.error, 'Could not save.')}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setMode('view')} className="rounded-xl border border-[#E7E2D6] px-3 py-1.5 text-sm">Cancel</button>
                  <button type="submit" disabled={act.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                    {act.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {mode === 'fix' ? 'Save as fixed' : 'Dismiss'}
                  </button>
                </div>
              </form>
            )}

            {mode === 'view' && (
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {i.code.startsWith('diagnostics_') && (
                  <Link to="/admin/settings/diagnostics" className="mr-auto inline-flex items-center gap-1 text-sm font-semibold text-[#2E8B57] hover:underline">
                    <Stethoscope className="h-4 w-4" aria-hidden="true" /> Open System Diagnostics
                  </Link>
                )}
                {canClose && (
                  <>
                    <button type="button" onClick={() => setMode('dismiss')} className="rounded-xl border border-[#E7E2D6] px-4 py-2 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">Dismiss</button>
                    <button type="button" onClick={() => setMode('fix')} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2E8B57] px-4 py-2 text-sm font-semibold text-white hover:bg-[#257347]">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Mark as fixed
                    </button>
                  </>
                )}
                {!canClose && !confirmReopen && (
                  <button type="button" onClick={() => setConfirmReopen(true)} disabled={act.isPending} className="inline-flex items-center gap-1.5 rounded-xl border border-[#E7E2D6] px-4 py-2 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reopen
                  </button>
                )}
                {!canClose && confirmReopen && (
                  <div role="group" aria-label="Confirm reopen" className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-sm text-[#3F4B43]">Reopen this incident? It will show as Needs fixing again.</span>
                    {/* "Yes" sits left; Cancel takes Reopen's old spot, so extra clicks land on Cancel. */}
                    <button type="button" onClick={() => act.mutate({ action: 'reopen' })} disabled={act.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-[#D99A00] px-4 py-2 text-sm font-semibold text-white hover:bg-[#B98200] disabled:opacity-50">
                      {act.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />} Yes, reopen
                    </button>
                    <button type="button" onClick={() => setConfirmReopen(false)} className="rounded-xl border border-[#E7E2D6] px-4 py-2 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">Cancel</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function Block({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className={cn('rounded-xl border border-[#F1EDE3] p-3', className)}>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#66736B]">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-sm">
      <span className="w-20 shrink-0 text-[#66736B]">{label}</span>
      <span className="min-w-0 break-words text-[#1C2B22]">{children}</span>
    </p>
  )
}
