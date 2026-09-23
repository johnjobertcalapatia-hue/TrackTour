/**
 * TrackTour — Customer UI Architecture: Sub-Status Message Matrix Engine
 *
 * Resolves the 5-step progress stages and dynamic customer messaging for multi-restaurant
 * restaurant fulfillment groups within a shared order as well as single-restaurant tracking.
 *
 * Progress Stages (1 to 5):
 * 1. Placed
 * 2. Preparing
 * 3. Ready
 * 4. On The Way
 * 5. Delivered
 *
 * Backend Field Mapping:
 * - order_status → order.status (order_status column)
 * - rider_assignment_status → delivery.status (maps to TripStatus enum)
 */

import { formatCurrency } from '@/shared/utils'

export interface SubOrderInput {
  orderStatus: string
  deliveryStatus?: string | null
  dispatchStatus?: string | null
  riderName?: string | null
  subOrderTotal: number | string
  paymentMethod?: string | null
}

export interface StepItem {
  index: number
  label: string
  state: 'completed' | 'current' | 'upcoming'
}

export interface SubOrderStatusResolution {
  stepIndex: number // 1..5, or -1 for cancelled
  stepLabel: string
  statusMessage: string
  stageCondition: string
  payoutText: string
  isCancelled: boolean
  steps: StepItem[]
}

export const FIVE_STAGE_LABELS = ['Placed', 'Preparing', 'Ready', 'On The Way', 'Delivered'] as const

/**
 * Maps delivery.status (TripStatus enum) to the spec's rider_assignment_status values.
 * - waiting → UNASSIGNED (no rider assigned yet)
 * - assigned → ACCEPTED (rider confirmed assignment)
 * - en_route_pickup → ACCEPTED (rider heading to store)
 * - arrived_pickup → ARRIVED_AT_STORE (rider at restaurant)
 * - picked_up → IN_TRANSIT (rider picked up food)
 * - in_transit → IN_TRANSIT (rider en route to customer)
 * - en_route_destination → IN_TRANSIT (rider heading to customer)
 * - arrived_destination → ARRIVED_AT_CUSTOMER (rider at customer location)
 */
function resolveRiderAssignmentStatus(deliveryStatus: string | null | undefined): string {
  const status = (deliveryStatus || '').toLowerCase()
  switch (status) {
    case 'waiting':
      return 'UNASSIGNED'
    case 'assigned':
    case 'en_route_pickup':
      return 'ACCEPTED'
    case 'arrived_pickup':
      return 'ARRIVED_AT_STORE'
    case 'picked_up':
    case 'in_transit':
    case 'en_route_destination':
      return 'IN_TRANSIT'
    case 'arrived_destination':
      return 'ARRIVED_AT_CUSTOMER'
    case 'delivered':
    case 'completed':
      return 'DELIVERED'
    default:
      return 'UNASSIGNED'
  }
}

