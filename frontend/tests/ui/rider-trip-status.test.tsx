import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PickupStop, PickupStopsData } from '@/features/rider/pickup-stops'
import { deliveryConditions, dropoffArrivalConditions, stepState, stopAction, stopConditions, tripStage } from '@/features/rider/trip-steps'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

const trip = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/features/rider/context/RiderActiveTripContext', () => ({ useRiderActiveTrip: () => trip.value }))

import RiderTripStatus from '@/features/rider/pages/RiderTripStatus'

const stop = (over: Partial<PickupStop>): PickupStop => ({
  id: 1, business_id: 10, business_name: 'Ekslusibo Grill', sequence: 1, preparation_time: 10,
  pickup_lat: 12.8, pickup_lng: 121.4, pickup_address: 'Pag-asa, Bansud', arrived_at: null, waiting_seconds: null,
  status: 'pending', pickup_confirmed_at: null, is_ready: true, ready_label: 'ready', ready_item_count: 1, active_item_count: 1,
  distance_meters: 20, can_confirm: false, reason: 'waiting_arrival', arrival_can_confirm: true, arrival_reason: null,
  items: [], cod_purchase: null, payment_confirmed: null,
  ...over,
})

const stopsData = (stops: PickupStop[], over: Partial<PickupStopsData> = {}): PickupStopsData => ({
  delivery_id: 6, is_cod: false, purchasing_cash: null, purchasing_cash_issued_at: null, purchasing_cash_received_at: null,
  fully_collected: false, pickup_origin: null, dropoff: null, stops, ...over,
})

describe('trip stage logic', () => {
  it('maps the delivery status to the current stage', () => {
    expect(tripStage('assigned')).toBe(2)
    expect(tripStage('arrived_pickup')).toBe(2)
    expect(tripStage('picked_up')).toBe(3)
    expect(tripStage('in_transit', true)).toBe(4)
    expect(tripStage('arrived_destination')).toBe(4)
    expect(tripStage('delivered')).toBe('done')
    expect(tripStage('cancelled')).toBe('cancelled')
    expect(stepState(1, 2)).toBe('done')
    expect(stepState(2, 2)).toBe('current')
    expect(stepState(4, 2)).toBe('upcoming')
    expect(stepState(4, 'done')).toBe('done')
  })

  it('a restaurant row goes Confirm Arrival → Confirm Pick Up → Picked Up, current stop only', () => {
    const a = stop({ id: 1, sequence: 1 })
    const b = stop({ id: 2, business_id: 20, sequence: 2, business_name: 'BBQ House' })
    expect(stopAction(a, stopsData([a, b]))).toEqual({ kind: 'arrive', enabled: true, hint: null })
    expect(stopAction(b, stopsData([a, b]))).toMatchObject({ kind: 'arrive', enabled: false })

    const arrived = { ...a, arrived_at: '2026-11-08T04:00:00Z', can_confirm: true, reason: null }
    expect(stopAction(arrived, stopsData([arrived, b]))).toEqual({ kind: 'pickup', enabled: true, hint: null })

    const notReady = { ...arrived, can_confirm: false, reason: 'waiting_ready' as const }
    expect(stopAction(notReady, stopsData([notReady, b]))).toMatchObject({ kind: 'pickup', enabled: false, hint: 'The restaurant is still preparing your order.' })

    expect(stopAction({ ...a, status: 'collected' }, stopsData([a, b]))).toEqual({ kind: 'collected' })
  })

  it('COD: pickup never waits for a per-delivery cash issue (daily advance)', () => {
    const arrived = stop({ arrived_at: '2026-11-08T04:00:00Z', can_confirm: true, reason: null })
    expect(stopAction(arrived, stopsData([arrived], { is_cod: true, purchasing_cash_issued_at: null, purchasing_cash_received_at: null })))
      .toEqual({ kind: 'pickup', enabled: true, hint: null })
  })
})

