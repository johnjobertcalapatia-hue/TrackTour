import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bike, CheckCircle2, Loader2, MapPin, MessageSquareText, Navigation, Phone, ShieldAlert, ShieldCheck, Siren, User } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { cn, formatDateTime } from '@/shared/utils'
import { useOfficePortal } from '@/features/admin/office-portal'

/** SOS alerts (2026-11-18): raised by a tourist during a ride or a rider during any trip. */
export interface AdminSos {
  id: number
  reference: string
  status: 'pending' | 'acknowledged' | 'responding' | 'resolved'
  active: boolean
  /** Municipal Office plan Stage 3: the municipal office that handles it (null: Bansud only). */
  municipality: { id: number; name: string } | null
  /** True once the Bansud Tourism Office has acted on it. */
  bansud_involved: boolean
  raised_by_role: 'tourist' | 'rider'
  service: 'ride' | 'food'
  reporter: { name: string | null; phone: string | null }
  other_party: { role: 'driver' | 'passenger' | 'customer'; name: string | null; phone: string | null; vehicle_type?: string | null; plate_number?: string | null } | null
  order: { id: number; order_number: string; pickup: string | null; dropoff: string | null } | null
  trip_status: string | null
  current_trip_status: string | null
  message: string | null
  location: { latitude: number; longitude: number; accuracy_m: number | null; at: string | null; source: string | null } | null
  live_location: { latitude: number; longitude: number; accuracy_m: number | null; at: string | null } | null
  raised_at: string | null
  sender_safe_at: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  responding_at: string | null
  responding_by: string | null
  responder: string | null
  response_note: string | null
  resolved_at: string | null
  resolved_by: string | null
  outcome: 'handled' | 'false_alarm' | null
  resolution_note: string | null
}

type Filter = 'active' | 'resolved' | 'all'

const STATUS: Record<AdminSos['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for the office', tone: 'bg-red-600 text-white' },
  acknowledged: { label: 'Acknowledged', tone: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200' },
  responding: { label: 'Help sent', tone: 'bg-blue-100 text-blue-800 ring-1 ring-blue-200' },
  resolved: { label: 'Resolved', tone: 'bg-[#E6F2EB] text-[#1E6B40] ring-1 ring-[#CFE5D7]' },
}

