import { useMemo, useState, type ReactNode } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CalendarCheck, CalendarDays, CalendarX, ChevronLeft, ChevronRight, ClipboardList, FileText, Loader2, Search,
  Users, X, Zap,
} from 'lucide-react'
import { apiErrorMessage, get, openAuthenticatedDocument, post, put } from '@/shared/services/api'
import { Modal } from '@/shared/components/Modal'
import { Alert } from '@/shared/components/Alert'
import { cn } from '@/shared/utils'
import { OnboardingTracker } from '@/features/onboarding/components/OnboardingTracker'
import {
  ASSESSMENT_ITEMS, CHECKLIST_ITEMS, SERVICE_LABELS, VEHICLE_LABELS, manilaDate, type ApplicantSummary, type AvailabilityDay, type AvailabilityMonth,
  type Evaluation, type OnboardingAppointment, type OnboardingSlot, type OnboardingStage,
} from '@/features/onboarding/types'

const BASE = '/onboarding-office'
const card = 'rounded-2xl bg-white ring-1 ring-[#E2E8E3] shadow-sm'
const input = 'w-full rounded-xl border border-[#E2E8E3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2E8B57] focus:ring-2 focus:ring-[#2E8B57]/20'
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition disabled:opacity-50'
const primary = `${btn} bg-[#0B5D2E] text-white hover:bg-[#094A25]`
const ghost = `${btn} ring-1 ring-[#E2E8E3] text-[#14351F] hover:bg-[#F4F6F4]`
const danger = `${btn} ring-1 ring-red-200 text-red-600 hover:bg-red-50`

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
const thisMonth = () => today().slice(0, 7)
const dateLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...opts }).format(new Date(`${d}T00:00:00Z`))

type Tab = 'appointments' | 'availability' | 'applicants'

interface Session extends OnboardingSlot {
  appointments: { id: number; status: OnboardingAppointment['status']; walk_in: boolean; applicant: ApplicantSummary }[]
}

/**
 * Tourism Office rider onboarding console. Scheduling is automatic; the office
 * manages availability, evaluates applicants and makes the final decision.
 * Every office works on its own municipality only; the server resolves it from
 * the signed-in account, so no municipality is ever sent from here.
 */