const OFFER = {
  id: 6, availability: 'mine', status: 'assigned', is_mine: true, offered_to_me: false,
  order_id: 9, order_number: 'TT-62973', delivery_speed: 'standard', delivery_type_label: 'Standard Delivery',
  pickup_names: ['Ekslusibo Grill', 'BBQ House'], items_count: 2, rider_tip: 0, delivery_fee: 197.2, distance_km: 10.6,
  payment_method: 'gcash', is_cod: false, estimated_duration_minutes: 20, created_at: '2026-11-04T04:10:00Z',
  pickup: { address: 'Pag-asa, Bansud', latitude: 12.8, longitude: 121.4 },
  dropoff: { address: 'Bansud, Oriental Mindoro', latitude: 12.86, longitude: 121.45 },
  pickups: [
    { id: 10, name: 'Ekslusibo Grill', address: 'Pag-asa, Bansud', logo: null, items_count: 1 },
    { id: 20, name: 'BBQ House', address: 'Brgy. San Jose, Bansud', logo: 'logos/bbq.png', items_count: 1 },
  ],
  items: [{ id: 1, business_id: 10, product_name: 'Sisig', quantity: 1, unit_price: 100, subtotal: 100, notes: null, image: 'offerings/sisig.jpg' }],
  items_total: 100, assigned_at: '2026-11-04T04:15:00Z', rider_earnings: 87.2, customer_name: 'Ana', customer_phone: '09171234567',
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/rider/deliveries/6/status']}>
        <Routes>
          <Route path="/rider/deliveries/:deliveryId/status" element={<RiderTripStatus />} />
          <Route path="/rider/map" element={<p>Live Map</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function setTrip(status: string, stops: PickupStop[], over: Record<string, unknown> = {}) {
  trip.value = {
    activeDelivery: { id: 6, status },
    tripState: 'EN_ROUTE_TO_PICKUP',
    pickupStopsData: stopsData(stops),
    busy: false, actionError: null, confirmStopBusy: false, confirmArrivalBusy: false, confirmStopError: null, confirmArrivalError: null,
    confirmArrivalStop: vi.fn(), confirmPickupStop: vi.fn(), onMarkPickedUp: vi.fn(), onArrivedDrop: vi.fn(), onConfirmDelivery: vi.fn(),
    // Live GPS: at the drop-off (OFFER.dropoff) unless a test moves the rider.
    positionKnown: true, riderPosition: [12.86, 121.45],
    ...over,
  }
}

describe('trip action conditions', () => {
  it("Confirm Arrival: the rider's turn and within the restaurant radius", () => {
    const a = stop({ id: 1, sequence: 1, distance_meters: 120, arrival_can_confirm: false, arrival_reason: 'too_far' })
    const b = stop({ id: 2, business_id: 20, sequence: 2, business_name: 'BBQ House' })
    expect(stopConditions(a, stopsData([a, b]))).toEqual([
      { label: 'Your turn in the pickup order', met: true },
      { label: 'Within 50 m of the restaurant (you are 120 m away)', met: false },
    ])
    expect(stopConditions(b, stopsData([a, b]))[0]).toEqual({ label: 'Your turn in the pickup order', met: false })
    const near = { ...a, distance_meters: 20, arrival_can_confirm: true, arrival_reason: null }
    expect(stopConditions(near, stopsData([near]))).toEqual([{ label: 'Within 50 m of the restaurant (you are 20 m away)', met: true }])
  })

  it('Confirm Pick Up: arrived, paid (COD only), ready and still in the pickup area', () => {
    const arrived = stop({ arrived_at: '2026-11-08T04:00:00Z', can_confirm: true, reason: null, payment_confirmed: true })
    expect(stopConditions(arrived, stopsData([arrived])).every((c) => c.met)).toBe(true)
    const prepaid = { ...arrived, payment_confirmed: null }
    expect(stopConditions(prepaid, stopsData([prepaid])).map((c) => c.label)).not.toContain('Restaurant confirmed your payment')
    const left = { ...arrived, reason: 'too_far' as const, distance_meters: 300 }
    expect(stopConditions(left, stopsData([left])).find((c) => c.label.startsWith('Within'))).toEqual({ label: 'Within 50 m of the restaurant (you are 300 m away)', met: false })
    expect(stopConditions({ ...arrived, status: 'collected' }, stopsData([arrived]))).toEqual([])
  })

  it('drop-off: arrival within 50 m, delivery within 50 m plus the photo', () => {
    expect(dropoffArrivalConditions(30, true)[1].met).toBe(true)
    expect(dropoffArrivalConditions(80, true)[1].met).toBe(false) // 50 m, not 100 m
    expect(dropoffArrivalConditions(1500, true)[1]).toEqual({ label: 'Within 50 m of the delivery address (you are 1.5 km away)', met: false })
    expect(dropoffArrivalConditions(null, false)[1].met).toBe(false)
    expect(deliveryConditions(30, true, true).every((c) => c.met)).toBe(true)
    expect(deliveryConditions(80, true, true)[0].met).toBe(false)
    expect(deliveryConditions(30, true, false)[1].met).toBe(false)
  })
})

describe('RiderTripStatus page', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockResolvedValue(OFFER)
  })

  it('shows the order header, the four stages with Pickup current, money and contact', async () => {
    setTrip('assigned', [
      stop({ id: 1, status: 'collected', pickup_confirmed_at: '2026-11-04T04:18:00Z' }),
      stop({ id: 2, business_id: 20, sequence: 2, business_name: 'BBQ House', pickup_address: 'Brgy. San Jose, Bansud', arrival_can_confirm: false, arrival_reason: 'too_far' }),
    ])
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Order #TT-62973' })).toBeInTheDocument()
    expect(screen.getByText('10.6 km • Group Order • 2 Restaurants • 1 Tourist Destination')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()

    const steps = within(screen.getByRole('list', { name: 'Delivery steps' })).getAllByRole('listitem').filter((li) => li.hasAttribute('data-step-state'))
    expect(steps.map((s) => s.getAttribute('data-step-state'))).toEqual(['done', 'current', 'upcoming', 'upcoming'])
    expect(screen.getByText('Nov 4, 2026 • 12:15 PM')).toBeInTheDocument()

    const grill = within(screen.getByRole('listitem', { name: 'Ekslusibo Grill' }))
    expect(grill.getByText('Picked Up')).toBeInTheDocument()
    expect(grill.queryByRole('button')).toBeNull()
    expect(screen.getByRole('listitem', { name: 'Ekslusibo Grill' }).querySelector('img')?.getAttribute('src')).toMatch(/offerings\/sisig\.jpg$/)

    const bbq = within(screen.getByRole('listitem', { name: 'BBQ House' }))
    expect(bbq.getByRole('button', { name: 'Confirm arrival at BBQ House' })).toBeDisabled()
    expect(bbq.getByText('Move closer to the restaurant to confirm arrival.')).toBeInTheDocument()

    expect(screen.getByText('Waiting for all pickups…')).toBeInTheDocument()
    expect(screen.getByText('Available after delivery arrival')).toBeInTheDocument()
    expect(screen.getByText('₱87.20')).toBeInTheDocument()
    expect(screen.getByText('₱197.20')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Contact Tourist/ })).toHaveAttribute('href', 'tel:09171234567')
  })

  it('confirms arrival, then pick up, for the current restaurant', async () => {
    setTrip('assigned', [stop({ id: 1 })])
    const { unmount } = renderPage()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Confirm arrival at Ekslusibo Grill' })) })
    expect(trip.value.confirmArrivalStop).toHaveBeenCalledWith(10)
    unmount()

    setTrip('arrived_pickup', [stop({ id: 1, arrived_at: '2026-11-08T04:00:00Z', can_confirm: true, reason: null })])
    renderPage()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Confirm pick up at Ekslusibo Grill' })) })
    expect(trip.value.confirmPickupStop).toHaveBeenCalledWith(10)
  })

  it('in transit: "I\'ve Arrived" moves the trip to the delivery step', async () => {
    setTrip('in_transit', [])
    renderPage()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: "I've Arrived" })) })
    expect(trip.value.onArrivedDrop).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Confirm Delivered' })).not.toBeInTheDocument()
  })

  it('at the drop-off: take a photo, then Confirm Delivered sends it', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} }))
    setTrip('arrived_destination', [])
    renderPage()

    const confirm = await screen.findByRole('button', { name: 'Confirm Delivered' })
    expect(confirm).toBeDisabled()
    const photo = new File(['x'], 'proof.jpg', { type: 'image/jpeg' })
    await act(async () => { fireEvent.change(screen.getByLabelText('Take a photo of the tourist receiving the food'), { target: { files: [photo] } }) })
    expect(screen.getByAltText('Photo preview')).toBeInTheDocument()
    expect(confirm).toBeDisabled() // taken, not submitted yet
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit photo' })) })
    expect(screen.getByAltText('Submitted delivery photo')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm Delivered' })) })
    expect(trip.value.onConfirmDelivery).toHaveBeenCalledWith(photo)
  })

  it("\"I've Arrived\" stays disabled until the rider is within 50 m of the delivery address", async () => {
    setTrip('in_transit', [], { riderPosition: [12.8, 121.4] }) // ~8 km away
    const { unmount } = renderPage()
    const button = await screen.findByRole('button', { name: "I've Arrived" })
    expect(button).toBeDisabled()
    expect(screen.getByText(/Within 50 m of the delivery address \(you are 8\.\d km away\)/).closest('li')).toHaveAttribute('data-met', 'false')
    expect(screen.getByText('All food picked up').closest('li')).toHaveAttribute('data-met', 'true')
    unmount()

    setTrip('in_transit', [], { positionKnown: false })
    renderPage()
    expect(await screen.findByRole('button', { name: "I've Arrived" })).toBeDisabled()
    expect(screen.getByText('Within 50 m of the delivery address (turn on your location)')).toBeInTheDocument()
  })

  it('Confirm Delivered needs the photo AND the rider within 50 m of the delivery address', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} }))
    setTrip('arrived_destination', [], { riderPosition: [12.8607, 121.45] }) // ~78 m away
    renderPage()
    const photo = new File(['x'], 'proof.jpg', { type: 'image/jpeg' })
    await act(async () => { fireEvent.change(await screen.findByLabelText('Take a photo of the tourist receiving the food'), { target: { files: [photo] } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit photo' })) })

    expect(screen.getByText('Photo of the tourist receiving the food submitted').closest('li')).toHaveAttribute('data-met', 'true')
    expect(screen.getByText(/Within 50 m of the delivery address \(you are \d+ m away\)/).closest('li')).toHaveAttribute('data-met', 'false')
    expect(screen.getByRole('button', { name: 'Confirm Delivered' })).toBeDisabled()
  })

  it('COD: Confirm Pick Up waits for the restaurant "Payment received" and the food', async () => {
    setTrip('arrived_pickup', [stop({ id: 1, arrived_at: '2026-11-08T04:00:00Z', payment_confirmed: false, is_ready: false, ready_label: 'preparing', can_confirm: false, reason: 'waiting_payment' })])
    renderPage()
    const row = within(await screen.findByRole('listitem', { name: 'Ekslusibo Grill' }))
    expect(row.getByRole('button', { name: 'Confirm pick up at Ekslusibo Grill' })).toBeDisabled()
    expect(row.getByText('Arrived at the restaurant').closest('li')).toHaveAttribute('data-met', 'true')
    expect(row.getByText('Restaurant confirmed your payment').closest('li')).toHaveAttribute('data-met', 'false')
    expect(row.getByText('Food is ready').closest('li')).toHaveAttribute('data-met', 'false')
  })

  it('a finished delivery shows every step done', async () => {
    trip.value = { ...trip.value, activeDelivery: null, pickupStopsData: null }
    api.get.mockResolvedValue({ ...OFFER, status: 'delivered' })
    renderPage()
    expect(await screen.findByText('Delivered. Thank you!')).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: 'Delivery steps' })).getAllByRole('listitem').filter((li) => li.hasAttribute('data-step-state'))
    expect(steps.every((s) => s.getAttribute('data-step-state') === 'done')).toBe(true)
  })

  it('refuses a delivery that is not this rider\'s', async () => {
    setTrip('assigned', [])
    api.get.mockRejectedValue(new Error('404'))
    renderPage()
    expect(await screen.findByText("This delivery isn't assigned to you.")).toBeInTheDocument()
  })
})

