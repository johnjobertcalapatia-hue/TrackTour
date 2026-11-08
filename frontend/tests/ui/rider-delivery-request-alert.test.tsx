import { act } from '@testing-library/react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RiderDeliveryRequestAlert, {
  formatCountdown,
  offerMinutesLine,
  type RiderDeliveryRequestData,
} from '@/features/rider/components/RiderDeliveryRequestAlert'

const OFFER: RiderDeliveryRequestData = {
  id: 1,
  delivery_id: 42,
  order_id: 99,
  order_number: 'TT-00099',
  business_name: 'Restaurant A',
  pickup_address: '123 Aquino St, Bansud',
  business_address: '123 Aquino St, Bansud',
  delivery_address: '456 Mabini St, Bansud',
  subtotal: 480,
  rider_payout: 60,
  distance_km: 2.4,
  duration_minutes: 15,
  items: [
    { name: 'Burger', quantity: 1, price: 120, subtotal: 120 },
    { name: 'Fries', quantity: 1, price: 80, subtotal: 80 },
  ],
  restaurant_count: 1,
  expires_in: 45,
  initial_timeout: 45,
  dispatched_at: '2026-09-24T00:00:00Z',
}

/** The card facts the server now sends (RiderDispatchController::offerCardFacts). */
const CARD: RiderDeliveryRequestData = {
  ...OFFER,
  business_name: 'BBQ House Bansud',
  business_address: 'Brgy. San Jose, Bansud',
  delivery_address: null,
  distance_km: 1.2,
  image: 'offerings/bbq.jpg',
  items_count: 1,
  is_cod: true,
  is_group: true,
  pickup_minutes: 3,
  dropoff_minutes: 8,
  initial_timeout: 85,
}

describe('RiderDeliveryRequestAlert (the rider delivery offer popup)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('renders nothing when there is no incoming order', () => {
    const { container } = render(
      <RiderDeliveryRequestAlert orderData={null} onAccept={vi.fn()} onDecline={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the offer card: pills, photo, restaurant, distance, tourist location, chips and minutes', () => {
    render(<RiderDeliveryRequestAlert orderData={CARD} onAccept={vi.fn()} onDecline={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'BBQ House Bansud' })
    const d = within(dialog)
    expect(d.getByText('New Delivery Offer')).toBeInTheDocument()
    expect(d.getByRole('timer')).toHaveTextContent('00:01:25')
    expect(dialog.querySelector('img')?.getAttribute('src')).toMatch(/\/storage\/offerings\/bbq\.jpg$/)
    expect(d.getByText('Brgy. San Jose, Bansud')).toBeInTheDocument()
    expect(d.getByText(/1\.2 km/)).toBeInTheDocument()
    expect(d.getByText('Tourist Location')).toBeInTheDocument()

    const facts = within(d.getByRole('list', { name: 'Order facts' }))
    expect(facts.getByText(/1 item/)).toBeInTheDocument()
    expect(facts.getByText(/Group Order/)).toBeInTheDocument()
    expect(facts.getByText(/COD/)).toBeInTheDocument()

    expect(d.getByRole('button', { name: 'Pickup: 3 min • Drop-off: 8 min' })).toHaveAttribute('aria-expanded', 'false')
    expect(d.getByRole('button', { name: /decline offer/i })).toHaveTextContent('Decline')
    expect(d.getByRole('button', { name: /accept order request/i })).toHaveTextContent('Accept')
  })

  it('a solo prepaid order shows neither the group nor the COD chip', () => {
    render(<RiderDeliveryRequestAlert orderData={{ ...CARD, is_group: false, is_cod: false, image: null }} onAccept={vi.fn()} onDecline={vi.fn()} />)
    const facts = within(screen.getByRole('list', { name: 'Order facts' }))
    expect(facts.queryByText(/Group Order/)).not.toBeInTheDocument()
    expect(facts.getByText('Paid online')).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
  })

  it('tapping the minutes bar shows the order number, items and payout', () => {
    render(<RiderDeliveryRequestAlert orderData={OFFER} onAccept={vi.fn()} onDecline={vi.fn()} />)
    expect(screen.queryByText('Burger')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Drop-off: 15 min/ }))

    const details = within(screen.getByTestId('offer-details'))
    expect(details.getByText(/TT-00099/)).toBeInTheDocument()
    expect(details.getByText('Burger')).toBeInTheDocument()
    expect(details.getByText('Fries')).toBeInTheDocument()
    expect(details.getByText(/₱\s*480\.00/)).toBeInTheDocument()
    expect(details.getByText('Your payout')).toBeInTheDocument()
    expect(details.getByText(/₱\s*60\.00/)).toBeInTheDocument()
  })

  it('calls onAccept when the rider presses Accept', () => {
    const onAccept = vi.fn()
    render(<RiderDeliveryRequestAlert orderData={OFFER} onAccept={onAccept} onDecline={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /accept order request/i }))

    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('calls onDecline when the rider presses Decline', () => {
    const onDecline = vi.fn()
    render(<RiderDeliveryRequestAlert orderData={OFFER} onAccept={vi.fn()} onDecline={onDecline} />)

    fireEvent.click(screen.getByRole('button', { name: /decline offer/i }))

    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('counts down and declines automatically when the offer expires', () => {
    vi.useFakeTimers()
    try {
      const onDecline = vi.fn()
      render(
        <RiderDeliveryRequestAlert
          orderData={{ ...OFFER, initial_timeout: 2, expires_in: 2 }}
          onAccept={vi.fn()}
          onDecline={onDecline}
        />
      )
      expect(screen.getByRole('timer')).toHaveTextContent('00:00:02')

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onDecline).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('offer popup formatting', () => {
  it('formats the countdown as hh:mm:ss', () => {
    expect(formatCountdown(85)).toBe('00:01:25')
    expect(formatCountdown(30)).toBe('00:00:30')
    expect(formatCountdown(-3)).toBe('00:00:00')
  })

  it('builds the minutes line, estimating pickup from distance when the server sent none', () => {
    expect(offerMinutesLine({ pickup_minutes: 3, dropoff_minutes: 8 })).toBe('Pickup: 3 min • Drop-off: 8 min')
    // 2.4 km at 25 km/h ≈ 5.8 → 6 min; drop-off falls back to the trip duration.
    expect(offerMinutesLine({ distance_km: 2.4, duration_minutes: 15 })).toBe('Pickup: 6 min • Drop-off: 15 min')
    expect(offerMinutesLine({})).toBeNull()
  })
})
