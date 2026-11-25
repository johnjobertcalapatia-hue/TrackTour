import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import AdminRiderCash from '@/features/admin/pages/AdminRiderCash'
import { MUNICIPAL_PORTAL, OfficePortalProvider } from '@/features/admin/office-portal'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

const overview = (mutationsEnabled: boolean) => ({
  date: today,
  policy: { enabled: mutationsEnabled, mutations_enabled: mutationsEnabled, effective_date: mutationsEnabled ? today : null, status: mutationsEnabled ? 'active' : 'inactive_pending_activation' },
  riders: [
    {
      rider_id: 8, name: 'Juan Rider', rider_status: 'available', advance_today: 2000, cash_with_rider: 1500, returned_to_date: 500, cod_deliveries_today: 3,
      advances: [{ id: 1, reference_number: 'RCFT-ADVANCE-1', amount: 2000, occurred_at: `${today}T00:30:00Z`, note: 'Morning' }],
      topups_today: 500, issued_today: 2500,
      day: {
        available: true, cod_deliveries: 3, cod_purchases: 1200, office_cash_used_for_purchases: 1000, cod_collections: 3900,
        unused_cash_returned: 500, cod_remitted: 0, cod_remittance_expected: 3600, cod_remittance_outstanding: 3600,
        outstanding_office_cash: 1500, reconciliation_status: 'calculated_preview', remittance_submitted: false, has_discrepancy: false, needs_reconciliation: true,
      },
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
    expect(juan.getByText('₱2,500.00', { selector: 'dd' })).toBeInTheDocument() // advance ₱2,000 + top-up ₱500
    expect(juan.getByText('₱1,500.00')).toBeInTheDocument()
    expect(juan.getByText(/RCFT-ADVANCE-1/)).toBeInTheDocument()
    expect(juan.getByRole('link', { name: /Daily receipt & remittance/ }))
      .toHaveAttribute('href', `/admin/riders/8/cash-reconciliation?date=${today}`)

    expect(screen.getByText('1 of 2 advanced on this date')).toBeInTheDocument()
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
    // The advance form opens from Issue cash (only for today).
    fireEvent.click(maria.getByRole('button', { name: /Issue cash/ }))
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

  it('keeps each cash purpose as its own figure and sums the daily overview', async () => {
    renderPage()
    const juan = within(await screen.findByRole('listitem', { name: 'Juan Rider' }))
    const figure = (label: string) => juan.getByText(label).parentElement!
    expect(figure('Cash issued')).toHaveTextContent('₱2,500.00')
    expect(figure('Cash issued')).toHaveTextContent('incl. ₱500.00 top-up')
    expect(figure('COD purchases')).toHaveTextContent('₱1,200.00')
    expect(figure('COD collected')).toHaveTextContent('₱3,900.00') // not reduced by purchases
    expect(figure('Unused cash returned')).toHaveTextContent('₱500.00')
    expect(figure('COD remitted')).toHaveTextContent('₱3,600.00 still due')
    expect(figure('Outstanding cash')).toHaveTextContent('₱1,500.00')
    expect(juan.getByText('Not yet submitted')).toBeInTheDocument()

    const tiles = within(screen.getByLabelText('Daily overview'))
    expect(tiles.getByText('Advanced today').parentElement).toHaveTextContent('₱2,500.00')
    expect(tiles.getByText('Outstanding cash').parentElement).toHaveTextContent('₱1,500.00')
    expect(tiles.getByText('Active advances').parentElement).toHaveTextContent('1 rider')
    expect(tiles.getByText('Pending reconciliation').parentElement).toHaveTextContent('1 rider')
  })

  it('explains exactly what is unavailable while the policy is inactive', async () => {
    renderPage()
    const available = await screen.findByRole('list', { name: 'Available now' })
    expect(available).toHaveTextContent('Issue cash advances and top-ups')
    expect(screen.getByRole('list', { name: 'Not available yet' })).toHaveTextContent('Record COD remittances')
    expect(screen.getByText('The daily COD cash policy does not have an approved effective date yet.')).toBeInTheDocument()
  })

  it('opens the historical record for an earlier date, read-only', async () => {
    renderPage()
    await screen.findByRole('listitem', { name: 'Juan Rider' })
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))

    const yesterday = new Date(`${today}T00:00:00Z`)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const y = yesterday.toISOString().slice(0, 10)
    expect(api.get).toHaveBeenLastCalledWith('/admin/cash-advances', { params: { date: y } })
    await screen.findByText(/Viewing the record for/)
    expect(screen.queryByRole('button', { name: /Issue cash/ })).toBeNull()
    expect(within(screen.getByRole('listitem', { name: 'Juan Rider' })).getByRole('link', { name: /Daily receipt/ })).toHaveAttribute('href', `/admin/riders/8/cash-reconciliation?date=${y}`)
  })
})

describe('Municipal Tourism Office Rider Cash board (plan Stage 2)', () => {
  it('uses /municipal for the overview, advances and the daily receipt link', async () => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockResolvedValue(overview(false))
    api.post.mockResolvedValue({})

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <OfficePortalProvider value={MUNICIPAL_PORTAL}><AdminRiderCash /></OfficePortalProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const juan = within(await screen.findByRole('listitem', { name: 'Juan Rider' }))
    expect(api.get).toHaveBeenCalledWith('/municipal/cash-advances', { params: { date: today } })
    expect(juan.getByRole('link', { name: /Daily receipt & remittance/ })).toHaveAttribute('href', `/municipal/riders/8/cash-reconciliation?date=${today}`)

    const maria = within(screen.getByRole('listitem', { name: 'Maria Rider' }))
    fireEvent.click(maria.getByRole('button', { name: /Issue cash/ }))
    fireEvent.change(maria.getByLabelText('Cash advance for Maria Rider'), { target: { value: '300' } })
    await act(async () => { fireEvent.click(maria.getByRole('button', { name: 'Record advance' })) })
    expect(api.post.mock.calls[0]?.[0]).toBe('/municipal/riders/9/cash-fund/advances')
  })
})
