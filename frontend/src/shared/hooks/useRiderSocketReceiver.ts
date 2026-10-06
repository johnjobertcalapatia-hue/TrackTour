// frontend/src/shared/hooks/useRiderSocketReceiver.ts
// Rider "receiver": connects the rider's browser to the socket-server radar registry
// (ephemeral RAM location), and listens for order_received_ping so the rider UI can
// immediately refetch its pending dispatch request over HTTP. No Firebase writes here.
import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { SOCKET_BASE_URL } from '@/shared/services/socket'

// Must stay comfortably BELOW socket-validation.js LIMITS.radarStaleMs
// (120 000 ms) so a stationary-but-online rider never ages out of the radar.
const RADAR_REFRESH_MS = 60_000

interface UseRiderSocketReceiverOptions {
  riderId: number | null
  isOnline: boolean
  vehicleType?: string
  onOrderPing?: (payload: { deliveryId: string; restaurantName: string; timeoutSeconds: number; distanceKm: number }) => void
  onOfferCancelled?: (payload: { delivery_id?: number; reason?: string }) => void
  /** Fires on every (re)connect so callers can reconcile state after a network drop. */
  onConnect?: () => void
  /** Backend cancelled the rider's trip (order cancelled, dispatch released, …). */
  onTripCancelled?: (payload: { delivery_id?: number; reason?: string }) => void
}

export function useRiderSocketReceiver({
  riderId,
  isOnline,
  vehicleType = 'food',
  onOrderPing,
  onOfferCancelled,
  onConnect,
  onTripCancelled,
}: UseRiderSocketReceiverOptions) {
  const socketRef = useRef<Socket | null>(null)
  const onOrderPingRef = useRef(onOrderPing)
  onOrderPingRef.current = onOrderPing

  const onOfferCancelledRef = useRef(onOfferCancelled)
  onOfferCancelledRef.current = onOfferCancelled

  const onConnectRef = useRef(onConnect)
  onConnectRef.current = onConnect

  const onTripCancelledRef = useRef(onTripCancelled)
  onTripCancelledRef.current = onTripCancelled

  // Keep the latest values available to the connection handler without re-creating it.
  const onlineRef = useRef({ riderId, isOnline, vehicleType })
  onlineRef.current = { riderId, isOnline, vehicleType }

  const register = (socket: Socket) => {
    const { riderId: id, isOnline: online, vehicleType: vtype } = onlineRef.current
    if (!socket || !id || !online) return

    const sendLocation = (lat: number, lng: number) => {
      // Never register a Null Island (0,0) fix: the engine rejects it, and a
      // rider without a fix should simply stay off the radar until one exists.
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
        console.warn('[socket] Skipping radar registration: no valid GPS fix yet.')
        return
      }
      socket.emit('driver_go_online', { riderId: id, currentLat: lat, currentLng: lng, vehicleType: vtype })
    }

    const sendLocationOrSkip = (pos: { coords: { latitude: number; longitude: number } }) =>
      sendLocation(pos.coords.latitude, pos.coords.longitude)

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        sendLocationOrSkip,
        () => sendLocation(0, 0),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      )
    } else {
      sendLocation(0, 0)
    }
  }

  // Establish the websocket connection once. Allow polling fallback so connection
  // establishment is resilient (it upgrades to WebSocket automatically), and
  // re-register the radar entry on every (re)connect so a rider never drops out.
  useEffect(() => {
    if (!riderId || !isOnline) {
      socketRef.current = null
      return
    }

    const socket = io(SOCKET_BASE_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      // A rider must never silently drop off the radar after a network blip:
      // the previous budget of 3 attempts (×2 s) exhausted in ~6 s, after
      // which the socket stayed dark until a full page reload — so the rider
      // simply stopped existing for dispatch. Retry indefinitely with backoff.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[socket] connected', socket.id, 'transport=', socket.io.engine.transport.name)
      register(socket)
      // Fires on first connect AND every reconnect: the server may have
      // restarted / state moved while we were dark — reconcile via the caller.
      onConnectRef.current?.()
    })

    socket.on('connect_error', (err) => {
      console.warn('[socket] Unable to connect to the rider dispatch server:', err.message)
    })

    socket.on('disconnect', (reason) => {
      console.warn('[socket] disconnected:', reason)
    })

    socket.on('order_received_ping', (payload) => {
      console.log('[socket] order_received_ping received:', payload?.deliveryId)
      onOrderPingRef.current?.(payload)
    })

    socket.on('delivery_offer_cancelled', (payload) => {
      console.log(
        '[socket] delivery_offer_cancelled received:',
        payload?.delivery_id,
        payload?.reason ?? 'delivery_no_longer_available'
      )
      onOfferCancelledRef.current?.(payload ?? {})
    })

    socket.on('trip_cancelled', (payload) => {
      // Authoritative backend decision that the rider's trip is over: the
      // backend has already released rider_status. Reconcile the UI from it.
      console.log('[socket] trip_cancelled received:', payload?.delivery_id, payload?.reason)
      onTripCancelledRef.current?.(payload ?? {})
    })

    socket.on('driver_registration_rejected', (data) => {
      console.warn('[socket] driver registration rejected:', data?.reason)
    })

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-register immediately if the rider goes online/offline or switches service.
  useEffect(() => {
    if (socketRef.current?.connected) {
      register(socketRef.current)
    }
  }, [riderId, isOnline, vehicleType])

  // Keep the RAM radar entry fresh while the rider stays online.
  //
  // `driver_go_online` is the ONLY thing that stamps `updatedAt` for an idle
  // rider: `rider_location_update` is ownership-gated to the rider already
  // assigned to a trip, so a rider with no delivery can never refresh it.
  // `isRadarEntryEligible()` drops entries after LIMITS.radarStaleMs (120 s),
  // and Laravel's radar fallback applies the same window — so without this
  // re-registration every online-but-parked rider aged out after 2 minutes and
  // was excluded as `radar_gps_stale`, which is why no offer was ever created.
  useEffect(() => {
    if (!riderId || !isOnline) return

    const refresh = () => {
      const socket = socketRef.current
      if (socket?.connected) register(socket)
    }

    refresh()
    const id = window.setInterval(refresh, RADAR_REFRESH_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderId, isOnline])
}
