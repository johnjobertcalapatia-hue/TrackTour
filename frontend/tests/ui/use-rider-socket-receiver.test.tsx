import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRiderSocketReceiver } from '@/shared/hooks/useRiderSocketReceiver'

// Fake Socket.IO server surface: the app registers handlers on `on`, the test
// "server" fires them through `emit`, and `driver_go_online`/GPS emissions are
// recorded on the socket instance.
const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: never[]) => void>>()
  let currentId = 1
  const fakeSocket = {
    id: 'fake-socket-1',
    connected: true,
    io: { engine: { transport: { name: 'websocket' } } },
    on(event: string, cb: (...args: never[]) => void) {
      const list = handlers.get(event) ?? []
      list.push(cb)
      handlers.set(event, list)
      return fakeSocket
    },
    emit: vi.fn(),
    removeAllListeners() {
      handlers.clear()
    },
    disconnect() {
      handlers.clear()
    },
  }
  const io = vi.fn(() => fakeSocket)
  const emit = (event: string, ...args: unknown[]) => {
    currentId = (currentId + 1) % Number.MAX_SAFE_INTEGER
    void currentId
    ;(handlers.get(event) ?? []).forEach((cb) => cb(...(args as never[])))
  }
  const reset = () => {
    handlers.clear()
    io.mockClear()
    fakeSocket.emit.mockClear()
    fakeSocket.connected = true
  }
  return { fakeSocket, io, emit, reset }
})

vi.mock('socket.io-client', () => ({
  io: socketMock.io,
  type: {},
}))

describe('useRiderSocketReceiver — rider side of the order ping', () => {
  beforeEach(() => {
    socketMock.reset()
  })

  it('delivers order_received_ping to the mounted handler', () => {
    const onOrderPing = vi.fn()
    renderHook(() =>
      useRiderSocketReceiver({
        riderId: 7,
        isOnline: true,
        onOrderPing,
      })
    )

    const payload = { deliveryId: '42', restaurantName: 'Restaurant A', timeoutSeconds: 45, distanceKm: 1.2 }
    act(() => {
      socketMock.emit('order_received_ping', payload)
    })

    expect(onOrderPing).toHaveBeenCalledTimes(1)
    expect(onOrderPing).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: '42' }))
    expect(socketMock.fakeSocket.emit).toBeDefined()
  })

  it('delivers delivery_offer_cancelled (another rider claimed it)', () => {
    const onOfferCancelled = vi.fn()
    renderHook(() =>
      useRiderSocketReceiver({
        riderId: 7,
        isOnline: true,
        onOfferCancelled,
      })
    )

    act(() => {
      socketMock.emit('delivery_offer_cancelled', { delivery_id: 42, reason: 'delivery_no_longer_available' })
    })

    expect(onOfferCancelled).toHaveBeenCalledTimes(1)
    expect(onOfferCancelled).toHaveBeenCalledWith(expect.objectContaining({ delivery_id: 42 }))
  })

  it('delivers trip_cancelled after the backend releases the rider', () => {
    const onTripCancelled = vi.fn()
    renderHook(() =>
      useRiderSocketReceiver({
        riderId: 7,
        isOnline: true,
        onTripCancelled,
      })
    )

    act(() => {
      socketMock.emit('trip_cancelled', { delivery_id: 42, reason: 'order_cancelled' })
    })

    expect(onTripCancelled).toHaveBeenCalledTimes(1)
    expect(onTripCancelled).toHaveBeenCalledWith(expect.objectContaining({ delivery_id: 42 }))
  })

  it('registers the online rider on the socket radar (driver_go_online) after connect', () => {
    const success = (pos: unknown) => pos
    const getCurrentPosition = vi
      .fn()
      .mockImplementation((cb: (pos: { coords: { latitude: number; longitude: number } }) => void) =>
        cb({ coords: { latitude: 12.51, longitude: 121.31 } })
      )
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
      configurable: true,
    })

    const onConnect = vi.fn()
    renderHook(() =>
      useRiderSocketReceiver({
        riderId: 7,
        isOnline: true,
        vehicleType: 'food',
        onConnect,
      })
    )

    act(() => {
      socketMock.emit('connect')
    })

    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(socketMock.fakeSocket.emit).toHaveBeenCalledWith('driver_go_online', {
      riderId: 7,
      currentLat: 12.51,
      currentLng: 121.31,
      vehicleType: 'food',
    })
    void success
  })

  it('re-registers the radar entry when the rider reconnects', () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: vi.fn((cb: (pos: { coords: { latitude: number; longitude: number } }) => void) =>
          cb({ coords: { latitude: 12.51, longitude: 121.31 } })
        ),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
      configurable: true,
    })

    renderHook(() => useRiderSocketReceiver({ riderId: 7, isOnline: true, vehicleType: 'food' }))

    // First registration
    act(() => {
      socketMock.emit('connect')
    })
    const callsAfterFirstConnect = socketMock.fakeSocket.emit.mock.calls.filter((c) => c[0] === 'driver_go_online').length
    expect(callsAfterFirstConnect).toBeGreaterThanOrEqual(1)

    // Simulate a network drop + reconnect
    socketMock.fakeSocket.connected = false
    act(() => {
      socketMock.emit('disconnect', 'transport close')
    })
    socketMock.fakeSocket.connected = true
    act(() => {
      socketMock.emit('connect')
    })

    const callsAfterReconnect = socketMock.fakeSocket.emit.mock.calls.filter((c) => c[0] === 'driver_go_online').length
    expect(callsAfterReconnect).toBeGreaterThanOrEqual(2)
  })

  it('does not register a Null Island (0,0) fix on the radar', () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: vi.fn((cb: (pos: { coords: { latitude: number; longitude: number } }) => void) =>
          cb({ coords: { latitude: 0, longitude: 0 } })
        ),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
      configurable: true,
    })

    renderHook(() => useRiderSocketReceiver({ riderId: 7, isOnline: true }))

    act(() => {
      socketMock.emit('connect')
    })

    const onlineCalls = socketMock.fakeSocket.emit.mock.calls.filter(
      (c) => c[0] === 'driver_go_online' && c[1]?.currentLat === 0
    )
    expect(onlineCalls).toHaveLength(0)
  })
})