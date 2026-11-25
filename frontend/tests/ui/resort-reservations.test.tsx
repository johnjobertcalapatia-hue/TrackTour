import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Resort reservations Stage 7: the tourist's Reserve builder, the tourist's and
 * the owner's reservation pages, and the owner's cancellation policy.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, default: { get: api.get }, apiErrorMessage: (_e: unknown, f: string) => f }))

import ReserveBuilder from '@/features/tourist/components/resort/ReserveBuilder'
import { availableFor, toLines } from '@/features/tourist/components/resort/reserve-helpers'
import type { ResortOfferingItem } from '@/features/tourist/components/resort/ResortDetail'
import TouristReservationShow from '@/features/tourist/pages/TouristReservationShow'
import BusinessOwnerBookingShow from '@/features/business-owner/pages/BusinessOwnerBookingShow'
import CancellationPolicyPanel from '@/features/business-owner/components/resort/CancellationPolicyPanel'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { browser } from '@/shared/services/browser'
import type { User } from '@/shared/types'

const TOURIST: User = { id: 9, name: 'Ana Cruz', email: 'ana@example.com', role: 'tourist', account_status: 'approved', email_verified_at: null, created_at: '', updated_at: '' }

const offering = (o: Partial<ResortOfferingItem> & { id: number; name: string }): ResortOfferingItem => ({
  category: 'cottage', category_label: 'Cottage', description: null, booking_mode: 'day_use', pricing_basis: 'per_unit', price: 300,
  inventory_mode: 'units', inventory_quantity: 2, min_guests: null, max_guests: 8, duration_minutes: null, is_required: false,
  bookable_independently: true, requires_offering_name: null, requires_offering_id: null, images: [], ...o,
})
const ENTRANCE = offering({ id: 1, name: 'Entrance', category: 'other', pricing_basis: 'per_person', price: 20, inventory_mode: 'capacity', inventory_quantity: 300, max_guests: null, is_required: true })
const COTTAGE = offering({ id: 2, name: 'Cottage' })
const VIDEOKE = offering({ id: 3, name: 'Videoke', category: 'equipment', price: 200, inventory_quantity: 3, bookable_independently: false, requires_offering_id: 2, requires_offering_name: 'Cottage' })
const OFFERINGS = [ENTRANCE, COTTAGE, VIDEOKE]

const CALENDAR = {
  closed_dates: [],
  offerings: [
    { id: 1, capacity: 300, booking_mode: 'day_use', dates: [{ date: '2099-01-01', available: 296, blocked: false, closed: false }] },
    { id: 2, capacity: 2, booking_mode: 'day_use', dates: [{ date: '2099-01-01', available: 1, blocked: false, closed: false }] },
    { id: 3, capacity: 3, booking_mode: 'day_use', dates: [{ date: '2099-01-01', available: 3, blocked: false, closed: false }] },
  ],
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  useAuthStore.setState({ user: TOURIST, loading: false })
})

const renderBuilder = () => render(
  <QueryClientProvider client={client()}>
    <MemoryRouter><ReserveBuilder businessId={7} businessName="RJM Beach Resort" offerings={OFFERINGS} policySummary="Free cancellation until 3 days before check-in." onClose={() => {}} /></MemoryRouter>
  </QueryClientProvider>,
)

