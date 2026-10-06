import { useEffect, useRef, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'

interface ProtectedRouteProps {
  children?: ReactNode
  roles?: string[]
}

function SessionSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#0F172A' }}>
      <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-emerald-500/20 border-t-emerald-500" />
    </div>
  )
}

export default function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const location = useLocation()

  // A stored token that the boot /user check has not yet confirmed (loading) or
  // that it could not confirm because of a transient network/5xx failure MUST
  // NOT bounce the user to /login while it is still on disk — that reads as a
  // spurious "logged me out on refresh". Only a definitive absence of a session
  // (no token, or a token /user already rejected and cleared) may redirect.
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const retryCountRef = useRef(0)

  useEffect(() => {
    // Transient boot failure: token still on disk but no confirmed user and the
    // store finished its retry loop with loading=false. Retry the authoritative
    // /user check in the background (it clears the token itself on a genuine
    // 401); ProtectedRoute keeps the spinner meanwhile — bounded so a dead API
    // cannot hammer the server in a tight loop.
    if (!user && token && !loading) {
      if (retryCountRef.current >= 5) return
      retryCountRef.current += 1
      const timer = setTimeout(() => void fetchUser(), 2500)
      return () => clearTimeout(timer)
    }
    if (user) retryCountRef.current = 0
  }, [user, token, loading, fetchUser])

  if (loading || (!user && token)) {
    return <SessionSpinner />
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  if (user.role === 'business_owner' && user.account_status !== 'approved' && location.pathname !== '/business-owner/account-status') {
    return <Navigate to="/business-owner/account-status" replace />
  }

  return <>{children ?? <Outlet />}</>
}
