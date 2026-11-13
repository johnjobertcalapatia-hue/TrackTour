import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import AdminRiders from '@/features/admin/pages/AdminRiders'

const foodFares = {
  base_fare: 40, included_kilometers: 2, per_kilometer: 15, minimum_fee: 40, service_adjustment: 0, surge_multiplier: 1,
}
const rideFares = {
  motorcycle: { base_fare: 55, per_km: 14 },
  tricycle: { base_fare: 60, per_km: 20 },
  car: { base_fare: 100, per_km: 25 },
  van: { base_fare: 150, per_km: 30 },
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AdminRiders /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Admin Riders: food delivery fee and ride hailing fares', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/admin/riders/fares') return Promise.resolve(foodFares)
      if (url === '/admin/riders/ride-fares') return Promise.resolve(rideFares)
      return Promise.resolve({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    })
    api.put.mockImplementation((_url: string, payload: unknown) => Promise.resolve(payload))
  })

  it('shows the two fare cards side by side with vehicle icons and one Save button', async () => {
    renderPage()
    const food = screen.getByRole('region', { name: 'Food Delivery Fee' })
    const ride = screen.getByRole('region', { name: 'Ride Hailing Fares' })
    const grid = food.parentElement!
    expect(grid).toHaveClass('lg:grid-cols-2')
    expect(grid).toContainElement(ride)

    expect(screen.getAllByRole('button', { name: /Save/ })).toHaveLength(1)
    expect(within(food).queryByRole('button', { name: /Save/ })).toBeNull()
    expect(within(ride).queryByRole('button', { name: /Save/ })).toBeNull()

    for (const vehicle of ['Motorcycle', 'Tricycle', 'Car', 'Van']) {
      expect(within(ride).getByLabelText(`${vehicle} Base Fare`)).toBeInTheDocument()
      expect(within(ride).getByLabelText(`${vehicle} Per-Kilometer Rate`)).toBeInTheDocument()
      expect(within(ride).getByTestId(`ride-vehicle-icon-${vehicle.toLowerCase()}`).querySelector('svg')).not.toBeNull()
    }
    await waitFor(() => expect(within(ride).getByLabelText('Motorcycle Base Fare')).toHaveValue(55))
  })

  it('Save Fares saves the food delivery fee and the ride fares, each to its own endpoint', async () => {
    renderPage()
    const food = screen.getByRole('region', { name: 'Food Delivery Fee' })
    const ride = screen.getByRole('region', { name: 'Ride Hailing Fares' })
    await waitFor(() => expect(within(ride).getByLabelText('Motorcycle Base Fare')).toHaveValue(55))
    await waitFor(() => expect(within(food).getByLabelText('Base Fare')).toHaveValue(40))

    fireEvent.change(within(food).getByLabelText('Base Fare'), { target: { value: '45' } })
    fireEvent.change(within(ride).getByLabelText('Motorcycle Base Fare'), { target: { value: '65' } })
    fireEvent.change(within(ride).getByLabelText('Van Per-Kilometer Rate'), { target: { value: '35' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Fares/ }))

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
    expect(api.put).toHaveBeenCalledWith('/admin/riders/fares', { ...foodFares, base_fare: 45 })
    expect(api.put).toHaveBeenCalledWith('/admin/riders/ride-fares', {
      ...rideFares,
      motorcycle: { base_fare: 65, per_km: 14 },
      van: { base_fare: 150, per_km: 35 },
    })
    expect(await screen.findByText(/Fares saved/)).toBeInTheDocument()
  })

  it('reports an error when saving fails', async () => {
    api.put.mockRejectedValueOnce(new Error('boom'))
    renderPage()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/riders/ride-fares'))
    fireEvent.click(screen.getByRole('button', { name: /Save Fares/ }))
    expect(await screen.findByText(/Failed to save fares/)).toBeInTheDocument()
  })

  it('the Save Fares bar stays on screen and says when there are unsaved changes', async () => {
    renderPage()
    const bar = screen.getByTestId('fares-save-bar')
    expect(bar).toHaveClass('sticky', 'top-0')
    expect(within(bar).getByRole('button', { name: /Save Fares/ })).toBeInTheDocument()
    const ride = screen.getByRole('region', { name: 'Ride Hailing Fares' })
    await waitFor(() => expect(within(ride).getByLabelText('Motorcycle Base Fare')).toHaveValue(55))
    await waitFor(() => expect(within(bar).queryByText('Unsaved changes')).toBeNull())

    fireEvent.change(within(ride).getByLabelText('Tricycle Base Fare'), { target: { value: '65' } })
    expect(within(bar).getByText('Unsaved changes')).toBeInTheDocument()

    // The fake server keeps what was saved, as the real one does.
    const saved: Record<string, unknown> = {}
    api.put.mockImplementation((url: string, payload: unknown) => {
      saved[url] = payload
      return Promise.resolve(payload)
    })
    api.get.mockImplementation((url: string) => {
      if (url in saved) return Promise.resolve(saved[url])
      if (url === '/admin/riders/fares') return Promise.resolve(foodFares)
      if (url === '/admin/riders/ride-fares') return Promise.resolve(rideFares)
      return Promise.resolve({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    })

    fireEvent.click(within(bar).getByRole('button', { name: /Save Fares/ }))
    await waitFor(() => expect(within(bar).queryByText('Unsaved changes')).toBeNull())
    expect(await within(bar).findByText(/Fares saved/)).toBeInTheDocument()
  })
})
