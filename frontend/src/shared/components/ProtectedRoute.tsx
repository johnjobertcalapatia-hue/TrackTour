import { type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'

interface ProtectedRouteProps {
  children?: ReactNode
  roles?: string[]
}

export default function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#0F172A' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-emerald-500/20 border-t-emerald-500" />
      </div>
    )
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
