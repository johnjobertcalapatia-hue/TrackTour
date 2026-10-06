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
      // A credential may be present but the profile still unconfirmed (transient
      // boot /user failure, ProtectedRoute holding the spinner). Bouncing to
      // /login there LOOKS like an auto-logout of a live session — so only send
      // a genuine guest (no credential at all) to the login page.
      const hasToken = !!localStorage.getItem('auth_token')
      if (loading || !user) {
        if (hasToken) {
          return false
        }
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