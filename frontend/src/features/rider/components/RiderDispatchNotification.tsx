import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { get, patch } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useRiderSocketReceiver } from '@/shared/hooks/useRiderSocketReceiver'
import RiderDeliveryRequestAlert, { type RiderDeliveryRequestData } from '@/features/rider/components/RiderDeliveryRequestAlert'
import RiderOffersPanel from '@/features/rider/components/RiderOffersPanel'
import NewBookingAlertDrawer from '@/features/rider/components/NewBookingAlertDrawer'

const TELEMETRY_SYNC_MS = 2000
const OFFERS_POLL_MS = 4000

type Phase = 'idle' | 'loading' | 'receipt'

export default function RiderDispatchNotification() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const riderOnline = user?.rider_status === 'online' || user?.rider_status === 'available'
  const [offers, setOffers] = useState<RiderDeliveryRequestData[]>([])
  const [request, setRequest] = useState<RiderDeliveryRequestData | null>(null)
  const [showAccepted, setShowAccepted] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [choosing, setChoosing] = useState(false)
  const [acceptingId, setAcceptingId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const shownDeliveryId = useRef<number | null>(null)
  const telemetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const offersRef = useRef<RiderDeliveryRequestData[]>([])
  offersRef.current = offers

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const clearTelemetryTimer = () => {
    if (telemetryTimer.current) {
      clearTimeout(telemetryTimer.current)
      telemetryTimer.current = null
    }
  }

  const scheduleReceipt = (deliveryId: number) => {
    clearTelemetryTimer()
    telemetryTimer.current = setTimeout(() => {
      shownDeliveryId.current = deliveryId
      setPhase('receipt')
    }, TELEMETRY_SYNC_MS)
  }

  // Authoritative (HTTP) list of the rider's LIVE offers. The socket is only a
  // hint; after a reconnect or a server restart this poll restores the state.
  const fetchOffers = useCallback(async (): Promise<RiderDeliveryRequestData[]> => {
    try {
      const res = await get<{ offers: RiderDeliveryRequestData[] }>('/rider/dispatch/offers')
      return (res?.offers ?? []).map((offer) => ({ ...offer, initial_timeout: offer.expires_in ?? 45 }))
    } catch {
      return []
    }
  }, [])

  const presentRequest = useCallback((req: RiderDeliveryRequestData | null) => {
    setRequest(req)
    if (!req) {
      setPhase('idle')
      shownDeliveryId.current = null
      clearTelemetryTimer()
      return
    }
    if (shownDeliveryId.current === req.delivery_id) {
      setPhase('receipt')
      return
    }
    setPhase('loading')
    scheduleReceipt(req.delivery_id ?? 0)
  }, [])

  // Reconcile the live offer list with the UI: one offer → the single alert
  // machine; many offers → the chooser panel; none → idle.
  const syncOffers = useCallback(async () => {
    const live = await fetchOffers()
    setOffers(live)

    if (live.length >= 2) {
      setRequest(null)
      setPhase('idle')
      clearTelemetryTimer()
      setChoosing(true)
      return
    }

    setChoosing(false)
    presentRequest(live[0] ?? null)
  }, [fetchOffers, presentRequest])

  // Register the rider with the socket radar: instant ping → HTTP refetch; an
  // offer cancelled elsewhere → drop it from the live list with a notice.
  useRiderSocketReceiver({
    riderId: user?.id ?? null,
    isOnline: riderOnline,
    vehicleType: user?.current_service ?? 'food',
    onOrderPing: async () => {
      // Master spec §57: browser-side ping/offer diagnostics.
      console.log('[Rider] order_received_ping received — fetching dispatch offers')
      const live = await fetchOffers()
      console.log('[Rider] dispatch offers received', live.length)
      setOffers(live)
      if (live.length >= 2) {
        setChoosing(true)
      } else {
        setChoosing(false)
        presentRequest(live[0] ?? null)
      }
    },
    onOfferCancelled: ({ delivery_id }) => {
      const hadIt = offersRef.current.some((o) => o.delivery_id === delivery_id)
      syncOffers()
      if (delivery_id && hadIt) {
        showToast('Another rider claimed this delivery — the offer is no longer available.', 'error')
      }
    },
    // Reconnect recovery: Socket.IO is not authoritative — after any
    // disconnect/server restart, re-sync the user (rider_status) over HTTP.
    onConnect: () => {
      void fetchUser()
    },
    // The backend cancelled our trip: it has already released rider_status,
    // so reconcile the store and refresh the active-trip view together.
    onTripCancelled: () => {
      void fetchUser()
      queryClient.invalidateQueries({ queryKey: ['rider-active-trip'] })
      queryClient.invalidateQueries({ queryKey: ['rider-map-location'] })
    },
  })

  useEffect(() => {
    if (!user?.id) return
    syncOffers()
    const interval = setInterval(syncOffers, OFFERS_POLL_MS)
    return () => {
      clearInterval(interval)
      clearTelemetryTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOffers, user?.id])

  const resetToIdle = useCallback(() => {
    setRequest(null)
    setPhase('idle')
    setChoosing(false)
    setAcceptingId(null)
    shownDeliveryId.current = null
    clearTelemetryTimer()
  }, [])

  const acceptMutation = useMutation({
    mutationFn: (deliveryId: number) => patch('/rider/dispatch/accept', { delivery_id: deliveryId }),
    onSuccess: async () => {
      // The backend sets rider_status='busy' atomically with the assignment,
      // and the accept payload carries no rider_status — so reconcile the user
      // from the server instead of assuming the new state locally. This is what
      // stops the UI from offering "Go Offline" (and a guaranteed 409) while
      // the rider is genuinely busy.
      void fetchUser()
      setShowAccepted(true)
      resetToIdle()
      setOffers([])
      queryClient.invalidateQueries({ queryKey: ['rider-dashboard'] })
      setTimeout(async () => {
        setShowAccepted(false)
        navigate('/rider/map')
      }, 900)
    },
    onError: (error) => {
      const err = error as { response?: { status?: number; data?: { message?: string } } }
      const status = err.response?.status
      const message = err.response?.data?.message
      setAcceptingId(null)
      if (status === 409) {
        // Conflict: expired, already claimed, or rider already on a trip.
        showToast(message || 'This offer is no longer available — it may have been claimed already.', 'error')
        syncOffers()
        return
      }
      if (status === 422) {
        // Ineligibility (e.g. COD limit): the offer itself may still be fine,
        // so keep it listed and just surface the backend's reason.
        showToast(message || 'You are not eligible for this delivery.', 'error')
        return
      }
      showToast(message || 'Failed to accept the delivery. Please try again.', 'error')
    },
  })

  const handleAccept = (offer: RiderDeliveryRequestData) => {
    const deliveryId = offer.delivery_id
    if (!deliveryId) return
    setAcceptingId(deliveryId)
    acceptMutation.mutate(deliveryId)
  }

  // Auto accept — while the rider's server-side preference (rider_details.
  // auto_accept) is ON and they are online, take the FIRST ping that arrives
  // (earliest dispatched_at) through the very same atomic accept endpoint the
  // manual button uses, so every backend rule still applies unchanged: offer
  // expiry, one active delivery per rider, COD eligibility, 409 conflicts.
  //
  // A delivery that was already auto-accept-attempted is remembered so a
  // rejected attempt (409 claimed / 422 ineligible) degrades to the normal
  // manual flow instead of looping on every 4s poll.
  const autoAcceptTried = useRef<Set<number>>(new Set())
  // react-query's `mutate` is identity-stable, so keeping it (and the boolean
  // pending flag) as the deps stops this from re-running on every render.
  const acceptDelivery = acceptMutation.mutate
  const acceptPending = acceptMutation.isPending

  useEffect(() => {
    if (offers.length === 0) {
      autoAcceptTried.current.clear()
      return
    }
    if (!user?.auto_accept || !riderOnline) return
    if (acceptPending || showAccepted) return

    // Offers arrive ordered by dispatched_at ascending (first ping first);
    // re-derive it here so the intent survives any future ordering change.
    const firstPing = offers.reduce<RiderDeliveryRequestData | null>((earliest, offer) => {
      if (!offer.delivery_id) return earliest
      if (!earliest?.delivery_id) return offer
      const candidate = Date.parse(offer.dispatched_at ?? '')
      const current = Date.parse(earliest.dispatched_at ?? '')
      if (Number.isNaN(candidate) || Number.isNaN(current)) return earliest
      return candidate < current ? offer : earliest
    }, null)

    if (!firstPing?.delivery_id) return
    if (autoAcceptTried.current.has(firstPing.delivery_id)) return

    autoAcceptTried.current.add(firstPing.delivery_id)
    setAcceptingId(firstPing.delivery_id)
    acceptDelivery(firstPing.delivery_id)
  }, [offers, user?.auto_accept, riderOnline, acceptPending, showAccepted, acceptDelivery])

  const declineMutation = useMutation({
    mutationFn: () => patch('/rider/dispatch/decline', { delivery_id: request?.delivery_id }),
    onSuccess: () => {
      resetToIdle()
    },
  })

  const skipToReceipt = () => {
    clearTelemetryTimer()
    shownDeliveryId.current = request?.delivery_id ?? shownDeliveryId.current
    setPhase('receipt')
  }

  return (
    <>
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000]">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium animate-slide-up ${
              toast.type === 'success'
                ? 'bg-emerald-600 border-emerald-700 text-white'
                : 'bg-red-600 border-red-700 text-white'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {showAccepted ? (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-950/70 backdrop-blur-2xl rounded-t-[24px] p-8 max-w-[480px] w-full text-center border-t border-white/10 rider-request-sheet">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircleIcon />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Order Accepted</h2>
            <p className="text-sm text-zinc-400">Starting navigation to the pickup location.</p>
          </div>
        </div>
      ) : choosing && offers.length >= 2 ? (
        <RiderOffersPanel offers={offers} onAccept={handleAccept} acceptDeliveryId={acceptingId} />
      ) : phase === 'loading' ? (
        <NewBookingAlertDrawer isVisible onTransitionComplete={skipToReceipt} />
      ) : (
        <RiderDeliveryRequestAlert
          orderData={phase === 'receipt' ? request : null}
          onAccept={() => request && handleAccept(request)}
          onDecline={() => declineMutation.mutate()}
          acceptPending={acceptMutation.isPending}
          declinePending={declineMutation.isPending}
        />
      )}
    </>
  )
}

function CheckCircleIcon() {
  return (
    <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}