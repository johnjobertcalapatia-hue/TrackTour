import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, openAuthenticatedDocument: vi.fn(), apiErrorMessage: (_e: unknown, f = 'Request failed.') => f }))
vi.mock('@/features/admin/components/RiderRecords', () => ({ RiderRecords: () => <section aria-label="Rider records">records</section> }))

import AdminRiderShow from '@/features/admin/pages/AdminRiderShow'

const rider = (account_status: string, extra: Record<string, unknown> = {}) => ({
  id: 8, name: 'Aldrin Robledo', email: 'aldrin@example.com', phone: '09312312312', profile_photo: null, account_status,
  rider_status: 'offline', current_service: 'transport', municipality_id: 1, municipality: 'Bansud', barangay: null, address: null,
  created_at: '2026-10-20T02:00:00Z', vehicle_type: null, vehicle_plate: null, can_ride_hail: false,
  license_number: null, license_expiry: null, registration_number: null, documents: [], review_history: [], ...extra,
})

function renderAt(data: unknown) {
  api.get.mockImplementation((url: string) => Promise.resolve(url === '/municipalities' ? [{ id: 1, name: 'Bansud' }] : data))
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/riders/8']}>
        <Routes><Route path="/admin/riders/:id" element={<AdminRiderShow />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('Admin rider profile page', () => {
  it('leads with identity, a summary and the actions, then records and profile side by side', async () => {
    renderAt(rider('approved'))

    const header = await screen.findByRole('region', { name: 'Rider' })
    expect(within(header).getByRole('heading', { name: 'Aldrin Robledo' })).toBeInTheDocument()
    const summary = within(header).getByRole('list', { name: 'Rider summary' })
    expect(summary).toHaveTextContent('Bansud')
    expect(summary).toHaveTextContent('Ride hailing')
    expect(summary).toHaveTextContent('No vehicle registered')
    expect(within(header).getByRole('link', { name: /View daily cash receipt/ })).toHaveAttribute('href', '/admin/riders/8/cash-reconciliation')

    // Hierarchy: header → records → profile sections → documents.
    const order = ['Rider', 'Rider records', 'Personal information', 'Registered vehicle', 'License & registration', 'Documents'].map((name) => screen.getByRole('region', { name }))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getByRole('list', { name: 'Document checklist' })).toHaveTextContent('Missing')
  })

  it.each([
    ['approved', ['Suspend']],
    ['pending_review', ['Approve', 'Reject']],
    ['suspended', ['Reactivate']],
    ['rejected', ['Approve']],
  ])('offers only the actions that fit a %s rider', async (status, expected) => {
    renderAt(rider(status))
    const actions = within(await screen.findByLabelText('Actions'))
    expect(actions.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(expected)
  })
})
