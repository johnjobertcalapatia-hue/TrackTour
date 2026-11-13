import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RiderDiagnosticsSheet from '@/features/rider/components/RiderDiagnosticsSheet'
import TripDiagnosticsPanel from '@/features/admin/components/TripDiagnosticsPanel'

/**
 * Trip diagnostics (2026-11-12): the rider sees the trip's canonical path and
 * the next step; the Tourism Office can apply fixes and reopen a step with a
 * written reason.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
  default: { get: api.get, post: api.post },
}))

const path = [
  { key: 'accepted', label: 'Rider accepted the delivery', state: 'done' },
  { key: 'arrive:2', label: 'Arrive at Ekslusibo Grill', state: 'done' },
  { key: 'ready:2', label: 'Food ready at Ekslusibo Grill', state: 'current' },
  { key: 'pickup:2', label: 'Confirm pickup at Ekslusibo Grill', state: 'todo' },
]

function withClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.86, longitude: 121.45, accuracy: 10 } } as GeolocationPosition) },
  })
})

describe('Rider: trip path in Diagnostics', () => {
  it('shows every step, the current one and the next thing to do', async () => {
    api.get.mockResolvedValue({
      ok: false,
      repaired: [],
      checks: [{ key: 'trip', status: 'needs_action', title: 'Food ready', message: 'Ekslusibo Grill marked the order ready, but its food items did not follow.' }],
      trip: { order_number: 'TT-04544', path, next_step: 'Ekslusibo Grill is still preparing your order.', reset_available: true },
    })
    withClient(<RiderDiagnosticsSheet isOpen onClose={vi.fn()} />)

    expect(await screen.findByText('Your trip · TT-04544')).toBeInTheDocument()
    expect(document.querySelector('[data-step="ready:2"]')).toHaveAttribute('data-state', 'current')
    expect(document.querySelector('[data-step="arrive:2"]')).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('trip-next-step')).toHaveTextContent('Ekslusibo Grill is still preparing your order.')
    expect(screen.getByText(/the Tourism Office can reopen it/)).toBeInTheDocument()
  })

  it('shows no trip section without a live delivery', async () => {
    api.get.mockResolvedValue({ ok: true, repaired: [], checks: [], trip: null })
    withClient(<RiderDiagnosticsSheet isOpen onClose={vi.fn()} />)

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByText(/Your trip/)).not.toBeInTheDocument()
  })
})

describe('Tourism Office: trip diagnostics panel', () => {
  const diagnosis = {
    delivery_id: 14,
    order_number: 'TT-04544',
    status: 'arrived_pickup',
    covered: true,
    path,
    next_step: 'Ekslusibo Grill is still preparing your order.',
    findings: [{ code: 'food_ready_mismatch', kind: 'fix', status: 'needs_action', title: 'Food ready', message: 'Its food items did not follow.' }],
    resets: [{ action: 'redo_pickup_arrival', business_id: 2, label: 'Redo arrival at Ekslusibo Grill', description: 'Clears the recorded arrival.' }],
    repaired: [],
  }

  it('applies the safe fixes', async () => {
    api.get.mockResolvedValue(diagnosis)
    api.post.mockResolvedValue({ ...diagnosis, findings: [{ ...diagnosis.findings[0], status: 'fixed' }], repaired: ['Items now match.'] })
    withClient(<TripDiagnosticsPanel deliveryId={14} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Apply fixes (1)' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/deliveries/14/diagnostics/fix'))
    expect(await screen.findByText('Fixed: Items now match.')).toBeInTheDocument()
  })

  it('reopens a step only with a written reason', async () => {
    api.get.mockResolvedValue(diagnosis)
    api.post.mockResolvedValue({ ...diagnosis, resets: [], reset: 'Reopened the arrival at Ekslusibo Grill.' })
    withClient(<TripDiagnosticsPanel deliveryId={14} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Reopen$/ }))
    const submit = screen.getByRole('button', { name: /Reopen step/ })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Reset reason'), { target: { value: 'short' } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reset reason'), { target: { value: 'Arrival recorded at the wrong place' } })
    fireEvent.click(submit)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/deliveries/14/diagnostics/reset', {
      action: 'redo_pickup_arrival',
      business_id: 2,
      reason: 'Arrival recorded at the wrong place',
    }))
    expect(await screen.findByText('Reopened the arrival at Ekslusibo Grill.')).toBeInTheDocument()
  })
})
