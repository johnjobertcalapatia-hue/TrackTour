import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDestinationIntent,
  clearPendingAction,
  isSafeInternalTouristPath,
  resolvePostAuthDestination,
  saveDestinationIntent,
  savePendingAction,
} from '@/shared/services/pending-action'

describe('post-auth tourist redirects', () => {
  beforeEach(() => {
    localStorage.clear()
    clearDestinationIntent()
    clearPendingAction()
  })

  it('rejects traversal and non-tourist paths', () => {
    expect(isSafeInternalTouristPath('/tourist/explore/1')).toBe(true)
    expect(isSafeInternalTouristPath('/tourist/explore/../admin')).toBe(false)
    expect(isSafeInternalTouristPath('//evil.example')).toBe(false)
    expect(isSafeInternalTouristPath('https://evil.example')).toBe(false)
    expect(isSafeInternalTouristPath('/admin/dashboard')).toBe(false)
    expect(isSafeInternalTouristPath('/tourist/login')).toBe(false)
  })

  it('prioritizes explicit from over stale destination intent', () => {
    saveDestinationIntent(99, '/tourist/explore/99')
    expect(resolvePostAuthDestination('tourist', '/tourist/explore/12')).toBe('/tourist/explore/12')
  })

  it('falls back to destination intent when from is absent', () => {
    saveDestinationIntent(5, '/tourist/explore/5')
    expect(resolvePostAuthDestination('tourist')).toBe('/tourist/explore/5')
  })

  it('falls back to pending action returnPath when no from/intent', () => {
    savePendingAction({ type: 'food_order', returnPath: '/tourist/food/3' })
    expect(resolvePostAuthDestination('tourist')).toBe('/tourist/food/3')
  })

  it('ignores unsafe from and uses role dashboard', () => {
    expect(resolvePostAuthDestination('tourist', '/tourist/../admin')).toBe('/tourist/dashboard')
  })
})
