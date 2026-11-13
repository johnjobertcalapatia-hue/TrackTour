import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, Wrench, X } from 'lucide-react'
import { get, post } from '@/shared/services/api'
import { cn } from '@/shared/utils'
import { isUsableGpsFix, MAX_SAVED_ACCURACY_M } from '@/features/rider/gps'
import TripPathView, { type TripPathStep } from '@/shared/components/TripPathView'

/**
 * Rider self-diagnostics (2026-11-10). "Run diagnostics" checks the phone
 * (internet, location) and the rider's server state (account, saved location,
 * status, current trip). "Fix problems" repairs what is safe to repair on the
 * server, sends a fresh GPS fix and reloads every rider screen, so the rider
 * can repeat the step that failed. Rules (50 m, food ready, payment) are never
 * skipped: those checks say what to do instead.
 */

export type CheckStatus = 'ok' | 'fixed' | 'warn' | 'needs_action' | 'info'

export interface DiagnosticCheck {
  key: string
  status: CheckStatus
  title: string
  message: string
}

interface TripDiagnosis {
  order_number: string
  path: TripPathStep[]
  next_step: string
  /** A recorded step the Tourism Office could reopen (riders can't). */
  reset_available: boolean
}

interface DiagnosticsResult {
  ok: boolean
  checks: DiagnosticCheck[]
  repaired: string[]
  /** The live trip's canonical path (null without a live delivery). */
  trip?: TripDiagnosis | null
}

export const OPEN_RIDER_DIAGNOSTICS_EVENT = 'rider:open-diagnostics'

/** Open the Diagnostics sheet from anywhere (e.g. under a trip error). */
export function openRiderDiagnostics() {
  window.dispatchEvent(new CustomEvent(OPEN_RIDER_DIAGNOSTICS_EVENT))
}

export function RunDiagnosticsLink({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openRiderDiagnostics}
      className={cn('mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#087F3F] underline underline-offset-2', className)}
    >
      <Wrench className="h-3.5 w-3.5" /> Run diagnostics
    </button>
  )
}

type Fix = { latitude: number; longitude: number; accuracy?: number }

function readDeviceFix(): Promise<{ fix: Fix | null; error: string | null }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      resolve({ fix: null, error: 'This phone or browser has no location service.' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        resolve(isUsableGpsFix(latitude, longitude)
          ? { fix: Number.isFinite(accuracy) ? { latitude, longitude, accuracy } : { latitude, longitude }, error: null }
          : { fix: null, error: 'Your phone reported an invalid location. Turn location off and on, then try again.' })
      },
      (err) => resolve({
        fix: null,
        error: err.code === 1
          ? 'Location permission is blocked. Allow location for this site in your browser settings.'
          : 'Could not get your location. Move to an open area and keep location on.',
      }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  })
}

function deviceChecks(online: boolean, gps: { fix: Fix | null; error: string | null } | null): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [
    online
      ? { key: 'internet', status: 'ok', title: 'Internet', message: 'Your phone is online.' }
      : { key: 'internet', status: 'needs_action', title: 'Internet', message: 'No internet connection. Turn on mobile data or Wi-Fi.' },
  ]
  if (gps) {
    const acc = gps.fix?.accuracy
    checks.push(!gps.fix
      ? { key: 'gps', status: 'needs_action', title: 'Phone GPS', message: gps.error ?? 'No location from your phone.' }
      : acc != null && acc > MAX_SAVED_ACCURACY_M
        ? { key: 'gps', status: 'warn', title: 'Phone GPS', message: `Your phone's location is not precise enough (±${Math.round(acc)} m; needs ${MAX_SAVED_ACCURACY_M} m or better). Move to an open area.` }
        : { key: 'gps', status: 'ok', title: 'Phone GPS', message: 'Your phone has a good location fix.' })
  }
  return checks
}

const STATUS_STYLE: Record<CheckStatus, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  ok: { icon: CheckCircle2, tone: 'text-emerald-600', label: 'OK' },
  fixed: { icon: CheckCircle2, tone: 'text-emerald-600', label: 'Fixed' },
  info: { icon: Info, tone: 'text-sky-600', label: 'Info' },
  warn: { icon: AlertTriangle, tone: 'text-amber-600', label: 'Check' },
  needs_action: { icon: AlertTriangle, tone: 'text-red-600', label: 'Problem' },
}

