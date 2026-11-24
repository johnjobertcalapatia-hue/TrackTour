import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, apiErrorMessage: (_e: unknown, f: string) => f, default: { get: api.get } }))

import TouristReviews from '@/features/tourist/pages/TouristReviews'

const base = { images: [], tags: [], details: [], would_recommend: null, status: 'approved', created_at: '2026-11-18T07:52:00Z' }
const FEED = {
  items: [
    { ...base, key: 'food-1', category: 'food', title: 'Sisig', subtitle: 'Ekslusibo Grill', rating: 5, comment: 'Crispy and hot', status: 'pending', link: '/tourist/food/item/3' },
    { ...base, key: 'business-1', category: 'restaurant', title: 'Ekslusibo Grill', subtitle: 'Order TT-500', rating: 5, comment: null, would_recommend: true, details: [{ label: 'Food', value: '5/5' }], link: '/tourist/explore/1' },
    { ...base, key: 'ride-9', category: 'rider', title: 'Rico Rider', subtitle: 'Ride · TT-600', rating: 4, comment: 'Smooth ride', tags: ['safe_driving'], link: '/tourist/transport/trips/9' },
  ],
  counts: { all: 3, food: 1, restaurant: 1, rider: 1, resort: 0, attraction: 0 },
}

function renderPage(url = '/tourist/reviews') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}><TouristReviews /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.get.mockResolvedValue(FEED)
})

describe('My Reviews, grouped by what was reviewed', () => {
  it('shows a tab per category with its count and lists everything under All', async () => {
    renderPage()
    const tabs = await screen.findByRole('tablist', { name: 'Review categories' })
    for (const [label, count] of [['All', 3], ['Food', 1], ['Restaurants', 1], ['Riders', 1], ['Resorts & stays', 0], ['Attractions', 0]] as const) {
      expect(within(tabs).getByRole('tab', { name: new RegExp(`${label}\\s*${count}`) })).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true')
    // The restaurant name and the comment are shown (they were blank before).
    expect(screen.getByTestId('review-business-1')).toHaveTextContent('Ekslusibo Grill')
    expect(screen.getByTestId('review-food-1')).toHaveTextContent('Crispy and hot')
    expect(screen.getByTestId('review-food-1')).toHaveTextContent('Dish · Ekslusibo Grill')
  })

  it('filters to one category and shows its details', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Riders/ }))
    expect(screen.getByRole('tab', { name: /Riders/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('review-food-1')).toBeNull()
    const ride = screen.getByTestId('review-ride-9')
    expect(ride).toHaveTextContent('Rico Rider')
    expect(ride).toHaveTextContent('Safe driving')
    expect(ride).toHaveAttribute('href', '/tourist/transport/trips/9')
    expect(within(ride).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument()
  })

  it('marks reviews awaiting approval and restaurant extras', async () => {
    renderPage('/tourist/reviews?tab=food')
    expect(await screen.findByTestId('review-food-1')).toHaveTextContent('Awaiting approval')
    fireEvent.click(screen.getByRole('tab', { name: /Restaurants/ }))
    const restaurant = screen.getByTestId('review-business-1')
    expect(restaurant).toHaveTextContent('Would recommend')
    expect(restaurant).toHaveTextContent('Food: 5/5')
  })

  it('explains that resort and attraction reviews are not available yet', async () => {
    renderPage('/tourist/reviews?tab=resort')
    expect(await screen.findByText('Reviews for resorts and stays are not available in the app yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Attractions/ }))
    expect(screen.getByText('Reviews for tourist attractions are not available in the app yet.')).toBeInTheDocument()
  })
})