describe('Reserve builder', () => {
  beforeEach(() => {
    api.get.mockResolvedValue(CALENDAR)
    api.post.mockImplementation(async (url: string, body: { lines: { offering_id: number; quantity: number }[] }) => {
      if (url.endsWith('/quote')) {
        const lines = body.lines.map((l) => ({ offering_id: l.offering_id, name: OFFERINGS.find((o) => o.id === l.offering_id)!.name, amount: l.offering_id === 1 ? 40 : 300, quantity: l.quantity, people: 2, nights: 1, slot: null }))
        return { check_in: '2099-01-01', check_out: null, nights: 0, guests: 2, lines, total: lines.reduce((s, l) => s + l.amount, 0), policy: { summary: 'Free cancellation until 3 days before check-in.' } }
      }
      return { id: 41, booking_number: 'RS-261201-ABCDE' }
    })
  })

  it('asks a guest to log in first', () => {
    useAuthStore.setState({ user: null, loading: false })
    renderBuilder()
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('includes the required entrance for the whole party and shows what is left', async () => {
    renderBuilder()
    expect(screen.getByTestId('rsv-qty-1')).toHaveTextContent('2')
    expect(await within(screen.getByTestId('rsv-offering-2')).findByText(/1 left/)).toBeInTheDocument()
    expect(within(screen.getByTestId('rsv-offering-3')).getByText(/Only with Cottage/)).toBeInTheDocument()
    expect(within(screen.getByTestId('rsv-offering-3')).getByRole('button', { name: 'More Videoke' })).toBeDisabled()
    // Changing the party size changes the entrance.
    fireEvent.change(screen.getByLabelText(/Guests/), { target: { value: '4' } })
    expect(screen.getByTestId('rsv-qty-1')).toHaveTextContent('4')
  })

  it('prices the stay on the server and sends the reservation once with pay at the resort', async () => {
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: 'More Cottage' }))
    expect(screen.getByRole('button', { name: 'More Cottage' })).toBeDisabled() // only 1 left
    expect(within(screen.getByTestId('rsv-offering-3')).getByRole('button', { name: 'More Videoke' })).toBeEnabled()

    expect(await screen.findByTestId('rsv-total')).toHaveTextContent('₱340.00')
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } })
    fireEvent.click(screen.getByRole('button', { name: /Reserve · ₱340.00/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/resorts/7/reservations', expect.objectContaining({
      customer_name: 'Ana Cruz', customer_phone: '09171234567', payment_option: 'pay_at_resort',
      lines: [{ offering_id: 1, quantity: 2 }, { offering_id: 2, quantity: 1, guests: 2 }],
      client_reference: expect.stringMatching(/^rsv-/),
    })))
    expect(await screen.findByText('Reservation RS-261201-ABCDE sent')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View my reservation' })).toHaveAttribute('href', '/tourist/reservations/41')
  })
})

describe('Reserve builder: GCash (Stage 8)', () => {
  beforeEach(() => {
    api.get.mockResolvedValue(CALENDAR)
    api.post.mockImplementation(async (url: string, body: { lines?: { offering_id: number; quantity: number }[] }) => {
      if (url.endsWith('/quote')) return { check_in: '2099-01-01', check_out: null, nights: 0, guests: 2, lines: [{ offering_id: 1, name: 'Entrance', amount: 40, quantity: 2, people: 2, nights: 1, slot: null }], total: 40, policy: { summary: 'Policy' } }
      if (url === '/payments/create-intent') return { payment_number: 'PAY-1', checkout_url: 'https://checkout.paymongo.test/abc' }
      return { id: 42, booking_number: 'RS-261201-GCASH', payment_option: 'gcash', ...body }
    })
  })

  it('reserves with GCash and goes straight to the PayMongo checkout', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {})
    renderBuilder()
    fireEvent.click(screen.getByLabelText(/GCash online/))
    expect(await screen.findByTestId('rsv-total')).toHaveTextContent('₱40.00')
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } })
    fireEvent.click(screen.getByRole('button', { name: /Reserve & pay · ₱40.00/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/resorts/7/reservations', expect.objectContaining({ payment_option: 'gcash' })))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/payments/create-intent', { payable_type: 'booking', payable_id: 42, method: 'gcash' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://checkout.paymongo.test/abc'))
    expect(screen.getByText(/held for 30 minutes/)).toBeInTheDocument()
    go.mockRestore()
  })

  it('offers Pay now on the reservation page when GCash cannot open', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/quote')) return { check_in: '2099-01-01', check_out: null, nights: 0, guests: 2, lines: [], total: 40, policy: { summary: 'Policy' } }
      if (url === '/payments/create-intent') throw new Error('down')
      return { id: 42, booking_number: 'RS-261201-GCASH' }
    })
    renderBuilder()
    fireEvent.click(screen.getByLabelText(/GCash online/))
    await screen.findByTestId('rsv-total')
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } })
    fireEvent.click(screen.getByRole('button', { name: /Reserve & pay/ }))
    expect(await screen.findByRole('link', { name: 'Pay now' })).toHaveAttribute('href', '/tourist/reservations/42')
  })
})

