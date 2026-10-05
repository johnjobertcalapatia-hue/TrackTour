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
      const live = await fetchOffers()
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
      const status = (error as { response?: { status?: number } }).response?.status
      setAcceptingId(null)
      if (status === 409) {
        // Out-of-date accept: expired, already claimed, or already active.
        showToast('This offer is no longer available — it may have been claimed already.', 'error')
        syncOffers()
        return
      }
      showToast('Failed to accept the delivery. Please try again.', 'error')
    },
  })

  const handleAccept = (offer: RiderDeliveryRequestData) => {
    const deliveryId = offer.delivery_id
    if (!deliveryId) return
    setAcceptingId(deliveryId)
    acceptMutation.mutate(deliveryId)
  }

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