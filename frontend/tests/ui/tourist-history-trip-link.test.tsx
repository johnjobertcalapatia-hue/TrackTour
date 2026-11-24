import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import TouristHistory from '@/features/tourist/pages/TouristHistory'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, default: { get: api.get } }))

function TripPage() {
  const { id } = useParams()
  return <p>Trip details {id}</p>
}

describe('My Activities › Travels › Transport (2026-11-18)', () => {
  it('View Trip opens that ride’s details page, not the booking page', async () => {
    api.get.mockResolvedValue({
      trips: { data: [
        { id: 57, order_number: 'TRP-6AFC86AC347A2', business_name: '', status: 'cancelled', total: 204.34, created_at: '2026-11-18T00:54:00+08:00' },
      ] },
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/tourist/activities']}>
          <Routes>
            <Route path="/tourist/activities" element={<TouristHistory embedded only={['transport']} />} />
            <Route path="/tourist/transport/trips/:id" element={<TripPage />} />
            <Route path="/tourist/transport" element={<p>Book a ride</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'View trip TRP-6AFC86AC347A2' }))
    expect(await screen.findByText('Trip details 57')).toBeInTheDocument()
    expect(screen.queryByText('Book a ride')).toBeNull()
  })
})
