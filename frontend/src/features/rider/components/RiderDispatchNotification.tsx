import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useRiderSocketReceiver } from '@/shared/hooks/useRiderSocketReceiver'
import RiderDeliveryRequestAlert, { type RiderDeliveryRequestData } from '@/features/rider/components/RiderDeliveryRequestAlert'
import NewBookingAlertDrawer from '@/features/rider/components/NewBookingAlertDrawer'

const TELEMETRY_SYNC_MS = 2000

type Phase = 'idle' | 'loading' | 'receipt'

export default function RiderDispatchNotification() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const riderOnline = user?.rider_status === 'online' || user?.rider_status === 'available'
  const [request, setRequest] = useState<RiderDeliveryRequestData | null>(null)
  const [showAccepted, setShowAccepted] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')

  const shownDeliveryId = useRef<number | null>(null)
  const telemetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const fetchPending = useCallback(async (): Promise<RiderDeliveryRequestData | null> => {
    try {
      const res = await get<{ request: RiderDeliveryRequestData | null }>('/rider/dispatch/pending-request')
      if (!res.request) return null
      return { ...res.request, initial_timeout: res.request.expires_in ?? 45 }
    } catch {
      return null
    }
  }, [])

  // Present an incoming request through the state machine timeline.
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

  // Register the rider with the socket radar and react to real-time order pings.
  useRiderSocketReceiver({
    riderId: user?.id ?? null,
    isOnline: riderOnline,
    vehicleType: user?.current_service ?? 'food',
    onOrderPing: async () => {
      const req = await fetchPending()
      presentRequest(req)
    },
  })

  useEffect(() => {
    if (!user?.id) return
    const poll = async () => {
      const req = await fetchPending()
      presentRequest(req)
    }
    poll()
    const interval = setInterval(poll, 4000)
    return () => {
      clearInterval(interval)
      clearTelemetryTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPending, user?.id])

  const acceptMutation = useMutation({
    mutationFn: () => patch('/rider/dispatch/accept', { delivery_id: request?.delivery_id }),
    onSuccess: () => {
      setShowAccepted(true)
      setRequest(null)
      setPhase('idle')
      shownDeliveryId.current = null
      queryClient.invalidateQueries({ queryKey: ['rider-dashboard'] })
      setTimeout(() => {
        setShowAccepted(false)
        navigate('/rider/map')
      }, 900)
    },
  })

  const declineMutation = useMutation({
    mutationFn: () => patch('/rider/dispatch/decline', { delivery_id: request?.delivery_id }),
    onSuccess: () => {
      setRequest(null)
      setPhase('idle')
      shownDeliveryId.current = null
      clearTelemetryTimer()
    },
  })

  const skipToReceipt = () => {
    clearTelemetryTimer()
    shownDeliveryId.current = request?.delivery_id ?? shownDeliveryId.current
    setPhase('receipt')
  }

  if (showAccepted) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-zinc-950/70 backdrop-blur-2xl rounded-t-[24px] p-8 max-w-[480px] w-full text-center border-t border-white/10 rider-request-sheet">
          <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircleIcon />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Order Accepted</h2>
          <p className="text-sm text-zinc-400">Starting navigation to the pickup location.</p>
        </div>
      </div>
    )
  }

  if (phase === 'loading') {
    return <NewBookingAlertDrawer isVisible onTransitionComplete={skipToReceipt} />
  }

  return (
    <RiderDeliveryRequestAlert
      orderData={phase === 'receipt' ? request : null}
      onAccept={() => acceptMutation.mutate()}
      onDecline={() => declineMutation.mutate()}
      acceptPending={acceptMutation.isPending}
      declinePending={declineMutation.isPending}
    />
  )
}

function CheckCircleIcon() {
  return (
    <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