describe('helpers', () => {
  it('uses the lowest availability over the nights and sends guests for unit offerings only', () => {
    const cal = { closed_dates: [], offerings: [{ id: 5, capacity: 2, booking_mode: 'overnight', dates: [{ date: 'a', available: 2, blocked: false, closed: false }, { date: 'b', available: 0, blocked: false, closed: false }] }] }
    expect(availableFor(cal, 5)).toBe(0)
    expect(toLines({ 1: { quantity: 3 }, 2: { quantity: 1, guests: 4 } }, OFFERINGS)).toEqual([{ offering_id: 1, quantity: 3 }, { offering_id: 2, quantity: 1, guests: 4 }])
  })
})

const RESERVATION = {
  id: 41, booking_number: 'RS-261201-ABCDE', booking_type: 'resort', business: { id: 7, business_name: 'RJM Beach Resort' },
  customer_name: 'Ana Cruz', customer_phone: '09171234567', customer_email: 'ana@example.com',
  check_in_date: '2099-01-01', check_out_date: null, number_of_guests: 2, special_requests: 'Arriving at 9 AM',
  status: 'pending', subtotal: 340, total_amount: 340, paid_amount: 0, payment_status: 'unpaid', payment_option: 'pay_at_resort',
  cancellation_policy: { free_days: 3, penalty_percent: 50, summary: 'Free cancellation until 3 days before check-in; after that, 50% of what you paid online is kept by the resort.' },
  cancellation_reason: null, created_at: '2098-12-01T00:00:00Z',
  items: [
    { id: 1, resort_offering_id: 1, name: 'Entrance', category: 'other', booking_mode: 'day_use', pricing_basis: 'per_person', quantity: 2, units: null, guests: 2, nights: 1, unit_price: 20, subtotal: 40, start_date: '2099-01-01', end_date: '2099-01-01', slot: null },
    { id: 2, resort_offering_id: 2, name: 'Cottage', category: 'cottage', booking_mode: 'day_use', pricing_basis: 'per_unit', quantity: 1, units: 1, guests: 2, nights: 1, unit_price: 300, subtotal: 300, start_date: '2099-01-01', end_date: '2099-01-01', slot: null },
  ],
  status_logs: [{ from_status: null, to_status: 'pending', actor_type: 'tourist', reason: null, created_at: '2098-12-01T00:00:00Z' }],
}

