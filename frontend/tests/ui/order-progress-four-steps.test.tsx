import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrderProgressTrack } from '@/features/tourist/components/OrderProgressTrack'
import { ORDER_STAGE_LABELS, resolveSubOrderStatus } from '@/features/tourist/utils/subOrderStatusEngine'

const resolve = (orderStatus: string, deliveryStatus: string | null = null, riderName: string | null = 'Ben') =>
  resolveSubOrderStatus({ orderStatus, deliveryStatus, riderName, subOrderTotal: 250, paymentMethod: 'cash' })

const states = (r: ReturnType<typeof resolve>) => r.steps.map((s) => `${s.label}:${s.state}`)

describe('tourist order progress — four steps', () => {
  it('uses Order Placed, Preparing, On The Way and Delivered', () => {
    expect(ORDER_STAGE_LABELS).toEqual(['Order Placed', 'Preparing', 'On The Way', 'Delivered'])

    render(<OrderProgressTrack resolution={resolve('pending', 'waiting', null)} />)
    for (const label of ORDER_STAGE_LABELS) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
    expect(screen.queryByText('Placed')).not.toBeInTheDocument()
  })

  it.each([
    ['pending', 'waiting', 1, 'Order Placed'],
    ['waiting_restaurant', 'assigned', 1, 'Order Placed'],
    ['accepted', 'assigned', 2, 'Preparing'],
    ['preparing', 'en_route_pickup', 2, 'Preparing'],
    ['ready', 'assigned', 2, 'Preparing'],         // ready, waiting for the rider: still Preparing
    ['ready', 'arrived_pickup', 2, 'Preparing'],
    ['picked_up', 'picked_up', 3, 'On The Way'],
    ['in_transit', 'arrived_destination', 3, 'On The Way'],
    ['delivered', 'delivered', 4, 'Delivered'],
    ['completed', 'completed', 4, 'Delivered'],
  ])('order %s / delivery %s → step %i (%s)', (order, delivery, index, label) => {
    const r = resolve(order, delivery)
    expect(r.stepIndex).toBe(index)
    expect(r.stepLabel).toBe(label)
  })

  it('keeps the "food is ready" messages inside Preparing', () => {
    const waiting = resolve('ready', 'assigned')
    expect(waiting.statusMessage).toBe('Your order is packed! Waiting for rider pickup.')
    expect(states(waiting)).toEqual(['Order Placed:completed', 'Preparing:current', 'On The Way:upcoming', 'Delivered:upcoming'])

    expect(resolve('ready', 'arrived_pickup').statusMessage).toBe('Your order is packed! Rider Ben is at the store picking it up.')
  })

  it('marks every step done once delivered, and none when cancelled', () => {
    expect(states(resolve('delivered', 'delivered'))).toEqual(['Order Placed:completed', 'Preparing:completed', 'On The Way:completed', 'Delivered:completed'])

    const cancelled = resolve('cancelled')
    expect(cancelled.isCancelled).toBe(true)
    expect(cancelled.steps).toHaveLength(4)
    expect(cancelled.steps.every((s) => s.state === 'upcoming')).toBe(true)
  })
})
