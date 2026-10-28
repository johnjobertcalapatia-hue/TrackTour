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
const PENDING_DESTINATION_KEY = 'tracktour_pending_destination'
const DEFAULT_TTL_MS = 30 * 60 * 1000

export interface PendingDestination {
  id: number | string
  returnPath: string
  expiresAt: number
}

export function isSafeInternalTouristPath(path?: string | null): boolean {
  if (!path || typeof path !== 'string') return false
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) return false
  // Reject protocol-relative, scheme, backslash, and path-traversal payloads.
  if (trimmed.startsWith('//') || trimmed.includes('\\') || trimmed.includes(':')) return false
  if (trimmed.includes('..')) return false
  if (!trimmed.startsWith('/tourist/')) return false
  if (trimmed.startsWith('/tourist/login') || trimmed.startsWith('/tourist/register')) return false
  return true
}

export function saveDestinationIntent(destinationId: number | string, customPath?: string): boolean {
  try {
    const returnPath = customPath || `/tourist/explore/${destinationId}`
    if (!isSafeInternalTouristPath(returnPath)) return false

    const payload: PendingDestination = {
      id: destinationId,
      returnPath,
      expiresAt: Date.now() + DEFAULT_TTL_MS,
    }
    localStorage.setItem(PENDING_DESTINATION_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function getDestinationIntent(): PendingDestination | null {
  try {
    const raw = localStorage.getItem(PENDING_DESTINATION_KEY)
    if (!raw) return null
    const parsed: PendingDestination = JSON.parse(raw)
    if (!parsed || !parsed.returnPath) return null
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      clearDestinationIntent()
      return null
    }
    if (!isSafeInternalTouristPath(parsed.returnPath)) {
      clearDestinationIntent()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearDestinationIntent(): void {
  try {
    localStorage.removeItem(PENDING_DESTINATION_KEY)
  } catch {}
}

export function takeDestinationIntent(): PendingDestination | null {
  const intent = getDestinationIntent()
  if (intent) clearDestinationIntent()
  return intent
}

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
  // Explicit navigation `from` wins over stale localStorage intents.
  if (role === 'tourist' && from && isSafeInternalTouristPath(from)) {
    clearDestinationIntent()
    clearPendingAction()
    return from
  }

  const destinationIntent = takeDestinationIntent()
  if (role === 'tourist' && destinationIntent && isSafeInternalTouristPath(destinationIntent.returnPath)) {
    return destinationIntent.returnPath
  }

  const pending = takePendingAction()
  const returnPath = pending?.returnPath
  if (role === 'tourist' && returnPath && isSafeInternalTouristPath(returnPath)) {
    return returnPath
  }

  return getRoleDashboardPath(role)
}