export default function RiderDiagnosticsSheet({
  isOpen,
  onClose,
  onFreshFix,
}: {
  isOpen: boolean
  onClose: () => void
  /** Called with the device fix sent during a repair, so the map updates at once. */
  onFreshFix?: (lat: number, lng: number) => void
}) {
  const queryClient = useQueryClient()
  const [checks, setChecks] = useState<DiagnosticCheck[]>([])
  const [trip, setTrip] = useState<TripDiagnosis | null>(null)
  const [running, setRunning] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runChecks = useCallback(async () => {
    setRunning(true)
    setError(null)
    setNotice(null)
    const gps = await readDeviceFix()
    const device = deviceChecks(navigator.onLine, gps)
    try {
      const result = await get<DiagnosticsResult>('/rider/diagnostics')
      setChecks([...device, ...result.checks])
      setTrip(result.trip ?? null)
    } catch {
      setChecks(device)
      setError('Could not reach the server. Check your internet and run diagnostics again.')
    } finally {
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) void runChecks()
    else { setChecks([]); setTrip(null); setNotice(null); setError(null) }
  }, [isOpen, runChecks])

  const fixProblems = async () => {
    setFixing(true)
    setError(null)
    setNotice(null)
    const gps = await readDeviceFix()
    try {
      const result = await post<DiagnosticsResult>('/rider/diagnostics/repair', gps.fix ?? {})
      if (gps.fix) onFreshFix?.(gps.fix.latitude, gps.fix.longitude)
      // Reload every rider screen from the server so stale buttons and
      // messages go away and the rider can repeat the step.
      await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('rider') })
      setChecks([...deviceChecks(navigator.onLine, gps), ...result.checks])
      setTrip(result.trip ?? null)
      setNotice(result.repaired.length > 0
        ? `Fixed ${result.repaired.length} problem${result.repaired.length === 1 ? '' : 's'}. You can try the step again.`
        : result.ok ? 'Nothing needed fixing. Everything looks fine.' : 'Nothing could be fixed automatically. Follow the steps marked below.')
    } catch {
      setError('The repair could not reach the server. Check your internet and try again.')
    } finally {
      setFixing(false)
    }
  }

  if (!isOpen) return null

  const problems = checks.filter((c) => c.status === 'needs_action' || c.status === 'warn').length

  return createPortal(
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rider-diagnostics-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[#fff] p-5 shadow-2xl sm:rounded-3xl"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="rider-diagnostics-title" className="text-lg font-bold text-[#17201B]">Diagnostics</h2>
          <button type="button" onClick={onClose} aria-label="Close diagnostics" className="rounded-full p-1.5 text-[#6B7280] hover:bg-[#F3F4F6]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {running && checks.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Checking your phone and account…</p>
        ) : (
          <ul className="max-h-[45vh] space-y-2 overflow-y-auto" aria-label="Diagnostic checks">
            {checks.map((c) => {
              const style = STATUS_STYLE[c.status] ?? STATUS_STYLE.info
              return (
                <li key={c.key} data-check={c.key} data-status={c.status} className="flex items-start gap-2.5 rounded-xl border border-[#E5E9E7] px-3 py-2.5">
                  <style.icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.tone)} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#17201B]">
                      {c.title} <span className={cn('ml-1 text-[11px] font-bold uppercase', style.tone)}>{style.label}</span>
                    </p>
                    <p className="text-xs leading-snug text-[#4B5563]">{c.message}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {trip && trip.path.length > 0 && (
          <div className="mt-3 rounded-xl border border-[#E5E9E7] px-3 py-2.5" role="region" aria-label="Trip steps">
            <p className="mb-1.5 text-sm font-semibold text-[#17201B]">Your trip · {trip.order_number}</p>
            <TripPathView path={trip.path} nextStep={trip.next_step} />
            {trip.reset_available && (
              <p className="mt-2 text-[11px] leading-snug text-[#6B7280]">
                If a step was recorded wrongly (for example your arrival), the Tourism Office can reopen it so you can do it again.
              </p>
            )}
          </div>
        )}

        {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void runChecks()}
            disabled={running || fixing}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#D1D5DB] px-3 py-2.5 text-sm font-semibold text-[#17201B] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', running && 'animate-spin')} /> Run again
          </button>
          <button
            type="button"
            onClick={() => void fixProblems()}
            disabled={running || fixing}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#087F3F] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            {problems > 0 ? 'Fix problems' : 'Re-sync'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
