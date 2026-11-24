import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Siren } from 'lucide-react'
import { get } from '@/shared/services/api'

export interface SosSummary {
  active: number
  pending: number
  latest_pending: { id: number; reference: string; raised_by_role: 'tourist' | 'rider'; service: 'ride' | 'food'; name: string | null; raised_at: string | null } | null
}

export const SOS_SUMMARY_KEY = ['admin-sos-summary']

/** Polled every 5 s; shared by the alarm banner and the sidebar badge. */
export function useSosSummary() {
  return useQuery({
    queryKey: SOS_SUMMARY_KEY,
    queryFn: () => get<SosSummary>('/admin/live/sos/summary'),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })
}

/** A short two-tone alarm; browsers may block sound until the page was clicked once. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[880, 660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.value = 0.15
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.25)
      osc.stop(ctx.currentTime + i * 0.25 + 0.2)
    })
    setTimeout(() => ctx.close().catch(() => {}), 1200)
  } catch {
    /* no sound available */
  }
}

/**
 * SOS alarm (2026-11-18): a red banner on every admin page while an SOS is
 * waiting for the office, with a sound when a new one arrives. Hidden on the
 * SOS Alerts page itself.
 */
export default function AdminSosAlarm() {
  const { pathname } = useLocation()
  const { data } = useSosSummary()
  const pending = data?.pending ?? 0
  const last = useRef<number | null>(null)

  useEffect(() => {
    if (last.current !== null && pending > last.current) beep()
    last.current = pending
  }, [pending])

  if (!pending || pathname.startsWith('/admin/live/sos')) return null
  const latest = data?.latest_pending

  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-red-600 px-4 py-3 text-white shadow-lg">
      <span className="relative flex h-3 w-3" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
      </span>
      <Siren className="h-5 w-5" aria-hidden="true" />
      <p className="flex-1 text-sm font-semibold">
        SOS: {latest?.name ?? 'Someone'} ({latest?.raised_by_role === 'rider' ? 'rider' : 'tourist'}, {latest?.service === 'food' ? 'food delivery' : 'ride'}) needs help.
        {pending > 1 && <span className="font-normal"> {pending} alerts are waiting.</span>}
      </p>
      <Link to="/admin/live/sos" className="rounded-xl bg-white px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50">Open SOS Alerts</Link>
    </div>
  )
}
