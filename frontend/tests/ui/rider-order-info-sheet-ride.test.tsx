import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

const trip = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/features/rider/context/RiderActiveTripContext', () => ({ useRiderActiveTrip: () => trip.value }))

import RiderOrderInfoSheet from '@/features/rider/components/RiderOrderInfoSheet'

// 2026-11-11: a ride booking on the rider map is not a restaurant order.
const RIDE = {
  id: 13,
  order_id: 13,
  order_number: 'TRP-6AF362EB5E076',
  order_type: 'transport',
  status: 'picked_up',
  pickup_address: 'Gloria, Oriental Mindoro',
  pickup_lat: 12.97,
  pickup_lng: 121.47,
  delivery_address: 'Pag-asa, Bansud, Oriental Mindoro',
  delivery_lat: 12.86,
  delivery_lng: 121.45,
  business_name: null,
  customer_name: 'Jayvie De Torres',
  created_at: '2026-11-11T02:31:00Z',
}

describe('Rider map sheet for a ride booking', () => {
  beforeEach(() => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(url === '/rider/map/location' ? { deliveries: [RIDE] } : { eligibility: {}, orders: [] }),
    )
    trip.value = {
      activeDelivery: RIDE,
      tripState: 'OUT_FOR_DELIVERY',
      riderPosition: [12.9, 121.46],
      positionKnown: true,
      pickupStopsData: null,
      confirmArrivalStop: vi.fn(), confirmArrivalBusy: false, confirmArrivalError: null,
      confirmPickupStop: vi.fn(), confirmStopBusy: false, confirmStopError: null,
    }
  })

  it('shows Booking details with the passenger and drop-off, never a restaurant', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RiderOrderInfoSheet />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Show booking details' }))

    const sheet = within(screen.getByRole('button', { name: 'Hide booking details' }).parentElement!)
    expect(sheet.getByText('Booking #TRP-6AF362EB5E076')).toBeInTheDocument()
    expect(sheet.getByText('On the way')).toBeInTheDocument()
    expect(sheet.getByText('Pickup · Passenger')).toBeInTheDocument()
    expect(sheet.getByText('Jayvie De Torres')).toBeInTheDocument()
    expect(sheet.getByText('Drop-off')).toBeInTheDocument()
    expect(sheet.getByText('Pag-asa, Bansud, Oriental Mindoro')).toBeInTheDocument()
    for (const food of ['Restaurant', 'Order details', 'Picked Up', 'Delivery', /Order #/]) {
      expect(sheet.queryByText(food)).toBeNull()
    }
  })
})
