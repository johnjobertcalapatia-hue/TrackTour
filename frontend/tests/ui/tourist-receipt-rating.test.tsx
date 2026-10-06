import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TripReceipt from '@/features/tourist/components/TripReceipt'
import RatingSheet from '@/features/tourist/components/RatingSheet'

/**
 * Ride-hailing plan Phase 5 — receipt math + rating tags (S80).
 *
 * Receipt: Base fare + Distance leg must reconcile to the authoritative Total;
 * service fee only renders when > 0; the estimate-vs-final explanation renders
 * ONLY when estimate differs from the final fare; non-cash payment surfaces
 * Paid/pending state.
 *
 * Rating: tag chips come from allowed_rating_tags, toggle independently, and
 * the submitted payload carries {rating, review, tags} for POST …/rate.
 */

describe('TripReceipt — S80 receipt math', () => {
  const base = {
    orderNumber: 'TRP-123456',
    completedLabel: '24 Sep 2026',
    distanceKm: 3.5,
    baseFare: 50,
    distanceFare: 100,
    serviceFee: 0,
    total: 150,
    estimateFare: 150,
    paymentMethod: 'gcash',
    paymentStatus: 'pending',
    paidAmount: 0,
  }

  it('renders the fare breakdown and reconciles base + distance to the total', () => {
    render(<TripReceipt {...base} />)

    expect(screen.getByText('Trip receipt')).toBeInTheDocument()
    expect(screen.getByText('TRP-123456')).toBeInTheDocument()
    expect(screen.getByText('Base fare')).toBeInTheDocument()
    expect(screen.getByText('₱50.00')).toBeInTheDocument()
    expect(screen.getByText('Distance (3.5 km)')).toBeInTheDocument()
    expect(screen.getByText('₱100.00')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('₱150.00')).toBeInTheDocument()
    expect(screen.getByText(/Payment pending/)).toBeInTheDocument()
  })

  it('shows the service fee line only when > 0', () => {
    const { unmount } = render(<TripReceipt {...base} serviceFee={0} total={150} />)
    expect(screen.queryByText(/Service fee/)).not.toBeInTheDocument()
    unmount()

    render(<TripReceipt {...base} serviceFee={20} total={170} />)
    expect(screen.getByText('Service fee')).toBeInTheDocument()
    expect(screen.getByText('₱20.00')).toBeInTheDocument()
    expect(screen.getByText('₱170.00')).toBeInTheDocument()
  })

  it('shows the estimate-vs-final explanation only when they differ', () => {
    const { unmount } = render(<TripReceipt {...base} />)
    expect(screen.queryByText(/differed from estimate/)).not.toBeInTheDocument()
    unmount()

    render(<TripReceipt {...base} estimateFare={180} />)
    expect(screen.getByText(/Estimate ₱180.00 · Final ₱150.00/)).toBeInTheDocument()
    expect(screen.getByText(/differed from estimate/)).toBeInTheDocument()
  })

  it('renders Paid with the amount once the payment is settled', () => {
    render(<TripReceipt {...base} paymentStatus="paid" paidAmount={150} />)
    expect(screen.getByText(/Paid · ₱150.00/)).toBeInTheDocument()
  })
})

describe('RatingSheet — S80 rating tags', () => {
  const allowedTags = ['friendly', 'safe_driving', 'clean_vehicle', 'arrived_on_time']

  it('renders tag chips from allowed_rating_tags and submits the selected tags', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(
      <RatingSheet
        open
        riderName="Alex"
        allowedTags={allowedTags}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Friendly')).toBeInTheDocument()
    expect(screen.getByText('Safe driving')).toBeInTheDocument()
    expect(screen.getByText('Clean vehicle')).toBeInTheDocument()
    expect(screen.getByText('Arrived on time')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Friendly'))
    fireEvent.click(screen.getByText('Arrived on time'))
    fireEvent.click(screen.getByText('Friendly')) // toggled back off

    fireEvent.change(screen.getByPlaceholderText(/Write a review/), {
      target: { value: 'Great ride' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Submit Rating/ }))

    expect(onSubmit).toHaveBeenCalledWith({
      rating: 5,
      review: 'Great ride',
      tags: ['arrived_on_time'],
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets the star selection drive the submitted rating', () => {
    const onSubmit = vi.fn()
    render(
      <RatingSheet open riderName="Alex" allowedTags={allowedTags} onSubmit={onSubmit} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '4 stars' }))
    fireEvent.click(screen.getByRole('button', { name: /Submit Rating/ }))

    expect(onSubmit).toHaveBeenCalledWith({ rating: 4, review: undefined, tags: [] })
  })

  it('Skip closes the sheet and an empty-comment submit sends no review', () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    render(
      <RatingSheet open riderName="Alex" allowedTags={allowedTags} onSubmit={onSubmit} onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Skip/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Submit Rating/ }))
    expect(onSubmit).toHaveBeenCalledWith({ rating: 5, review: undefined, tags: [] })
  })
})