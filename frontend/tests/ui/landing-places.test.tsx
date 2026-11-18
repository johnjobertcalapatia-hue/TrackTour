import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn().mockResolvedValue([]) }))
vi.mock('@/shared/services/api', () => ({ get: api.get }))

import LandingPlaces, { landingCardLink, type LandingCard } from '@/pages/components/LandingPlaces'
import LandingDestinations from '@/pages/components/LandingDestinations'

const cards: LandingCard[] = [
  { key: 'biz-7', types: ['food'], title: 'Ekslusibo Grill', location: 'Bansud', category: 'Restaurant', rating: 4.6, image: null },
  { key: 'spot-3', types: ['spot'], title: 'Manihala Falls', location: 'Bansud', category: 'Waterfall', rating: null, image: null },
  { key: 'biz-9', types: ['resort'], title: 'Seaside Resort', location: 'Gloria', category: 'Resort', rating: null, image: null },
]

describe('places to discover', () => {
  it('links each card to its public page', () => {
    expect(landingCardLink(cards[0]!)).toBe('/explore/food/7')
    expect(landingCardLink(cards[1]!)).toBe('/tourist/destinations/3')
    expect(landingCardLink(cards[2]!)).toBe('/tourist/explore/9')
  })

  it('filters the cards with the tabs', () => {
    render(<MemoryRouter><LandingPlaces cards={cards} pending={false} /></MemoryRouter>)

    expect(screen.getAllByRole('link')).toHaveLength(3)
    fireEvent.click(screen.getByRole('tab', { name: /Food/ }))
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Ekslusibo Grill/ })).toHaveAttribute('href', '/explore/food/7')
    fireEvent.click(screen.getByRole('tab', { name: /Businesses/ }))
    expect(screen.getByText('No businesses published yet.')).toBeInTheDocument()
  })
})

describe('where to next', () => {
  it('marks Bansud as home and municipalities without places as coming soon', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <LandingDestinations municipalities={[{ id: 1, name: 'Bansud', businesses_count: 1 }, { id: 4, name: 'Gloria' }]} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Where to Next?' })).toBeInTheDocument()
    expect(screen.getByText('Home of TrackTour')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Gloria.*Coming soon/ })).toHaveAttribute('href', '/explore/municipality/4')
    expect(screen.getByRole('button', { name: 'Scroll municipalities right' })).toBeInTheDocument()
  })
})
