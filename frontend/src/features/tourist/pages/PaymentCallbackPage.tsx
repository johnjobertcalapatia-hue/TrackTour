import { useSearchParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkAndConfirmPayment } from '@/shared/services/payment'
import { CheckCircle2, XCircle, Clock, Loader2, ArrowLeft, Package, Ban } from 'lucide-react'
import { formatCurrency } from '@/shared/utils'

interface PaymentStatusData {
  payment_number: string
  status: string
  amount?: number
  method?: string
  paid_at: string | null
  payable_type?: 'order' | 'booking' | 'group_order'
  order_id?: number | null
  group_order_id?: number | null
}

export default function PaymentCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const paymentNumber = searchParams.get('payment_number')
  const statusParam = searchParams.get('status') || 'unknown'
  const payableType = searchParams.get('payable_type') || (searchParams.get('group_order_id') ? 'group_order' : 'order')
  const payableId = searchParams.get('payable_id')
  const [countdown, setCountdown] = useState(5)

  const isRedirectFromPayMongo = statusParam === 'success'

  const { data: payment, isLoading } = useQuery<PaymentStatusData>({
    queryKey: ['payment-status', paymentNumber],
    queryFn: () => checkAndConfirmPayment(paymentNumber!),
    enabled: !!paymentNumber,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (isRedirectFromPayMongo && status !== 'paid' && status !== 'failed' && status !== 'cancelled') {
        return 3000
      }
      return false
    },
    refetchIntervalInBackground: false,
  })

  const orderId = payableId || payment?.order_id?.toString()
  const groupId = searchParams.get('group_order_id') || payment?.group_order_id?.toString()
  const paymentStatus = payment?.status

  const isSuccess = paymentStatus === 'paid' || paymentStatus === 'authorized'
  const isFailed = statusParam === 'failed' || paymentStatus === 'failed'
  const isCancelled = statusParam === 'cancelled' || paymentStatus === 'cancelled'

  const type = payableType === 'group_order' ? 'group_order' : 'order'
  const targetId = type === 'group_order' ? groupId : orderId

  useEffect(() => {
    if (!isSuccess || !targetId) return
    if (countdown <= 0) {
      if (type === 'group_order') {
        navigate(`/tourist/food/group-order/${targetId}`, { replace: true })
      } else {
        navigate(`/tourist/orders/${targetId}/progress`, { replace: true })
      }
      return
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown, isSuccess, navigate, type, targetId])

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[#E5E9E7] p-8 max-w-md w-full text-center shadow-sm">
        {isLoading ? (
          <>
            <Loader2 className="w-10 h-10 text-[#087F3F] animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-bold text-[#17201B] mb-2">Verifying Payment...</h1>
            <p className="text-sm text-[#6B7280]">Please wait while we confirm your payment.</p>
          </>
        ) : isSuccess ? (
          <>
            <div className="w-16 h-16 bg-[#E9F7EF] rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-[#087F3F]" />
            </div>
            <h1 className="text-2xl font-bold text-[#17201B] mb-2">Payment Successful!</h1>
            <p className="text-sm text-[#6B7280] mb-4">
              {type === 'group_order'
                ? 'Your GCash payment has been processed. Each restaurant will now accept and prepare its part of your group order.'
                : 'Your GCash payment has been processed. Waiting for the restaurant to accept your order.'}
            </p>
            {payment && (
              <div className="bg-[#F8FAF9] rounded-xl p-4 mb-6 text-left space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Payment Number</span>
                  <span className="font-semibold text-[#17201B]">{payment.payment_number}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Amount Paid</span>
                  <span className="font-semibold text-[#087F3F]">{formatCurrency(payment.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Status</span>
                  <span className="font-semibold text-[#087F3F] capitalize">{payment.status}</span>
                </div>
              </div>
            )}
            {isSuccess && targetId && (
              <p className="text-sm text-[#087F3F] font-semibold">
                {type === 'group_order'
                  ? `Redirecting to your group order in ${countdown}...`
                  : `Redirecting to your order in ${countdown}...`}
              </p>
            )}
          </>
        ) : isCancelled ? (
          <>
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Ban className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-2xl font-bold text-[#17201B] mb-2">Payment Cancelled</h1>
            <p className="text-sm text-[#6B7280] mb-6">
              You cancelled the payment. Your order has not been charged.
            </p>
          </>
        ) : isFailed ? (
          <>
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-[#17201B] mb-2">Payment Failed</h1>
            <p className="text-sm text-[#6B7280] mb-6">
              Your payment could not be processed. Please try again.
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-2xl font-bold text-[#17201B] mb-2">Processing Payment</h1>
            <p className="text-sm text-[#6B7280] mb-4">
              Your payment is being processed. This may take a moment.
            </p>
            <Loader2 className="w-6 h-6 text-[#087F3F] animate-spin mx-auto mb-4" />
          </>
        )}

        <div className="space-y-3">
          {isSuccess && targetId ? (
            <button
              onClick={() =>
                type === 'group_order'
                  ? navigate(`/tourist/food/group-order/${targetId}`, { replace: true })
                  : navigate(`/tourist/orders/${targetId}/progress`, { replace: true })
              }
              className="w-full bg-[#087F3F] hover:bg-[#056B35] text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2"
            >
              <Package className="w-4 h-4" /> {type === 'group_order' ? 'View Group Order' : 'View Order Status'}
            </button>
          ) : (
            <button
              onClick={() => navigate('/tourist/food')}
              className="w-full bg-[#087F3F] hover:bg-[#056B35] text-white py-3 rounded-xl font-semibold transition"
            >
              Browse Food
            </button>
          )}
          <button
            onClick={() => navigate(-1)}
            className="w-full bg-[#F8FAF9] hover:bg-[#E9F7EF] text-[#17201B] py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Go Back
          </button>
        </div>
      </div>
    </div>
  )
}
