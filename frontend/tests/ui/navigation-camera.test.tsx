import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Navigation view camera: the rider's arrow must stay on the rider's real
 * position while zooming, "My location" must work while navigating, the
 * camera must follow the rider as they move — and (rider map, 2026-11-09)
 * the map can be explored like Google Maps: drag pans, pinch / wheel zoom,
 * twist / right-drag rotates.
 */

type Handler = () => void

function fakeMap() {
  const container = document.createElement('div')
  const handlers: Record<string, Handler[]> = {}
  let zoom = 18
  let center = { lat: 12.86, lng: 121.45 }
  const project = (ll: [number, number]) => ({ x: ll[1] * 1000, y: -ll[0] * 1000 })
  const unproject = (p: { x: number; y: number }) => ({ lat: -p.y / 1000, lng: p.x / 1000 })
  const map = {
    options: { zoomSnap: 1 } as Record<string, unknown>,
    getContainer: () => container,
    getZoom: () => zoom,
    getMinZoom: () => 5,
    getMaxZoom: () => 20,
    getSize: () => ({ x: 1000, y: 1000 }),
    setView: vi.fn((c: [number, number] | { lat: number; lng: number }, z: number) => {
      center = Array.isArray(c) ? { lat: c[0], lng: c[1] } : c
      zoom = z
    }),
    /** Map pixels of the centre (this fake's projection ignores zoom). */
    centerPx: () => project([center.lat, center.lng]),
    latLngToContainerPoint: (ll: [number, number]) => {
      const c = project([center.lat, center.lng])
      const p = project(ll)
      return { x: p.x - c.x + 500, y: p.y - c.y + 500 }
    },
    containerPointToLatLng: (cp: { x: number; y: number }) => {
      const c = project([center.lat, center.lng])
      return unproject({ x: c.x + cp.x - 500, y: c.y + cp.y - 500 })
    },
    setZoomAround: vi.fn((_ll: unknown, z: number) => { zoom = z }),
    project,
    unproject,
    invalidateSize: vi.fn(),
    on: (ev: string, fn: Handler) => { (handlers[ev] ??= []).push(fn) },
    off: (ev: string, fn: Handler) => { handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn) },
    fire: (ev: string) => (handlers[ev] ?? []).forEach((h) => h()),
    dragging: { enable: vi.fn(), disable: vi.fn() },
    scrollWheelZoom: { enable: vi.fn(), disable: vi.fn() },
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    touchZoom: { enable: vi.fn(), disable: vi.fn() },
    setZoom: vi.fn((z: number) => { zoom = z }),
    panBy: vi.fn(),
  }
  return { map, container }
}

const state = vi.hoisted(() => ({ map: null as unknown }))
vi.mock('react-leaflet', () => ({ useMap: () => state.map }))

import { NavigationCamera, NAV_ZOOM } from '@/shared/components/map/NavigationCamera'

/** jsdom may lack PointerEvent: a MouseEvent carrying a pointerId does the job. */
function pointer(type: string, x: number, y: number, opts: { id?: number; pointerType?: string; button?: number; ctrlKey?: boolean } = {}) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: opts.button ?? 0, ctrlKey: opts.ctrlKey ?? false, bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pointerId', { value: opts.id ?? 1 })
  Object.defineProperty(e, 'pointerType', { value: opts.pointerType ?? 'touch' })
  return e
}

