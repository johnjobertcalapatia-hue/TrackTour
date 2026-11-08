import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BusinessOwnerSettings from '@/features/business-owner/pages/BusinessOwnerSettings'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'

const api = vi.hoisted(() => ({
  business: {
    id: 5,
    business_name: 'Test Restaurant',
    payment_methods: ['cash', 'gcash'] as string[],
    force_closed: false,
    business_hours: { monday: [{ open: '08:00', close: '17:00' }] },
    accepts_reservation: true,
    accepts_orders: true,
    accepts_walk_ins: true,
  },
  get: vi.fn(async (url: string) => {
    if (url === '/business-owner/businesses/5') {
      return {
        ...api.business,
        payment_methods: [...api.business.payment_methods],
        business_hours: { ...api.business.business_hours },
      }
    }
    return {}
  }),
  put: vi.fn(async (_url: string, payload: {
    payment_methods?: string[]
    force_closed?: boolean
    accepts_reservation?: boolean
    accepts_orders?: boolean
    accepts_walk_ins?: boolean
  }) => {
    if (payload.payment_methods) api.business.payment_methods = payload.payment_methods
    if (payload.force_closed !== undefined) api.business.force_closed = payload.force_closed
    if (payload.accepts_reservation !== undefined) api.business.accepts_reservation = payload.accepts_reservation
    if (payload.accepts_orders !== undefined) api.business.accepts_orders = payload.accepts_orders
    if (payload.accepts_walk_ins !== undefined) api.business.accepts_walk_ins = payload.accepts_walk_ins
    return {}
  }),
  post: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  put: api.put,
  post: api.post,
  del: api.del,
}))

