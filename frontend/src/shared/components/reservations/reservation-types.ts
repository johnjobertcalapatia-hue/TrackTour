/**
 * Resort reservations (Stage 7, docs/resort-reservation-architecture.md §11):
 * the booking as BookingResource returns it, shared by the tourist and owner views.
 */
export type ReservationStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed' | 'no_show' | 'expired'

export interface ReservationItem {
  id: number
  resort_offering_id: number | null
  name: string
  category: string | null
  booking_mode: string | null
  pricing_basis: string | null
  quantity: number
  units: number | null
  guests: number | null
  nights: number | null
  unit_price: number | null
  subtotal: number | null
  start_date: string | null
  end_date: string | null
  slot: string | null
}

export interface ReservationLog {
  from_status: string | null
  to_status: string
  actor_type: string
  reason: string | null
  created_at: string
}

export interface Reservation {
  id: number
  booking_number: string
  booking_type: string
  business?: { id: number; name?: string; business_name?: string } | null
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  check_in_date: string
  check_out_date: string | null
  number_of_guests: number
  special_requests: string | null
  status: ReservationStatus | string
  subtotal: number | string | null
  total_amount: number | string
  paid_amount: number | string
  payment_status: string | null
  payment_option: string | null
  cancellation_policy: { free_days: number; penalty_percent: number; summary: string } | null
  cancellation_reason: string | null
  items: ReservationItem[]
  status_logs?: ReservationLog[]
  created_at: string
  /** Tourist view. */
  can_cancel?: boolean
  /** Owner view: status changes allowed now. */
  actions?: ('confirm' | 'reject' | 'cancel' | 'complete' | 'no_show')[] | null
  /** Stage 8: GCash hold, refund preview and refunds. */
  payment_due_at?: string | null
  awaiting_payment?: boolean
  cancel_refund?: { percent: number; amount: number } | null
  refund?: RefundInfo | null
}

export interface RefundInfo {
  due: number
  refunded: number
  in_flight: number
  status: 'none' | 'pending' | 'refunded' | 'failed'
  failed_attempts: number
}

export const RESERVATION_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Waiting for confirmation', tone: 'bg-[#FFF6DB] text-[#7A5A00]' },
  confirmed: { label: 'Confirmed', tone: 'bg-[#E9F7EF] text-[#16803C]' },
  rejected: { label: 'Not accepted', tone: 'bg-[#FDECEC] text-[#B91C1C]' },
  cancelled: { label: 'Cancelled', tone: 'bg-[#F1F3F2] text-[#56615B]' },
  completed: { label: 'Completed', tone: 'bg-[#E9F7EF] text-[#126B32]' },
  no_show: { label: 'No-show', tone: 'bg-[#FDECEC] text-[#B91C1C]' },
  expired: { label: 'Expired (not paid)', tone: 'bg-[#F1F3F2] text-[#56615B]' },
}

export const PAYMENT_OPTION_LABEL: Record<string, string> = {
  pay_at_resort: 'Pay at the resort',
  gcash: 'GCash (online)',
}

const BASIS: Record<string, string> = {
  per_person: 'person',
  per_unit: 'unit',
  per_night: 'night',
  per_hour: 'hour',
  per_booking: 'booking',
}

export const peso = (v: number | string | null | undefined) =>
  `₱${Number(v ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const reservationDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '—'

export function stayLabel(r: Pick<Reservation, 'check_in_date' | 'check_out_date'>): string {
  return r.check_out_date ? `${reservationDay(r.check_in_date)} → ${reservationDay(r.check_out_date)}` : reservationDay(r.check_in_date)
}

/** "2 units · 4 guests · 2 nights · 9:00 AM" for an item. */
export function itemDetail(item: ReservationItem): string {
  const parts: string[] = []
  if (item.units) parts.push(`${item.units} unit${item.units === 1 ? '' : 's'}`)
  if (item.guests) parts.push(`${item.guests} ${item.guests === 1 ? 'person' : 'people'}`)
  if (item.nights && item.booking_mode === 'overnight') parts.push(`${item.nights} night${item.nights === 1 ? '' : 's'}`)
  if (item.slot) parts.push(item.slot)
  if (item.unit_price != null && item.pricing_basis) parts.push(`${peso(item.unit_price)} / ${BASIS[item.pricing_basis] ?? item.pricing_basis}`)
  return parts.join(' · ')
}

export const ACTOR_LABEL: Record<string, string> = { tourist: 'Guest', owner: 'Resort', staff: 'Resort staff', system: 'TrackTour' }
