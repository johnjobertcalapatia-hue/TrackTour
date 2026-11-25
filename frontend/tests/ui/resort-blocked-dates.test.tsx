import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Resort reservations Stage 6: the owner's Closed & blocked dates panel. */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import BlockedDatesPanel, { manilaToday } from '@/features/business-owner/components/resort/BlockedDatesPanel'

const renderPanel = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BlockedDatesPanel businessId={7} offerings={[{ id: 3, name: 'Family room' }]} />
  </QueryClientProvider>,
)

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  api.get.mockResolvedValue([{ id: 1, resort_offering_id: null, offering_name: null, start_date: '2026-12-20', end_date: '2026-12-22', reason: 'Private event' }])
})

describe('Closed & blocked dates', () => {
  it('lists upcoming closures and reopens one', async () => {
    api.del.mockResolvedValue(null)
    renderPanel()
    const list = await screen.findByRole('list', { name: 'Blocked dates' })
    expect(within(list).getByText(/Whole resort · Private event/)).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: 'Reopen 2026-12-20' }))
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/business-owner/businesses/7/resort-blocked-dates/1'))
    expect(await screen.findByRole('status')).toHaveTextContent('Dates reopened.')
  })

  it('blocks one offering and warns about reservations already made', async () => {
    api.post.mockResolvedValue({ id: 2, already_reserved: 2 })
    renderPanel()
    await screen.findByRole('list', { name: 'Blocked dates' })
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2099-01-10' } })
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2099-01-11' } })
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Repairs' } })
    fireEvent.click(screen.getByRole('button', { name: /Block dates/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/business-owner/businesses/7/resort-blocked-dates', {
      start_date: '2099-01-10', end_date: '2099-01-11', resort_offering_id: 3, reason: 'Repairs',
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('2 already reserved on those dates stay booked')
  })

  it('refuses a last day before the first day without calling the server', async () => {
    renderPanel()
    await screen.findByRole('list', { name: 'Blocked dates' })
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2099-01-10' } })
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2099-01-05' } })
    fireEvent.click(screen.getByRole('button', { name: /Block dates/ }))
    expect(await screen.findByText('The last day cannot be before the first day.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('uses the Philippine date for today', () => {
    expect(manilaToday(new Date('2026-12-01T17:30:00Z'))).toBe('2026-12-02')
  })
})
