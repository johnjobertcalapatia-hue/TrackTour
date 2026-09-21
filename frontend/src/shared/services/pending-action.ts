import { getRoleDashboardPath } from '@/shared/utils'

export type PendingActionType =
  | 'food_order'
  | 'resort_booking'
  | 'tour_booking'
  | 'reservation'
  | 'business_service'

export interface PendingAction {
  type: PendingActionType
  restaurantId?: number
  foodId?: number
  quantity?: number
  selectedOptions?: Record<string, unknown>
  returnPath?: string
  expiresAt?: number
}

const PENDING_ACTION_KEY = 'tracktour_pending_action'
const DEFAULT_TTL_MS = 30 * 60 * 1000

export function savePendingAction(action: PendingAction): boolean {
  try {
    const payload: PendingAction = {
      ...action,
      expiresAt: action.expiresAt ?? Date.now() + DEFAULT_TTL_MS,
    }
    localStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function getPendingAction(): PendingAction | null {
  try {
    const raw = localStorage.getItem(PENDING_ACTION_KEY)
    if (!raw) return null
    const parsed: PendingAction = JSON.parse(raw)
    if (!parsed || typeof parsed.type !== 'string') return null
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      clearPendingAction()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearPendingAction(): void {
  try {
    localStorage.removeItem(PENDING_ACTION_KEY)
  } catch {}
}

export function takePendingAction(): PendingAction | null {
  const action = getPendingAction()
  if (action) clearPendingAction()
  return action
}

export function resolvePostAuthDestination(role: string, from?: string): string {
  const pending = takePendingAction()
  const returnPath = pending?.returnPath
  if (role === 'tourist' && returnPath && (returnPath.startsWith('/tourist/') || returnPath === '/tourist')) {
    return returnPath
  }
  if (role === 'tourist' && from && (from.startsWith('/tourist/') || from === '/tourist')) {
    return from
  }
  return getRoleDashboardPath(role)
}
