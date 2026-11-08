import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Navigation view camera: the rider's arrow must stay on the rider's real
 * position while zooming, "My location" must work while navigating, and the
 * camera must follow the rider as they move.
 */

type Handler = () => void

function fakeMap() {
  const container = document.createElement('div')
  const handlers: Record<string, Handler[]> = {}
  let zoom = 18
  const map = {
    options: {} as Record<string, unknown>,
    getContainer: () => container,
    getZoom: () => zoom,
    getMinZoom: () => 5,
    getMaxZoom: () => 20,
    setView: vi.fn((_c: unknown, z: number) => { zoom = z }),
    setZoomAround: vi.fn((_ll: unknown, z: number) => { zoom = z }),
    project: (ll: [number, number]) => ({ x: ll[1] * 1000, y: -ll[0] * 1000 }),
    unproject: (p: { x: number; y: number }) => ({ lat: -p.y / 1000, lng: p.x / 1000 }),
    invalidateSize: vi.fn(),
    on: (ev: string, fn: Handler) => { (handlers[ev] ??= []).push(fn) },
    off: (ev: string, fn: Handler) => { handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn) },
    fire: (ev: string) => (handlers[ev] ?? []).forEach((h) => h()),
    dragging: { enable: vi.fn(), disable: vi.fn() },
    scrollWheelZoom: { enable: vi.fn(), disable: vi.fn() },
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    setZoom: (z: number) => { zoom = z },
  }
  return { map, container }
}

const state = vi.hoisted(() => ({ map: null as unknown }))
vi.mock('react-leaflet', () => ({ useMap: () => state.map }))

import { NavigationCamera, NAV_ZOOM } from '@/shared/components/map/NavigationCamera'

const RIDER = { lat: 12.86, lng: 121.45 }
const OFFSET = { x: 0, y: 200 }

describe('NavigationCamera (rider navigation view)', () => {
  let fake: ReturnType<typeof fakeMap>
  beforeEach(() => {
    fake = fakeMap()
    state.map = fake.map
  })

  it('takes over wheel / double-click zoom so they can anchor on the rider', () => {
    render(<NavigationCamera active location={RIDER} bearing={0} screenOffset={OFFSET} />)
    expect(fake.map.scrollWheelZoom.disable).toHaveBeenCalled()
    expect(fake.map.doubleClickZoom.disable).toHaveBeenCalled()
    expect(fake.map.dragging.disable).toHaveBeenCalled()
    expect(fake.map.options.touchZoom).toBe('center')
  })

  it('wheel zoom (out and in) zooms around the rider, so the arrow stays on them', () => {
    vi.useFakeTimers()
    try {
      render(<NavigationCamera active location={RIDER} bearing={30} screenOffset={OFFSET} />)
      // Whole levels only: the map snaps zoom to integers, and a half step
      // used to pan the map on every notch instead of zooming.
      act(() => { fake.container.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })) })
      expect(fake.map.setZoomAround).toHaveBeenLastCalledWith([RIDER.lat, RIDER.lng], NAV_ZOOM - 1, { animate: false })
      expect(fake.map.getZoom()).toBe(NAV_ZOOM - 1)
      expect(Number.isInteger(fake.map.getZoom())).toBe(true)

      vi.advanceTimersByTime(200)
      act(() => { fake.container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true })) })
      expect(fake.map.setZoomAround).toHaveBeenLastCalledWith([RIDER.lat, RIDER.lng], NAV_ZOOM, { animate: false })

      // At the maximum zoom another notch in does nothing (no pan, no zoom).
      fake.map.setZoom(20)
      fake.map.setZoomAround.mockClear()
      vi.advanceTimersByTime(200)
      act(() => { fake.container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true })) })
      expect(fake.map.setZoomAround).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a pinch zoom is snapped back onto the rider when it ends', () => {
    render(<NavigationCamera active location={RIDER} bearing={0} screenOffset={{ x: 0, y: 0 }} />)
    fake.map.setView.mockClear()
    fake.map.setZoom(15)
    act(() => fake.map.fire('zoomend'))
    expect(fake.map.setView).toHaveBeenCalledWith([RIDER.lat, RIDER.lng], 15, { animate: false })
  })

  it('"My location" re-centres on the rider at street zoom while navigating', () => {
    const { rerender } = render(<NavigationCamera active location={RIDER} bearing={0} screenOffset={{ x: 0, y: 0 }} recenterSignal={0} />)
    fake.map.setZoom(13) // the rider zoomed far out
    fake.map.setView.mockClear()

    rerender(<NavigationCamera active location={RIDER} bearing={0} screenOffset={{ x: 0, y: 0 }} recenterSignal={1} />)
    expect(fake.map.setView).toHaveBeenCalledWith([RIDER.lat, RIDER.lng], NAV_ZOOM, { animate: true })
  })

  it('follows the rider as they move, keeping their zoom', () => {
    const { rerender } = render(<NavigationCamera active location={RIDER} bearing={0} screenOffset={{ x: 0, y: 0 }} />)
    fake.map.setZoom(16)
    fake.map.setView.mockClear()

    const moved = { lat: 12.861, lng: 121.451 }
    rerender(<NavigationCamera active location={moved} bearing={0} screenOffset={{ x: 0, y: 0 }} />)
    expect(fake.map.setView).toHaveBeenCalledWith([moved.lat, moved.lng], 16, { animate: true })
  })

  it('gives the normal gestures back when navigation ends', () => {
    const { rerender } = render(<NavigationCamera active location={RIDER} bearing={0} screenOffset={OFFSET} />)
    rerender(<NavigationCamera active={false} location={RIDER} bearing={0} screenOffset={OFFSET} />)
    expect(fake.map.scrollWheelZoom.enable).toHaveBeenCalled()
    expect(fake.map.doubleClickZoom.enable).toHaveBeenCalled()
    expect(fake.map.dragging.enable).toHaveBeenCalled()
  })
})
