import { afterEach, describe, expect, it } from 'vitest'
import { RIDER_CONTROLS_GAP_PX, bottomAboveRiderStatus } from '@/features/rider/hooks/useAboveRiderStatus'

const rect = (top: number, height: number) => () =>
  ({ top, height, bottom: top + height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

describe('rider map buttons above the Rider Status panel', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function setup(statusTop: number) {
    const container = document.createElement('div')
    container.getBoundingClientRect = rect(0, 800)
    const controls = document.createElement('div')
    Object.defineProperty(controls, 'offsetParent', { get: () => container })
    const status = document.createElement('div')
    status.className = 'rider-status-panel'
    status.getBoundingClientRect = rect(statusTop, 52)
    document.body.append(container, status)
    return controls
  }

  it('leaves the same 8 px gap as between the buttons', () => {
    // Container bottom 800, status top 560 → 240 px + 8 px gap.
    expect(RIDER_CONTROLS_GAP_PX).toBe(8)
    expect(bottomAboveRiderStatus(setup(560))).toBe(248)
  })

  it('follows the panel when the bar is taller or shorter', () => {
    expect(bottomAboveRiderStatus(setup(500))).toBe(308)
    document.body.innerHTML = ''
    expect(bottomAboveRiderStatus(setup(620))).toBe(188)
  })

  it('returns null (CSS fallback) without a status panel or layout', () => {
    expect(bottomAboveRiderStatus(null)).toBeNull()
    const controls = setup(560)
    document.querySelector('.rider-status-panel')!.remove()
    expect(bottomAboveRiderStatus(controls)).toBeNull()
  })
})