function renderSettings(path = '/settings?tab=payment-methods') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings" element={<BusinessOwnerSettings />} />
          <Route path="/business-owner/gallery" element={<p>Business Gallery destination</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Business Owner payment methods', () => {
  beforeEach(() => {
    api.business.payment_methods = ['cash', 'gcash']
    api.business.force_closed = false
    api.business.accepts_reservation = true
    api.business.accepts_orders = true
    api.business.accepts_walk_ins = true
    api.get.mockClear()
    api.put.mockReset()
    api.put.mockImplementation(async (_url, payload) => {
      if (payload.payment_methods) api.business.payment_methods = payload.payment_methods
      if (payload.force_closed !== undefined) api.business.force_closed = payload.force_closed
      if (payload.accepts_reservation !== undefined) api.business.accepts_reservation = payload.accepts_reservation
      if (payload.accepts_orders !== undefined) api.business.accepts_orders = payload.accepts_orders
      if (payload.accepts_walk_ins !== undefined) api.business.accepts_walk_ins = payload.accepts_walk_ins
      return {}
    })
    useBusinessOwnerStore.setState({
      businesses: [{ id: 5, name: 'Test Restaurant', category: 'restaurant', status: 'active', logo: null }],
      selectedBusinessId: 5,
    })
  })

  it('saves each toggle immediately without a separate save button', async () => {
    renderSettings()

    const toggles = await screen.findAllByRole('checkbox')
    fireEvent.click(toggles[0])

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        '/business-owner/businesses/5/payment-methods',
        { payment_methods: ['gcash'] }
      )
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment methods updated.')
    expect(screen.queryByRole('button', { name: /save payment methods/i })).not.toBeInTheDocument()
  })

  it('redirects legacy General Settings links to the Business Gallery', async () => {
    renderSettings('/settings?tab=general')

    expect(await screen.findByText('Business Gallery destination')).toBeInTheDocument()
  })

  it('shows operating hours and visibility together for the old Hours link', async () => {
    renderSettings('/settings?tab=hours')

    expect(await screen.findByRole('heading', { name: 'Visibility' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Opening Hours' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Business Status' })).toBeInTheDocument()
    const restaurantStatusCard = screen.getByRole('heading', { name: 'Restaurant Status' }).parentElement
    expect(within(restaurantStatusCard as HTMLElement).getByRole('heading', { name: 'Accept Settings' })).toBeInTheDocument()
    expect(within(restaurantStatusCard as HTMLElement).getByText('Accept Walk-ins')).toBeInTheDocument()
  })

  it('saves restaurant status immediately without submitting schedule changes', async () => {
    renderSettings('/settings?tab=visibility')

    const closedOption = await screen.findByLabelText(/Temporarily Closed/)
    fireEvent.click(closedOption)

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        '/business-owner/businesses/5/hours',
        { force_closed: true }
      )
    })
    expect(screen.queryByRole('button', { name: /save status/i })).not.toBeInTheDocument()
    expect(closedOption).toBeChecked()
  })

  it('restores the previous restaurant status when autosave fails', async () => {
    api.put.mockRejectedValueOnce({ response: { data: { message: 'Status save failed.' } } })
    renderSettings('/settings?tab=visibility')

    fireEvent.click(await screen.findByLabelText(/Temporarily Closed/))

    expect(await screen.findByRole('alert')).toHaveTextContent('Status save failed.')
    await waitFor(() => {
      expect(screen.getByLabelText(/Automatic — Follow business hours/)).toBeChecked()
    })
  })

  it.each([
    ['Accept Bookings', 'accepts_reservation'],
    ['Accept Orders', 'accepts_orders'],
    ['Accept Walk-ins', 'accepts_walk_ins'],
  ] as const)('autosaves %s with the current values', async (label, field) => {
    renderSettings('/settings?tab=visibility')

    fireEvent.click(await screen.findByLabelText(label))

    const expectedSettings = {
      accepts_reservation: field === 'accepts_reservation' ? false : true,
      accepts_orders: field === 'accepts_orders' ? false : true,
      accepts_walk_ins: field === 'accepts_walk_ins' ? false : true,
    }

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        '/business-owner/businesses/5/accept-settings',
        expectedSettings
      )
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Acceptance settings updated successfully.')
  })

  it('restores the previous Accept Settings values when autosave fails', async () => {
    api.put.mockRejectedValueOnce({ response: { data: { message: 'Preference save failed.' } } })
    renderSettings('/settings?tab=visibility')

    const acceptOrders = await screen.findByLabelText(/Accept Orders/)
    fireEvent.click(acceptOrders)

    expect(await screen.findByRole('alert')).toHaveTextContent('Preference save failed.')
    await waitFor(() => expect(screen.getByLabelText(/Accept Orders/)).toBeChecked())
  })

  it('saves GCash changes immediately', async () => {
    renderSettings()

    const toggles = await screen.findAllByRole('checkbox')
    fireEvent.click(toggles[1])

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        '/business-owner/businesses/5/payment-methods',
        { payment_methods: ['cash'] }
      )
    })
  })

  it('does not allow disabling the last enabled payment method', async () => {
    api.business.payment_methods = ['cash']
    renderSettings()

    const [cashToggle] = await screen.findAllByRole('checkbox')
    fireEvent.click(cashToggle)

    expect(await screen.findByRole('alert')).toHaveTextContent('At least one payment method must remain enabled.')
    expect(cashToggle).toBeChecked()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('restores the previous toggle when saving fails', async () => {
    api.put.mockRejectedValueOnce({ response: { data: { message: 'Save failed.' } } })
    renderSettings()

    const toggles = await screen.findAllByRole('checkbox')
    fireEvent.click(toggles[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed.')
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toBeChecked())
  })

  it('shows restaurant COD purchase payment separately from the tourist payment status', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/business-owner/businesses/5') {
        return {
          ...api.business,
          payment_methods: [...api.business.payment_methods],
          business_hours: { ...api.business.business_hours },
        }
      }

      if (url === '/business-owner/businesses/5/payments') {
        return {
          data: {
            payments: [{
              id: 21,
              order_number: 'ORD-COD-PAID',
              group_reference: null,
              customer_name: 'Tourist',
              placed_at: '2026-11-05T10:00:00Z',
              payment_method: 'cash',
              payment_label: 'Cash',
              payment_status: 'pending',
              restaurant_purchase_status: 'paid',
              restaurant_purchase_paid_at: '2026-11-05T10:15:00Z',
              order_status: 'ready',
              total: 500,
              paid_amount: 0,
              settlement_number: null,
              settlement_amount: null,
              settlement_status: null,
              settled_at: null,
            }],
          },
          meta: {
            current_page: 1,
            last_page: 1,
            per_page: 25,
            total: 1,
            summary: {
              orders_count: 1,
              total_received: 500,
              cash_count: 1,
              cash_total: 500,
              online_count: 0,
              online_total: 0,
              paid_count: 0,
              settled_amount: 0,
            },
          },
        }
      }

      return {}
    })

    renderSettings('/settings?tab=payments')

    expect(await screen.findByText('Restaurant purchase: Paid')).toBeInTheDocument()
    const row = screen.getByText('ORD-COD-PAID').closest('tr')
    expect(row).toHaveTextContent('Pending')
    expect(row).toHaveTextContent('Restaurant purchase: Paid')
  })
})
