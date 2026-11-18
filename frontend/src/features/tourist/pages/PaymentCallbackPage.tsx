import { useSearchParams, useNavigate } from 'react-router-dom'
import { useBackOr } from '@/shared/hooks/use-back-or'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkAndConfirmPayment } from '@/shared/services/payment'
import { CheckCircle2, XCircle, Clock, Loader2, ArrowLeft, Package, Ban, Car } from 'lucide-react'
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
  /** 'transport' = a ride (2026-11-18): this page returns to the ride, not a food order. */
  order_type?: string | null
}

export default function PaymentCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // This page is opened by PayMongo's redirect: plain history-back would
  // return to PayMongo's checkout, so go to My Orders instead.
  const goBack = useBackOr('/tourist/activities?view=orders')

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
  // Ride hailing: PayMongo's success page and its "Return to merchant" link
  // both come back to the ride's tracking page.
  const isRide = type === 'order' && (searchParams.get('kind') === 'ride' || payment?.order_type === 'transport')
  const targetUrl = type === 'group_order'
    ? `/tourist/food/group-order/${targetId}`
    : isRide ? `/tourist/transport/tracking/${targetId}` : `/tourist/orders/${targetId}/track`

  useEffect(() => {
    if (!isSuccess || !targetId) return
    if (countdown <= 0) {
      navigate(targetUrl, { replace: true })
      return
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown, isSuccess, navigate, targetUrl, targetId])

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
                : isRide
                  ? 'Your GCash payment for the ride has been received. Your driver will confirm it and complete the ride.'
                  : 'Your GCash payment has been processed. Waiting for a rider to accept your order delivery offer.'}
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
                  : isRide ? `Returning to your ride in ${countdown}...` : `Redirecting to your order in ${countdown}...`}
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
              {isRide
                ? 'Your ride has not been paid yet, and you were not charged. Go back to your ride to pay with GCash, or pay your driver in cash.'
                : 'You cancelled the payment. Your order has not been charged.'}
            </p>
          </>
        ) : isFailed ? (
          <>
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-[#17201B] mb-2">Payment Failed</h1>
            <p className="text-sm text-[#6B7280] mb-6">
              {isRide
                ? 'Your GCash payment could not be processed. Go back to your ride to try again, or pay your driver in cash.'
                : 'Your payment could not be processed. Please try again.'}
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
          {isRide && targetId ? (
            // Success, cancelled ("Return to merchant") or failed: back to the ride.
            <button
              onClick={() => navigate(targetUrl, { replace: true })}
              className="w-full bg-[#087F3F] hover:bg-[#056B35] text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2"
            >
              <Car className="w-4 h-4" /> Back to your ride
            </button>
          ) : isSuccess && targetId ? (
            <button
              onClick={() => navigate(targetUrl, { replace: true })}
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
          {!isRide && (
            <button
              onClick={goBack}
              className="w-full bg-[#F8FAF9] hover:bg-[#E9F7EF] text-[#17201B] py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Go Back
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
