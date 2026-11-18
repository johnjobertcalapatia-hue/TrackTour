import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GlobalRiderAlert from '@/features/rider/components/GlobalRiderAlert'
import RiderDestinationChangeBanner from '@/features/rider/components/RiderDestinationChangeBanner'
import { COD_PICKUP_GATE_MESSAGE } from '@/features/rider/gating'

const h = vi.hoisted(() => {
  const defaults = {
    activeDelivery: {
      id: 12,
      order_id: 16,
      status: 'arrived_pickup',
      pickup_address: 'Restaurant St, Bansud',
      pickup_lat: 12.8667,
      pickup_lng: 121.45,
      delivery_address: 'Droppoint St, Bansud',
      delivery_lat: 12.86,
      delivery_lng: 121.48,
      business_name: 'John Jobert’s Restaurant',
    },
    arrivalAlert: null as 'PICKUP' | 'DROPOFF' | null,
    tripState: 'IDLE',
    busy: false,
    actionError: null as string | null,
    pickupGateBlocked: false,
    pickupGateMessage: null as string | null,
    onMarkPickedUp: () => {},
    onConfirmDelivery: () => {},
    dismissArrivalAlert: () => {},
    pickupArrivalPrompt: null as {
      deliveryId: number
      businessId: number
      businessName: string | null
      sequence: number
      totalStops: number
      distanceMeters: number | null
    } | null,
    confirmArrivalStop: () => {},
    confirmArrivalBusy: false,
    confirmArrivalError: null as string | null,
    pickupStopPrompt: null as {
      deliveryId: number
      businessId: number
      businessName: string | null
      sequence: number
      totalStops: number
      distanceMeters: number | null
    } | null,
    confirmPickupStop: () => {},
    confirmStopBusy: false,
    confirmStopError: null as string | null,
    pickupComplete: false,
  }
  let overrides: Record<string, unknown> = {}
  return {
    defaults,
    setOverrides(o: Record<string, unknown>) {
      overrides = o
    },
    value() {
      return { ...defaults, ...overrides }
    },
  }
})

vi.mock('@/features/rider/context/RiderActiveTripContext', () => ({
  useRiderActiveTrip: () => h.value(),
}))

