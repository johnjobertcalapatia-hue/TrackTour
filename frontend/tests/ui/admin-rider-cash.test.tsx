import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import AdminRiderCash from '@/features/admin/pages/AdminRiderCash'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

const overview = (mutationsEnabled: boolean) => ({
  date: today,
  policy: { enabled: mutationsEnabled, mutations_enabled: mutationsEnabled, effective_date: mutationsEnabled ? today : null, status: mutationsEnabled ? 'active' : 'inactive_pending_activation' },
  riders: [
    {
      rider_id: 8, name: 'Juan Rider', rider_status: 'available', advance_today: 2000, cash_with_rider: 1500, returned_to_date: 500, cod_deliveries_today: 3,
      advances: [{ id: 1, reference_number: 'RCFT-ADVANCE-1', amount: 2000, occurred_at: `${today}T00:30:00Z`, note: 'Morning' }],
    },
    { rider_id: 9, name: 'Maria Rider', rider_status: 'offline', advance_today: 0, cash_with_rider: 0, returned_to_date: 0, cod_deliveries_today: 0, advances: [] },
  ],
})

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AdminRiderCash /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Tourism Office Rider Cash board', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockResolvedValue(overview(false))
    api.post.mockResolvedValue({})
  })

  it('lists each rider with the advance, cash still with the rider and a link to the daily receipt', async () => {
    renderPage()
    const juan = within(await screen.findByRole('listitem', { name: 'Juan Rider' }))
    expect(juan.getByText('₱2,000.00', { selector: 'dd' })).toBeInTheDocument()
    expect(juan.getByText('₱1,500.00')).toBeInTheDocument()
    expect(juan.getByText(/RCFT-ADVANCE-1/)).toBeInTheDocument()
    expect(juan.getByRole('link', { name: /Daily receipt & remittance/ }))
      .toHaveAttribute('href', `/admin/riders/8/cash-reconciliation?date=${today}`)

    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/admin/cash-advances', { params: { date: today } })
  })

  it('says plainly when remittance recording is off, and hides the notice once the policy is active', async () => {
    const { unmount } = renderPage()
    expect(await screen.findByText(/Remittance recording is off/)).toBeInTheDocument()
    unmount()

    api.get.mockResolvedValue(overview(true))
    renderPage()
    await screen.findByRole('listitem', { name: 'Juan Rider' })
    expect(screen.queryByText(/Remittance recording is off/)).not.toBeInTheDocument()
  })

  it('records an advance once with an idempotency key, then refreshes', async () => {
    renderPage()
    const maria = within(await screen.findByRole('listitem', { name: 'Maria Rider' }))
    const button = maria.getByRole('button', { name: 'Record advance' })
    expect(button).toBeDisabled()

    fireEvent.change(maria.getByLabelText('Cash advance for Maria Rider'), { target: { value: '1500' } })
    fireEvent.change(maria.getByLabelText('Note for Maria Rider'), { target: { value: 'Morning float' } })
    await act(async () => { fireEvent.click(button) })

    expect(api.post).toHaveBeenCalledTimes(1)
    const [url, body] = api.post.mock.calls[0]
    expect(url).toBe('/admin/riders/9/cash-fund/advances')
    expect(body).toMatchObject({ amount: 1500, note: 'Morning float' })
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText('Recorded a ₱1,500.00 advance for Maria Rider.')).toBeInTheDocument()
  })
})
