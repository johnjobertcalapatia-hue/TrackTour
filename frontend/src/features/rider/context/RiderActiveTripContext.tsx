import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, patch } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'

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
  onArrivedPickup: () => void
  onMarkPickedUp: () => void
  onArrivedDrop: () => void
  onConfirmDelivery: () => void
}

const RiderActiveTripContext = createContext<RiderActiveTripContextValue | null>(null)

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
    onSuccess: (id) => {
      lastAlertStatus.current = 'picked_up'
      setArrivalAlert(null)
      arrivalsRefetch()
    },
  })
  const arrivedDropMutation = useMutation({
    mutationFn: (id: number) => patch(`/rider/deliveries/${id}/status`, { status: 'arrived_destination' }),
    onSuccess: arrivalsRefetch,
  })
  const completeMutation = useMutation({
    mutationFn: (id: number) => patch(`/rider/deliveries/${id}/status`, { status: 'delivered' }),
    onSuccess: (id) => {
      lastAlertStatus.current = 'delivered'
      setArrivalAlert(null)
      arrivalsRefetch()
    },
  })

  const activeDelivery = useMemo(() => {
    const list = data?.deliveries ?? []
    return list.find((d) => ACTIVE_STATUSES.includes(d.status)) as TripDelivery | null
  }, [data])

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

  const tripState: TripState = !activeDelivery
    ? 'IDLE'
    : activeDelivery.status === 'assigned'
      ? (nearPickup ? 'ARRIVED_AT_PICKUP' : 'EN_ROUTE_TO_PICKUP')
      : activeDelivery.status === 'arrived_pickup'
        ? 'ARRIVED_AT_PICKUP'
        : activeDelivery.status === 'picked_up' || activeDelivery.status === 'in_transit' || activeDelivery.status === 'arrived_destination'
          ? (nearDropoff ? 'ARRIVED_AT_DROP' : 'OUT_FOR_DELIVERY')
          : 'COMPLETED'

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
      lastAlertStatus.current = 'arrived_pickup'
      setArrivalAlert('PICKUP')
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

  const dismissArrivalAlert = useCallback(() => setArrivalAlert(null), [])

  const busy =
    arrivedPickupMutation.isPending ||
    pickupMutation.isPending ||
    arrivedDropMutation.isPending ||
    completeMutation.isPending

  const actionError =
    (arrivedPickupMutation.isError ? (arrivedPickupMutation.error as Error)?.message : null) ||
    (pickupMutation.isError ? (pickupMutation.error as Error)?.message : null) ||
    (arrivedDropMutation.isError ? (arrivedDropMutation.error as Error)?.message : null) ||
    (completeMutation.isError ? (completeMutation.error as Error)?.message : null)

  const value: RiderActiveTripContextValue = {
    activeDelivery,
    tripState,
    riderPosition,
    setRiderPosition,
    arrivalAlert,
    dismissArrivalAlert,
    busy,
    actionError,
    onArrivedPickup: () => activeDelivery && arrivedPickupMutation.mutate(activeDelivery.id),
    onMarkPickedUp: () => activeDelivery && pickupMutation.mutate(activeDelivery.id),
    onArrivedDrop: () => activeDelivery && arrivedDropMutation.mutate(activeDelivery.id),
    onConfirmDelivery: () => activeDelivery && completeMutation.mutate(activeDelivery.id),
  }

  return <RiderActiveTripContext.Provider value={value}>{children}</RiderActiveTripContext.Provider>
}