export function RiderOnboardingOffice({ headerSlot }: { headerSlot?: ReactNode }) {
  const [tab, setTab] = useState<Tab>('appointments')
  const [openRider, setOpenRider] = useState<number | null>(null)
  const params: Record<string, number> = {}

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'appointments', label: 'Appointments', icon: ClipboardList },
    { key: 'availability', label: 'Training availability', icon: CalendarDays },
    { key: 'applicants', label: 'Applicants', icon: Users },
  ]

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#14351F] lg:text-3xl">Rider Onboarding</h1>
          <p className="mt-1 text-sm text-[#5B6A60]">Appointments are scheduled automatically. Manage availability, evaluate applicants and make the final decision.</p>
        </div>
        {headerSlot}
      </div>

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-white p-1.5 ring-1 ring-[#E2E8E3]" role="tablist" aria-label="Onboarding sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn('flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold', tab === t.key ? 'bg-[#0B5D2E] text-white' : 'text-[#14351F] hover:bg-[#F4F6F4]')}
          >
            <t.icon className={cn('h-4 w-4', tab === t.key ? 'text-[#FFD000]' : 'text-[#0B5D2E]')} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'appointments' && <AppointmentsTab params={params} onOpen={setOpenRider} />}
      {tab === 'availability' && <AvailabilityTab params={params} onOpen={setOpenRider} />}
      {tab === 'applicants' && <ApplicantsTab params={params} onOpen={setOpenRider} />}

      {openRider !== null && <ApplicantPanel riderId={openRider} params={params} onClose={() => setOpenRider(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

const APPOINTMENT_STATUS: Record<OnboardingAppointment['status'], { label: string; tone: 'green' | 'gold' | 'red' | 'gray' }> = {
  booked: { label: 'Booked', tone: 'gold' },
  checked_in: { label: 'Checked in', tone: 'green' },
  completed: { label: 'Completed', tone: 'green' },
  no_show: { label: 'No-show', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
}

const shiftDay = (d: string, delta: number) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + delta)
  return t.toISOString().slice(0, 10)
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

function AppointmentsTab({ params, onOpen }: { params: Record<string, number>; onOpen: (id: number) => void }) {
  const [date, setDate] = useState(today())
  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-office', 'appointments', params, date],
    queryFn: () => get<{ date: string; sessions: Session[] }>(`${BASE}/appointments`, { params: { ...params, date } }),
    placeholderData: keepPreviousData,
  })
  const sessions = data?.sessions ?? []
  const all = sessions.flatMap((s) => s.appointments)
  const stats = [
    { label: 'Sessions', value: sessions.length },
    { label: 'Applicants', value: all.length },
    { label: 'Checked in', value: all.filter((a) => a.status === 'checked_in' || a.status === 'completed').length },
    { label: 'Open seats', value: sessions.filter((s) => s.status === 'open').reduce((n, s) => n + Math.max(0, s.remaining), 0) },
  ]
  const isToday = date === today()

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="flex items-center gap-2">
          <button type="button" className={`${ghost} h-9 w-9 px-0`} onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-0 px-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#7A867F]">{isToday ? 'Today' : dateLabel(date, { weekday: 'long' })}</p>
            <p className="truncate text-lg font-bold text-[#14351F]">{dateLabel(date, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <button type="button" className={`${ghost} h-9 w-9 px-0`} onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
          <label className="relative ml-1 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-[#14351F] ring-1 ring-[#E2E8E3] hover:bg-[#F4F6F4]">
            <CalendarDays className="h-4 w-4 text-[#0B5D2E]" aria-hidden="true" /> Pick date
            <input
              type="date"
              aria-label="Date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          {!isToday && <button type="button" className={`${ghost} h-9`} onClick={() => setDate(today())}>Today</button>}
        </div>
        <dl className="grid grid-cols-4 divide-x divide-[#EEF2EF] rounded-xl bg-[#FAFAF5] ring-1 ring-[#EEF2EF]">
          {stats.map((s) => (
            <div key={s.label} className="px-4 py-2 text-center">
              <dd className="text-lg font-bold text-[#0B5D2E]">{s.value}</dd>
              <dt className="whitespace-nowrap text-[11px] font-medium text-[#7A867F]">{s.label}</dt>
            </div>
          ))}
        </dl>
      </div>

      {isLoading ? (
        <Spinner />
      ) : sessions.length === 0 ? (
        <div className={`${card} flex flex-col items-center px-6 py-14 text-center`}>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F4F6F4] text-[#7A867F]"><CalendarX className="h-6 w-6" aria-hidden="true" /></span>
          <p className="mt-3 font-semibold text-[#14351F]">No onboarding on this date</p>
          <p className="mt-1 max-w-sm text-sm text-[#5B6A60]">It is not a working day, or the trainer or interviewer is marked unavailable.</p>
        </div>
      ) : (
        <ol className={`${card} divide-y divide-[#EEF2EF] overflow-hidden`} aria-label="Sessions">
          {sessions.map((s) => {
            const pct = Math.min(100, (s.booked / Math.max(1, s.capacity)) * 100)
            const closed = s.status === 'closed'
            return (
              <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:gap-6" aria-label={`Session ${s.time}`}>
                <div className="flex shrink-0 items-center gap-4 sm:w-44 sm:flex-col sm:items-start sm:gap-1.5">
                  <span className="text-base font-bold text-[#14351F]">{s.time}</span>
                  <div className="flex w-full max-w-[160px] items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E2E8E3]" aria-hidden="true">
                      <span className={cn('block h-full rounded-full', closed ? 'bg-[#B8C2BC]' : s.remaining <= 0 ? 'bg-red-400' : 'bg-[#2E8B57]')} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="whitespace-nowrap text-xs font-medium text-[#5B6A60]">{s.booked}/{s.capacity}</span>
                  </div>
                  {closed && <Badge tone="red">Unavailable</Badge>}
                </div>

                <div className="min-w-0 flex-1">
                  {s.appointments.length === 0 ? (
                    <p className="flex h-full items-center text-sm text-[#9AA5A0]">{closed ? 'Closed for this date' : `${s.remaining} seats open`}</p>
                  ) : (
                    <ul className="space-y-2">
                      {s.appointments.map((a) => {
                        const st = APPOINTMENT_STATUS[a.status]
                        return (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => onOpen(a.applicant.id)}
                              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-[#EEF2EF] transition hover:bg-[#FAFAF5] hover:ring-[#CFE5D7]"
                            >
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E6F2EB] text-xs font-bold text-[#0B5D2E]" aria-hidden="true">{initials(a.applicant.name)}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-[#14351F]">{a.applicant.name}</span>
                                <span className="block truncate text-xs text-[#7A867F]">
                                  {a.applicant.reference} · {a.applicant.phone ?? a.applicant.email}
                                  {a.applicant.application_status_label ? ` · ${a.applicant.application_status_label}` : ''}
                                </span>
                              </span>
                              {a.walk_in && <Badge tone="gray">Walk-in</Badge>}
                              <Badge tone={st.tone}>{st.label}</Badge>
                              <ChevronRight className="h-4 w-4 shrink-0 text-[#B8C2BC] group-hover:text-[#0B5D2E]" aria-hidden="true" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

type DayKind = 'past' | 'open' | 'off' | 'closed'

/** open = sessions run; off = the office marked trainer/interviewer away; closed = not a work day by default. */
function dayKind(d: AvailabilityDay): DayKind {
  if (d.past) return 'past'
  if (d.schedulable) return 'open'
  return d.overridden ? 'off' : 'closed'
}

function offLabel(d: Pick<AvailabilityDay, 'trainer_available' | 'interviewer_available'>) {
  if (!d.trainer_available && !d.interviewer_available) return 'Both away'
  return !d.trainer_available ? 'Trainer away' : 'Interviewer away'
}

function AvailabilityTab({ params, onOpen }: { params: Record<string, number>; onOpen: (id: number) => void }) {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(thisMonth())
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState({ trainer: true, interviewer: true, notes: '' })
  const [result, setResult] = useState<{ message: string; affected: ApplicantSummary[] } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-office', 'availability', params, month],
    queryFn: () => get<AvailabilityMonth>(`${BASE}/availability`, { params: { ...params, month } }),
    placeholderData: keepPreviousData,
  })
  const { data: affected } = useQuery({
    queryKey: ['onboarding-office', 'affected', params],
    queryFn: () => get<ApplicantSummary[]>(`${BASE}/affected`, { params }),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['onboarding-office'] })

  const day = data?.days.find((d) => d.date === selected) ?? null
  const save = useMutation({
    mutationFn: () => put<{ schedulable: boolean; affected: ApplicantSummary[]; scheduled_from_pending: number }>(`${BASE}/availability/${selected}`, {
      ...params, trainer_available: form.trainer, interviewer_available: form.interviewer, notes: form.notes || null,
    }),
    onSuccess: (res) => {
      const when = dateLabel(selected!, { month: 'long', day: 'numeric' })
      const parts = [res.schedulable ? `${when} is open for onboarding.` : `${when} marked unavailable.`]
      if (res.scheduled_from_pending) parts.push(`${res.scheduled_from_pending} waiting applicant(s) were scheduled.`)
      setResult({ message: parts.join(' '), affected: res.affected })
      refresh()
    },
  })
  const reschedule = useMutation({
    mutationFn: (date?: string) => post<{ moved: number; unplaced: number }>(`${BASE}/affected/reschedule`, { ...params, date }),
    onSuccess: (res) => {
      setResult({ message: `${res.moved} appointment(s) rescheduled and the applicants notified.${res.unplaced ? ` ${res.unplaced} could not be placed yet.` : ''}`, affected: [] })
      refresh()
    },
  })

  const grid = useMemo(() => {
    if (!data) return []
    const lead = (data.days[0]?.weekday ?? 1) - 1
    return [...Array(lead).fill(null), ...data.days] as (AvailabilityDay | null)[]
  }, [data])

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number]
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    setSelected(null)
  }

  const pick = (d: AvailabilityDay) => {
    if (d.past) return
    setSelected(d.date)
    setResult(null)
    setForm({ trainer: d.trainer_available, interviewer: d.interviewer_available, notes: d.notes ?? '' })
  }

  const affectedList = result?.affected.length ? result.affected : affected ?? []
  const willOpen = form.trainer && form.interviewer
  const dirty = !!day && (day.trainer_available !== form.trainer || day.interviewer_available !== form.interviewer || (day.notes ?? '') !== form.notes)
  const stats = [
    { label: 'Open days', value: data?.summary.available_days ?? 0 },
    { label: 'Unavailable', value: data?.summary.unavailable_days ?? 0 },
    { label: 'To reschedule', value: data?.summary.affected_appointments ?? 0, alert: !!data?.summary.affected_appointments },
    { label: 'Waiting', value: data?.summary.pending_schedule ?? 0, alert: !!data?.summary.pending_schedule },
  ]
  const todayKey = today()

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="flex items-center gap-2">
          <button type="button" className={`${ghost} h-9 w-9 px-0`} onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-0 px-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-[#7A867F]">{data?.office?.name ?? 'Tourism Office'}</p>
            <p className="text-lg font-bold text-[#14351F]">{dateLabel(`${month}-01`, { month: 'long', year: 'numeric' })}</p>
          </div>
          <button type="button" className={`${ghost} h-9 w-9 px-0`} onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          {month !== thisMonth() && <button type="button" className={`${ghost} h-9`} onClick={() => { setMonth(thisMonth()); setSelected(null) }}>This month</button>}
        </div>
        <dl className="grid grid-cols-4 divide-x divide-[#EEF2EF] rounded-xl bg-[#FAFAF5] ring-1 ring-[#EEF2EF]">
          {stats.map((s) => (
            <div key={s.label} className="px-4 py-2 text-center">
              <dd className={cn('text-lg font-bold', s.alert ? 'text-[#B45309]' : 'text-[#0B5D2E]')}>{s.value}</dd>
              <dt className="whitespace-nowrap text-[11px] font-medium text-[#7A867F]">{s.label}</dt>
            </div>
          ))}
        </dl>
      </div>

      {result && <Alert type={result.affected.length ? 'warning' : 'success'} message={result.message} onDismiss={() => setResult(null)} />}

      {affectedList.length > 0 && (
        <section className="rounded-2xl bg-[#FFF8E6] px-4 py-3 ring-1 ring-[#F5D78A]" aria-label="Affected appointments">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <AlertTriangle className="hidden h-5 w-5 shrink-0 text-[#B45309] sm:block" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#7C4A03]">
                {affectedList.length} confirmed appointment{affectedList.length === 1 ? ' is' : 's are'} on unavailable dates
              </p>
              <p className="text-xs text-[#8A6A2E]">They stay booked until you reschedule them. Applicants are notified of the new time.</p>
            </div>
            <button type="button" className={`${primary} shrink-0`} disabled={reschedule.isPending} onClick={() => reschedule.mutate(undefined)}>
              {reschedule.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reschedule all
            </button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {affectedList.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onOpen(a.id)} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#7C4A03] ring-1 ring-[#F5D78A] hover:bg-[#FFF1CC]">
                  {a.name}{a.appointment?.slot ? ` · ${manilaDate(a.appointment.slot.starts_at, { month: 'short', day: 'numeric' })}, ${a.appointment.slot.time}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${card} overflow-hidden`} aria-label="Training availability calendar">
          {isLoading ? (
            <Spinner />
          ) : (
            <>
              <div className="grid grid-cols-7 border-b border-[#EEF2EF] bg-[#FAFAF5]">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <span key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-[#7A867F]">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-[#EEF2EF]" role="grid" aria-label="Select a date">
                {grid.map((d, i) => {
                  if (d === null) return <span key={`e${i}`} className="bg-[#FCFCFA]" />
                  const kind = dayKind(d)
                  const isSel = selected === d.date
                  return (
                    <button
                      key={d.date}
                      type="button"
                      disabled={d.past}
                      onClick={() => pick(d)}
                      aria-pressed={isSel}
                      aria-label={`${dateLabel(d.date)}: ${d.schedulable ? 'available' : 'unavailable'}${d.booked ? `, ${d.booked} booked` : ''}`}
                      className={cn(
                        'relative flex h-[84px] flex-col items-start justify-between p-2 text-left transition',
                        kind === 'past' && 'cursor-not-allowed bg-[#FCFCFA] text-[#C4CCC7]',
                        kind === 'open' && 'bg-white hover:bg-[#F3FAF6]',
                        kind === 'off' && 'bg-[repeating-linear-gradient(135deg,#FBF4F4_0,#FBF4F4_6px,#FFFFFF_6px,#FFFFFF_12px)] hover:bg-[#FBF4F4]',
                        kind === 'closed' && 'bg-[#FAFAF8] text-[#9AA5A0] hover:bg-[#F4F6F4]',
                        isSel && 'z-10 ring-2 ring-inset ring-[#0B5D2E]'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                          d.date === todayKey ? 'bg-[#0B5D2E] text-white' : kind === 'open' ? 'text-[#14351F]' : ''
                        )}
                      >
                        {Number(d.date.slice(8))}
                      </span>
                      <span className="flex w-full flex-col gap-1">
                        {kind === 'open' && d.booked > 0 && (
                          <span className="w-fit rounded-md bg-[#E6F2EB] px-1.5 py-0.5 text-[10px] font-semibold text-[#0B5D2E]">{d.booked} booked</span>
                        )}
                        {kind === 'off' && (
                          <span className="w-fit rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{offLabel(d)}</span>
                        )}
                        {kind === 'off' && d.booked > 0 && <span className="text-[10px] font-medium text-red-700">{d.booked} booked</span>}
                        {kind === 'open' && d.booked === 0 && <span className="flex items-center gap-1 text-[10px] font-medium text-[#2E8B57]"><span className="h-1.5 w-1.5 rounded-full bg-[#2E8B57]" />Open</span>}
                      </span>
                      {d.affected > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#E0A800]" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[#EEF2EF] px-4 py-3 text-xs text-[#5B6A60]">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#2E8B57]" /> Open for onboarding</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[repeating-linear-gradient(135deg,#F3DADA_0,#F3DADA_2px,#FFFFFF_2px,#FFFFFF_4px)] ring-1 ring-red-100" /> Marked unavailable</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[#FAFAF8] ring-1 ring-[#E2E8E3]" /> No sessions (weekend)</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#E0A800]" /> Needs rescheduling</span>
              </div>
            </>
          )}
        </section>

        <aside className={`${card} p-5 lg:sticky lg:top-6`} aria-label="Selected date">
          {!day ? (
            <div className="py-6 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E6F2EB] text-[#0B5D2E]"><CalendarDays className="h-5 w-5" aria-hidden="true" /></span>
              <p className="mt-3 font-semibold text-[#14351F]">Select a date</p>
              <p className="mt-1 text-sm text-[#5B6A60]">Mark the trainer or interviewer as away. Appointments are scheduled automatically on open days.</p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                save.mutate()
              }}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7A867F]">{dateLabel(day.date, { weekday: 'long' })}</p>
                <h3 className="text-lg font-bold text-[#14351F]">{dateLabel(day.date, { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
                <p className="mt-0.5 text-xs text-[#7A867F]">{day.booked} booked{dayKind(day) === 'closed' ? ' · not a regular work day' : ''}</p>
              </div>

              <div className="divide-y divide-[#EEF2EF] rounded-xl ring-1 ring-[#EEF2EF]">
                <AvailabilitySwitch label="Trainer available" value={form.trainer} onChange={(v) => setForm((f) => ({ ...f, trainer: v }))} />
                <AvailabilitySwitch label="Interviewer available" value={form.interviewer} onChange={(v) => setForm((f) => ({ ...f, interviewer: v }))} />
              </div>

              <p className={cn('flex items-start gap-2 text-xs', willOpen ? 'text-[#0B5D2E]' : 'text-[#5B6A60]')}>
                {willOpen ? <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CalendarX className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {willOpen ? 'Open — applicants are scheduled on this date.' : 'Closed — both the trainer and interviewer must be available.'}
              </p>

              {day.booked > 0 && !willOpen && (
                <p className="rounded-xl bg-[#FFF8E6] px-3 py-2 text-xs font-medium text-[#7C4A03] ring-1 ring-[#F5D78A]">
                  {day.booked} confirmed appointment(s) on this date will need rescheduling. They will not change automatically.
                </p>
              )}

              <Field label="Note (optional)">
                <input value={form.notes} maxLength={255} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={input} placeholder="e.g. Trainer on leave" />
              </Field>
              {save.isError && <p className="text-sm text-red-600">{apiErrorMessage(save.error)}</p>}
              <div className="flex gap-2">
                <button type="button" className={`${ghost} flex-1`} onClick={() => setSelected(null)}>Cancel</button>
                <button type="submit" disabled={save.isPending || !dirty} className={`${primary} flex-[2]`}>
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save availability
                </button>
              </div>
            </form>
          )}
        </aside>
      </div>
    </div>
  )
}

function AvailabilitySwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
      <span>
        <span className="block text-sm font-semibold text-[#14351F]">{label.replace(' available', '')}</span>
        <span className={cn('block text-xs', value ? 'text-[#2E8B57]' : 'text-red-600')}>{value ? 'Available' : 'Away'}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition', value ? 'bg-[#0B5D2E]' : 'bg-[#CBD3CE]')}
      >
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', value ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

function ApplicantsTab({ params, onOpen }: { params: Record<string, number>; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState('requirements_review')
  const [search, setSearch] = useState('')
  const filters: Record<string, Record<string, string>> = {
    requirements_review: { status: 'pending_review', application_status: 'requirements_review' },
    in_onboarding: { status: 'pending_review' },
    for_final_approval: { status: 'pending_review', application_status: 'for_final_approval' },
    pending_schedule: { status: 'pending_review', application_status: 'pending_schedule' },
    needs_retraining: { status: 'pending_review', application_status: 'needs_retraining' },
    approved: { status: 'approved' },
    rejected: { status: 'rejected' },
  }
  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-office', 'applicants', params, filter, search],
    queryFn: () =>
      get<{ data: ApplicantSummary[]; meta: { total: number; stats: { pending: number; booked: number; for_final_approval: number; pending_schedule: number; requirements_review?: number } } }>(`${BASE}/applicants`, {
        params: { ...params, ...filters[filter], search: search || undefined },
      }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const stats = data?.meta.stats

  return (
    <div>
      <div className={`${card} mb-4 flex flex-col gap-3 p-4`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A867F]" />
          <input type="search" aria-label="Search applicants" placeholder="Search by name, email or reference" value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} pl-9`} />
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Applicant status">
          {[
            ['requirements_review', `Requirements review${stats ? ` · ${stats.requirements_review ?? 0}` : ''}`],
            ['in_onboarding', `All applicants${stats ? ` · ${stats.pending}` : ''}`],
            ['for_final_approval', `For final approval${stats ? ` · ${stats.for_final_approval}` : ''}`],
            ['pending_schedule', `Pending schedule${stats ? ` · ${stats.pending_schedule}` : ''}`],
            ['needs_retraining', 'Needs retraining'],
            ['approved', 'Approved'],
            ['rejected', 'Rejected'],
          ].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key!)} className={cn('rounded-full px-3 py-1.5 text-xs font-semibold ring-1', filter === key ? 'bg-[#0B5D2E] text-white ring-[#0B5D2E]' : 'ring-[#CFE5D7] text-[#0B5D2E]')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty text="No applicants match these filters." />
      ) : (
        <ul className={`${card} divide-y divide-[#EEF2EF]`}>
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen(r.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF5]">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[#14351F]">{r.name}</span>
                  <span className="block text-xs text-[#5B6A60]">{r.reference ?? 'No application yet'} · {r.requested_services.map((s) => SERVICE_LABELS[s] ?? s).join(', ') || '—'}</span>
                </span>
                {r.appointment?.slot && <span className="text-xs text-[#5B6A60]">{manilaDate(r.appointment.slot.starts_at, { month: 'short', day: 'numeric' })} · {r.appointment.slot.time}</span>}
                {r.appointment?.needs_reschedule && <Badge tone="red">Reschedule</Badge>}
                <Badge tone={r.account_status === 'approved' ? 'green' : r.account_status === 'rejected' ? 'red' : r.application_status === 'for_final_approval' ? 'green' : 'gold'}>
                  {r.application_status_label ?? r.current_stage?.label ?? 'Applicant'}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface ApplicantDetail {
  applicant: ApplicantSummary & {
    documents?: { name: string; file_url: string }[]
    vehicle: { type: string | null; plate_number: string | null; make: string | null; model: string | null; license_number: string | null; license_expiry: string | null }
    missing_documents: string[]
  }
  appointment: OnboardingAppointment | null
  stages: OnboardingStage[]
  evaluation: Evaluation
  quick_approve_enabled?: boolean
  history: {
    interviews: { result: string; documents_verified: boolean; notes: string | null; by: string | null; at: string }[]
    attendance: { status: string; notes: string | null; by: string | null; at: string }[]
    assessments: { score: number; result: string; notes: string | null; by: string | null; at: string }[]
  }
}

function ApplicantPanel({ riderId, params, onClose }: { riderId: number; params: Record<string, number>; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState('')
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [items, setItems] = useState<Record<string, 'passed' | 'failed' | 'na'>>({})
  const [score, setScore] = useState('80')
  const [services, setServices] = useState<string[] | null>(null)
  const [remarks, setRemarks] = useState('')
  const [rescheduleTo, setRescheduleTo] = useState('')
  const [message, setMessage] = useState('')
  const [quickServices, setQuickServices] = useState<string[] | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-office', 'applicant', riderId, params],
    queryFn: () => get<ApplicantDetail>(`${BASE}/applicants/${riderId}`, { params }),
  })
  const { data: schedules } = useQuery({
    queryKey: ['onboarding-office', 'schedules', params],
    queryFn: () => get<{ slots: OnboardingSlot[] }>(`${BASE}/schedules`, { params }),
  })

  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: Record<string, unknown> }) => post(`${BASE}/applicants/${riderId}/${action}`, { ...params, ...body }),
    onSuccess: (_d, { action, body }) => {
      const decisionMessages: Record<string, string> = { approve: 'Rider approved and activated.', reject: 'Application rejected.', return: 'Returned for further evaluation.' }
      setMessage(
        action === 'decision'
          ? decisionMessages[String(body?.decision)] ?? 'Saved.'
          : ({ 'check-in': 'Checked in.', 'no-show': 'Marked as no-show.', interview: 'Interview saved.', attendance: 'Attendance saved.', assessment: 'Assessment saved.', reschedule: 'Appointment scheduled; the applicant was notified.', 'requirements/verify': 'Requirements verified. Training has been scheduled.', 'requirements/return': 'Requirements returned for correction; the applicant was notified.', 'quick-approve': 'Rider approved. They can now go online.' }[action] ?? 'Saved.')
      )
      setNotes('')
      queryClient.invalidateQueries({ queryKey: ['onboarding-office'] })
    },
  })

  const current = data?.stages.find((s) => s.status !== 'done')
  const appointment = data?.appointment
  const status = data?.applicant.application_status
  const pending = data?.applicant.account_status === 'pending_review'
  const requested = data?.evaluation.requested_services ?? []
  const eligible = data?.evaluation.eligible_services ?? []
  const chosen = services ?? eligible
  const openSlots = (schedules?.slots ?? []).filter((s) => s.status === 'open' && s.remaining > 0 && s.id !== appointment?.slot?.id)
  const itemsForApplicant = ASSESSMENT_ITEMS.filter((i) => i.service === null || requested.includes(i.service))
  const showInterview = pending && appointment?.status === 'checked_in' && current?.key === 'interview'
  // Retraining loops back to attendance; attendance "present" moves the status to training_completed.
  const showTraining = pending && (status === 'interview_completed' || status === 'needs_retraining') && data?.evaluation.interview?.result === 'passed'
  const showAssessment = pending && status === 'training_completed'
  const showDecision = pending && status === 'for_final_approval'

  return (
    <Modal show onClose={onClose} maxWidth="4xl">
      <div className="max-h-[85vh] overflow-y-auto bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#7A867F]">Rider applicant evaluation</p>
            <h2 className="text-xl font-bold text-[#14351F]">{data?.applicant.name ?? 'Applicant'}</h2>
            <p className="text-sm text-[#5B6A60]">{data?.applicant.reference} · {data?.applicant.email} · {data?.applicant.phone}</p>
          </div>
          <div className="flex items-center gap-2">
            {data?.applicant.application_status_label && <Badge tone={status === 'for_final_approval' || status === 'approved' ? 'green' : status === 'rejected' || status === 'needs_retraining' ? 'red' : 'gold'}>{data.applicant.application_status_label}</Badge>}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-[#F4F6F4]"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {isLoading || !data ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
              {message && <Alert type="success" message={message} onDismiss={() => setMessage('')} />}
              {act.isError && <Alert type="error" message={apiErrorMessage(act.error)} />}
              {appointment?.needs_reschedule && <Alert type="warning" message="This appointment is on a date that is now unavailable. Reschedule it below." />}

              {pending && data.quick_approve_enabled && (() => {
                const offered = requested.length ? requested : Object.keys(SERVICE_LABELS)
                const picked = quickServices ?? offered
                return (
                  <section className="rounded-2xl bg-[#FFF8E1] p-4 ring-1 ring-[#F5D78A]" aria-label="Quick approve">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFD000] text-[#14351F]"><Zap className="h-5 w-5" aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-[#5C4A00]">Quick approve (presentation)</p>
                        <p className="text-xs text-[#7C6A2E]">Activates this rider now without recording the interview, training and assessment. Recorded in the decision history.</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {offered.map((s) => (
                        <label key={s} className={cn('flex cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold ring-1', picked.includes(s) ? 'ring-[#2E8B57] text-[#0B5D2E]' : 'ring-[#E2E8E3] text-[#5B6A60]')}>
                          <input type="checkbox" className="h-4 w-4 rounded" checked={picked.includes(s)} onChange={(e) => setQuickServices(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} />
                          {SERVICE_LABELS[s] ?? s}
                        </label>
                      ))}
                      <button
                        type="button"
                        className={`${primary} sm:ml-auto`}
                        disabled={picked.length === 0 || act.isPending}
                        onClick={() => act.mutate({ action: 'quick-approve', body: { services: picked } })}
                      >
                        {act.isPending && act.variables?.action === 'quick-approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Approve rider now
                      </button>
                    </div>
                  </section>
                )
              })()}

              {pending && status === 'requirements_review' && (
                <Step title="Verify requirements (phase 1)">
                  <p className="mb-2 text-sm text-[#5B6A60]">Check the vehicle details and the uploaded documents below. Verifying schedules the applicant's interview and training automatically.</p>
                  {data.applicant.missing_documents.length > 0 && (
                    <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{data.applicant.missing_documents.length} required document(s) missing — return the requirements for correction.</p>
                  )}
                  <textarea rows={2} placeholder="What needs correction (required to return)" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={input} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={primary} disabled={data.applicant.missing_documents.length > 0} onClick={() => act.mutate({ action: 'requirements/verify' })}>Verify requirements</button>
                    <button type="button" className={danger} disabled={!remarks.trim()} onClick={() => act.mutate({ action: 'requirements/return', body: { remarks } })}>Return for correction</button>
                  </div>
                </Step>
              )}
              {pending && status === 'requirements_returned' && (
                <Alert type="warning" message={`Requirements returned for correction${data.applicant.requirements_remarks ? `: ${data.applicant.requirements_remarks}` : '.'} Waiting for the applicant to resubmit.`} />
              )}

              {pending && current?.key === 'visit' && appointment?.status === 'booked' && (
                <Step title="Visit Tourism Office">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={primary} onClick={() => act.mutate({ action: 'check-in' })}>Check in</button>
                    <button type="button" className={ghost} onClick={() => act.mutate({ action: 'no-show' })}>Mark no-show</button>
                  </div>
                </Step>
              )}

              {showInterview && (
                <Step title="Document verification and interview">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {CHECKLIST_ITEMS.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-[#E2E8E3]">
                        <input type="checkbox" className="h-4 w-4 rounded" checked={!!checklist[c.key]} onChange={(e) => setChecklist((v) => ({ ...v, [c.key]: e.target.checked }))} />
                        {c.label} verified
                      </label>
                    ))}
                  </div>
                  <textarea rows={2} placeholder="Interview notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${input} mt-2`} />
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={primary} disabled={CHECKLIST_ITEMS.some((c) => !checklist[c.key])} onClick={() => act.mutate({ action: 'interview', body: { result: 'passed', checklist, notes } })}>Interview passed</button>
                    <button type="button" className={danger} onClick={() => act.mutate({ action: 'interview', body: { result: 'failed', checklist, notes } })}>Did not pass</button>
                  </div>
                </Step>
              )}

              {showTraining && (
                <Step title="Actual rider training">
                  <textarea rows={2} placeholder="Training notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={primary} onClick={() => act.mutate({ action: 'attendance', body: { status: 'present', notes } })}>Attended training</button>
                    <button type="button" className={ghost} onClick={() => act.mutate({ action: 'attendance', body: { status: 'absent', notes } })}>Absent</button>
                  </div>
                </Step>
              )}

              {showAssessment && (
                <Step title="Training assessment">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-[#EEF2EF]">
                      {itemsForApplicant.map((item) => (
                        <tr key={item.key}>
                          <th scope="row" className="py-2 text-left font-medium text-[#14351F]">{item.label}{item.service ? ` (${SERVICE_LABELS[item.service]})` : ''}</th>
                          <td className="py-2 text-right">
                            <div className="inline-flex gap-1" role="radiogroup" aria-label={item.label}>
                              {(['passed', 'failed'] as const).map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  role="radio"
                                  aria-checked={items[item.key] === r}
                                  onClick={() => setItems((v) => ({ ...v, [item.key]: r }))}
                                  className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold ring-1', items[item.key] === r ? (r === 'passed' ? 'bg-[#0B5D2E] text-white ring-[#0B5D2E]' : 'bg-red-600 text-white ring-red-600') : 'ring-[#E2E8E3]')}
                                >
                                  {r === 'passed' ? 'Passed' : 'Failed'}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <Field label="Overall score (0–100)"><input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} className={`${input} !w-28`} /></Field>
                    <textarea rows={1} placeholder="Assessment notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${input} min-w-[200px] !w-auto flex-1`} />
                  </div>
                  <button type="button" className={`${primary} mt-2`} disabled={itemsForApplicant.some((i) => !items[i.key])} onClick={() => act.mutate({ action: 'assessment', body: { items, score: Number(score), notes } })}>
                    Save assessment
                  </button>
                </Step>
              )}

              {(showDecision || data.evaluation.assessment) && (
                <section className="space-y-4 rounded-2xl p-4 ring-1 ring-[#E2E8E3]" aria-label="Final evaluation">
                  <h3 className="font-bold text-[#14351F]">Final evaluation</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <EvalTable title="Application requirements" rows={data.evaluation.checklist.map((c) => ({ label: c.label, value: c.verified === null ? 'Pending' : c.verified ? 'Verified' : 'Not verified', ok: c.verified === true }))} />
                    <EvalTable title="Training evaluation" rows={(data.evaluation.assessment?.items ?? []).filter((i) => i.result !== 'na').map((i) => ({ label: i.label, value: i.result === 'passed' ? 'Passed' : 'Failed', ok: i.result === 'passed' }))} />
                  </div>
                  <p className="text-sm">
                    Interview: <b>{data.evaluation.interview ? (data.evaluation.interview.result === 'passed' ? 'Passed' : 'Did not pass') : 'Pending'}</b>
                    {data.evaluation.interview?.notes ? ` — ${data.evaluation.interview.notes}` : ''}
                    {data.evaluation.assessment ? ` · Assessment score ${data.evaluation.assessment.score}/100` : ''}
                  </p>

                  {showDecision && (
                    <div className="space-y-3 rounded-xl bg-[#FAFAF5] p-4">
                      <p className="text-sm font-bold text-[#14351F]">Service eligibility decision</p>
                      <div className="flex flex-wrap gap-2">
                        {requested.map((s) => {
                          const ok = eligible.includes(s)
                          return (
                            <label key={s} className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1', ok ? 'ring-[#CFE5D7]' : 'cursor-not-allowed opacity-60 ring-[#E2E8E3]')}>
                              <input type="checkbox" className="h-4 w-4 rounded" disabled={!ok} checked={ok && chosen.includes(s)} onChange={(e) => setServices(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} />
                              Approve {SERVICE_LABELS[s]}{!ok && ' (assessment not passed)'}
                            </label>
                          )
                        })}
                      </div>
                      <textarea rows={2} placeholder="Remarks (required to reject or return)" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={input} />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={primary} disabled={chosen.filter((s) => eligible.includes(s)).length === 0} onClick={() => act.mutate({ action: 'decision', body: { decision: 'approve', services: chosen.filter((s) => eligible.includes(s)), remarks: remarks || undefined } })}>
                          Approve rider
                        </button>
                        <button type="button" className={ghost} disabled={!remarks.trim()} onClick={() => act.mutate({ action: 'decision', body: { decision: 'return', remarks } })}>Return for further evaluation</button>
                        <button type="button" className={danger} disabled={!remarks.trim()} onClick={() => act.mutate({ action: 'decision', body: { decision: 'reject', remarks } })}>Reject applicant</button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {pending && !showDecision && !['requirements_review', 'requirements_returned'].includes(status ?? '') && (
                <section className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Schedule and reject">
                  <div className="space-y-2 rounded-2xl p-4 ring-1 ring-[#E2E8E3]">
                    <p className="text-sm font-bold text-[#14351F]">{appointment ? 'Reschedule' : 'Schedule appointment'}</p>
                    <select aria-label="Session" value={rescheduleTo} onChange={(e) => setRescheduleTo(e.target.value)} className={input}>
                      <option value="">Choose a session…</option>
                      {openSlots.map((s) => <option key={s.id} value={s.id}>{manilaDate(s.starts_at, { month: 'short', day: 'numeric' })} · {s.time} ({s.remaining} left)</option>)}
                    </select>
                    <button type="button" className={ghost} disabled={!rescheduleTo} onClick={() => act.mutate({ action: 'reschedule', body: { schedule_id: Number(rescheduleTo) } })}>Save and notify applicant</button>
                  </div>
                  <div className="space-y-2 rounded-2xl p-4 ring-1 ring-red-100">
                    <p className="text-sm font-bold text-red-700">Reject application</p>
                    <textarea rows={2} placeholder="Reason (required)" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={input} />
                    <button type="button" className={danger} disabled={!remarks.trim()} onClick={() => act.mutate({ action: 'decision', body: { decision: 'reject', remarks } })}>Reject</button>
                  </div>
                </section>
              )}

              <section aria-label="Application details">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#7A867F]">Application</h3>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <Item label="Requested services" value={requested.map((s) => SERVICE_LABELS[s] ?? s).join(', ')} />
                  <Item label="Vehicle" value={[data.applicant.vehicle.type && VEHICLE_LABELS[data.applicant.vehicle.type], data.applicant.vehicle.make, data.applicant.vehicle.model].filter(Boolean).join(' ')} />
                  <Item label="Plate number" value={data.applicant.vehicle.plate_number} />
                  <Item label="License" value={[data.applicant.vehicle.license_number, data.applicant.vehicle.license_expiry && `exp. ${data.applicant.vehicle.license_expiry}`].filter(Boolean).join(' · ')} />
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(data.applicant.documents ?? []).map((d) => (
                    <button key={d.file_url} type="button" className={ghost} onClick={() => openAuthenticatedDocument(d.file_url).catch((e: Error) => setMessage(e.message))}>
                      <FileText className="h-4 w-4 text-[#0B5D2E]" /> {d.name}
                    </button>
                  ))}
                  {data.applicant.missing_documents.length > 0 && <Badge tone="red">{data.applicant.missing_documents.length} required document(s) missing</Badge>}
                </div>
              </section>

              {data.evaluation.decisions.length > 0 && (
                <section aria-label="Decisions">
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#7A867F]">Decisions</h3>
                  <ul className="space-y-1 text-sm text-[#3F4B43]">
                    {data.evaluation.decisions.map((d, i) => (
                      <li key={i}>
                        <b className="capitalize">{d.decision.replace('_', ' ')}</b>
                        {d.services?.length ? ` · ${d.services.map((s) => SERVICE_LABELS[s] ?? s).join(', ')}` : ''}
                        {d.remarks ? ` — ${d.remarks}` : ''} <span className="text-xs text-[#7A867F]">({d.by}, {manilaDate(d.at, { month: 'short', day: 'numeric', year: 'numeric' })})</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <aside className="rounded-2xl bg-[#FAFAF5] p-4">
              {appointment?.slot && (
                <p className="mb-4 rounded-xl bg-white p-3 text-sm ring-1 ring-[#E2E8E3]">
                  <span className="block text-xs font-bold uppercase text-[#7A867F]">Appointment</span>
                  {manilaDate(appointment.slot.starts_at, { month: 'long', day: 'numeric' })} · {appointment.slot.time}
                  <span className="block text-xs text-[#5B6A60]">
                    {appointment.status.replace('_', ' ')}
                    {appointment.walk_in ? ' · walk-in' : ''}
                    {appointment.scheduled_by === 'system' ? ' · scheduled automatically' : appointment.scheduled_by === 'office' ? ' · set by the office' : ''}
                  </span>
                </p>
              )}
              <OnboardingTracker stages={data.stages} compact />
            </aside>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-[#FAFAF5] p-4" aria-label={title}>
      <p className="text-xs font-bold uppercase tracking-wide text-[#7A867F]">Next step</p>
      <p className="mb-3 font-bold text-[#0B5D2E]">{title}</p>
      {children}
    </section>
  )
}

function EvalTable({ title, rows }: { title: string; rows: { label: string; value: string; ok: boolean }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A867F]">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-[#7A867F]">Not recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-[#EEF2EF]">
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="py-1.5 text-left font-normal text-[#14351F]">{r.label}</th>
                <td className={cn('py-1.5 text-right font-semibold', r.ok ? 'text-[#0B5D2E]' : 'text-red-600')}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-[#14351F]">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

function Item({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#EEF2EF] py-1.5">
      <dt className="text-[#7A867F]">{label}</dt>
      <dd className="text-right font-semibold text-[#14351F]">{value || '—'}</dd>
    </div>
  )
}

function Badge({ tone, children }: { tone: 'green' | 'gold' | 'red' | 'gray'; children: ReactNode }) {
  const tones = { green: 'bg-[#E6F2EB] text-[#0B5D2E]', gold: 'bg-[#FFF6CC] text-[#5C4A00]', red: 'bg-red-50 text-red-700', gray: 'bg-[#F4F6F4] text-[#5B6A60]' }
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${tones[tone]}`}>{children}</span>
}

function Spinner() {
  return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#0B5D2E]" /></div>
}

function Empty({ text }: { text: string }) {
  return <div className={`${card} p-10 text-center text-sm text-[#5B6A60]`}>{text}</div>
}
