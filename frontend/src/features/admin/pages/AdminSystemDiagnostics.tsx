import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, ShieldAlert, Stethoscope, UserCog, Users, Wrench, X, XCircle,
  type LucideIcon,
} from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { Modal } from '@/shared/components/Modal'
import { cn } from '@/shared/utils'
import { CHECK_COPY, FIX_COPY, GRADE_MEANING, MEASURE_COPY, type FixedBy } from './diagnosticsCopy'

const API = '/admin/system/diagnostics'

type Status = 'ok' | 'warning' | 'error'

export interface DiagnosticFix {
  action: string
  label: string
  description: string
  confirm?: boolean
  danger?: boolean
}

export interface DiagnosticCheck {
  key: string
  area: 'platform' | 'automation' | 'operations' | 'payments' | 'integrity' | 'errors'
  title: string
  status: Status
  summary: string
  details: string[]
  count: number | null
  fixes: DiagnosticFix[]
  link: string | null
}

export interface HealthMeasure {
  key: string
  group: 'performance' | 'service'
  label: string
  value: number | null
  display: string
  target: string
  status: Status | 'idle'
  hint: string
  ratio: number | null
}

export interface Health {
  score: number | null
  grade: string
  window: string
  measures: HealthMeasure[]
}

export interface Diagnostics {
  generated_at: string
  summary: { ok: number; warning: number; error: number }
  health: Health
  checks: DiagnosticCheck[]
  recent_fixes: { id: number; description: string; by: string | null; at: string | null }[]
}

interface FixResult {
  action: string
  message: string
  output: string
  diagnostics: Diagnostics
}

const RANK: Record<Status, number> = { error: 0, warning: 1, ok: 2 }

const FIXED_BY: Record<FixedBy, { label: string; icon: LucideIcon; tone: string }> = {
  you: { label: 'You can fix this here', icon: Wrench, tone: 'bg-[#E6F2EB] text-[#1E6B40]' },
  technical: { label: 'Needs your technical person', icon: UserCog, tone: 'bg-[#E3F1F8] text-[#1D5F80]' },
  staff: { label: 'Needs a staff decision', icon: Users, tone: 'bg-[#F3EEE2] text-[#5B5446]' },
}

const time = (iso: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(iso))
const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(iso)) : '')

const copyFor = (c: DiagnosticCheck) => CHECK_COPY[c.key]
const fixLabel = (f: DiagnosticFix) => FIX_COPY[f.action]?.label ?? f.label

/**
 * System Diagnostics (Settings → System Diagnostics), written for office
 * staff: a plain status sentence, a list of things to fix (what it means,
 * how to fix it, who can fix it), health measures with everyday names, and
 * everything that works folded away. Technical text stays one click away.
 */