describe('Tourist reservation page', () => {
  const renderPage = () => render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/tourist/reservations/41']}>
        <Routes><Route path="/tourist/reservations/:id" element={<TouristReservationShow />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  it('shows the reservation and cancels it', async () => {
    api.get.mockResolvedValue({ ...RESERVATION, can_cancel: true })
    api.post.mockResolvedValue({ ...RESERVATION, status: 'cancelled', can_cancel: false })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'RJM Beach Resort' })).toBeInTheDocument()
    expect(screen.getByTestId('reservation-status')).toHaveTextContent('Waiting for confirmation')
    expect(screen.getByTestId('reservation-total')).toHaveTextContent('₱340.00')
    expect(screen.getByText(/1 unit · 2 people/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    expect(screen.getAllByText('Nothing was paid online, so cancelling costs nothing.').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Change of plans' } })
    fireEvent.click(within(screen.getByRole('heading', { name: 'Cancel this reservation?' }).closest('form')!).getByRole('button', { name: 'Cancel reservation' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/reservations/41/cancel', { reason: 'Change of plans' }))
  })

  it('a GCash hold shows Pay with GCash and the time left', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {})
    api.get.mockResolvedValue({ ...RESERVATION, payment_option: 'gcash', payment_status: 'awaiting_payment', awaiting_payment: true, can_cancel: true, payment_due_at: new Date(Date.now() + 25 * 60000).toISOString() })
    api.post.mockResolvedValue({ payment_number: 'PAY-2', checkout_url: 'https://checkout.paymongo.test/again' })
    renderPage()
    expect(await screen.findByTestId('awaiting-payment')).toHaveTextContent('Pay ₱340.00 with GCash within 25 minutes.')
    fireEvent.click(screen.getByRole('button', { name: 'Pay with GCash' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://checkout.paymongo.test/again'))
    go.mockRestore()
  })

  it('cancelling a paid reservation says what comes back, and refunds are shown', async () => {
    api.get.mockResolvedValue({ ...RESERVATION, status: 'confirmed', payment_option: 'gcash', payment_status: 'paid', paid_amount: 340, can_cancel: true, cancel_refund: { percent: 50, amount: 170 }, refund: { due: 0, refunded: 0, in_flight: 0, status: 'none', failed_attempts: 0 } })
    renderPage()
    expect(await screen.findByTestId('reservation-payment')).toHaveTextContent('₱340.00 paid online')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    expect(screen.getByTestId('cancel-refund')).toHaveTextContent('You get ₱170.00 back (50%)')
  })

  it('shows a refund in progress', async () => {
    api.get.mockResolvedValue({ ...RESERVATION, status: 'cancelled', payment_option: 'gcash', payment_status: 'paid', paid_amount: 340, can_cancel: false, refund: { due: 340, refunded: 0, in_flight: 340, status: 'pending', failed_attempts: 0 } })
    renderPage()
    expect(await screen.findByTestId('reservation-refund')).toHaveTextContent('Refund of ₱340.00 is on its way')
  })

  it('hides Cancel when it is too late', async () => {
    api.get.mockResolvedValue({ ...RESERVATION, status: 'confirmed', can_cancel: false })
    renderPage()
    expect(await screen.findByTestId('reservation-status')).toHaveTextContent('Confirmed')
    expect(screen.queryByRole('button', { name: 'Cancel reservation' })).toBeNull()
  })
})

describe('Owner reservation page', () => {
  const renderPage = () => render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/business-owner/bookings/41']}>
        <Routes><Route path="/business-owner/bookings/:id" element={<BusinessOwnerBookingShow />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  it('confirms, and rejects only with a reason', async () => {
    api.get.mockResolvedValue({ ...RESERVATION, actions: ['confirm', 'reject', 'cancel'] })
    api.patch.mockResolvedValue({})
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Ana Cruz' })).toBeInTheDocument()
    expect(screen.getByText('“Arriving at 9 AM”')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Reservation actions' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Confirm reservation', 'Reject', 'Cancel reservation'])

    fireEvent.click(within(group).getByRole('button', { name: 'Reject' }))
    const reject = screen.getAllByRole('button', { name: 'Reject' }).at(-1)!
    expect(reject).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Fully booked for a private event' } })
    fireEvent.click(reject)
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/business-owner/bookings/41/status', { status: 'rejected', reason: 'Fully booked for a private event' }))

    fireEvent.click(within(group).getByRole('button', { name: 'Confirm reservation' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/business-owner/bookings/41/status', { status: 'confirmed', reason: undefined }))
  })
})

describe('Owner cancellation policy', () => {
  it('shows the policy and saves a new one', async () => {
    api.get.mockResolvedValue({ free_days: 3, penalty_percent: 50, summary: 'Free cancellation until 3 days before check-in.', limits: { free_days: { min: 0, max: 14 }, penalty_percent: { min: 0, max: 100 } } })
    api.put.mockResolvedValue({})
    render(<QueryClientProvider client={client()}><CancellationPolicyPanel businessId={7} /></QueryClientProvider>)
    expect(await screen.findByTestId('policy-summary')).toHaveTextContent('Free cancellation until 3 days before check-in.')
    expect(screen.getByText('Allowed 0–14 days')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Free cancellation until/), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(/Kept after that/), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/business-owner/businesses/7/resort-policy', { free_days: 7, penalty_percent: 30 }))
  })
})
