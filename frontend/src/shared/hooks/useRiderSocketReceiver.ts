// frontend/src/shared/hooks/useRiderSocketReceiver.ts
// Rider "receiver": connects the rider's browser to the socket-server radar registry
// (ephemeral RAM location), and listens for order_received_ping so the rider UI can
// immediately refetch its pending dispatch request over HTTP. No Firebase writes here.
import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { SOCKET_BASE_URL } from '@/shared/services/socket'

interface UseRiderSocketReceiverOptions {
  riderId: number | null
  isOnline: boolean
  vehicleType?: string
  onOrderPing?: (payload: { deliveryId: string; restaurantName: string; timeoutSeconds: number; distanceKm: number }) => void
}

export function useRiderSocketReceiver({
  riderId,
  isOnline,
  vehicleType = 'food',
  onOrderPing,
}: UseRiderSocketReceiverOptions) {
  const socketRef = useRef<Socket | null>(null)
  const onOrderPingRef = useRef(onOrderPing)
  onOrderPingRef.current = onOrderPing

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
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[socket] connected', socket.id, 'transport=', socket.io.engine.transport.name)
      register(socket)
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
}
