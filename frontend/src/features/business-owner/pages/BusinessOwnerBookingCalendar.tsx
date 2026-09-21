import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDate } from '@/shared/utils'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays, Filter } from 'lucide-react'

interface Booking {
  id: number
  booking_number: string
  customer_name: string
  booking_type: string
  status: string
  check_in_date: string | null
  check_out_date: string | null
  total_amount: number
  num_guests: number | null
  business_name: string
  created_at: string
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled']

function groupByDate(bookings: Booking[]) {
  const grouped: Record<string, Booking[]> = {}
  for (const b of bookings) {
    const key = b.check_in_date ? b.check_in_date.split('T')[0] ?? '' : 'no-date'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(b)
  }
  return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
}

export default function BusinessOwnerBookingCalendar() {
  const now = new Date()
  const [currentMonth, setCurrentMonth] = useState(now.getMonth())
  const [currentYear, setCurrentYear] = useState(now.getFullYear())
  const [statusFilter, setStatusFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['bo-bookings'],
    queryFn: () => get<Booking[]>('/business-owner/bookings'),
  })

  if (isLoading) return <DashboardSkeleton />

  const allBookings = data ?? []

  const filtered = useMemo(() => {
    const monthStart = new Date(currentYear, currentMonth, 1)
    const monthEnd = new Date(currentYear, currentMonth + 1, 0)
    const startStr = monthStart.toISOString().split('T')[0] ?? ''
    const endStr = monthEnd.toISOString().split('T')[0] ?? ''

    return allBookings.filter((b) => {
      const checkIn = b.check_in_date ? b.check_in_date.split('T')[0] : null
      const created = b.created_at.split('T')[0] ?? ''
      const inMonth = (checkIn && checkIn >= startStr && checkIn <= endStr) || (created >= startStr && created <= endStr)
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter
      return inMonth && matchesStatus
    })
  }, [allBookings, currentMonth, currentYear, statusFilter])

  const grouped = useMemo(() => groupByDate(filtered), [filtered])

  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear((y) => y - 1)
    } else {
      setCurrentMonth((m) => m - 1)
    }
  }

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear((y) => y + 1)
    } else {
      setCurrentMonth((m) => m + 1)
    }
  }

  const goToToday = () => {
    setCurrentMonth(now.getMonth())
    setCurrentYear(now.getFullYear())
  }

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay()

  const bookingsByDay: Record<number, Booking[]> = {}
  for (const b of filtered) {
    if (b.check_in_date) {
      const d = new Date(b.check_in_date)
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const day = d.getDate()
        if (!bookingsByDay[day]) bookingsByDay[day] = []
        bookingsByDay[day].push(b)
      }
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Booking Calendar</h1>
        <p className="mt-1 text-sm text-[#647067]">View bookings organized by date</p>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button onClick={goToPrevMonth} className="p-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] transition">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-semibold text-[#17201A] min-w-[180px] text-center">
              {MONTH_NAMES[currentMonth]} {currentYear}
            </h2>
            <button onClick={goToNextMonth} className="p-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] transition">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={goToToday} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-[#16803C] hover:bg-[#F3F8F4] transition border border-[#D7E8DB]">
              Today
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-[#647067]" />
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  statusFilter === s
                    ? 'bg-[#16803C] text-white'
                    : 'bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4]'
                }`}
              >
                {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-[#E2E8E3] rounded-xl overflow-hidden mb-6">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="bg-[#F3F8F4] px-2 py-2 text-center text-xs font-semibold text-[#647067] uppercase tracking-wider">
              {day}
            </div>
          ))}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-[#F6F8F4] min-h-[80px]" />
          ))}
          {calendarDays.map((day) => {
            const dayBookings = bookingsByDay[day] || []
            const isToday = day === now.getDate() && currentMonth === now.getMonth() && currentYear === now.getFullYear()
            return (
              <div
                key={day}
                className={`bg-[#F6F8F4] min-h-[80px] p-1.5 relative ${isToday ? 'ring-1 ring-[#16803C]/40' : ''}`}
              >
                <span className={`text-xs font-medium ${isToday ? 'text-[#16803C]' : 'text-[#647067]'}`}>
                  {day}
                </span>
                <div className="mt-1 space-y-0.5">
                  {dayBookings.slice(0, 3).map((b) => (
                    <Link
                      key={b.id}
                      to={`/business-owner/bookings/${b.id}`}
                      className="block px-1 py-0.5 rounded text-[10px] font-medium truncate hover:bg-[#F3F8F4] transition bg-[#EAF6ED] text-[#4B5563] border border-[#D7E8DB]"
                    >
                      {b.customer_name}
                    </Link>
                  ))}
                  {dayBookings.length > 3 && (
                    <span className="block text-[10px] text-[#647067] px-1">+{dayBookings.length - 3} more</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="text-xs text-[#647067]">
          {filtered.length} booking{filtered.length !== 1 ? 's' : ''} this month
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#647067] uppercase tracking-wider px-1">
          {MONTH_NAMES[currentMonth]} Bookings
        </h3>
        {grouped.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
            <CalendarDays className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#17201A] mb-2">No Bookings</h3>
            <p className="text-[#647067]">No bookings found for {MONTH_NAMES[currentMonth]} {currentYear}.</p>
          </div>
        ) : (
          grouped.map(([date, bookings]) => (
            <div key={date} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <h4 className="text-sm font-semibold text-[#17201A]">
                  {date === 'no-date' ? 'No Date' : formatDate(date)}
                  <span className="ml-2 text-xs font-normal text-[#647067]">({bookings.length})</span>
                </h4>
              </div>
              <div className="divide-y divide-[#E2E8E3]">
                {bookings.map((booking) => (
                  <Link
                    key={booking.id}
                    to={`/business-owner/bookings/${booking.id}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 hover:bg-[#F6F8F4] transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-[#EAF6ED] border border-[#D7E8DB] rounded-xl flex items-center justify-center shrink-0">
                        <CalendarDays className="w-5 h-5 text-[#16803C]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#17201A]">{booking.booking_number}</span>
                          <StatusBadge status={booking.status} />
                        </div>
                        <p className="text-sm text-[#647067] mt-0.5">
                          {booking.customer_name} &bull; {booking.booking_type?.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 sm:mr-2">
                      {booking.check_in_date && (
                        <div className="text-xs text-[#647067]">
                          <span className="block text-[#647067]">Check-in</span>
                          {formatDate(booking.check_in_date)}
                          {booking.check_out_date && (
                            <span> → {formatDate(booking.check_out_date)}</span>
                          )}
                        </div>
                      )}
                      <span className="text-sm font-semibold text-[#16803C] whitespace-nowrap">
                        {formatCurrency(booking.total_amount)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