const RIDER = { lat: 12.86, lng: 121.45 }
const OFFSET = { x: 0, y: 200 }
/** Screen point == plane point (no tilt), so expected values stay readable. */
const flat = (p: { x: number; y: number }) => p

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

  it('without explore (tourist map): whole-level wheel zoom around the user', () => {
    vi.useFakeTimers()
    try {
      render(<NavigationCamera active location={RIDER} bearing={30} screenOffset={OFFSET} />)
      // Whole levels only: that map snaps zoom to integers, and a half step
      // used to pan the map on every notch instead of zooming.
      act(() => { fake.container.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })) })
      expect(fake.map.setZoomAround).toHaveBeenLastCalledWith([RIDER.lat, RIDER.lng], NAV_ZOOM - 1, { animate: false })
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
      // No explore: one finger does nothing.
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', 100, 100))
        window.dispatchEvent(pointer('pointermove', 160, 100))
      })
      expect(fake.map.panBy).not.toHaveBeenCalled()
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

  describe('explore (Google-Maps-like)', () => {
    function renderExplore(props: Partial<Parameters<typeof NavigationCamera>[0]> = {}) {
      const onFree = vi.fn()
      const onBearing = vi.fn()
      const onGesture = vi.fn()
      const utils = render(
        <NavigationCamera
          active
          location={RIDER}
          bearing={0}
          screenOffset={OFFSET}
          onFreeLookChange={onFree}
          onBearingChange={onBearing}
          onGestureChange={onGesture}
          screenToPlanePoint={flat}
          {...props}
        />,
      )
      return { ...utils, onFree, onBearing, onGesture }
    }
    /** How far the view centre moved (map px) since `from`. */
    const movedSince = (from: { x: number; y: number }) => {
      const c = fake.map.centerPx()
      return { x: c.x - from.x, y: c.y - from.y }
    }

    it('smooth zoom: fractional zoom and Leaflet pinch off while navigating; whole level again after', () => {
      const { rerender } = renderExplore()
      expect(fake.map.options.zoomSnap).toBe(0)
      expect(fake.map.touchZoom.disable).toHaveBeenCalled()
      expect(fake.container.style.touchAction).toBe('none')

      fake.map.setZoom(16.4)
      rerender(<NavigationCamera active={false} location={RIDER} bearing={0} screenOffset={OFFSET} onFreeLookChange={vi.fn()} />)
      expect(fake.map.options.zoomSnap).toBe(1)
      expect(fake.map.getZoom()).toBe(16)
      expect(fake.map.touchZoom.enable).toHaveBeenCalled()
    })

    it('leaving the page while navigating: no call on the already-destroyed map', () => {
      // React can tear the Leaflet map down (map.remove()) before this
      // cleanup runs; view calls on it threw "reading '_leaflet_pos'".
      const { unmount } = renderExplore()
      fake.map.setZoom(16.4)
      fake.map.setZoom.mockClear()
      fake.map.invalidateSize.mockClear()
      act(() => fake.map.fire('unload')) // what Leaflet's map.remove() fires
      expect(() => unmount()).not.toThrow()
      expect(fake.map.setZoom).not.toHaveBeenCalled()
      expect(fake.map.invalidateSize).not.toHaveBeenCalled()
      expect(fake.map.dragging.enable).not.toHaveBeenCalled()
    })

    it('one-finger drag moves the map with the finger and starts exploring', () => {
      const { onFree, onGesture } = renderExplore()
      const start = fake.map.centerPx()
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', 100, 100))
        window.dispatchEvent(pointer('pointermove', 110, 100)) // past the tap threshold
        window.dispatchEvent(pointer('pointermove', 140, 100))
      })
      expect(onFree).toHaveBeenCalledWith(true)
      expect(onGesture).toHaveBeenLastCalledWith(true)
      // The spot grabbed stays under the finger: it moved right 40 px, so the
      // view moved left 40 px.
      expect(movedSince(start).x).toBeCloseTo(-40)
      expect(movedSince(start).y).toBeCloseTo(0)

      act(() => { window.dispatchEvent(pointer('pointerup', 140, 100)) })
      expect(onGesture).toHaveBeenLastCalledWith(false)
    })

    it('forward / backward / sideways follow the drag, whatever the map bearing', () => {
      renderExplore({ bearing: 90 })
      const start = fake.map.centerPx()
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', 100, 100))
        window.dispatchEvent(pointer('pointermove', 100, 110))
        window.dispatchEvent(pointer('pointermove', 130, 100))
      })
      // Heading east (screen up = east): a drag to the right of the screen is
      // a drag toward the map's south, so the view moves north (-y).
      expect(movedSince(start).x).toBeCloseTo(0)
      expect(movedSince(start).y).toBeCloseTo(-30)
    })

    it('a tap is not a drag', () => {
      const { onFree } = renderExplore()
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', 100, 100))
        window.dispatchEvent(pointer('pointermove', 102, 101))
        window.dispatchEvent(pointer('pointerup', 102, 101))
      })
      expect(onFree).not.toHaveBeenCalled()
      expect(fake.map.panBy).not.toHaveBeenCalled()
    })

    it('pinch while following only zooms, around the rider (who stays under the puck)', () => {
      const { onFree } = renderExplore()
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', -100, 0, { id: 1 }))
        fake.container.dispatchEvent(pointer('pointerdown', 100, 0, { id: 2 }))
        // Fingers spread apart symmetrically: distance 200 → 400 = one level in.
        // (as real fingers do: small, interleaved moves).
        for (let i = 1; i <= 10; i++) {
          window.dispatchEvent(pointer('pointermove', -100 - 10 * i, 0, { id: 1 }))
          window.dispatchEvent(pointer('pointermove', 100 + 10 * i, 0, { id: 2 }))
        }
      })
      expect(onFree).not.toHaveBeenCalled()
      // Zoomed one level in, re-anchored on the rider (who stays under the puck).
      const [centre, zoom] = fake.map.setView.mock.calls.at(-1)! as [{ lat: number; lng: number }, number]
      expect(zoom).toBeCloseTo(19)
      expect(centre.lng).toBeCloseTo(RIDER.lng)
      expect(centre.lat).toBeCloseTo(RIDER.lat + OFFSET.y / 1000) // the puck sits 200 px below the centre
    })

    it('a two-finger twist rotates the map (and starts exploring)', () => {
      const { onFree, onBearing } = renderExplore()
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', -100, 0, { id: 1 }))
        fake.container.dispatchEvent(pointer('pointerdown', 100, 0, { id: 2 }))
        // Second finger swings a quarter turn clockwise around the first: past
        // the twist threshold, so following turns into exploring (rotation
        // starts from here — no jump by the twist that tripped it)…
        window.dispatchEvent(pointer('pointermove', -100, 200, { id: 2 }))
      })
      expect(onFree).toHaveBeenCalledWith(true)
      expect(onBearing).not.toHaveBeenCalled()
      act(() => {
        // …then another quarter turn clockwise turns the map with the fingers.
        window.dispatchEvent(pointer('pointermove', -300, 0, { id: 2 }))
      })
      // Content turned 90° clockwise → the screen's "up" now points west.
      expect(onBearing).toHaveBeenLastCalledWith(270)
    })

    it('desktop: right-drag (or Ctrl+drag) rotates around the screen centre', () => {
      const { onFree, onBearing } = renderExplore()
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', 100, 100, { pointerType: 'mouse', button: 2 }))
        window.dispatchEvent(pointer('pointermove', 110, 100, { pointerType: 'mouse', button: 2 }))
        window.dispatchEvent(pointer('pointermove', 160, 100, { pointerType: 'mouse', button: 2 }))
      })
      expect(onFree).toHaveBeenCalledWith(true)
      expect(onBearing).toHaveBeenLastCalledWith(336) // 60 px × 0.4° = 24°

      act(() => { window.dispatchEvent(pointer('pointerup', 160, 100, { pointerType: 'mouse', button: 2 })) })
      const ctrl = renderExplore({ bearing: 0 })
      act(() => {
        fake.container.dispatchEvent(pointer('pointerdown', 100, 100, { pointerType: 'mouse', ctrlKey: true }))
        window.dispatchEvent(pointer('pointermove', 90, 100, { pointerType: 'mouse', ctrlKey: true }))
      })
      expect(ctrl.onBearing).toHaveBeenLastCalledWith(4)
    })

    it('the wheel zooms smoothly and always around the rider: their marker never moves', () => {
      const { rerender } = renderExplore()
      act(() => { fake.container.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })) })
      // Half a level out, the rider kept under the puck.
      let [centre, zoom] = fake.map.setView.mock.calls.at(-1)! as [{ lat: number; lng: number }, number]
      expect(zoom).toBe(17.5)
      expect(centre.lng).toBeCloseTo(RIDER.lng)

      rerender(<NavigationCamera active location={RIDER} bearing={0} screenOffset={OFFSET} freeLook onFreeLookChange={vi.fn()} screenToPlanePoint={flat} />)
      fake.map.setView.mockClear()
      // Exploring: the rider's marker is somewhere on screen; scrolling with
      // the cursor elsewhere zooms around the rider, not the cursor.
      const riderBefore = fake.map.latLngToContainerPoint([RIDER.lat, RIDER.lng])
      act(() => { fake.container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 120, clientY: -40, cancelable: true })) })
      ;[centre, zoom] = fake.map.setView.mock.calls.at(-1)! as [{ lat: number; lng: number }, number]
      expect(zoom).toBe(18)
      const riderAfter = fake.map.latLngToContainerPoint([RIDER.lat, RIDER.lng])
      expect(riderAfter.x).toBeCloseTo(riderBefore.x)
      expect(riderAfter.y).toBeCloseTo(riderBefore.y)
    })

    it('while exploring the camera stops following and a pinch is not snapped back', () => {
      const { rerender } = renderExplore({ freeLook: true })
      fake.map.setView.mockClear()
      rerender(<NavigationCamera active location={{ lat: 12.861, lng: 121.451 }} bearing={0} screenOffset={OFFSET} freeLook onFreeLookChange={vi.fn()} />)
      act(() => fake.map.fire('zoomend'))
      expect(fake.map.setView).not.toHaveBeenCalled()
    })

    it('"My location" ends exploring and goes back to the rider', () => {
      const onFree = vi.fn()
      const { rerender } = render(<NavigationCamera active location={RIDER} bearing={0} screenOffset={{ x: 0, y: 0 }} freeLook recenterSignal={0} onFreeLookChange={onFree} />)
      fake.map.setView.mockClear()
      rerender(<NavigationCamera active location={RIDER} bearing={0} screenOffset={{ x: 0, y: 0 }} freeLook recenterSignal={1} onFreeLookChange={onFree} />)
      expect(onFree).toHaveBeenCalledWith(false)
      expect(fake.map.setView).toHaveBeenCalledWith([RIDER.lat, RIDER.lng], NAV_ZOOM, { animate: true })
    })
  })
})