// 2026-11-11: a ride booking is not a restaurant delivery.
const RIDE = {
  ...OFFER,
  order_number: 'TRP-6AF362EB5E076',
  order_type: 'transport',
  delivery_type_label: 'Motorcycle ride',
  pickup_names: [], items_count: 1, delivery_fee: null, distance_km: 10.76, payment_method: 'cash', is_cod: true,
  pickup: { address: 'Gloria, Oriental Mindoro', latitude: 12.97, longitude: 121.47 },
  dropoff: { address: 'Pag-asa, Bansud, Oriental Mindoro', latitude: 12.86, longitude: 121.45 },
  pickups: [],
  items: [{ id: 9, business_id: 0, product_name: 'Ride: Motorcycle (1 pax)', quantity: 1, unit_price: 211.36, subtotal: 211.36, notes: null, image: null }],
  items_total: 211.36, rider_earnings: 84.54, customer_name: 'Jayvie De Torres',
  ride: { vehicle_type: 'motorcycle', passenger_count: 1, fare: 211.36, distance_km: 10.76, duration_minutes: 33, booking_notes: null },
}

describe('ride booking trip page', () => {
  beforeEach(() => {
    api.get.mockReset()
  })

  function setRide(status: string, over: Record<string, unknown> = {}) {
    api.get.mockResolvedValue({ ...RIDE, status })
    setTrip(status, [], { onArrivedPickup: vi.fn(), onCompleteRide: vi.fn(), settleCod: vi.fn(), settleBusy: false, settleError: null, pendingSettlement: null, ...over })
  }

  it('reads as a booking with a passenger, never restaurants or food', async () => {
    setRide('assigned', { riderPosition: [12.9702, 121.4701] })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Booking #TRP-6AF362EB5E076' })).toBeInTheDocument()
    expect(screen.getByText(/10\.8 km • ~33 min • Motorcycle • 1 passenger/)).toBeInTheDocument()
    expect(screen.getByText('Jayvie De Torres')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2. Pick Up Passenger' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '3. On the Way' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '4. Complete Ride' })).toBeInTheDocument()
    for (const food of [/restaurant/i, /food/i, 'Customer Tip', 'Delivery Fee', 'Tourist Location']) {
      expect(screen.queryByText(food)).toBeNull()
    }
    const info = within(screen.getByRole('region', { name: 'Ride information' }))
    expect(info.getByText('Your Earnings').nextSibling).toHaveTextContent('₱84.54')
    expect(info.getByText('Ride Fare').nextSibling).toHaveTextContent('₱211.36')
    expect(info.getByText('Payment').nextSibling).toHaveTextContent('Cash')
  })

  it('pickup: arrive near the passenger, then Passenger On Board', async () => {
    setRide('assigned', { riderPosition: [12.9702, 121.4701] })
    const { unmount } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /I've Arrived at Pickup/ }))
    expect(trip.value.onArrivedPickup).toHaveBeenCalledTimes(1)
    unmount()

    setRide('arrived_pickup')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Passenger On Board/ }))
    expect(trip.value.onMarkPickedUp).toHaveBeenCalledTimes(1)
  })

  it('far from the pickup point the arrival button waits', async () => {
    setRide('assigned', { riderPosition: [12.86, 121.45] })
    renderPage()
    expect(await screen.findByRole('button', { name: /I've Arrived at Pickup/ })).toBeDisabled()
    expect(screen.getByText(/Within 100 m of the pickup point/)).toBeInTheDocument()
  })

  it('at the drop-off a cash ride collects the fare and completes', async () => {
    setRide('arrived_destination')
    renderPage()
    expect(await screen.findByText('Collect ₱211.36 in cash from the passenger.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Fare Collected · Complete Ride/ }))
    expect(trip.value.onCompleteRide).toHaveBeenCalledWith(211.36)
  })

  it('a cash ride already marked delivered but not settled records the fare', async () => {
    setRide('delivered', { pendingSettlement: { deliveryId: 6, orderId: 9, cashDue: 211.36 } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Fare Collected · Complete Ride/ }))
    expect(trip.value.settleCod).toHaveBeenCalledWith(211.36)
  })

  it('an online-paid ride completes with nothing to collect', async () => {
    api.get.mockResolvedValue({ ...RIDE, status: 'arrived_destination', is_cod: false, payment_method: 'gcash' })
    setTrip('arrived_destination', [], { onCompleteRide: vi.fn(), settleCod: vi.fn(), settleBusy: false, settleError: null, pendingSettlement: null })
    renderPage()
    expect(await screen.findByText('Paid online. Nothing to collect.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Complete Ride$/ }))
    expect(trip.value.onCompleteRide).toHaveBeenCalledWith(null)
  })
})
