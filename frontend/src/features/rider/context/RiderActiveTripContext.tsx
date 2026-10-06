import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, patch, apiErrorMessage } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { resolvePickupGate, isArrivalDismissed, markArrivalDismissed } from '@/features/rider/gating'
import { resolveStopArrival } from '@/features/rider/stop-arrival'
import type { PickupStopsData } from '@/features/rider/pickup-stops'
import type { Delivery } from '@/shared/types'

export type TripState =
  | 'EN_ROUTE_TO_PICKUP'
  | 'ARRIVED_AT_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'ARRIVED_AT_DROP'
  | 'COMPLETED'
  | 'IDLE'

export interface TripDelivery {
  id: number
  order_id: number
  status: string
  pickup_address: string
  pickup_lat: number | null
  pickup_lng: number | null
  delivery_address: string
  delivery_lat: number | null
  delivery_lng: number | null
  business_name?: string | null
}

export type ArrivalAlertKind = 'PICKUP' | 'DROPOFF' | null

interface RiderLocation {
  latitude: number
  longitude: number
}

export interface RiderTripLocationData {
  rider: RiderLocation
  deliveries: Array<TripDelivery & { status: string }>
}

const GEOFENCE_METERS = 100
const ACTIVE_STATUSES = ['assigned', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination']

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface RiderActiveTripContextValue {
  activeDelivery: TripDelivery | null
  tripState: TripState
  riderPosition: [number, number]
  setRiderPosition: (lat: number, lng: number) => void
  arrivalAlert: ArrivalAlertKind
  dismissArrivalAlert: () => void
  busy: boolean
  actionError: string | null
  pickupGateBlocked: boolean
  pickupGateMessage: string | null
  onArrivedPickup: () => void
  onMarkPickedUp: () => void
  onArrivedDrop: () => void
  onConfirmDelivery: () => void
  /** Unified pickup-stops payload for the assigned delivery (COD + prepaid). */
  pickupStopsData: PickupStopsData | null
  confirmPickupStop: (businessId: number) => void
  confirmStopBusy: boolean
  confirmStopError: string | null
  /** A delivered-but-unsettled COD delivery awaiting the Payment settled step. */
  pendingSettlement: { deliveryId: number; orderId: number; cashDue: number | null } | null
  settleCod: (cashReceived: number) => void
  settleBusy: boolean
  settleError: string | null
  /**
   * The per-stop "Confirm Item Pickup" appearing message. Derived purely from
   * the rider's live position + the authoritative stops payload: non-null only
   * while the rider is within the pickup radius of the current (next
   * unconfirmed) stop AND that restaurant's items are READY. Powers the global
   * alert so the Order details sheet can stay view-only.
   */
  pickupStopPrompt: PickupStopPrompt | null
  /**
   * True once every pickup stop has been collected while the delivery is still
   * in the pickup stage. Lets the global alert keep surfacing the final
   * "I Picked Up the Food" confirm even if the one-shot arrival alert was
   * dismissed earlier — the sheet (now view-only) no longer holds a fallback.
   */
  pickupComplete: boolean
}

export interface PickupStopPrompt {
  deliveryId: number
  businessId: number
  businessName: string | null
  sequence: number
  totalStops: number
  distanceMeters: number | null
}

export const RiderActiveTripContext = createContext<RiderActiveTripContextValue | null>(null)

export function useRiderActiveTrip(): RiderActiveTripContextValue {
  const ctx = useContext(RiderActiveTripContext)
  if (!ctx) {
    throw new Error('useRiderActiveTrip must be used within RiderActiveTripProvider')
  }
  return ctx
}

export function RiderActiveTripProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const fetchUser = useAuthStore((state) => state.fetchUser)
  const [riderPosition, setRiderPositionState] = useState<[number, number]>([12.8667, 121.45])
  const [arrivalAlert, setArrivalAlert] = useState<ArrivalAlertKind>(null)
  // Optimistic status override: while a pickup-confirm PATCH is in flight (or
  // has succeeded but the authoritative poll has not caught up yet), tripState
  // is derived from this so the map draws the drop-off route the INSTANT the
  // rider confirms pickup instead of waiting up to a refetch round-trip.
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null)
  const lastAlertStatus = useRef<string | null>(null)

  const setRiderPosition = useCallback((lat: number, lng: number) => {
    setRiderPositionState([lat, lng])
  }, [])

  const { data } = useQuery({
    queryKey: ['rider-map-location'],
    queryFn: async () => (await get<RiderTripLocationData>('/rider/map/location')) ?? {} as RiderTripLocationData,
    refetchInterval: 10000,
    retry: false,
    staleTime: 5000,
    enabled: !!user?.id,
  })

  const locationMutation = useMutation({
    mutationFn: (location: RiderLocation) => post('/rider/map/location', location),
  })

  const arrivalsRefetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['rider-active-trip'] })
    queryClient.invalidateQueries({ queryKey: ['rider-map-location'] })
  }, [queryClient])

  const arrivedPickupMutation = useMutation({
    mutationFn: (id: number) => patch(`/rider/deliveries/${id}/status`, { status: 'arrived_pickup' }),
    onSuccess: arrivalsRefetch,
  })
  const pickupMutation = useMutation({
    mutationFn: (id: number) => patch(`/rider/deliveries/${id}/status`, { status: 'picked_up' }),
    onMutate: () => setOptimisticStatus('picked_up'),
    onSuccess: () => {
      lastAlertStatus.current = 'picked_up'
      setArrivalAlert(null)
      arrivalsRefetch()
    },
    onError: () => setOptimisticStatus(null),
  })
  const arrivedDropMutation = useMutation({
    mutationFn: (id: number) => patch(`/rider/deliveries/${id}/status`, { status: 'arrived_destination' }),
    onSuccess: arrivalsRefetch,
  })
  const completeMutation = useMutation({
    mutationFn: (id: number) => patch(`/rider/deliveries/${id}/status`, { status: 'delivered' }),
    onSuccess: () => {
      lastAlertStatus.current = 'delivered'
      setArrivalAlert(null)
      arrivalsRefetch()
    },
  })

  const activeDelivery = useMemo(() => {
    const list = data?.deliveries ?? []
    return list.find((d) => ACTIVE_STATUSES.includes(d.status)) as TripDelivery | null
  }, [data])

  // Pickup gate. Reads the unified /pickup-stops payload (served for COD and
  // prepaid group orders alike), which shares the same cache key as the
  // purchasing panel on /rider/map, so no duplicate requests fire when the map
  // is mounted. Until the data resolves the gate stays OPEN (the backend remains
  // authoritative and rejects a premature `picked_up` with a 422 whose message
  // we surface via actionError). Stops-bearing deliveries stay blocked until
  // every restaurant stop is confirmed.
  const isPickupStage = !!activeDelivery && ['assigned', 'arrived_pickup'].includes(activeDelivery.status)

  const pickupStopsQuery = useQuery({
    queryKey: ['rider-delivery-pickup-stops', activeDelivery?.id],
    queryFn: async () => {
      if (!activeDelivery) return null
      return (await get<PickupStopsData>(`/rider/deliveries/${activeDelivery.id}/pickup-stops`)) ?? null
    },
    enabled: !!activeDelivery && isPickupStage,
    refetchInterval: 10000,
    staleTime: 5000,
  })
  const { data: pickupStopsData } = pickupStopsQuery

  const pickupGate = resolvePickupGate({
    isPickupStage,
    hasStops: (pickupStopsData?.stops?.length ?? 0) > 0,
    fullyCollected: pickupStopsData?.fully_collected ?? false,
    stopsLoaded: pickupStopsQuery.isSuccess,
  })

  // The single canonical per-restaurant "Confirm Item Pickup" action. The
  // backend enforces the gate (current stop + within pickup radius + restaurant
  // READY); the response refreshes the leg so the next stop advances.
  const confirmStopMutation = useMutation({
    mutationFn: (businessId: number) =>
      post(`/rider/deliveries/${activeDelivery!.id}/pickup-stops/${businessId}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-delivery-pickup-stops', activeDelivery?.id] })
    },
  })

  // The per-stop "Confirm Item Pickup" appearing message. This is the message
  // the rider confirms each restaurant with (the Order details sheet is
  // view-only). It appears exactly when the backend gate would allow it:
  // pickup stage + rider within the arrival radius of the current unconfirmed
  // stop + that restaurant's items are READY. Derived (not one-shot) so it
  // naturally re-targets the next stop after each confirm and disappears once
  // every stop is collected.
  const pickupStopPrompt = useMemo<PickupStopPrompt | null>(() => {
    if (!isPickupStage || !activeDelivery || !pickupStopsData) return null
    const stops = pickupStopsData.stops ?? []
    if (stops.length === 0 || pickupStopsData.fully_collected) return null

    const { activeStop, distanceMeters, arrived } = resolveStopArrival({
      riderLatitude: riderPosition[0],
      riderLongitude: riderPosition[1],
      stops: stops.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        status: stop.status,
        latitude: stop.pickup_lat,
        longitude: stop.pickup_lng,
        business_name: stop.business_name,
      })),
    })

    if (!activeStop || !arrived) return null
    const current = stops.find((stop) => stop.id === activeStop.id)
    if (!current?.is_ready) return null

    return {
      deliveryId: activeDelivery.id,
      businessId: current.business_id,
      businessName: current.business_name,
      sequence: current.sequence,
      totalStops: stops.length,
      distanceMeters,
    }
  }, [isPickupStage, activeDelivery, pickupStopsData, riderPosition])

  // Every stop collected (while still in the pickup stage). Used by the global
  // alert to keep the final "I Picked Up the Food" confirm available even when
  // the one-shot arrival alert was dismissed before the last stop was confirmed.
  const pickupComplete =
    isPickupStage && (pickupStopsData?.fully_collected ?? false) && (pickupStopsData?.stops?.length ?? 0) > 0

  // "Payment settled?" — the map polls /rider/deliveries/active, which keeps a
  // COD delivery at `delivered` (cash collected but NOT settled) visible. A
  // delivered COD surfaces the inline cash step; settling it releases the rider.
  // Prepaid deliveries are completed by the backend the moment `delivered` is
  // confirmed, so they never appear here.
  const { data: activeDeliveriesData } = useQuery({
    queryKey: ['rider-deliveries-active'],
    queryFn: async () => (await get<{ data: Delivery[] }>('/rider/deliveries/active')) ?? { data: [] },
    enabled: !!user?.id,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  const pendingSettlement = useMemo(() => {
    const delivered = (activeDeliveriesData?.data ?? []).find(
      (d) => d.status === 'delivered' && d.is_cod
    )
    if (!delivered) return null
    return {
      deliveryId: delivered.id,
      orderId: delivered.order_id,
      cashDue: delivered.cash_due ?? null,
    }
  }, [activeDeliveriesData])

  const settleCodMutation = useMutation({
    mutationFn: ({ deliveryId, cashReceived }: { deliveryId: number; cashReceived: number }) =>
      post(`/rider/deliveries/${deliveryId}/settle-cod`, { cash_received: cashReceived }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-deliveries-active'] })
      queryClient.invalidateQueries({ queryKey: ['rider-map-location'] })
      // Settling the last COD delivery ends the trip on the backend — reconcile
      // rider_status from the server instead of assuming it.
      void fetchUser()
    },
  })

  // Trip-end reconciliation: whenever an active trip disappears from the
  // authoritative poll (cancelled, completed, or settled elsewhere), the
  // backend has already released rider_status — so re-sync the store from
  // the server instead of assuming it. HTTP is the sanctioned recovery path
  // (the socket `trip_cancelled` listener is the low-latency twin of this).
  const hadActiveTripRef = useRef(false)
  useEffect(() => {
    if (activeDelivery) {
      hadActiveTripRef.current = true
      return
    }
    if (!hadActiveTripRef.current) return
    hadActiveTripRef.current = false
    void fetchUser()
  }, [activeDelivery, fetchUser])

  const nearPickup =
    activeDelivery?.pickup_lat != null && activeDelivery?.pickup_lng != null
      ? haversineMeters(riderPosition[0], riderPosition[1], activeDelivery.pickup_lat, activeDelivery.pickup_lng) <=
        GEOFENCE_METERS
      : false

  const nearDropoff =
    activeDelivery?.delivery_lat != null && activeDelivery?.delivery_lng != null
      ? haversineMeters(riderPosition[0], riderPosition[1], activeDelivery.delivery_lat, activeDelivery.delivery_lng) <=
        GEOFENCE_METERS
      : false

  const effectiveStatus = optimisticStatus ?? activeDelivery?.status

  const tripState: TripState = !activeDelivery
    ? 'IDLE'
    : effectiveStatus === 'assigned'
      ? (nearPickup ? 'ARRIVED_AT_PICKUP' : 'EN_ROUTE_TO_PICKUP')
      : effectiveStatus === 'arrived_pickup'
        ? 'ARRIVED_AT_PICKUP'
        : effectiveStatus === 'picked_up' || effectiveStatus === 'in_transit' || effectiveStatus === 'arrived_destination'
          ? (nearDropoff ? 'ARRIVED_AT_DROP' : 'OUT_FOR_DELIVERY')
          : 'COMPLETED'

  // Reconcile the optimistic pickup against the authoritative status: clear it
  // once the server poll actually reflects the pickup (or the trip ended), so
  // tripState keeps pointing at OUT_FOR_DELIVERY with no gap in between.
  useEffect(() => {
    if (!optimisticStatus) return
    const settled =
      !activeDelivery ||
      ['picked_up', 'in_transit', 'arrived_destination', 'delivered', 'completed'].includes(activeDelivery.status)
    if (settled) setOptimisticStatus(null)
  }, [optimisticStatus, activeDelivery])

  // Fire the global arrival alert exactly once per arrival transition.
  // - PICKUP: only once the pickup point has actually been reached (backend
  //   confirmed `arrived_pickup`).
  // - DROPOFF: only once the package has been picked up (pickup confirmed) AND
  //   the rider's location is within the 50m drop-off geofence. Anything else
  //   keeps the drop-off alert hidden.
  useEffect(() => {
    if (!activeDelivery) return
    const status = activeDelivery.status
    const pickupConfirmed = ['picked_up', 'in_transit'].includes(status)

    // DROPOFF is server-authoritative: it fires once the backend has confirmed
    // arrival (`arrived_destination`). Relying on the transient client-side
    // `nearDropoff` alone is fragile because the rider's GPS position can lag or
    // jitter just outside the geofence in the same tick that the server flips
    // the status, causing the alert to be skipped. `nearDropoff` is kept only as
    // a fallback so the alert can still fire if the frontend tracks the rider
    // inside the geofence before the backend has had a chance to confirm.
    if (status === 'arrived_pickup' && lastAlertStatus.current !== 'arrived_pickup') {
      // Always record the leg; only surface the alert if the rider has not
      // already dismissed it. Persisted dismissal means a page refresh (which
      // clears lastAlertStatus) does not re-prompt the same pickup card.
      lastAlertStatus.current = 'arrived_pickup'
      if (!isArrivalDismissed(activeDelivery.id, 'PICKUP')) {
        setArrivalAlert('PICKUP')
      }
    } else if (
      lastAlertStatus.current !== 'arrived_destination' &&
      (status === 'arrived_destination' || (pickupConfirmed && nearDropoff))
    ) {
      lastAlertStatus.current = 'arrived_destination'
      setArrivalAlert('DROPOFF')
    } else if (!ACTIVE_STATUSES.includes(status) && lastAlertStatus.current !== null) {
      lastAlertStatus.current = null
      setArrivalAlert(null)
    }
  }, [activeDelivery, nearDropoff])

  // Also nudge the backend when arriving at a geofence so the authoritative
  // proximity controller transitions the status (keeps server truth in sync).
  useEffect(() => {
    if (user?.id && nearPickup && activeDelivery?.status === 'assigned' && locationMutation.isIdle) {
      locationMutation.mutate({ latitude: riderPosition[0], longitude: riderPosition[1] })
    }
  }, [nearPickup]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user?.id && nearDropoff && (activeDelivery?.status === 'picked_up' || activeDelivery?.status === 'in_transit') && locationMutation.isIdle) {
      locationMutation.mutate({ latitude: riderPosition[0], longitude: riderPosition[1] })
    }
  }, [nearDropoff]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismissArrivalAlert = useCallback(() => {
    if (activeDelivery && arrivalAlert) markArrivalDismissed(activeDelivery.id, arrivalAlert)
    setArrivalAlert(null)
  }, [activeDelivery, arrivalAlert])

  const busy =
    arrivedPickupMutation.isPending ||
    pickupMutation.isPending ||
    arrivedDropMutation.isPending ||
    completeMutation.isPending

  const actionError =
    (arrivedPickupMutation.isError ? apiErrorMessage(arrivedPickupMutation.error) : null) ||
    (pickupMutation.isError ? apiErrorMessage(pickupMutation.error) : null) ||
    (arrivedDropMutation.isError ? apiErrorMessage(arrivedDropMutation.error) : null) ||
    (completeMutation.isError ? apiErrorMessage(completeMutation.error) : null)

  const value: RiderActiveTripContextValue = {
    activeDelivery,
    tripState,
    riderPosition,
    setRiderPosition,
    arrivalAlert,
    dismissArrivalAlert,
    busy,
    actionError,
    pickupGateBlocked: pickupGate.blocked,
    pickupGateMessage: pickupGate.message,
    onArrivedPickup: () => activeDelivery && arrivedPickupMutation.mutate(activeDelivery.id),
    onMarkPickedUp: () => {
      if (activeDelivery && !pickupGate.blocked) pickupMutation.mutate(activeDelivery.id)
    },
    onArrivedDrop: () => activeDelivery && arrivedDropMutation.mutate(activeDelivery.id),
    onConfirmDelivery: () => activeDelivery && completeMutation.mutate(activeDelivery.id),
    pickupStopsData: pickupStopsData ?? null,
    confirmPickupStop: (businessId) => {
      if (activeDelivery) confirmStopMutation.mutate(businessId)
    },
    confirmStopBusy: confirmStopMutation.isPending,
    confirmStopError: confirmStopMutation.isError ? apiErrorMessage(confirmStopMutation.error) : null,
    pickupStopPrompt,
    pickupComplete,
    pendingSettlement,
    settleCod: (cashReceived) => {
      if (pendingSettlement) settleCodMutation.mutate({ deliveryId: pendingSettlement.deliveryId, cashReceived })
    },
    settleBusy: settleCodMutation.isPending,
    settleError: settleCodMutation.isError ? apiErrorMessage(settleCodMutation.error) : null,
  }

  return <RiderActiveTripContext.Provider value={value}>{children}</RiderActiveTripContext.Provider>
}
