import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * True when the previous browser-history entry is a page of THIS app.
 *
 * React Router keeps a position counter (`idx`) in `history.state`, starting
 * at 0 when the app loads. Returning from an external page that redirected
 * here (PayMongo's checkout → /payment/callback → the order page) is a fresh
 * load, so idx is 0 and "back" would land on the external page.
 */
export function hasInAppHistory(): boolean {
  if (typeof window === 'undefined') return false
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' && idx > 0
}

/**
 * A Back action that never leaves the app: goes back when the previous page
 * is ours, otherwise opens `fallback` (replacing the current entry).
 */
export function useBackOr(fallback: string): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    if (hasInAppHistory()) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, fallback])
}
