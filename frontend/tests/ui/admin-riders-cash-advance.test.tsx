import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  ...api,
  apiErrorMessage: (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f),
}))

import { RiderCashAdvanceCard } from '@/features/admin/components/RiderCashAdvanceCard'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

const overview = {
  date: today,
  riders: [
    { rider_id: 8, name: 'Aldrin Robledo', rider_status: 'available', advance_today: 1000, cash_with_rider: 650, returned_to_date: 0, cod_deliveries_today: 2, advances: [] },
    { rider_id: 9, name: 'Johnjobert Calapatia', rider_status: 'offline', advance_today: 0, cash_with_rider: 0, returned_to_date: 0, cod_deliveries_today: 0, advances: [] },
  ],
  policy: { enabled: false, mutations_enabled: false, effective_date: null, status: 'inactive_pending_activation' },
}

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><RiderCashAdvanceCard /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Riders page: COD cash advance', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockResolvedValue(overview)
    api.post.mockResolvedValue({ id: 1, reference_number: 'RCFT-ADVANCE-1', amount: 500 })
  })

  it("lists every rider with today's COD deliveries, cash issued and cash still with the rider", async () => {
    renderCard()
    const card = screen.getByRole('region', { name: 'COD Cash Advance' })
    const aldrin = within(await within(card).findByRole('row', { name: 'Aldrin Robledo' }))
    expect(aldrin.getByText('₱1,000.00')).toBeInTheDocument()
    expect(aldrin.getByText('₱650.00')).toBeInTheDocument()
    expect(aldrin.getByRole('link', { name: 'Daily receipt' }))
      .toHaveAttribute('href', `/admin/riders/8/cash-reconciliation?date=${today}`)

    expect(within(card).getByText('Issued today', { selector: 'dt' }).nextSibling).toHaveTextContent('₱1,000.00')
    expect(within(card).getByText('Still with riders', { selector: 'dt' }).nextSibling).toHaveTextContent('₱650.00')
    expect(within(card).getByRole('link', { name: /Rider Cash/ })).toHaveAttribute('href', '/admin/rider-cash')
    expect(api.get).toHaveBeenCalledWith('/admin/cash-advances', { params: { date: today } })
  })

  it('issues cash to one rider with a once-only key, then clears the form', async () => {
    renderCard()
    const row = within(await screen.findByRole('row', { name: 'Johnjobert Calapatia' }))
    const issue = row.getByRole('button', { name: 'Issue' })
    expect(issue).toBeDisabled()

    fireEvent.change(row.getByLabelText('Cash advance for Johnjobert Calapatia'), { target: { value: '500' } })
    fireEvent.change(row.getByLabelText('Note for Johnjobert Calapatia'), { target: { value: 'Morning COD fund' } })
    fireEvent.click(issue)

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    const [url, body] = api.post.mock.calls[0]
    expect(url).toBe('/admin/riders/9/cash-fund/advances')
    expect(body).toMatchObject({ amount: 500, note: 'Morning COD fund' })
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/)

    expect(await screen.findByText('Issued ₱500.00 COD cash to Johnjobert Calapatia.')).toBeInTheDocument()
    expect(row.getByLabelText('Cash advance for Johnjobert Calapatia')).toHaveValue(null)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  })

  it('shows the reason when the office cannot issue cash', async () => {
    api.post.mockRejectedValueOnce(new Error('Rider is not in your municipality.'))
    renderCard()
    const row = within(await screen.findByRole('row', { name: 'Aldrin Robledo' }))
    fireEvent.change(row.getByLabelText('Cash advance for Aldrin Robledo'), { target: { value: '300' } })
    fireEvent.click(row.getByRole('button', { name: 'Issue' }))
    expect(await screen.findByText('Rider is not in your municipality.')).toBeInTheDocument()
  })
})