export default function AdminSystemDiagnostics() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<{ fix: DiagnosticFix; check: DiagnosticCheck } | null>(null)
  const [result, setResult] = useState<FixResult | null>(null)
  const [showWorking, setShowWorking] = useState(false)

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-system-diagnostics'],
    queryFn: () => get<Diagnostics>(API),
  })

  const runFix = useMutation({
    mutationFn: (vars: { action: string; confirm: boolean }) => post<FixResult>(`${API}/fix`, vars),
    onSuccess: (res) => {
      queryClient.setQueryData(['admin-system-diagnostics'], res.diagnostics)
      setResult(res)
      setPending(null)
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#66736B]">
        <Loader2 className="h-5 w-5 animate-spin" /> Checking the system…
      </div>
    )
  }
  if (!data) return <div className="py-20 text-center text-[#66736B]">{apiErrorMessage(error, 'Could not check the system.')}</div>

  const problems = data.checks.filter((c) => c.status !== 'ok').sort((a, b) => RANK[a.status] - RANK[b.status])
  const working = data.checks.filter((c) => c.status === 'ok')
  const urgent = problems.filter((c) => c.status === 'error').length

  return (
    <div className="space-y-6">
      <StatusHeader
        problems={problems.length}
        urgent={urgent}
        health={data.health}
        checkedAt={data.generated_at}
        checking={isFetching}
        onCheck={() => refetch()}
      />

      {result && <FixResultBanner result={result} onClose={() => setResult(null)} />}

      {/* 1 — Things to fix */}
      <section aria-labelledby="to-fix-heading" className="space-y-3">
        <h2 id="to-fix-heading" className="text-lg font-bold text-[#1C2B22]">
          {problems.length ? `Things to fix (${problems.length})` : 'Things to fix'}
        </h2>
        {problems.length === 0 ? (
          <p className="flex items-center gap-2 rounded-2xl border border-[#CFE5D7] bg-[#F3FAF6] px-4 py-4 text-sm font-medium text-[#1E6B40]">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Nothing to fix — everything is working.
          </p>
        ) : (
          <ol className="space-y-3">
            {problems.map((c, i) => (
              <ProblemCard key={c.key} index={i + 1} check={c} onFix={(fix) => setPending({ fix, check: c })} />
            ))}
          </ol>
        )}
      </section>

      {/* 2 — Health measures */}
      <HealthMeasures health={data.health} />

      {/* 3 — What is working */}
      <section aria-label="Everything that is working" className="rounded-2xl border border-[#E7E2D6] bg-white">
        <button
          type="button"
          onClick={() => setShowWorking((v) => !v)}
          aria-expanded={showWorking}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-[#1C2B22]">
            <CheckCircle2 className="h-5 w-5 text-[#2E8B57]" aria-hidden="true" /> Everything that is working ({working.length})
          </span>
          {showWorking ? <ChevronDown className="h-4 w-4 text-[#66736B]" /> : <ChevronRight className="h-4 w-4 text-[#66736B]" />}
        </button>
        {showWorking && (
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-[#F1EDE3] px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {working.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-sm text-[#1C2B22]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" />
                <span>
                  {copyFor(c)?.ok ?? c.title}
                  {c.fixes.length > 0 && (
                    <span className="ml-2">
                      {c.fixes.map((f) => (
                        <button key={f.action} type="button" onClick={() => setPending({ fix: f, check: c })} className="text-xs font-medium text-[#66736B] underline underline-offset-2 hover:text-[#1C2B22]">
                          {fixLabel(f)}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4 — History */}
      <section aria-label="Recent fixes" className="rounded-2xl border border-[#EEE9DD] bg-white">
        <h2 className="flex items-center gap-2 border-b border-[#F1EDE3] px-5 py-3 text-sm font-semibold text-[#1C2B22]">
          <Wrench className="h-4 w-4 text-[#66736B]" aria-hidden="true" /> Recent fixes
        </h2>
        {data.recent_fixes.length === 0 ? (
          <p className="px-5 py-5 text-sm text-[#66736B]">No fixes have been made from this page yet.</p>
        ) : (
          <ul className="divide-y divide-[#F1EDE3]">
            {data.recent_fixes.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5 text-sm">
                <span className="text-[#1C2B22]">{f.description}</span>
                <span className="text-xs text-[#66736B]">{[f.by, when(f.at)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && (
        <FixDialog
          fix={pending.fix}
          check={pending.check}
          running={runFix.isPending}
          error={runFix.isError ? apiErrorMessage(runFix.error, 'The fix could not run.') : null}
          onClose={() => {
            setPending(null)
            runFix.reset()
          }}
          onRun={(confirm) => runFix.mutate({ action: pending.fix.action, confirm })}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function StatusHeader({ problems, urgent, health, checkedAt, checking, onCheck }: {
  problems: number; urgent: number; health: Health; checkedAt: string; checking: boolean; onCheck: () => void
}) {
  const state: Status = urgent ? 'error' : problems ? 'warning' : 'ok'
  const Icon = state === 'ok' ? CheckCircle2 : state === 'warning' ? AlertTriangle : ShieldAlert
  const headline = state === 'ok' ? 'Everything is working' : `Your system needs attention: ${problems} ${problems === 1 ? 'thing' : 'things'} to fix`
  const sub = state === 'ok'
    ? 'No problems were found.'
    : urgent
      ? `${urgent} ${urgent === 1 ? 'is' : 'are'} urgent and may stop orders, riders or payments from working.`
      : 'Nothing urgent, but these should be fixed soon.'

  return (
    <section
      aria-label="System status"
      className={cn(
        'grid grid-cols-1 gap-5 rounded-2xl border p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center',
        state === 'error' ? 'border-red-200 bg-red-50' : state === 'warning' ? 'border-[#F5D78A] bg-[#FFFBEB]' : 'border-[#CFE5D7] bg-[#F3FAF6]',
      )}
    >
      <div className="flex items-start gap-4">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm', state === 'error' ? 'text-red-600' : state === 'warning' ? 'text-[#B07C00]' : 'text-[#2E8B57]')}>
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-bold leading-snug text-[#1C2B22]">{headline}</h2>
          <p className="mt-1 text-sm text-[#3F4B43]">{sub}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#66736B]">
            <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" /> Last checked at {time(checkedAt)}
            <Link to="/admin/settings/incidents" className="font-semibold text-[#2E8B57] hover:underline">See the full history</Link>
            <button type="button" onClick={onCheck} disabled={checking} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2E1D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D5C3A] disabled:opacity-60">
              <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} aria-hidden="true" /> Check again
            </button>
          </p>
        </div>
      </div>
      <ScoreBadge health={health} />
    </section>
  )
}

function ScoreBadge({ health }: { health: Health }) {
  const score = health.score
  const tone = score === null ? '#9A9282' : score >= 75 ? '#2E8B57' : score >= 50 ? '#D99A00' : '#DC2626'
  const r = 40
  const circumference = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5">
      <div className="relative h-20 w-20 shrink-0" role="img" aria-label={score === null ? 'Health score: not enough data' : `Health score ${score} of 100, ${health.grade}`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#E7E2D6" strokeWidth="10" />
          {score !== null && <circle cx="50" cy="50" r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(score / 100) * circumference} ${circumference}`} />}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums text-[#1C2B22]">{score ?? '—'}</span>
      </div>
      <div className="max-w-[200px]">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#66736B]">Health score</p>
        <p className="text-base font-bold text-[#1C2B22]">{health.grade}</p>
        <p className="text-xs text-[#3F4B43]">{GRADE_MEANING[health.grade] ?? ''}</p>
      </div>
    </div>
  )
}

function ProblemCard({ index, check: c, onFix }: { index: number; check: DiagnosticCheck; onFix: (fix: DiagnosticFix) => void }) {
  const [technical, setTechnical] = useState(false)
  const copy = copyFor(c)
  const urgent = c.status === 'error'
  // A check with a button the admin can press is "you can fix this", whatever the default.
  const fixedBy: FixedBy = c.fixes.some((f) => !f.danger) && copy?.fixedBy !== 'staff' ? 'you' : copy?.fixedBy ?? 'technical'
  const who = FIXED_BY[fixedBy]
  const WhoIcon = who.icon
  const primary = c.fixes.filter((f) => !f.danger && f.action !== 'acknowledge_errors' && f.action !== 'clear_caches')
  const secondary = c.fixes.filter((f) => !primary.includes(f))

  return (
    <li className={cn('overflow-hidden rounded-2xl border bg-white', urgent ? 'border-red-200' : 'border-[#F5D78A]')} aria-label={copy?.problem ?? c.title}>
      <div className={cn('flex flex-wrap items-center gap-2 px-5 py-3', urgent ? 'bg-red-50' : 'bg-[#FFFBEB]')}>
        <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white', urgent ? 'bg-red-600' : 'bg-[#D99A00]')} aria-hidden="true">{index}</span>
        <h3 className="text-base font-bold text-[#1C2B22]">{copy?.problem ?? c.title}</h3>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', urgent ? 'bg-red-100 text-red-700' : 'bg-[#FFE680] text-[#5C4A00]')}>
          {urgent ? 'Urgent' : 'Fix soon'}
        </span>
        <span className={cn('ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', who.tone)}>
          <WhoIcon className="h-3.5 w-3.5" aria-hidden="true" /> {who.label}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#66736B]">What this means</p>
          <p className="mt-1 text-sm text-[#1C2B22]">{copy?.meaning ?? c.summary}</p>
          {c.count != null && <p className="mt-1 text-xs text-[#66736B]">Affected: {c.count}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#66736B]">How to fix it</p>
          {primary.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {primary.map((f) => (
                <button key={f.action} type="button" onClick={() => onFix(f)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2E8B57] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#257347]">
                  <Wrench className="h-4 w-4" aria-hidden="true" /> {fixLabel(f)}
                </button>
              ))}
            </div>
          )}
          {copy?.staffStep && <p className="mt-1.5 text-sm text-[#1C2B22]">{copy.staffStep}</p>}
          {copy?.techStep && (fixedBy === 'technical' || primary.length > 0) && (
            <TechStep step={copy.techStep} after={primary.length > 0} />
          )}
          {!primary.length && !copy?.staffStep && !copy?.techStep && <p className="mt-1.5 text-sm text-[#1C2B22]">{c.summary}</p>}
          {(secondary.length > 0 || c.link) && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {secondary.map((f) => (
                <button key={f.action} type="button" onClick={() => onFix(f)} className={cn('text-xs font-semibold underline underline-offset-2', f.danger ? 'text-red-700' : 'text-[#2E8B57]')}>
                  {fixLabel(f)}
                </button>
              ))}
              {c.link && (
                <Link to={c.link} className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#2E8B57] hover:underline">
                  Open deliveries <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#F1EDE3] px-5 py-2">
        <button type="button" onClick={() => setTechnical((v) => !v)} aria-expanded={technical} className="inline-flex items-center gap-1 text-xs font-medium text-[#66736B] hover:text-[#1C2B22]">
          {technical ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Technical details
        </button>
        {technical && (
          <div className="mt-2 space-y-1 rounded-lg bg-[#FAF7F0] p-3 text-xs text-[#3F4B43]">
            <p className="font-semibold">{c.title}: {c.summary}</p>
            {c.details.map((d, i) => <p key={i} className="break-words">• {d}</p>)}
          </div>
        )}
      </div>
    </li>
  )
}

function TechStep({ step, after }: { step: { text: string; command?: string }; after: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 rounded-xl border border-[#D6E7F0] bg-[#F4F9FC] p-3 text-sm text-[#1C2B22]">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1D5F80]">
        <UserCog className="h-3.5 w-3.5" aria-hidden="true" /> {after ? 'To stop it happening again, ask your technical person:' : 'Ask your technical person:'}
      </p>
      <p className="mt-1">{step.text}</p>
      {step.command && (
        <div className="mt-1.5 flex items-center gap-2">
          <code className="rounded-md bg-[#0F2E1D] px-2 py-1 text-xs text-white">{step.command}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(step.command!)
              setCopied(true)
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D5F80] hover:underline"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Health measures

const MEASURE_STATUS: Record<HealthMeasure['status'], { label: string; chip: string; bar: string; icon: LucideIcon }> = {
  ok: { label: 'Good', chip: 'bg-[#E6F2EB] text-[#1E6B40]', bar: 'bg-[#2E8B57]', icon: CheckCircle2 },
  warning: { label: 'Needs attention', chip: 'bg-[#FFF3C4] text-[#6B5300]', bar: 'bg-[#D99A00]', icon: AlertTriangle },
  error: { label: 'Not working', chip: 'bg-red-50 text-red-700', bar: 'bg-red-500', icon: XCircle },
  idle: { label: 'No data yet', chip: 'bg-[#F1EDE3] text-[#5B5446]', bar: 'bg-[#C9C2B2]', icon: Stethoscope },
}

function HealthMeasures({ health }: { health: Health }) {
  const groups: { key: HealthMeasure['group']; label: string; note: string }[] = [
    { key: 'performance', label: 'How the system is running', note: 'Right now' },
    { key: 'service', label: 'How well we are serving people', note: health.window },
  ]

  return (
    <section aria-label="Health measures" className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-[#1C2B22]">Health measures</h2>
        <p className="text-sm text-[#66736B]">Each figure is compared with its target. Together they make the health score.</p>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="rounded-2xl border border-[#E7E2D6] bg-white p-4">
          <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-[#1C2B22]">
            {g.label} <span className="text-xs font-normal text-[#66736B]">{g.note}</span>
          </h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {health.measures.filter((m) => m.group === g.key).map((m) => <MeasureTile key={m.key} measure={m} />)}
          </ul>
        </div>
      ))}
    </section>
  )
}

function MeasureTile({ measure: m }: { measure: HealthMeasure }) {
  const s = MEASURE_STATUS[m.status]
  const Icon = s.icon
  const copy = MEASURE_COPY[m.key]
  const label = copy?.label ?? m.label
  return (
    <li className="rounded-xl border border-[#EEE9DD] p-3" aria-label={`${label}: ${m.display}, ${s.label}`} title={m.hint}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-[#1C2B22]">{label}</p>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', s.chip)}>
          <Icon className="h-3 w-3" aria-hidden="true" /> {s.label}
        </span>
      </div>
      <p className="mt-1 truncate text-xl font-bold tabular-nums text-[#1C2B22]">{m.display}</p>
      {m.ratio !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F1EDE3]" aria-hidden="true">
          <div className={cn('h-full rounded-full', s.bar)} style={{ width: `${Math.max(3, m.ratio * 100)}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-[#66736B]">{copy?.meaning ?? m.hint} <span className="font-semibold text-[#3F4B43]">Target: {m.target}</span></p>
    </li>
  )
}

// ---------------------------------------------------------------------------

function FixDialog({ fix, check, running, error, onClose, onRun }: {
  fix: DiagnosticFix; check: DiagnosticCheck; running: boolean; error: string | null; onClose: () => void; onRun: (confirm: boolean) => void
}) {
  const [understood, setUnderstood] = useState(false)
  const [technical, setTechnical] = useState(false)
  const needsConfirm = !!fix.confirm
  const copy = FIX_COPY[fix.action]

  return (
    <Modal show onClose={onClose} maxWidth="lg">
      <div className="bg-white p-6" role="document" aria-label={copy?.label ?? fix.label}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#66736B]">{CHECK_COPY[check.key]?.problem ?? check.title}</p>
            <h2 className="text-lg font-bold text-[#1C2B22]">{copy?.label ?? fix.label}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-[#FAF7F0]"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-[#1C2B22]">{copy?.explain ?? fix.description}</p>
        <p className="mt-3 rounded-lg bg-[#FAF7F0] px-3 py-2 text-xs text-[#66736B]">This uses the system’s own safe steps and is saved in the activity log under your name.</p>
        <button type="button" onClick={() => setTechnical((v) => !v)} className="mt-2 text-xs font-medium text-[#66736B] underline underline-offset-2">Technical details</button>
        {technical && <p className="mt-1 text-xs text-[#3F4B43]">{fix.description}</p>}
        {needsConfirm && (
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 accent-red-600" />
            I understand this cannot be undone.
          </label>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#E7E2D6] px-4 py-2 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">Cancel</button>
          <button
            type="button"
            onClick={() => onRun(needsConfirm)}
            disabled={running || (needsConfirm && !understood)}
            className={cn('inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50', fix.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#2E8B57] hover:bg-[#257347]')}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />} Yes, fix it
          </button>
        </div>
      </div>
    </Modal>
  )
}

function FixResultBanner({ result, onClose }: { result: FixResult; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <section role="status" aria-label="Fix result" className="rounded-2xl border border-[#CFE5D7] bg-[#F3FAF6] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#1E6B40]">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Done: {result.message} <span className="font-normal text-[#3F4B43]">The system was checked again below.</span>
        </p>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded-full p-1 hover:bg-white"><X className="h-4 w-4" /></button>
      </div>
      {result.output && (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs font-medium text-[#66736B] underline underline-offset-2">{open ? 'Hide technical details' : 'Technical details'}</button>
          {open && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-[#0F2E1D] p-3 text-xs text-white/90">{result.output}</pre>}
        </>
      )}
    </section>
  )
}
