import { useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { post } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { CheckCircle, ArrowLeft, Loader2, XCircle } from 'lucide-react'

export default function TopUpSuccess() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const submittedRef = useRef(false)
  const ref = searchParams.get('ref')
  const sessionId = searchParams.get('session_id')
  const isCancelled = location.pathname.endsWith('/failed')
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')

  useEffect(() => {
    if (submittedRef.current) return
    submittedRef.current = true

    if (isCancelled) {
      if (ref) {
        post('/rider/credits/cancel-topup', { reference: ref })
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ['rider-credits-transactions'] })
            setStatus('error')
          })
          .catch(() => {
            setStatus('error')
          })
      } else {
        setStatus('error')
      }
      return
    }

    if (!ref) {
      setStatus('done')
      return
    }

    post('/rider/credits/confirm-topup', { reference: ref, payment_id: sessionId || ref })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['rider-credits-balance'] })
        queryClient.invalidateQueries({ queryKey: ['rider-credits-transactions'] })
        setStatus('done')
        if (user) {
          navigate('/rider/wallet', { replace: true })
        }
      })
      .catch(() => {
        setStatus('error')
      })
  }, [isCancelled, ref, sessionId, queryClient, user, navigate])

  return (
    <div className="relative min-h-[80dvh] flex items-center justify-center p-4">
      {status === 'done' && !isCancelled && (
        <div className="fixed top-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 shadow-lg">
          <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-bold">Top-up successful</p>
            <p className="text-xs">Your payment was received and the credits were added to your wallet.</p>
          </div>
        </div>
      )}
      {status === 'error' && isCancelled && (
        <div className="fixed top-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 shadow-lg">
          <XCircle className="h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-bold">Top-up cancelled</p>
            <p className="text-xs">No credits were added to your wallet.</p>
          </div>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-sm p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-[#E9F7EF] rounded-full flex items-center justify-center mx-auto mb-5">
          {status === 'loading' ? (
            <Loader2 className="w-8 h-8 text-[#087F3F] animate-spin" />
          ) : (
            <CheckCircle className="w-8 h-8 text-[#087F3F]" />
          )}
        </div>
        <h1 className="text-xl font-bold text-[#17201B] mb-2">
          {isCancelled ? 'Payment Cancelled' : 'GCash Payment Received!'}
        </h1>
        <p className="text-sm text-[#6B7280] mb-1">
          {status === 'loading'
            ? 'Confirming your payment...'
            : status === 'error'
              ? 'We could not confirm this top-up. Please check your wallet activity.'
              : 'Your credits have been added.'}
        </p>
        {ref && (
          <p className="text-xs text-[#9CA3AF] mb-6">Reference: {ref}</p>
        )}
        <Link
          to="/rider/wallet"
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#087F3F] hover:bg-[#065F2E] text-white font-semibold rounded-xl transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Credits
        </Link>
      </div>
    </div>
  )
}
