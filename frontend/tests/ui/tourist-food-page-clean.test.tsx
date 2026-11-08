import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristFood from '@/features/tourist/pages/TouristFood'
import { getFoodCart } from '@/shared/services/food-cart'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn() }))

function dish(id: number, name: string, category = 'Grilled Specialties') {
  return {
    id, name, description: null, category, image: null, price: 100 + id,
    business_name: 'Eksklusibo Grill', business_id: 7, business_latitude: 12.8, business_longitude: 121.4,
    rating: null, is_open: true, is_accepting_orders: true, availability: 'open', open_status: { status: 'open', label: 'Open now' },
  }
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristFood /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const lastParams = () => (api.get.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params

beforeEach(() => {
  localStorage.clear()
  api.get.mockReset()
  api.get.mockImplementation((_url: string, opts: { params: { page: number } }) => Promise.resolve(
    opts.params.page === 1
      ? { data: [dish(1, 'Chicken BBQ'), dish(2, 'Pancit Bihon', 'Noodles')], categories: ['Grilled Specialties', 'Noodles'], meta: { current_page: 1, last_page: 2, total: 3 } }
      : { data: [dish(3, 'Halo-Halo', 'Desserts')], categories: ['Grilled Specialties', 'Noodles'], meta: { current_page: 2, last_page: 2, total: 3 } },
  ))
})

describe('Tourist Food page (clean layout)', () => {
  it('shows real categories as one chip row and filters with the real name', async () => {
    renderPage()

    const chips = within(await screen.findByRole('navigation', { name: 'Food categories' }))
    await chips.findByRole('button', { name: 'Noodles' })
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Grilled Specialties', 'Noodles'])
    expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    // No duplicate category dropdown, no hard-coded fake categories.
    expect(screen.queryByText('Street Food')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'All Categories' })).not.toBeInTheDocument()

    fireEvent.click(chips.getByRole('button', { name: 'Noodles' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ category: 'Noodles', page: 1 }))
    expect(chips.getByRole('button', { name: 'Noodles' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends a sort value the API implements', async () => {
    renderPage()
    await screen.findByText('Chicken BBQ')

    const sort = screen.getByRole('combobox', { name: 'Sort dishes' })
    expect(within(sort).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['popular', 'price_low', 'price_high', 'newest'])
    fireEvent.change(sort, { target: { value: 'price_low' } })
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'price_low' }))
  })

  it('shows the total and loads more dishes on demand', async () => {
    renderPage()

    expect(await screen.findByText('Chicken BBQ')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more dishes' }))

    expect(await screen.findByText('Halo-Halo')).toBeInTheDocument()
    expect(lastParams()).toMatchObject({ page: 2 })
    expect(screen.queryByRole('button', { name: 'Show more dishes' })).not.toBeInTheDocument()
  })

  it('card stepper adds and removes from the shared cart; no fake favourite or "In Cart" buttons', async () => {
    renderPage()
    const card = (await screen.findByRole('button', { name: 'View details for Chicken BBQ' }))

    expect(within(card).queryByRole('button', { name: /favorite|like/i })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Add to Cart' }))
    expect(await within(card).findByText('1 in cart')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Add one more Chicken BBQ' }))
    expect(getFoodCart()).toEqual([expect.objectContaining({ id: 1, quantity: 2 })])
    expect(within(card).queryByRole('button', { name: /In Cart/ })).not.toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Remove one Chicken BBQ' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Remove one Chicken BBQ' }))
    expect(getFoodCart()).toEqual([])
    expect(within(card).getByRole('button', { name: 'Add to Cart' })).toBeInTheDocument()
    // Card buttons never open the detail page.
    expect(screen.getByRole('button', { name: 'View details for Chicken BBQ' })).toBeInTheDocument()
  })

  it('floating cart bar shows count and subtotal', async () => {
    renderPage()
    const card = await screen.findByRole('button', { name: 'View details for Chicken BBQ' })
    fireEvent.click(within(card).getByRole('button', { name: 'Add to Cart' }))

    const bar = (await screen.findByText('1 item in cart')).closest('button')!
    expect(within(bar).getByText('₱101.00')).toBeInTheDocument()
    expect(within(bar).getByText('View Cart')).toBeInTheDocument()
  })
})
