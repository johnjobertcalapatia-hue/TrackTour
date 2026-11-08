import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, () => void> = {}
const map = vi.hoisted(() => ({
  invalidateSize: vi.fn(),
  getBoundsZoom: vi.fn(() => 6),
  setMinZoom: vi.fn(),
  getZoom: vi.fn(() => 17),
  setZoom: vi.fn(),
  setMaxBounds: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  options: {} as Record<string, unknown>,
}))
vi.mock('react-leaflet', () => ({ useMap: () => map }))

import { MapZoomOutLimit, PHILIPPINES_BOUNDS } from '@/features/rider/components/MapZoomOutLimit'

beforeEach(() => {
  vi.clearAllMocks()
  map.options = {}
  map.getZoom.mockReturnValue(17)
  map.getBoundsZoom.mockReturnValue(6)
  map.on.mockImplementation((event: string, fn: () => void) => { handlers[event] = fn })
})

describe('Rider map zoom-out limit: the whole Philippines', () => {
  it('covers the whole country, Batanes to Tawi-Tawi and Palawan to Davao', () => {
    expect(PHILIPPINES_BOUNDS.contains([20.45, 121.97])).toBe(true) // Basco, Batanes
    expect(PHILIPPINES_BOUNDS.contains([5.03, 119.77])).toBe(true) // Bongao, Tawi-Tawi
    expect(PHILIPPINES_BOUNDS.contains([8.45, 117.2])).toBe(true) // southern Palawan
    expect(PHILIPPINES_BOUNDS.contains([7.07, 126.6])).toBe(true) // Davao Oriental coast
    expect(PHILIPPINES_BOUNDS.contains([12.87, 121.45])).toBe(true) // Bansud
  })

  it('sets the farthest zoom-out to the level that fits the whole Philippines', () => {
    render(<MapZoomOutLimit />)

    expect(map.getBoundsZoom).toHaveBeenCalledWith(PHILIPPINES_BOUNDS, false)
    expect(map.setMinZoom).toHaveBeenCalledWith(6)
    expect(map.setZoom).not.toHaveBeenCalled() // already zoomed in further
  })

  it('keeps panning inside the Philippines', () => {
    render(<MapZoomOutLimit />)

    expect(map.setMaxBounds).toHaveBeenCalledTimes(1)
    const padded = map.setMaxBounds.mock.calls[0]![0]
    expect(padded.contains(PHILIPPINES_BOUNDS)).toBe(true)
    expect(padded.contains([35.68, 139.69])).toBe(false) // Tokyo is out of reach
    expect(map.options.maxBoundsViscosity).toBe(1)
  })

  it('pulls a map that is zoomed out too far back to the whole-country view', () => {
    map.getZoom.mockReturnValue(3)
    render(<MapZoomOutLimit />)
    expect(map.setZoom).toHaveBeenCalledWith(6)
  })

  it('recomputes the limit when the screen size changes', () => {
    render(<MapZoomOutLimit />)
    map.getBoundsZoom.mockReturnValue(5) // e.g. rotated to a narrower view
    handlers.resize?.()
    expect(map.setMinZoom).toHaveBeenLastCalledWith(5)
  })
})