describe('GlobalRiderAlert — COD pickup-gate behaviour', () => {
  beforeEach(() => {
    h.setOverrides({})
  })

  it('renders nothing when there is no arrival alert', () => {
    h.setOverrides({ arrivalAlert: null })
    const { container } = render(<GlobalRiderAlert />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the pickup confirm when the COD gate is clear and confirms via onMarkPickedUp', () => {
    const onMarkPickedUp = vi.fn()
    h.setOverrides({ arrivalAlert: 'PICKUP', tripState: 'ARRIVED_AT_PICKUP', onMarkPickedUp })

    render(<GlobalRiderAlert />)

    expect(screen.getByRole('button', { name: /i picked up the food/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collect food at restaurants/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /i picked up the food/i }))
    expect(onMarkPickedUp).toHaveBeenCalledTimes(1)
  })

  it('replaces the pickup confirm with a Collect-Food escape while the gate is blocked', () => {
    const onMarkPickedUp = vi.fn()
    const dismissArrivalAlert = vi.fn()
    h.setOverrides({
      arrivalAlert: 'PICKUP',
      tripState: 'ARRIVED_AT_PICKUP',
      pickupGateBlocked: true,
      pickupGateMessage: COD_PICKUP_GATE_MESSAGE,
      onMarkPickedUp,
      dismissArrivalAlert,
    })

    render(<GlobalRiderAlert />)

    // The rider sees WHY pickup is blocked, and the premature confirm disappears.
    expect(screen.getByText(COD_PICKUP_GATE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /i picked up the food/i })).not.toBeInTheDocument()

    // Dismissing sends them to the purchasing panel — never a blind picked_up.
    const escape = screen.getByRole('button', { name: /collect food at restaurants/i })
    fireEvent.click(escape)
    expect(dismissArrivalAlert).toHaveBeenCalledTimes(1)
    expect(onMarkPickedUp).not.toHaveBeenCalled()
  })

  it('stays neutral while the pickup stops are still loading — no confirm flash', () => {
    const onMarkPickedUp = vi.fn()
    const dismissArrivalAlert = vi.fn()
    h.setOverrides({
      arrivalAlert: 'PICKUP',
      tripState: 'ARRIVED_AT_PICKUP',
      pickupGateBlocked: true,
      pickupGateMessage: null,
      onMarkPickedUp,
      dismissArrivalAlert,
    })

    render(<GlobalRiderAlert />)

    // The confirm button must NOT appear before the stops payload resolves.
    expect(screen.queryByRole('button', { name: /i picked up the food/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collect food at restaurants/i })).not.toBeInTheDocument()

    // A disabled, neutral state covers the gap between arrival and gate resolution.
    const checking = screen.getByRole('button', { name: /checking pickup stops/i })
    expect(checking).toBeDisabled()
    fireEvent.click(checking)
    expect(dismissArrivalAlert).not.toHaveBeenCalled()
    expect(onMarkPickedUp).not.toHaveBeenCalled()
  })

  it('completes the drop-off only with a proof photo (reconciled 2026-11-08: rider photo replaces tourist confirm)', () => {
    const onConfirmDelivery = vi.fn()
    h.setOverrides({
      arrivalAlert: 'DROPOFF',
      tripState: 'ARRIVED_AT_DROP',
      actionError: null,
      onConfirmDelivery,
      pickupStopsData: { is_cod: true, stops: [], fully_collected: true },
      // Live GPS at the drop-off (activeDelivery.delivery_lat / delivery_lng).
      positionKnown: true,
      riderPosition: [12.86, 121.48],
    })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:proof'), revokeObjectURL: vi.fn() }))

    render(<GlobalRiderAlert />)

    // No photo yet: Confirm Delivered is disabled, nothing is sent.
    const confirm = screen.getByRole('button', { name: /confirm delivered/i })
    expect(confirm).toBeDisabled()
    expect(screen.getByText(/paid you in cash/i)).toBeInTheDocument()
    fireEvent.click(confirm)
    expect(onConfirmDelivery).not.toHaveBeenCalled()

    // Take the photo of the tourist receiving the food (jsdom has no live
    // camera, so this is the phone camera-app path), check it, submit it.
    const input = screen.getByLabelText('Take a photo of the tourist receiving the food')
    expect(input).toHaveAttribute('capture', 'environment')
    const photo = new File(['x'], 'delivered.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [photo] } })
    expect(screen.getByAltText('Photo preview')).toHaveAttribute('src', 'blob:proof')
    // Taken but not submitted yet: still can't confirm.
    expect(screen.getByRole('button', { name: /confirm delivered/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit photo' }))
    expect(screen.getByAltText('Submitted delivery photo')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /confirm delivered/i }))
    expect(onConfirmDelivery).toHaveBeenCalledWith(photo)
  })

  it('Confirm Delivered stays disabled away from the address, even with the photo submitted', () => {
    const onConfirmDelivery = vi.fn()
    h.setOverrides({
      arrivalAlert: 'DROPOFF',
      tripState: 'ARRIVED_AT_DROP',
      actionError: null,
      onConfirmDelivery,
      pickupStopsData: { is_cod: false, stops: [], fully_collected: true },
      positionKnown: true,
      riderPosition: [12.8, 121.4], // ~11 km from the drop-off
    })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:proof'), revokeObjectURL: vi.fn() }))
    render(<GlobalRiderAlert />)

    const photo = new File(['x'], 'delivered.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Take a photo of the tourist receiving the food'), { target: { files: [photo] } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit photo' }))

    expect(screen.getByText('Photo of the tourist receiving the food submitted').closest('li')).toHaveAttribute('data-met', 'true')
    expect(screen.getByText(/Within 50 m of the delivery address \(you are \d+\.\d km away\)/).closest('li')).toHaveAttribute('data-met', 'false')
    const confirm = screen.getByRole('button', { name: /confirm delivered/i })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirmDelivery).not.toHaveBeenCalled()
  })

  it('the rider can collapse the arrival message and reopen it later, keeping the submitted photo', () => {
    h.setOverrides({
      arrivalAlert: 'DROPOFF',
      tripState: 'ARRIVED_AT_DROP',
      actionError: null,
      onConfirmDelivery: vi.fn(),
      pickupStopsData: { is_cod: false, stops: [], fully_collected: true },
      positionKnown: true,
      riderPosition: [12.86, 121.48],
    })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:proof'), revokeObjectURL: vi.fn() }))
    render(<GlobalRiderAlert />)

    const photo = new File(['x'], 'delivered.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Take a photo of the tourist receiving the food'), { target: { files: [photo] } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit photo' }))

    // Not ready yet: collapse it to a small bar; the confirm button is gone.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByRole('button', { name: /confirm delivered/i })).not.toBeInTheDocument()
    const bar = screen.getByRole('button', { name: 'Show delivery confirmation' })
    expect(bar).toHaveTextContent("You've Arrived")
    expect(bar).toHaveTextContent('Tap to confirm the delivery')

    // Reopen: same message, photo still submitted, ready to confirm.
    fireEvent.click(bar)
    expect(screen.getByAltText('Submitted delivery photo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm delivered/i })).toBeEnabled()
  })

  it('the restaurant arrival prompt (Pickup 1 of 1) collapses to a bar and reopens', () => {
    const confirmArrivalStop = vi.fn()
    h.setOverrides({
      pickupArrivalPrompt: { businessId: 10, businessName: 'Ekslusibo Grill and Restaurant', sequence: 1, totalStops: 1, distanceMeters: 22 },
      confirmArrivalStop,
    })
    render(<GlobalRiderAlert />)
    expect(screen.getByText('Confirm Restaurant Arrival')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Confirm Restaurant Arrival')).not.toBeInTheDocument()
    const bar = screen.getByRole('button', { name: 'Show restaurant arrival confirmation' })
    expect(bar).toHaveTextContent('Pickup 1 of 1: Ekslusibo Grill and Restaurant')
    expect(bar).toHaveTextContent('Tap to confirm your arrival')

    fireEvent.click(bar)
    fireEvent.click(screen.getByRole('button', { name: /Confirm Arrival/ }))
    expect(confirmArrivalStop).toHaveBeenCalledWith(10)
  })

  it('the food pickup prompt collapses too', () => {
    h.setOverrides({
      pickupStopPrompt: { businessId: 10, businessName: 'Ekslusibo Grill and Restaurant', sequence: 1, totalStops: 1, distanceMeters: 10 },
    })
    render(<GlobalRiderAlert />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.getByRole('button', { name: 'Show pickup confirmation' })).toHaveTextContent('Food is ready. Tap to confirm the pickup')
  })

  it('pickup arrival can be collapsed too', () => {
    h.setOverrides({ arrivalAlert: 'PICKUP', tripState: 'ARRIVED_AT_PICKUP', actionError: null })
    render(<GlobalRiderAlert />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.getByRole('button', { name: 'Show pickup confirmation' })).toHaveTextContent('Tap to confirm the pickup')
  })

  it('surfaces the real server message instead of the old generic text', () => {
    h.setOverrides({
      arrivalAlert: 'DROPOFF',
      tripState: 'ARRIVED_AT_DROP',
      actionError: COD_PICKUP_GATE_MESSAGE,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(COD_PICKUP_GATE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/unable to confirm\. please try again/i)).not.toBeInTheDocument()
  })
})

describe('GlobalRiderAlert — per-stop pickup appearing message (view-only Order details)', () => {
  beforeEach(() => {
    h.setOverrides({})
  })

  it('automatically prompts arrival at the current restaurant and confirms it manually', () => {
    const confirmArrivalStop = vi.fn()
    h.setOverrides({
      pickupArrivalPrompt: {
        deliveryId: 12,
        businessId: 2,
        businessName: 'Jobert’s Kitchen',
        sequence: 1,
        totalStops: 2,
        distanceMeters: 20,
      },
      confirmArrivalStop,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/confirm restaurant arrival/i)).toBeInTheDocument()
    expect(screen.getByText(/arrival starts this restaurant's waiting-time clock/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /confirm arrival/i }))
    expect(confirmArrivalStop).toHaveBeenCalledWith(2)
  })

  it('shows the per-stop Confirm Item Pickup message when the rider is in range and the stop is ready', () => {
    const confirmPickupStop = vi.fn()
    h.setOverrides({
      pickupStopPrompt: {
        deliveryId: 12,
        businessId: 2,
        businessName: 'Jobert’s Kitchen',
        sequence: 1,
        totalStops: 2,
        distanceMeters: 45,
      },
      confirmPickupStop,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/pickup 1 of 2/i)).toBeInTheDocument()
    expect(screen.getByText('Jobert’s Kitchen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm item pickup/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /confirm item pickup/i }))
    expect(confirmPickupStop).toHaveBeenCalledWith(2)
  })

  it('applies the appearance priority over the arrival alert while a stop is confirmable', () => {
    h.setOverrides({
      arrivalAlert: 'PICKUP',
      pickupGateBlocked: true,
      pickupGateMessage: COD_PICKUP_GATE_MESSAGE,
      pickupStopPrompt: {
        deliveryId: 12,
        businessId: 5,
        businessName: 'Beachside Grill',
        sequence: 2,
        totalStops: 2,
        distanceMeters: 12,
      },
    })

    render(<GlobalRiderAlert />)

    // The per-stop message wins — the rider must confirm this stop first.
    expect(screen.getByText('Beachside Grill')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collect food at restaurants/i })).not.toBeInTheDocument()
  })

  it('surfaces a confirm error inside the per-stop message', () => {
    h.setOverrides({
      pickupStopPrompt: {
        deliveryId: 12,
        businessId: 3,
        businessName: 'Cafe Bansud',
        sequence: 1,
        totalStops: 1,
        distanceMeters: null,
      },
      confirmStopError: 'server rejected',
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/server rejected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm item pickup/i })).toBeInTheDocument()
  })

  it('disables the per-stop confirm while a confirmation is in flight', () => {
    h.setOverrides({
      pickupStopPrompt: {
        deliveryId: 12,
        businessId: 4,
        businessName: 'Lahui Bar',
        sequence: 1,
        totalStops: 1,
        distanceMeters: 80,
      },
      confirmStopBusy: true,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByRole('button', { name: /confirming/i })).toBeDisabled()
  })

  it('keeps the final "I Picked Up the Food" confirm after all stops are collected even without a fresh arrival alert', () => {
    const onMarkPickedUp = vi.fn()
    h.setOverrides({
      pickupComplete: true,
      onMarkPickedUp,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByRole('button', { name: /i picked up the food/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /i picked up the food/i }))
    expect(onMarkPickedUp).toHaveBeenCalledTimes(1)
  })
})
describe('GlobalRiderAlert — ride booking wording (2026-11-11)', () => {
  const ride = {
    ...h.defaults.activeDelivery,
    order_type: 'transport',
    business_name: null,
    customer_name: 'Maria Santos',
    pickup_address: 'Gloria, Oriental Mindoro',
    delivery_address: 'Pag-asa, Bansud, Oriental Mindoro',
  }

  beforeEach(() => {
    h.setOverrides({})
  })

  it('at the pickup it asks to confirm the passenger is on board, never food', () => {
    const onMarkPickedUp = vi.fn()
    // Even if a stale restaurant gate were reported, a ride never shows it.
    h.setOverrides({ activeDelivery: ride, arrivalAlert: 'PICKUP', tripState: 'ARRIVED_AT_PICKUP', onMarkPickedUp, pickupGateBlocked: true })

    render(<GlobalRiderAlert />)

    expect(screen.getByText('Passenger Pickup')).toBeInTheDocument()
    expect(screen.getByText('Maria Santos')).toBeInTheDocument()
    expect(screen.getByText('Gloria, Oriental Mindoro')).toBeInTheDocument()
    expect(screen.getByText(/continue the ride/)).toBeInTheDocument()
    expect(screen.queryByText('Location unavailable')).toBeNull()
    expect(screen.queryByText(/food/i)).toBeNull()
    expect(screen.queryByText(/restaurant/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /passenger on board/i }))
    expect(onMarkPickedUp).toHaveBeenCalledTimes(1)
  })

  it('at the drop-off a cash ride collects the fare and completes the ride (no food photo)', () => {
    const onCompleteRide = vi.fn()
    h.setOverrides({
      activeDelivery: { ...ride, status: 'arrived_destination', is_cod: true, order_total: 211.36 },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF', onCompleteRide,
      positionKnown: true, riderPosition: [12.86, 121.48],
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/Collect ₱211\.36 in cash from the passenger/)).toBeInTheDocument()
    expect(screen.queryByText(/food/i)).toBeNull()
    expect(screen.queryByText(/photo/i)).toBeNull()
    // The rider confirms the cash before completing (2026-11-18).
    expect(screen.getByRole('button', { name: /fare collected · complete ride/i })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I received ₱211.36 in cash from the passenger'))
    fireEvent.click(screen.getByRole('button', { name: /fare collected · complete ride/i }))
    expect(onCompleteRide).toHaveBeenCalledWith(211.36)
  })

  // 2026-11-17: a rider AT the destination was stuck on "Location saved (waiting:
  // GPS is not precise enough…)". Like the food drop-off, the phone's own fix
  // counts up to ±200 m when the server could not save it for precision.
  it('at the destination a GPS fix too coarse to SAVE (±80 m) still lets the ride complete', () => {
    const onCompleteRide = vi.fn()
    h.setOverrides({
      activeDelivery: { ...ride, status: 'arrived_destination', is_cod: false, order_total: 150, payment_method: 'gcash', payment_status: 'paid' },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF', onCompleteRide,
      positionKnown: true, riderPosition: [12.86, 121.48],
      locationRefusal: 'low_accuracy', deviceAccuracy: 80,
    })

    render(<GlobalRiderAlert />)

    expect(screen.queryByText(/GPS is not precise enough, move to an open area/)).toBeNull()
    expect(screen.getByText('Location checked from your phone (±80 m)')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("I confirm the passenger's GCash payment of ₱150.00 was received"))
    const complete = screen.getByRole('button', { name: /complete ride/i })
    expect(complete).toBeEnabled()
    fireEvent.click(complete)
    expect(onCompleteRide).toHaveBeenCalledWith(null)
  })

  it('at the destination a fix coarser than ±200 m still waits, and says what to do', () => {
    const onCompleteRide = vi.fn()
    h.setOverrides({
      activeDelivery: { ...ride, status: 'arrived_destination', is_cod: false, order_total: 150 },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF', onCompleteRide,
      positionKnown: true, riderPosition: [12.86, 121.48],
      locationRefusal: 'low_accuracy', deviceAccuracy: 350,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/now ±350 m; needs ±200 m or better — turn on Precise location or step outside/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /complete ride/i })).toBeDisabled()
  })

  // One-time destination change (2026-11-17).
  const change = {
    id: 1, status: 'confirmed', original: { address: 'Pagasa', latitude: 12.6, longitude: 121.4 },
    new: { name: 'Tambangan Falls', address: 'Tambangan, Bansud', latitude: 12.53, longitude: 121.31 },
    confirmed_at: '2026-11-17T08:04:00Z', original_fare: 120, estimated_fare: 76.1, max_fare: 87.52,
    traveled_km_at_change: 1.11, remaining_km_estimate: 1.5, rider_notification_status: 'sent', rider_acknowledged_at: null,
    verified_km: null, unverified_km: null, computed_fare: null, final_fare: null, cap_adjustment: null,
    original_commission: 48, final_commission: null, fare_review_status: null, review_reasons: [], finalized_at: null,
  }

  it("a changed ride records the arrival first (I've Arrived) — the final fare is set there", () => {
    const arriveAtRideDestination = vi.fn()
    const onCompleteRide = vi.fn()
    h.setOverrides({
      activeDelivery: { ...ride, status: 'in_transit', is_cod: true, order_total: 120, destination_change: change },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF', onCompleteRide, arriveAtRideDestination,
      positionKnown: true, riderPosition: [12.86, 121.48],
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/The passenger changed the destination\. Tap I've Arrived/)).toHaveTextContent('at most ₱87.52')
    expect(screen.queryByText(/Collect ₱120\.00/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /I've Arrived/i }))
    expect(arriveAtRideDestination).toHaveBeenCalledTimes(1)
    expect(onCompleteRide).not.toHaveBeenCalled()
  })

  it('a GCash ride at the drop-off waits for the payment; the rider may switch it to cash', () => {
    const switchRideToCash = vi.fn()
    h.setOverrides({
      activeDelivery: { ...ride, status: 'arrived_destination', is_cod: false, order_total: 150, payment_method: 'gcash', payment_status: 'pending' },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF', switchRideToCash,
      positionKnown: true, riderPosition: [12.86, 121.48],
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/Waiting for the passenger's GCash payment of ₱150\.00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^complete ride$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Switch to cash/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, switch to cash' }))
    expect(switchRideToCash).toHaveBeenCalledTimes(1)
  })

  it('once the final fare is set, the rider collects exactly that', () => {
    const onCompleteRide = vi.fn()
    h.setOverrides({
      activeDelivery: { ...ride, status: 'arrived_destination', is_cod: true, order_total: 83.36, destination_change: { ...change, status: 'finalized', final_fare: 83.36 } },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF', onCompleteRide,
      positionKnown: true, riderPosition: [12.86, 121.48],
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByText(/Collect ₱83\.36 in cash from the passenger/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('I received ₱83.36 in cash from the passenger'))
    fireEvent.click(screen.getByRole('button', { name: /fare collected · complete ride/i }))
    expect(onCompleteRide).toHaveBeenCalledWith(83.36)
  })

  it('the rider is told about the new destination until they acknowledge it', () => {
    const acknowledgeDestinationChange = vi.fn()
    h.setOverrides({ activeDelivery: { ...ride, status: 'in_transit', destination_change: change }, acknowledgeDestinationChange, acknowledgeBusy: false })
    const { rerender } = render(<RiderDestinationChangeBanner />)

    const alert = screen.getByRole('alertdialog', { name: 'Destination changed' })
    expect(alert).toHaveTextContent('The passenger changed the destination')
    expect(alert).toHaveTextContent('Tambangan Falls')
    expect(screen.getByText('Pagasa')).toHaveClass('line-through')
    fireEvent.click(screen.getByRole('button', { name: /Got it/ }))
    expect(acknowledgeDestinationChange).toHaveBeenCalledTimes(1)

    h.setOverrides({ activeDelivery: { ...ride, status: 'in_transit', destination_change: { ...change, rider_acknowledged_at: '2026-11-17T08:05:00Z' } } })
    rerender(<RiderDestinationChangeBanner />)
    expect(screen.queryByRole('alertdialog', { name: 'Destination changed' })).toBeNull()
  })

  // Pickup arrival (2026-11-18): rides never arrive by themselves.
  it("near the pickup the rider confirms I've Arrived first — that starts the waiting", () => {
    const onArrivedPickup = vi.fn()
    const onMarkPickedUp = vi.fn()
    h.setOverrides({ activeDelivery: { ...ride, status: 'assigned' }, arrivalAlert: 'PICKUP', tripState: 'ARRIVED_AT_PICKUP', onArrivedPickup, onMarkPickedUp })

    render(<GlobalRiderAlert />)

    expect(screen.getByTestId('ride-arrival-step')).toHaveTextContent('their waiting time starts')
    expect(screen.queryByRole('button', { name: /passenger on board/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /I've Arrived/i }))
    expect(onArrivedPickup).toHaveBeenCalledTimes(1)
    expect(onMarkPickedUp).not.toHaveBeenCalled()
  })

  it('after the confirmed arrival: the waiting timer and Passenger On Board', () => {
    const onMarkPickedUp = vi.fn()
    const now = new Date().toISOString()
    h.setOverrides({
      activeDelivery: { ...ride, status: 'arrived_pickup', pickup_waiting: { arrived_at: new Date(Date.now() - 400_000).toISOString(), ended_at: null, server_now: now, free_seconds: 180, unit_seconds: 180, rate: 2, charged_seconds: null, amount: null } },
      arrivalAlert: 'PICKUP', tripState: 'ARRIVED_AT_PICKUP', onMarkPickedUp,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByTestId('ride-waiting-step')).toHaveTextContent(/Waiting 0[6-8]:\d\d/)
    expect(screen.getByTestId('ride-waiting-step')).toHaveTextContent('₱2.00 so far')
    fireEvent.click(screen.getByRole('button', { name: /passenger on board/i }))
    expect(onMarkPickedUp).toHaveBeenCalledTimes(1)
  })

  it('after Complete Ride the closing message never flashes the food photo step', () => {
    h.setOverrides({
      activeDelivery: { ...ride, status: 'arrived_destination', is_cod: true, order_total: 211.36 },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF',
      positionKnown: true, riderPosition: [12.86, 121.48],
    })
    const { rerender } = render(<GlobalRiderAlert />)
    expect(screen.queryByText(/photo/i)).toBeNull()

    // The ride is completed: the trip is gone and the message animates out.
    h.setOverrides({ activeDelivery: null, arrivalAlert: null, tripState: 'IDLE' })
    rerender(<GlobalRiderAlert />)

    expect(screen.queryByText(/photo/i)).toBeNull()
    expect(screen.queryByText(/food/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /camera|photo/i })).toBeNull()
  })

  it('a cash ride waiting for its fare asks in ride words', () => {
    h.setOverrides({ activeDelivery: { ...ride, status: 'arrived_destination', is_cod: true, order_total: 211.36 }, arrivalAlert: 'DROPOFF' })
    const { rerender } = render(<GlobalRiderAlert />)

    h.setOverrides({
      activeDelivery: null, arrivalAlert: null,
      pendingSettlement: { deliveryId: 12, orderId: 16, cashDue: 211.36 }, settleCod: vi.fn(), settleBusy: false, settleError: null,
    })
    rerender(<GlobalRiderAlert />)

    expect(screen.getByText('Fare collected?')).toBeInTheDocument()
    expect(screen.getByText('Enter the cash the passenger paid to finish the ride')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fare Collected — Finish Ride/ })).toBeInTheDocument()
    expect(screen.queryByText(/tourist|delivery/i)).toBeNull()
  })

  it('when the server refused the latest location, the checklist says so and Confirm waits (TT-23255, 2026-11-11)', () => {
    // Device GPS says 0 m from the drop-off, but the server still has the
    // rider 10.6 km away because the jump was refused.
    const photo = new File(['x'], 'proof.jpg', { type: 'image/jpeg' })
    h.setOverrides({
      activeDelivery: { ...h.defaults.activeDelivery, status: 'arrived_destination' },
      arrivalAlert: 'DROPOFF', tripState: 'ARRIVED_AT_DROPOFF',
      positionKnown: true, riderPosition: [12.86, 121.48],
      locationRefusal: 'implausible_movement',
    })
    render(<GlobalRiderAlert />)
    expect(screen.getByText(/Location saved \(waiting: it jumped too far/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm delivered/i })).toBeDisabled()
    void photo
  })
})
