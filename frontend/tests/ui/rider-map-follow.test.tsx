import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, () => void> = {}
const map = vi.hoisted(() => ({
  setView: vi.fn(),
  panTo: vi.fn(),
  fitBounds: vi.fn(),
  invalidateSize: vi.fn(),
  getZoom: vi.fn(() => 12),
  on: vi.fn(),
  off: vi.fn(),
  options: {} as Record<string, unknown>,
}))
vi.mock('react-leaflet', () => ({ useMap: () => map }))

import { RIDER_FOCUS_ZOOM, RiderMapFollow } from '@/features/rider/components/RiderMapFollow'

const HOME: [number, number] = [12.86, 121.45]
const PLACEHOLDER: [number, number] = [12.8667, 121.45]

function setup(props: Partial<Parameters<typeof RiderMapFollow>[0]> = {}) {
  const onFollowChange = vi.fn()
  const base = { center: HOME, hasFix: true, following: true, focusSignal: 0, onFollowChange, ...props }
  const view = render(<RiderMapFollow {...base} />)
  const rerender = (next: Partial<typeof base>) => view.rerender(<RiderMapFollow {...base} {...next} />)
  return { onFollowChange, rerender }
}

beforeEach(() => {
  vi.clearAllMocks()
  map.options = {}
  map.getZoom.mockReturnValue(12)
  map.on.mockImplementation((event: string, fn: () => void) => { handlers[event] = fn })
})

describe('Rider map keeps the rider marker centred', () => {
  it('never focuses on the placeholder before a real location exists', () => {
    setup({ center: PLACEHOLDER, hasFix: false })
    expect(map.setView).not.toHaveBeenCalled()
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('zooms in to street level on the rider at the first real fix, after re-measuring the map', () => {
    const { rerender } = setup({ center: PLACEHOLDER, hasFix: false })
    rerender({ center: HOME, hasFix: true })

    expect(map.setView).toHaveBeenCalledWith(HOME, RIDER_FOCUS_ZOOM, { animate: true })
    // Re-measured before centring, so the centre is the middle of the visible map.
    expect(map.invalidateSize.mock.invocationCallOrder[0]).toBeLessThan(map.setView.mock.invocationCallOrder[0]!)
  })

  it('follows the rider as they move, ignoring GPS jitter under 5 m', () => {
    const { rerender } = setup()
    map.panTo.mockClear()

    rerender({ center: [12.86002, 121.45] }) // ~2 m
    expect(map.panTo).not.toHaveBeenCalled()

    const moved: [number, number] = [12.8605, 121.45] // ~55 m
    rerender({ center: moved })
    expect(map.panTo).toHaveBeenCalledWith(moved, { animate: true, duration: 0.5 })
  })

  it('pauses following when the rider drags the map, and "My location" re-centres and resumes', () => {
    const { onFollowChange, rerender } = setup()
    act(() => handlers.dragstart?.())
    expect(onFollowChange).toHaveBeenCalledWith(false)

    map.panTo.mockClear()
    map.setView.mockClear()
    rerender({ following: false, center: [12.8605, 121.45] })
    expect(map.panTo).not.toHaveBeenCalled()

    map.getZoom.mockReturnValue(14)
    rerender({ following: false, center: [12.8605, 121.45], focusSignal: 1 })
    expect(map.setView).toHaveBeenCalledWith([12.8605, 121.45], RIDER_FOCUS_ZOOM, { animate: true })
    expect(onFollowChange).toHaveBeenLastCalledWith(true)
  })

  it('re-centres when the visible screen size changes (mobile browser bars, rotation)', () => {
    setup()
    map.invalidateSize.mockClear()
    map.panTo.mockClear()

    act(() => { window.dispatchEvent(new Event('resize')) })

    expect(map.invalidateSize).toHaveBeenCalled()
    expect(map.panTo).toHaveBeenCalledWith(HOME, { animate: false })
  })

  it('does not snap back on resize while the rider is exploring the map', () => {
    setup({ following: false })
    map.panTo.mockClear()

    act(() => { window.dispatchEvent(new Event('resize')) })

    expect(map.invalidateSize).toHaveBeenCalled()
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('zooms around the centre while following, so zooming never pushes the marker sideways', () => {
    const { rerender } = setup()
    expect(map.options).toMatchObject({ scrollWheelZoom: 'center', touchZoom: 'center', doubleClickZoom: 'center' })

    // Exploring the map: zoom behaves normally around the cursor / fingers.
    rerender({ following: false })
    expect(map.options).toMatchObject({ scrollWheelZoom: true, touchZoom: true, doubleClickZoom: true })
  })

  it('snaps the rider back to the exact centre after every zoom while following', () => {
    setup()
    map.panTo.mockClear()

    act(() => handlers.zoomend?.())

    expect(map.panTo).toHaveBeenCalledWith(HOME, { animate: false })
  })

  it('leaves the view alone after zooming while the rider is exploring', () => {
    setup({ following: false })
    map.panTo.mockClear()

    act(() => handlers.zoomend?.())

    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('frames the rider and the restaurant once when a trip starts, then keeps following', () => {
    const restaurant: [number, number] = [12.87, 121.46]
    const { onFollowChange, rerender } = setup({ center: PLACEHOLDER, hasFix: false, overview: { key: '9:pickup', points: [PLACEHOLDER, restaurant] } })
    expect(map.fitBounds).not.toHaveBeenCalled() // no real position yet

    rerender({ center: HOME, hasFix: true, overview: { key: '9:pickup', points: [HOME, restaurant] } })
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    const [bounds, opts] = map.fitBounds.mock.calls[0]!
    expect(bounds.contains(HOME)).toBe(true)
    expect(bounds.contains(restaurant)).toBe(true)
    expect(opts).toMatchObject({ maxZoom: RIDER_FOCUS_ZOOM, paddingBottomRight: [60, 260] })
    expect(onFollowChange).toHaveBeenLastCalledWith(true)

    // Same trip leg: never re-framed as the rider moves.
    rerender({ center: [12.8605, 121.45], hasFix: true, overview: { key: '9:pickup', points: [[12.8605, 121.45], restaurant] } })
    expect(map.fitBounds).toHaveBeenCalledTimes(1)

    // Drop-off leg starts: framed again (rider + tourist).
    rerender({ center: restaurant, hasFix: true, overview: { key: '9:drop', points: [restaurant, [12.96, 121.47]] } })
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
  })
})
