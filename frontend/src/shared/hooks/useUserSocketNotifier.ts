// frontend/src/shared/hooks/useUserSocketNotifier.ts
// P11.5 — Authorized live status notifier for the tourist.
// Mints an HMAC user-room token from Laravel, joins `user:{id}`, and forwards
// canonical order/delivery status events so the order-status page refetches
// instead of waiting for the poll interval. Unavailable socket paths degrade
// to HTTP polling.
import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { get } from '@/shared/services/api'
import { SOCKET_BASE_URL } from '@/shared/services/socket'

export type UserSocketConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

export type UserStatusEventName =
  | 'order.status.changed'
  | 'delivery.status.changed'
  | 'delivery.assigned'
  | 'trip_cancelled'
  | 'dispatch_status_update'

export interface UserSocketPayload {
  order_id?: number
  order_number?: string
  delivery_id?: number
  business_id?: number
  rider_id?: number
  old_status?: string
  new_status?: string
  [key: string]: unknown
}

interface UserTokenData {
  userId: number
  room: string
  token: string
  role: string
}

export function useUserSocketNotifier({
  onStatusEvent,
}: {
  onStatusEvent?: (eventName: UserStatusEventName, data: UserSocketPayload) => void
}) {
  const [connection, setConnection] = useState<UserSocketConnection>('idle')
  const onStatusEventRef = useRef(onStatusEvent)
  onStatusEventRef.current = onStatusEvent

  useEffect(() => {
    let cancelled = false
    let socket: Socket | null = null
    setConnection('connecting')

    get<UserTokenData>('/socket/user-token')
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
          socket?.emit('join_user_room', { userId: String(data.userId), token: data.token })
        })

        socket.on('reconnect_attempt', () => setConnection('reconnecting'))
        socket.on('disconnect', (reason) => {
          setConnection(reason === 'io client disconnect' ? 'closed' : 'reconnecting')
        })
        socket.on('connect_error', () => setConnection('reconnecting'))

        const EVENTS: UserStatusEventName[] = [
          'order.status.changed',
          'delivery.status.changed',
          'delivery.assigned',
          'trip_cancelled',
          'dispatch_status_update',
        ]

        for (const name of EVENTS) {
          socket.on(name, (payload: UserSocketPayload) => {
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
  }, [])

  return { connection }
}