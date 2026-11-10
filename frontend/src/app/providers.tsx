import { useEffect, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/services/auth-store'

/**
 * Retry a failed query once — but not a client error (4xx): "not found",
 * "forbidden" or a validation error gives the same answer again, and the
 * retry only doubled the error in the console (e.g. a restaurant that no
 * longer exists, reported 2026-11-09). Timeouts (408) and rate limits (429)
 * can succeed later, so they are retried.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) return false
  return failureCount < 1
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
})

function AuthInitializer({ children }: { children: ReactNode }) {
  const fetchUser = useAuthStore((s) => s.fetchUser)

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  // The bearer token lives in localStorage, which every tab shares, and the
  // API client reads it per request. When another tab logs out or signs in as
  // a different account, this tab must follow that session instead of
  // carrying on with the old user in memory (e.g. a rider tab polling its
  // cached delivery with someone else's token → 403 on /rider/deliveries/*).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'auth_token' || e.key === null) fetchUser()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [fetchUser])

  // Cached server data belongs to the account that fetched it. Drop it all
  // when that account logs out or is replaced, so no screen keeps acting on
  // the previous user's orders, trips or deliveries.
  useEffect(() => {
    let previousId = useAuthStore.getState().user?.id ?? null
    return useAuthStore.subscribe((state) => {
      const id = state.user?.id ?? null
      if (previousId !== null && id !== previousId) {
        // Logged out → screens unmount on redirect, just drop the data.
        // Switched account → wipe and refetch what is on screen as the new user.
        if (id === null) queryClient.clear()
        else void queryClient.resetQueries()
      }
      previousId = id
    })
  }, [])

  return <>{children}</>
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer>
        {children}
      </AuthInitializer>
    </QueryClientProvider>
  )
}
