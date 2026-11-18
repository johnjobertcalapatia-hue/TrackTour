import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'

/** Applicants (pending or rejected riders) stay in onboarding until activated. */
export function RiderOnboardingGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  // The backend vocabulary includes pending_review | approved | rejected | suspended.
  const status = user?.account_status as string | undefined
  if (user?.role === 'rider' && (status === 'pending_review' || status === 'rejected')) {
    return <Navigate to="/rider/onboarding" replace />
  }
  return <>{children}</>
}
