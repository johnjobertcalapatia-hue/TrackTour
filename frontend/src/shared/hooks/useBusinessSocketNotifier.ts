// frontend/src/shared/hooks/useBusinessSocketNotifier.ts
// P11.5 — Authorized live status notifier for the restaurant/kitchen.
// Mints an HMAC business-room token from Laravel, joins `business:{id}`, and
// forwards canonical status events so the kitchen can refetch immediately
// instead of waiting for the poll interval. If the token cannot be minted or
// the socket is unavailable the page keeps working via HTTP polling.
import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { get } from '@/shared/services/api'
import { SOCKET_BASE_URL } from '@/shared/services/socket'

export type BusinessSocketConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

export type BusinessStatusEventName =
  | 'order.status.changed'
  | 'delivery.status.changed'
  | 'delivery.assigned'
  | 'rider_assigned'
  | 'trip_cancelled'
  | 'dispatch_status_update'

export interface BusinessSocketPayload {
  order_id?: number
  order_number?: string
  business_id?: number
  user_id?: number
  delivery_id?: number
  rider_id?: number
  old_status?: string
  new_status?: string
  [key: string]: unknown
}

interface BusinessTokenData {
  businessId: number
  room: string
  token: string
  role: string
}

export function useBusinessSocketNotifier({
  businessId,
  onStatusEvent,
}: {
  businessId: number | null
  onStatusEvent?: (eventName: BusinessStatusEventName, data: BusinessSocketPayload) => void
}) {
  const [connection, setConnection] = useState<BusinessSocketConnection>('idle')
  const onStatusEventRef = useRef(onStatusEvent)
  onStatusEventRef.current = onStatusEvent

  useEffect(() => {
    if (!businessId) {
      setConnection('idle')
      return
    }

    let cancelled = false
    let socket: Socket | null = null
    setConnection('connecting')

    get<BusinessTokenData>(`/business-owner/socket/token?business_id=${businessId}`)
      .then((data) => {
        if (cancelled) return

        socket = io(SOCKET_BASE_URL, {
          transports: ['polling', 'websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 2000,
        })

        socket.on('connect', () => {
          setConnection('connected')
          socket?.emit('join_business_room', { businessId: String(data.businessId), token: data.token })
        })

        socket.on('reconnect_attempt', () => setConnection('reconnecting'))
        socket.on('disconnect', (reason) => {
          setConnection(reason === 'io client disconnect' ? 'closed' : 'reconnecting')
        })
        socket.on('connect_error', () => setConnection('reconnecting'))

        const EVENTS: BusinessStatusEventName[] = [
          'order.status.changed',
          'delivery.status.changed',
          'delivery.assigned',
          'rider_assigned',
          'trip_cancelled',
          'dispatch_status_update',
        ]

        for (const name of EVENTS) {
          socket.on(name, (payload: BusinessSocketPayload) => {
            onStatusEventRef.current?.(name, payload)
          })
        }
      })
      .catch(() => {
        // Token minting unavailable → fall back to HTTP polling only.
        setConnection('closed')
      })

    return () => {
      cancelled = true
      socket?.removeAllListeners()
      socket?.disconnect()
    }
  }, [businessId])

  return { connection }
}