import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { createCheckoutSession } from '@/shared/services/payment'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDate, formatDateTime } from '@/shared/utils'
import { ArrowLeft, Calendar, MapPin, User, FileText, Smartphone } from 'lucide-react'
import type { Booking } from '@/shared/types'

interface BookingDetail extends Booking {
  business: {
    id: number
    business_name: string
    address: string | null
  } | null
}

export default function TouristBookingShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [isRedirecting, setIsRedirecting] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-booking', id],
    queryFn: () => get<{ booking: BookingDetail }>(`/tourist/booking/${id}/detail`),
  })

  const booking = data?.booking

  const handlePayWithGCash = async () => {
    if (!booking) return
    try {
      setIsRedirecting(true)
      const data = await createCheckoutSession('booking', booking.id, 'gcash')
      if (data?.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch {
      alert('Payment initialization failed. Please try again.')
      setIsRedirecting(false)
    }
  }

  if (isLoading) return <DashboardSkeleton />
  if (!booking) return <div className="text-center py-20 text-[#68736D]">Booking not found.</div>

  const canPay = booking.status === 'confirmed' && booking.total_amount > 0

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#68736D] hover:text-[#17201B] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">{booking.booking_number}</h1>
          <StatusBadge status={booking.status} size="md" />
        </div>
        <p className="text-sm text-[#68736D]">Booking Details</p>
      </div>

      <div className="space-y-4">
        <div className="bg-white backdrop-blur-xl rounded-2xl border border-[#E5E9E7] p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[#17201B]">Reservation Info</h2>

          <div className="flex items-center gap-3 text-sm">
            <User className="w-4 h-4 text-[#68736D]" />
            <div>
              <p className="text-xs text-gray-500">Customer</p>
              <p className="text-[#17201B]">{booking.customer_name}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <MapPin className="w-4 h-4 text-[#68736D]" />
            <div>
              <p className="text-xs text-gray-500">Business</p>
              <p className="text-[#17201B]">{booking.business?.business_name ?? 'Business'}</p>
              <p className="text-xs text-gray-500">{booking.business?.address ?? ''}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <Calendar className="w-4 h-4 text-[#68736D]" />
            <div>
              <p className="text-xs text-gray-500">Dates</p>
              {booking.check_in_date ? (
                <p className="text-[#17201B]">
                  {formatDate(booking.check_in_date)} → {booking.check_out_date ? formatDate(booking.check_out_date) : '—'}
                </p>
              ) : (
                <p className="text-[#68736D]">No dates set</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <FileText className="w-4 h-4 text-[#68736D]" />
            <div>
              <p className="text-xs text-gray-500">Type</p>
              <p className="text-[#17201B] capitalize">{booking.booking_type}</p>
            </div>
          </div>
        </div>

        <div className="bg-white backdrop-blur-xl rounded-2xl border border-[#E5E9E7] p-6">
          <div className="flex items-center justify-between">
            <span className="text-[#68736D]">Total Amount</span>
            <span className="text-2xl font-bold text-[#087F3F]">{formatCurrency(booking.total_amount)}</span>
          </div>
        </div>

        {canPay && (
          <button
            onClick={handlePayWithGCash}
            disabled={isRedirecting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <Smartphone className="w-4 h-4" />
            {isRedirecting ? 'Redirecting to GCash...' : `Pay with GCash (${formatCurrency(booking.total_amount)})`}
          </button>
        )}

        {booking.notes && (
          <div className="bg-white backdrop-blur-xl rounded-2xl border border-[#E5E9E7] p-6">
            <h3 className="text-sm font-semibold text-[#17201B] mb-2">Notes</h3>
            <p className="text-sm text-[#56615B]">{booking.notes}</p>
          </div>
        )}

        <div className="bg-white backdrop-blur-xl rounded-2xl border border-[#E5E9E7] p-6 text-sm text-gray-500">
          Created: {formatDateTime(booking.created_at)}
        </div>
      </div>
    </div>
  )
}
