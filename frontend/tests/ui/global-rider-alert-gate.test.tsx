import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GlobalRiderAlert from '@/features/rider/components/GlobalRiderAlert'
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

  it('confirms the drop-off leg via the confirm button outside the pickup stage', () => {
    const onConfirmDelivery = vi.fn()
    h.setOverrides({
      arrivalAlert: 'DROPOFF',
      tripState: 'ARRIVED_AT_DROP',
      actionError: null,
      onConfirmDelivery,
    })

    render(<GlobalRiderAlert />)

    expect(screen.getByRole('button', { name: /i delivered the food/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /i delivered the food/i }))
    expect(onConfirmDelivery).toHaveBeenCalledTimes(1)
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