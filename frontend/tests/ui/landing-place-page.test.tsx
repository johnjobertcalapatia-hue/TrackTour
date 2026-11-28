import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Public place page (/explore/place/:id, 2026-11-24): a landing-page card for
 * a tourist attraction opens a public page, not the tourist portal with its
 * "Guest · Sign in" sidebar. Restaurants keep their own public page.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn() }))
vi.mock('@/pages/components/LandingShell', () => ({
  default: ({ children, back }: { children: React.ReactNode; back?: { to: string; label: string } }) => (
    <div data-testid="landing-shell">{back && <a href={back.to}>{back.label}</a>}{children}</div>
  ),
}))

import LandingPlacePage from '@/pages/LandingPlacePage'

const ATTRACTION = {
  business: {
    id: 2, name: 'Batong Buwaya River', category: { name: 'Attractions' }, business_category_id: null,
    description: 'A rock formation resembling a crocodile head.', municipality: { name: 'Bansud' }, barangay: { name: 'Rosacara' },
    address: 'Rosacara, Bansud', latitude: 12.8, longitude: 121.4, phone: '09506777112', email: 'river@example.com',
    logo: null, cover_photo: '/storage/covers/river.jpg', opening_time: '08:00', closing_time: '20:00',
    category_details: { entrance_fee: '₱20', attraction_type: 'River', activities: 'Swimming and picnics' },
  },
  reviews: [],
  avgRating: 0,
  reviewsCount: 0,
  gallery: [{ id: 1, type: 'photo', file_path: '/storage/gallery/river-1.jpg', caption: 'The river' }],
}

function renderAt(id: number) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/explore/place/${id}`]}>
        <Routes>
          <Route path="/explore/place/:id" element={<LandingPlacePage />} />
          <Route path="/explore/food/:id" element={<p>Public restaurant page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('Public place page', () => {
  it('shows an attraction on the public site with its visitor information', async () => {
    api.get.mockResolvedValue(ATTRACTION)
    renderAt(2)
    expect(await screen.findByRole('heading', { level: 1, name: 'Batong Buwaya River' })).toBeInTheDocument()
    expect(screen.getByTestId('landing-shell')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/tourist/explore/2')
    expect(screen.getByText('Tourist Spot')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About & History' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activities & Highlights' })).toBeInTheDocument()
    const info = within(screen.getByRole('complementary', { name: 'Visitor information' }))
    expect(info.getByText('₱20')).toBeInTheDocument()
    expect(info.getByText('08:00 – 20:00')).toBeInTheDocument()
    expect(info.getByRole('link', { name: /Get Directions/ })).toHaveAttribute('href', '/explore/map?directions=2') // public TrackTour map, not Google
    expect(screen.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toHaveAttribute('href', '/explore')
  })

  it('saves a guest favourite without an account, and opens photos', async () => {
    api.get.mockResolvedValue(ATTRACTION)
    renderAt(2)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }))
    expect(JSON.parse(localStorage.getItem('tracktour_landing_favorites')!)).toEqual([2])
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /The river/ }))
    expect(screen.getByRole('dialog', { name: 'Photo' })).toBeInTheDocument()
  })

  it('sends a restaurant to its own public page', async () => {
    api.get.mockResolvedValue({ business: { ...ATTRACTION.business, id: 5, name: 'Ekslusibo Grill', category: { name: 'Restaurant' } } })
    renderAt(5)
    expect(await screen.findByText('Public restaurant page')).toBeInTheDocument()
  })

  it('says so when the place is gone', async () => {
    api.get.mockRejectedValue({ response: { status: 404 } })
    renderAt(99)
    expect(await screen.findByText(/isn.t on TrackTour anymore/)).toBeInTheDocument()
  })
})
