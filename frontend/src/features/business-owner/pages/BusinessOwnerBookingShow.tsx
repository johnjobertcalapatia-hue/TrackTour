import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { ArrowLeft, User, Mail, Phone, Building2, Calendar, Users, FileText } from 'lucide-react'

interface BookingItem {
  id: number
  description: string
  quantity: number
  price: number
  subtotal: number
}

interface BookingDetail {
  id: number
  booking_number: string
  customer_name: string
  customer_email: string
  customer_phone: string
  business_name: string
  booking_type: string
  status: string
  check_in_date: string | null
  check_out_date: string | null
  num_guests: number | null
  total_amount: number
  paid_amount: number
  balance: number
  notes: string | null
  created_at: string
  updated_at: string
  items: BookingItem[]
}

const BOOKING_TRANSITIONS: Record<string, { next: string; label: string; color: string }[]> = {
  pending: [
    { next: 'confirmed', label: 'Confirm', color: 'bg-[#16803C] hover:bg-[#126B32] text-white' },
    { next: 'cancelled', label: 'Cancel', color: 'border border-[#B91C1C] text-[#B91C1C] hover:bg-[#FEF2F2]' },
    { next: 'rejected', label: 'Reject', color: 'border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4]' },
  ],
  confirmed: [
    { next: 'in_progress', label: 'Check In', color: 'bg-[#16803C] hover:bg-[#126B32] text-white' },
    { next: 'cancelled', label: 'Cancel', color: 'border border-[#B91C1C] text-[#B91C1C] hover:bg-[#FEF2F2]' },
  ],
  in_progress: [
    { next: 'completed', label: 'Complete', color: 'bg-[#16803C] hover:bg-[#126B32] text-white' },
  ],
}

export default function BusinessOwnerBookingShow() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const { data: booking, isLoading } = useQuery({
    queryKey: ['bo-booking', id],
    queryFn: () => get<BookingDetail>(`/business-owner/bookings/${id}`),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => patch(`/business-owner/bookings/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-booking', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-bookings'] })
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!booking) return <div className="text-center py-20 text-[#647067]">Booking not found.</div>

  const transitions = BOOKING_TRANSITIONS[booking.status] || []

  return (
    <div>
      <Link to="/business-owner/bookings" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Bookings
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">{booking.booking_number}</h1>
          <StatusBadge status={booking.status} size="md" />
        </div>
        <p className="text-sm text-[#647067]">Booking Details</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Customer Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Name</p>
                  <p className="text-sm text-[#17201A] mt-1">{booking.customer_name}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Email</p>
                  <p className="text-sm text-[#17201A] mt-1">{booking.customer_email}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Phone</p>
                  <p className="text-sm text-[#17201A] mt-1">{booking.customer_phone || '—'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Business</p>
                  <p className="text-sm text-[#17201A] mt-1">{booking.business_name}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Booking Type</p>
                  <p className="text-sm text-[#17201A] mt-1 capitalize">{booking.booking_type?.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Users className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Guests</p>
                  <p className="text-sm text-[#17201A] mt-1">{booking.num_guests ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Check-in</p>
                  <p className="text-sm text-[#17201A] mt-1">
                    {booking.check_in_date ? formatDateTime(booking.check_in_date) : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Check-out</p>
                  <p className="text-sm text-[#17201A] mt-1">
                    {booking.check_out_date ? formatDateTime(booking.check_out_date) : '—'}
                  </p>
                </div>
              </div>
            </div>
            {booking.notes && (
              <div className="mt-4 flex items-start gap-3">
                <FileText className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Notes</p>
                  <p className="text-sm text-[#17201A] mt-1">{booking.notes}</p>
                </div>
              </div>
            )}
          </div>

          {booking.items && booking.items.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#E2E8E3]">
                <h2 className="text-lg font-semibold text-[#17201A]">Booking Items</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                      <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Description</th>
                      <th className="text-center px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Qty</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Price</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8E3]">
                    {booking.items.map((item) => (
                      <tr key={item.id} className="hover:bg-[#F6F8F4] transition-colors">
                        <td className="px-6 py-3 font-medium text-[#17201A]">{item.description}</td>
                        <td className="px-6 py-3 text-center text-[#4B5563]">{item.quantity}</td>
                        <td className="px-6 py-3 text-right text-[#4B5563]">{formatCurrency(item.price)}</td>
                        <td className="px-6 py-3 text-right font-medium text-[#17201A]">{formatCurrency(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Payment Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#F3F8F4] rounded-xl p-4 border border-[#E2E8E3]">
                <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Total Amount</p>
                <p className="text-xl font-bold text-[#17201A] mt-1">{formatCurrency(booking.total_amount)}</p>
              </div>
              <div className="bg-[#F3F8F4] rounded-xl p-4 border border-[#E2E8E3]">
                <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Paid Amount</p>
                <p className="text-xl font-bold text-[#16803C] mt-1">{formatCurrency(booking.paid_amount)}</p>
              </div>
              <div className="bg-[#F3F8F4] rounded-xl p-4 border border-[#E2E8E3]">
                <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Balance</p>
                <p className={`text-xl font-bold mt-1 ${booking.balance > 0 ? 'text-[#A66F00]' : 'text-[#16803C]'}`}>
                  {formatCurrency(booking.balance)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Actions</h2>
            {transitions.length > 0 ? (
              <div className="space-y-3">
                {transitions.map((t) => (
                  <button
                    key={t.next}
                    onClick={() => statusMutation.mutate(t.next)}
                    disabled={statusMutation.isPending}
                    className={`w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${t.color}`}
                  >
                    {statusMutation.isPending ? 'Updating...' : t.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#647067]">No actions available for this status.</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-sm font-semibold text-[#647067] uppercase tracking-wider mb-3">Booking Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#647067]">Status</span>
                <StatusBadge status={booking.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Type</span>
                <span className="text-[#17201A] capitalize">{booking.booking_type?.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Guests</span>
                <span className="text-[#17201A]">{booking.num_guests ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Total</span>
                <span className="text-[#16803C] font-bold">{formatCurrency(booking.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Paid</span>
                <span className="text-[#16803C]">{formatCurrency(booking.paid_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Balance</span>
                <span className={booking.balance > 0 ? 'text-[#A66F00]' : 'text-[#16803C]'}>
                  {formatCurrency(booking.balance)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Created</span>
                <span className="text-[#4B5563] text-xs">{formatDateTime(booking.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Updated</span>
                <span className="text-[#4B5563] text-xs">{formatDateTime(booking.updated_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
