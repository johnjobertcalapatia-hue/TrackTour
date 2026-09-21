import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { savePendingAction, type PendingAction } from '@/shared/services/pending-action'

export function useRequireAuth() {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const navigate = useNavigate()

  const requireAuth = useCallback(
    (action?: PendingAction): boolean => {
      if (loading || !user) {
        if (action) {
          savePendingAction({
            ...action,
            returnPath: action.returnPath ?? window.location.pathname + window.location.search,
          })
        }
        navigate('/login')
        return false
      }
      return true
    },
    [user, loading, navigate]
  )

  return { user, loading, requireAuth }
}