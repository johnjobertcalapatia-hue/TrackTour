import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RiderDeliveriesPending from '@/features/rider/pages/RiderDeliveriesPending'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}))

vi.mock('@/shared/services/api', () => api)

const RIDER: User = {
  id: 8,
  name: 'Rider Test',
  email: 'rider-test@example.com',
  role: 'rider',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  rider_status: 'online',
  current_service: 'food',
  auto_accept: false,
}

function renderPendingPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/rider/deliveries/pending']}>
        <Routes>
          <Route path="/rider/deliveries/pending" element={<RiderDeliveriesPending />} />
          <Route path="/rider/map" element={<p>Active Delivery Map</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RiderDeliveriesPending', () => {
  beforeEach(() => {
    api.get.mockResolvedValue([
      {
        id: 42,
        order_id: 73,
        status: 'waiting',
        pickup_address: 'Restaurant, Bansud',
        delivery_address: 'Tourist address, Bansud',
        created_at: '2026-10-30T12:00:00Z',
      },
    ])
    api.patch.mockResolvedValue({ success: true })
    useAuthStore.setState({ user: RIDER, loading: false })
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, loading: false })
    vi.clearAllMocks()
  })

  it('opens the active delivery map after an offer is accepted', async () => {
    renderPendingPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Accept Delivery' }))

    expect(await screen.findByText('Active Delivery Map')).toBeInTheDocument()
    expect(api.patch).toHaveBeenCalledWith('/rider/dispatch/accept', { delivery_id: 42 })
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/rider/deliveries/pending')
    })
  })
})