export function resolveSubOrderStatus(input: SubOrderInput): SubOrderStatusResolution {
  const orderStatus = (input.orderStatus || '').toLowerCase()
  const deliveryStatus = (input.deliveryStatus || '').toLowerCase()
  const riderName = input.riderName?.trim() || null
  const paymentMethod = (input.paymentMethod || 'cash').toLowerCase()

  const formattedTotal = typeof input.subOrderTotal === 'number'
    ? formatCurrency(input.subOrderTotal)
    : (input.subOrderTotal.startsWith('₱') ? input.subOrderTotal : `₱${input.subOrderTotal}`)

  const payoutText = paymentMethod === 'cash'
    ? `${formattedTotal} COD`
    : `${formattedTotal} Paid (${paymentMethod.toUpperCase()})`

  const riderAssignmentStatus = resolveRiderAssignmentStatus(input.deliveryStatus)

  // 1. Check for Cancellation
  if (['cancelled', 'rejected', 'cancelled_by_tourist', 'cancelled_by_restaurant', 'failed'].includes(orderStatus)) {
    return {
      stepIndex: -1,
      stepLabel: 'Cancelled',
      statusMessage: orderStatus === 'rejected'
        ? 'The restaurant was unable to accept these items.'
        : 'These restaurant items have been cancelled.',
      stageCondition: 'CANCELLED',
      payoutText,
      isCancelled: true,
      steps: FIVE_STAGE_LABELS.map((label, idx) => ({
        index: idx + 1,
        label,
        state: 'upcoming',
      })),
    }
  }

  let stepIndex = 1
  let stepLabel = 'Placed'
  let statusMessage = ''
  let stageCondition = '1A'

  // 📍 Stage 5: Delivered (Step Index: 5)
  // Backend Status: order_status: DELIVERED | PAYMENT_RECEIVED | COMPLETED
  if (['delivered', 'completed'].includes(orderStatus) || ['delivered', 'completed'].includes(deliveryStatus)) {
    stepIndex = 5
    stepLabel = 'Delivered'
    stageCondition = '5A'
    statusMessage = '🎉 Enjoy your meal! Thank you for using TrackTour.'
  }

  // 📍 Stage 4: On The Way (Step Index: 4)
  // Backend Status: order_status: PICKED_UP | IN_TRANSIT | OUT_FOR_DELIVERY | ON_THE_WAY
  // rider_assignment_status: IN_TRANSIT | ARRIVED_AT_CUSTOMER
  else if (
    ['picked_up', 'in_transit', 'out_for_delivery', 'on_the_way'].includes(orderStatus) ||
    ['picked_up', 'in_transit', 'en_route_destination', 'arrived_destination'].includes(deliveryStatus)
  ) {
    stepIndex = 4
    stepLabel = 'On The Way'

    // Condition B: Courier breaks through the ≤50m geofence bubble enclosing tourist target coordinates
    // rider_assignment_status: ARRIVED_AT_CUSTOMER
    if (riderAssignmentStatus === 'ARRIVED_AT_CUSTOMER' || orderStatus === 'near_customer') {
      stageCondition = '4B'
      statusMessage = paymentMethod === 'cash'
        ? `✨ Rider is outside! Please prepare ${payoutText} cash.`
        : '✨ Rider is outside! Your order has arrived.'
    }
    // Condition A: Rider completes parcel handoff check and begins driving route pathing
    // rider_assignment_status: IN_TRANSIT
    else {
      stageCondition = '4A'
      statusMessage = riderName
        ? `🚴 Rider ${riderName} is bringing your order to you.`
        : '🚴 Your order is on the way!'
    }
  }

  // 📍 Stage 3: Ready for Pickup (Step Index: 3)
  // Backend Status: order_status: READY_FOR_PICKUP
  // rider_assignment_status: ACCEPTED | ARRIVED_AT_STORE
  else if (orderStatus === 'ready') {
    stepIndex = 3
    stepLabel = 'Ready'

    // Condition B: Courier arrives inside restaurant storefront boundary threshold
    // rider_assignment_status: ARRIVED_AT_STORE
    if (riderAssignmentStatus === 'ARRIVED_AT_STORE') {
      stageCondition = '3B'
      statusMessage = riderName
        ? `Your order is packed! Rider ${riderName} is at the store picking it up.`
        : 'Your order is packed! Rider is at the store picking it up.'
    }
    // Condition A: Merchant flags fulfillment completely finished; package tagged for courier transit
    // rider_assignment_status: ACCEPTED
    else {
      stageCondition = '3A'
      statusMessage = 'Your order is packed! Waiting for rider pickup.'
    }
  }

  // 📍 Stage 2: Preparing (Step Index: 2)
  // Backend Status: order_status: RESTAURANT_RECEIVED | PREPARING
  // rider_assignment_status: ACCEPTED
  else if (['accepted', 'preparing'].includes(orderStatus)) {
    stepIndex = 2
    stepLabel = 'Preparing'

    // Condition A: Restaurant system acknowledges the split incoming item queue
    // order_status: RESTAURANT_RECEIVED (accepted)
    if (orderStatus === 'accepted') {
      stageCondition = '2A'
      statusMessage = 'Order received by the kitchen.'
    }
    // Condition B: Kitchen manually kicks off cooking pipeline actions
    // order_status: PREPARING
    else {
      stageCondition = '2B'
      statusMessage = riderName
        ? `✓ Rider ${riderName} accepted. Kitchen is preparing your food.`
        : 'Kitchen is preparing your food.'
    }
  }

  // 📍 Stage 1: Placed (Step Index: 1)
  // Backend Status: order_status: ORDER_PLACED | FINDING_RIDER | RIDER_ASSIGNED
  // rider_assignment_status: UNASSIGNED | ACCEPTED
  else {
    stepIndex = 1
    stepLabel = 'Placed'

    // Condition B: Rider found and confirmed
    // rider_assignment_status: ACCEPTED
    if (riderAssignmentStatus === 'ACCEPTED' && riderName) {
      stageCondition = '1B'
      statusMessage = `🚴 Rider ${riderName} accepted your delivery.`
    }
    // Condition A: Order created; looking for candidate match
    // rider_assignment_status: UNASSIGNED
    else {
      stageCondition = '1A'
      statusMessage = 'Looking for a nearby rider...'
    }
  }

  const steps: StepItem[] = FIVE_STAGE_LABELS.map((label, idx) => {
    const sIndex = idx + 1
    let state: 'completed' | 'current' | 'upcoming' = 'upcoming'
    if (sIndex < stepIndex) {
      state = 'completed'
    } else if (sIndex === stepIndex) {
      state = stepIndex === 5 ? 'completed' : 'current'
    }
    return {
      index: sIndex,
      label,
      state,
    }
  })

  return {
    stepIndex,
    stepLabel,
    statusMessage,
    stageCondition,
    payoutText,
    isCancelled: false,
    steps,
  }
}
