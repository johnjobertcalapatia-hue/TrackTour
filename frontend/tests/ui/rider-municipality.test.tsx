import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), openAuthenticatedDocument: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import RiderRegisterPage from '@/features/auth/pages/RiderRegisterPage'
import AdminRiderShow from '@/features/admin/pages/AdminRiderShow'

const municipalities = [
  { id: 1, name: 'Bansud' },
  { id: 2, name: 'Gloria' },
]

const rider = {
  id: 8,
  name: 'Aldrin Robledo',
  email: 'aldrin@example.com',
  phone: '09312312312',
  profile_photo: null,
  account_status: 'approved',
  municipality_id: null,
  municipality: null,
  barangay: null,
  address: null,
  created_at: '2026-10-22T00:00:00Z',
  vehicle_type: null,
  vehicle_plate: null,
  license_number: null,
  license_expiry: null,
  registration_number: null,
  documents: [],
  review_history: [],
}

function wrap(ui: React.ReactNode, path = '/') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Rider municipality (decides which Tourism Office issues COD cash)', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/municipalities') return Promise.resolve(municipalities)
      if (url === '/admin/riders/8') return Promise.resolve(rider)
      return Promise.resolve(null)
    })
    api.put.mockResolvedValue({ ...rider, municipality_id: 1, municipality: 'Bansud' })
  })

  it('rider sign-up asks for a required municipality from the municipality list', async () => {
    wrap(<RiderRegisterPage />)
    const select = screen.getByLabelText(/Municipality/)
    expect(select).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bansud' })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Gloria' })).toBeInTheDocument()
    expect(screen.getByText(/Its Tourism Office issues your COD cash/)).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/municipalities')
  })

  it('rider detail warns when the municipality is not set and saves the one the office picks', async () => {
    wrap(
      <Routes>
        <Route path="/admin/riders/:id" element={<AdminRiderShow />} />
      </Routes>,
      '/admin/riders/8',
    )
    const select = await screen.findByLabelText('Municipality')
    expect(screen.getByText(/the Tourism Office cannot issue this rider COD cash/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bansud' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    fireEvent.change(select, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/riders/8/municipality', { municipality_id: 1 }))
    expect(await screen.findByText('Municipality saved.')).toBeInTheDocument()
  })
})