const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`
const who = (a: AdminSos) => `${a.raised_by_role === 'tourist' ? 'Tourist' : 'Rider'} · ${a.service === 'ride' ? 'Ride' : 'Food delivery'}`
const ago = (iso: string | null) => {
  if (!iso) return ''
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return formatDateTime(iso)
}

export default function AdminLiveSOS() {
  // Bansud: every alert. Municipal office: its own town's alerts (Bansud can take any over).
  const portal = useOfficePortal()
  const [filter, setFilter] = useState<Filter>('active')
  const { data, isLoading } = useQuery({
    queryKey: ['admin-live-sos', portal.api, filter],
    queryFn: () => get<{ data: AdminSos[]; summary: { active: number; pending: number } }>(`${portal.api}/live/sos?filter=${filter}`),
    refetchInterval: 5000,
  })
  const alerts = data?.data ?? []
  const summary = data?.summary

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#1C2B22] lg:text-3xl">
          <Siren className="h-7 w-7 text-red-600" aria-hidden="true" /> SOS Alerts
        </h1>
        <p className="mt-1 text-sm text-[#66736B]">
          Emergencies raised by tourists during a ride and by riders during a trip. The other person on the trip is not told. Updates every 5 seconds.
        </p>
        {summary && (
          <p className="mt-2 text-sm font-semibold text-[#1C2B22]" data-testid="sos-summary">
            {summary.active} active · <span className={summary.pending ? 'text-red-600' : ''}>{summary.pending} waiting for the office</span>
          </p>
        )}
      </header>

      <div className="flex gap-2" role="group" aria-label="Show">
        {(['active', 'resolved', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition', filter === f ? 'bg-[#2E8B57] text-white' : 'border border-[#E7E2D6] bg-white text-[#3F4B43] hover:bg-[#FAF7F0]')}
          >
            {f === 'active' ? 'Active' : f === 'resolved' ? 'Resolved' : 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-[#E7E2D6] bg-white p-12 text-center">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-[#2E8B57]" aria-hidden="true" />
          <p className="font-medium text-[#1C2B22]">{filter === 'active' ? 'No active SOS alerts' : 'No SOS alerts'}</p>
          <p className="mt-1 text-sm text-[#66736B]">New alerts appear here and as a red banner on every admin page.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {alerts.map((a) => <li key={a.id}><SosCard alert={a} /></li>)}
        </ul>
      )}
    </div>
  )
}

function SosCard({ alert: a }: { alert: AdminSos }) {
  const portal = useOfficePortal()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'view' | 'respond' | 'resolve'>('view')
  const [responder, setResponder] = useState('')
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState<'handled' | 'false_alarm'>('handled')

  const act = useMutation({
    mutationFn: (v: { action: 'acknowledge' | 'respond' | 'resolve'; body?: Record<string, unknown> }) => post(`${portal.api}/live/sos/${a.id}/${v.action}`, v.body ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-live-sos'] })
      queryClient.invalidateQueries({ queryKey: ['admin-sos-summary'] })
      setMode('view')
      setNote('')
      setResponder('')
    },
  })
  const status = STATUS[a.status]

  return (
    <article aria-label={`SOS ${a.reference}`} className={cn('rounded-2xl border bg-white p-5', a.status === 'pending' ? 'border-red-300 ring-2 ring-red-100' : 'border-[#E7E2D6]')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', status.tone)}>{status.label}</span>
        <span className="text-sm font-semibold text-[#1C2B22]">{a.reference}</span>
        <span className="rounded-full bg-[#FAF7F0] px-2.5 py-0.5 text-xs font-medium text-[#3F4B43] ring-1 ring-[#E7E2D6]">{who(a)}</span>
        {/* Bansud sees which office handles each alert; a municipal office sees when Bansud stepped in. */}
        {portal.district ? (
          <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-100">
            {a.municipality ? `${a.municipality.name} office` : 'No town · Bansud'}
          </span>
        ) : a.bansud_involved ? (
          <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-100">Bansud Tourism Office is helping</span>
        ) : null}
        <span className="ml-auto text-xs text-[#66736B]" title={a.raised_at ? formatDateTime(a.raised_at) : undefined}>Raised {ago(a.raised_at)}</span>
      </div>

      {a.active && a.sender_safe_at && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-[#F3FAF6] px-3 py-2 text-sm text-[#1E6B40]">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" /> The sender says they are safe ({ago(a.sender_safe_at)}). Confirm, then resolve.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Person icon={User} title={a.raised_by_role === 'tourist' ? 'Tourist (sent the SOS)' : 'Rider (sent the SOS)'} name={a.reporter.name} phone={a.reporter.phone} />
        {a.other_party && (
          <Person
            icon={a.other_party.role === 'driver' ? Bike : User}
            title={`${a.other_party.role === 'driver' ? 'Driver' : a.other_party.role === 'passenger' ? 'Passenger' : 'Customer'} (not told)`}
            name={a.other_party.name}
            phone={a.other_party.phone}
            extra={a.other_party.role === 'driver' ? [a.other_party.vehicle_type, a.other_party.plate_number].filter(Boolean).join(' · ') : undefined}
          />
        )}
      </div>

      {a.order && (
        <p className="mt-3 text-sm text-[#3F4B43]">
          <span className="font-semibold text-[#1C2B22]">Order #{a.order.order_number}</span>
          {(a.order.pickup || a.order.dropoff) && <> · {a.order.pickup ?? '—'} → {a.order.dropoff ?? '—'}</>}
          {a.current_trip_status && <span className="text-[#66736B]"> · trip now: {a.current_trip_status.replace(/_/g, ' ')}</span>}
        </p>
      )}

      {a.message && (
        <p className="mt-3 flex gap-2 rounded-xl bg-[#FAF7F0] px-3 py-2 text-sm text-[#1C2B22]">
          <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-[#66736B]" aria-hidden="true" /> “{a.message}”
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {a.location ? (
          <a href={mapsUrl(a.location.latitude, a.location.longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-[#E7E2D6] px-3 py-1.5 font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">
            <MapPin className="h-4 w-4 text-red-600" aria-hidden="true" /> Where the SOS was sent
            <span className="text-xs font-normal text-[#66736B]">{a.location.accuracy_m != null ? `±${Math.round(a.location.accuracy_m)} m · ` : ''}{a.location.source === 'rider_gps' ? 'rider GPS' : 'phone'}</span>
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-amber-800"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> No location was sent</span>
        )}
        {a.active && a.live_location && (
          <a href={mapsUrl(a.live_location.latitude, a.live_location.longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-[#E7E2D6] px-3 py-1.5 font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">
            <Navigation className="h-4 w-4 text-[#2E8B57]" aria-hidden="true" /> Live position (rider GPS)
            <span className="text-xs font-normal text-[#66736B]">{ago(a.live_location.at)}</span>
          </a>
        )}
        {a.active && <Link to={`${portal.route}/live/map`} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-medium text-[#2E8B57] hover:underline">Open Live Map</Link>}
      </div>

      <ol className="mt-4 space-y-1 border-l-2 border-[#E7E2D6] pl-4 text-sm text-[#3F4B43]" aria-label="What was done">
        <li>Raised {a.raised_at ? formatDateTime(a.raised_at) : ''}</li>
        {a.acknowledged_at && <li>Acknowledged by {a.acknowledged_by ?? 'the office'} · {formatDateTime(a.acknowledged_at)}</li>}
        {a.responding_at && <li>Help sent: <span className="font-semibold text-[#1C2B22]">{a.responder}</span>{a.response_note ? ` — ${a.response_note}` : ''} · {formatDateTime(a.responding_at)}</li>}
        {a.resolved_at && (
          <li>
            Resolved ({a.outcome === 'false_alarm' ? 'false alarm' : 'handled'}) by {a.resolved_by ?? 'the office'} · {formatDateTime(a.resolved_at)}
            {a.resolution_note && <span className="block text-[#66736B]">{a.resolution_note}</span>}
          </li>
        )}
      </ol>

      {act.isError && <p role="alert" className="mt-3 text-sm text-red-600">{apiErrorMessage(act.error, 'Could not save.')}</p>}

      {a.active && mode === 'view' && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {a.status === 'pending' && (
            <button type="button" onClick={() => act.mutate({ action: 'acknowledge' })} disabled={act.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
              {act.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" aria-hidden="true" />} Acknowledge
            </button>
          )}
          <button type="button" onClick={() => { setResponder(a.responder ?? ''); setMode('respond') }} className="rounded-xl border border-[#E7E2D6] px-4 py-2 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">
            {a.status === 'responding' ? 'Update help sent' : 'Send help'}
          </button>
          <button type="button" onClick={() => setMode('resolve')} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2E8B57] px-4 py-2 text-sm font-semibold text-white hover:bg-[#257347]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Resolve
          </button>
        </div>
      )}

      {mode === 'respond' && (
        <form
          className="mt-4 space-y-2 rounded-xl border border-[#E7E2D6] p-3"
          onSubmit={(e) => { e.preventDefault(); act.mutate({ action: 'respond', body: { responder: responder.trim(), note: note.trim() || undefined } }) }}
        >
          <label className="block text-sm font-semibold text-[#1C2B22]">
            Who was sent?
            <input value={responder} onChange={(e) => setResponder(e.target.value)} required minLength={2} maxLength={120} placeholder="e.g. PNP Bansud, MDRRMO ambulance" className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-2 text-sm font-normal outline-none focus:border-[#2E8B57]" />
          </label>
          <label className="block text-sm font-semibold text-[#1C2B22]">
            Note (optional)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="e.g. Patrol car leaving now, about 10 minutes away." className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-2 text-sm font-normal outline-none focus:border-[#2E8B57]" />
          </label>
          <FormButtons onCancel={() => setMode('view')} pending={act.isPending} submit="Save" />
        </form>
      )}

      {mode === 'resolve' && (
        <form
          className="mt-4 space-y-2 rounded-xl border border-[#E7E2D6] p-3"
          onSubmit={(e) => { e.preventDefault(); act.mutate({ action: 'resolve', body: { outcome, note: note.trim() } }) }}
        >
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 font-semibold text-[#1C2B22]">How did it end?</legend>
            <label className="flex items-center gap-2"><input type="radio" name={`outcome-${a.id}`} checked={outcome === 'handled'} onChange={() => setOutcome('handled')} className="accent-[#2E8B57]" /> Handled</label>
            <label className="flex items-center gap-2"><input type="radio" name={`outcome-${a.id}`} checked={outcome === 'false_alarm'} onChange={() => setOutcome('false_alarm')} className="accent-[#2E8B57]" /> False alarm</label>
          </fieldset>
          <label className="block text-sm font-semibold text-[#1C2B22]">
            What happened?
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} required minLength={3} maxLength={1000} placeholder="e.g. Called the passenger; they arrived safely." className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-2 text-sm font-normal outline-none focus:border-[#2E8B57]" />
          </label>
          <FormButtons onCancel={() => setMode('view')} pending={act.isPending} submit="Resolve" />
        </form>
      )}
    </article>
  )
}

function Person({ icon: Icon, title, name, phone, extra }: { icon: typeof User; title: string; name: string | null; phone: string | null; extra?: string }) {
  return (
    <div className="rounded-xl border border-[#F1EDE3] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#66736B]">{title}</p>
      <p className="mt-1 flex items-center gap-2 font-semibold text-[#1C2B22]"><Icon className="h-4 w-4 text-[#66736B]" aria-hidden="true" /> {name ?? 'Unknown'}</p>
      {extra && <p className="text-sm text-[#3F4B43]">{extra}</p>}
      {phone ? (
        <a href={`tel:${phone}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2E8B57] hover:underline"><Phone className="h-3.5 w-3.5" aria-hidden="true" /> {phone}</a>
      ) : <p className="mt-1 text-sm text-[#66736B]">No phone number on file</p>}
    </div>
  )
}

function FormButtons({ onCancel, pending, submit }: { onCancel: () => void; pending: boolean; submit: string }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-xl border border-[#E7E2D6] px-3 py-1.5 text-sm">Cancel</button>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} {submit}
      </button>
    </div>
  )
}
