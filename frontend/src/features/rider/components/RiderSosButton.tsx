import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ShieldAlert } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import HoldToSendButton from '@/shared/components/HoldToSendButton'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import SosStatusCard from '@/features/sos/SosStatusCard'
import type { SenderSos } from '@/features/sos/sos'

/**
 * Rider SOS (2026-11-18): on every rider screen while a trip (ride or food)
 * is active. Hold 3 seconds → alerts the Bansud Tourism Office with the
 * rider's location. The customer is never told.
 *
 * `inline`: on the live map it sits in the top-left stack under Orders; the
 * floating bottom-right copy (mounted for every rider page) steps aside there
 * so the button never covers the rider sheet.
 */
export default function RiderSosButton({ inline = false }: { inline?: boolean }) {
  const { pathname } = useLocation()
  const { activeDelivery, riderPosition, positionKnown } = useRiderActiveTrip()
  const queryClient = useQueryClient()
  const deliveryId = activeDelivery?.id
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const key = ['rider-sos', deliveryId]

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => get<{ sos: SenderSos | null }>(`/rider/deliveries/${deliveryId}/sos`),
    enabled: !!deliveryId,
    refetchInterval: (q) => ((q.state.data as { sos: SenderSos | null } | undefined)?.sos?.active ? 10_000 : false),
  })
  const sos = data?.sos ?? null

  const send = useMutation({
    // The server falls back to the rider's recent GPS when the position isn't known yet.
    mutationFn: () => post(`/rider/deliveries/${deliveryId}/sos`, positionKnown ? { latitude: riderPosition[0], longitude: riderPosition[1] } : {}),
    onSuccess: () => {
      setError(null)
      setOpen(true)
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (e) => setError(apiErrorMessage(e, 'The SOS could not be sent. Call 911 if you are in danger.')),
  })
  const safe = useMutation({
    mutationFn: () => post(`/rider/deliveries/${deliveryId}/sos/safe`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  if (!deliveryId) return null
  // The live map shows the inline button instead.
  if (!inline && pathname === '/rider/map') return null

  const wrap = inline
    ? 'relative z-[2500] flex flex-col items-start gap-2'
    : 'fixed bottom-24 right-3 z-[2500] flex flex-col items-end gap-2'

  if (sos?.active) {
    return (
      <div className={inline ? 'relative z-[2500] w-[min(20rem,calc(100vw-1.5rem))]' : 'fixed bottom-24 right-3 z-[2500] w-[min(22rem,calc(100vw-1.5rem))]'}>
        {open ? (
          <div className="rounded-2xl bg-white shadow-2xl">
            <SosStatusCard sos={sos} onSafe={() => safe.mutate()} safePending={safe.isPending} />
            <button type="button" onClick={() => setOpen(false)} className="flex w-full items-center justify-center gap-1 py-1.5 text-xs font-medium text-[#56615B]">
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> Hide
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className={`${inline ? '' : 'ml-auto '}flex items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-xl`}>
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> SOS active
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={wrap}>
      {error && <p role="alert" className="max-w-[16rem] rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow">{error}</p>}
      <HoldToSendButton
        ariaLabel="SOS: hold for 3 seconds to alert the Tourism Office"
        onComplete={() => send.mutate()}
        disabled={send.isPending}
        holdingLabel="Hold"
        className={inline
          ? 'h-10 min-w-[4.5rem] rounded-full bg-red-600 px-4 text-sm font-bold text-white shadow-lg ring-2 ring-white disabled:opacity-70'
          : 'h-12 min-w-[4.5rem] rounded-full bg-red-600 px-4 text-sm font-bold text-white shadow-xl disabled:opacity-70'}
        label={<><ShieldAlert className="h-4 w-4" aria-hidden="true" /> {send.isPending ? 'Sending…' : 'SOS'}</>}
      />
    </div>
  )
}
