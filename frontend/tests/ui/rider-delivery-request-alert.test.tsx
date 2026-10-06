import { act } from '@testing-library/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RiderDeliveryRequestAlert, {
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

describe('RiderDeliveryRequestAlert (the rider "New Order" ping card)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('renders nothing when there is no incoming order', () => {
    const { container } = render(
      <RiderDeliveryRequestAlert orderData={null} onAccept={vi.fn()} onDecline={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the full incoming-order card a rider sees for a live ping', () => {
    render(<RiderDeliveryRequestAlert orderData={OFFER} onAccept={vi.fn()} onDecline={vi.fn()} />)

    // New-order / live-offer indicators
    expect(screen.getByText(/live delivery offer/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /new booking request/i })).toBeInTheDocument()

    // Reference + item count
    expect(screen.getByText(/TT-00099/)).toBeInTheDocument()
    expect(screen.getByText(/2\s*Items/)).toBeInTheDocument()
    expect(screen.getAllByText('Restaurant A').length).toBeGreaterThanOrEqual(1)

    // Item lines from the shared order
    expect(screen.getAllByText(/1\s*×/)).toHaveLength(2)
    expect(screen.getByText('Burger')).toBeInTheDocument()
    expect(screen.getByText(/₱\s*120\.00/)).toBeInTheDocument()
    expect(screen.getByText('Fries')).toBeInTheDocument()
    expect(screen.getByText(/₱\s*80\.00/)).toBeInTheDocument()
    expect(screen.getByText(/₱\s*480\.00/)).toBeInTheDocument()

    // Pickup location
    expect(screen.getByText(/pickup location/i)).toBeInTheDocument()
    expect(screen.getByText('123 Aquino St, Bansud')).toBeInTheDocument()

    // Destination
    expect(screen.getByText(/dropoff destination/i)).toBeInTheDocument()
    expect(screen.getByText('456 Mabini St, Bansud')).toBeInTheDocument()

    // Trip metrics (distance + estimated duration)
    expect(screen.getByText(/2.4 km/)).toBeInTheDocument()
    expect(screen.getByText('15 mins')).toBeInTheDocument()

    // Fare / guaranteed payout
    expect(screen.getByText(/guaranteed rider payout/i)).toBeInTheDocument()
    expect(screen.getByText(/₱\s*60\.00/)).toBeInTheDocument()

    // Offer expiration countdown
    expect(screen.getByText(/offer expiration warning/i)).toBeInTheDocument()

    // Accept + Decline actions
    expect(screen.getByRole('button', { name: /accept order request/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline offer/i })).toBeInTheDocument()
  })

  it('calls onAccept when the rider presses the Accept button', () => {
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

  it('declines automatically when the offer expires', () => {
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

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onDecline).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})