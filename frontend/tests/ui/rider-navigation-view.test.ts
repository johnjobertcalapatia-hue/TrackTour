import { afterEach, describe, expect, it } from 'vitest'
import {
  NAV_PERSPECTIVE_PX,
  NAV_PUCK_GAP_PX,
  NAV_PUCK_HALF_PX,
  NAV_TILT_DEG,
  navPuckScreenOffset,
  planeOffsetForScreenY,
  planePointForScreen,
  screenYForPlaneOffset,
} from '@/features/rider/navigation-view'

describe('navigation view geometry (3D tilt)', () => {
  it('planePointForScreen inverts the tilt for whole points (drag to explore)', () => {
    const t = (NAV_TILT_DEG * Math.PI) / 180
    const p = NAV_PERSPECTIVE_PX
    for (const [sx, sy] of [[0, 0], [120, 200], [-80, -150], [40, 300]]) {
      const plane = planePointForScreen(sx, sy)
      const scale = p / (p - plane.y * Math.sin(t))
      expect(plane.x * scale).toBeCloseTo(sx, 6)
      expect(screenYForPlaneOffset(plane.y)).toBeCloseTo(sy, 6)
    }
    // Above the horizon it stays finite (clamped just below it).
    expect(Number.isFinite(planePointForScreen(0, -5000).y)).toBe(true)
  })

  it('finds the plane offset that lands exactly at a screen offset despite the perspective', () => {
    for (const screenY of [-200, -50, 0, 120, 260, 340]) {
      const plane = planeOffsetForScreenY(screenY)
      expect(screenYForPlaneOffset(plane)).toBeCloseTo(screenY, 6)
    }
  })

  it('needs a larger plane offset than the screen offset below the centre (the near side is foreshortened)', () => {
    expect(planeOffsetForScreenY(0)).toBe(0)
    expect(Math.abs(planeOffsetForScreenY(250))).toBeGreaterThan(250 * 0.9)
  })
})

describe('rider puck placement', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const area = (top: number, height: number) => ({
    getBoundingClientRect: () => ({ top, left: 0, width: 400, height, right: 400, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }),
  }) as unknown as HTMLElement

  it('sits 30 px above the Go Online button, horizontally centred', () => {
    const button = document.createElement('button')
    button.className = 'rider-availability-button'
    button.getBoundingClientRect = () => ({ top: 700, left: 30, width: 48, height: 48, right: 78, bottom: 748, x: 30, y: 700, toJSON: () => ({}) })
    document.body.appendChild(button)

    const offset = navPuckScreenOffset(area(0, 800))
    // Puck centre = button top - gap - half puck height; relative to the map centre (400).
    expect(offset).toEqual({ x: 0, y: 700 - NAV_PUCK_GAP_PX - NAV_PUCK_HALF_PX - 400 })
  })

  it('falls back to a quarter of the height below the centre without the button', () => {
    expect(navPuckScreenOffset(area(0, 800))).toEqual({ x: 0, y: 200 })
  })

  it('is centred when the map area has no size yet', () => {
    expect(navPuckScreenOffset(area(0, 0))).toEqual({ x: 0, y: 0 })
    expect(navPuckScreenOffset(null)).toEqual({ x: 0, y: 0 })
  })
})
