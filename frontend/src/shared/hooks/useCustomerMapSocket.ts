// frontend/src/shared/hooks/useCustomerMapSocket.ts
// Authorized tourist live-tracking hook. Presents the HMAC trip token minted
// by Laravel (order status `tracking.token`) to join `trip:<deliveryId>`, then
// consumes the Zero-DB `rider_location_stream`. If the socket is unavailable or
// unauthorized, the page falls back to HTTP-polled `rider_location`.
import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { SOCKET_BASE_URL } from '@/shared/services/socket'

export type MapSocketConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

export interface RiderTelemetryStream {
  riderId: number
  lat: number
  lng: number
  heading: number
  speed: number
  timestamp: number
}

interface UseCustomerMapSocketOptions {
  deliveryId: string | null
  token: string | null
  enabled?: boolean
  staleAfterMs?: number
}

export function useCustomerMapSocket({
  deliveryId,
  token,
  enabled = true,
  staleAfterMs = 15000,
}: UseCustomerMapSocketOptions) {
  const [connection, setConnection] = useState<MapSocketConnection>('idle')
  const [telemetry, setTelemetry] = useState<RiderTelemetryStream | null>(null)
  const [assignedRiderId, setAssignedRiderId] = useState<number | null>(null)
  const [tripCompleted, setTripCompleted] = useState(false)
  const [tripCancelled, setTripCancelled] = useState(false)
  const [rejectedReason, setRejectedReason] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const lastFixRef = useRef<number>(0)

  useEffect(() => {
    // Nothing to track until Laravel hands us a delivery + token.
    if (!enabled || !deliveryId || !token) {
      setConnection('idle')
      setTelemetry(null)
      setAssignedRiderId(null)
      setTripCompleted(false)
      setTripCancelled(false)
      setRejectedReason(null)
      setIsStale(false)
      return
    }

    setConnection('connecting')
    setTripCompleted(false)
    setTripCancelled(false)
    setRejectedReason(null)
    setIsStale(false)

    const socket: Socket = io(SOCKET_BASE_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    })

    socket.on('connect', () => {
      setConnection('connected')
      socket.emit('join_trip_room', { deliveryId, token })
    })

    socket.on('reconnect_attempt', () => setConnection('reconnecting'))
    socket.on('disconnect', (reason) => {
      setConnection(reason === 'io client disconnect' ? 'closed' : 'reconnecting')
    })
    socket.on('connect_error', () => setConnection('reconnecting'))

    socket.on('join_trip_room_rejected', (data: { deliveryId?: string; reason?: string }) => {
      setRejectedReason(data?.reason ?? 'unauthorized')
      setConnection('closed')
      socket.disconnect()
    })

    socket.on('rider_assigned', (data: { deliveryId: string; riderId: number }) => {
      setAssignedRiderId(data.riderId)
    })

    socket.on('rider_location_stream', (data: RiderTelemetryStream) => {
      setTelemetry(data)
      lastFixRef.current = data.timestamp
      setIsStale(false)
    })

    socket.on('trip_completed', () => {
      setTripCompleted(true)
      setTelemetry(null)
      lastFixRef.current = 0
      setIsStale(false)
    })

    socket.on('trip_cancelled', () => {
      // P11.5 cancellation exit: stop tracking immediately. The authoritative
      // cancellation is served by HTTP on the next order-status refetch.
      setTripCancelled(true)
      setTripCompleted(true)
      setTelemetry(null)
      lastFixRef.current = 0
      setIsStale(false)
    })

    // Staleness watchdog: a connected room with no recent fix is "stale" so the
    // UI can degrade to the HTTP-polled fallback instead of freezing a dot.
    const tick = setInterval(() => {
      if (lastFixRef.current > 0 && Date.now() - lastFixRef.current > staleAfterMs) {
        setIsStale(true)
      }
    }, 5000)

    return () => {
      clearInterval(tick)
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [deliveryId, token, enabled, staleAfterMs])

  return { connection, telemetry, assignedRiderId, tripCompleted, tripCancelled, rejectedReason, isStale }
}