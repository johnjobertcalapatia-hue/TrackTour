import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Business Gallery page by business type: restaurants keep Signature Dishes +
 * Menu; resorts get Resort Highlights + Cottages & Rooms; tourist attractions
 * get Things to Do + Visit Info; each with its own checklist item, tip and
 * photo categories.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, default: { get: api.get } }))

import BusinessOwnerBusinessGallery from '@/features/business-owner/pages/BusinessOwnerBusinessGallery'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'
import { profileKind, splitActivities } from '@/features/business-owner/services/business-profile-kind'

const base = {
  id: 7, business_name: 'Test Place', business_description: 'About it', tagline: null, welcome_message: null, signature_dishes: ['Sisig'],
  logo: null, cover_photo: null, contact_number: '0917', email: null, website: null, facebook: null, instagram: null, other_social_media: null,
  address: 'Bansud', opening_time: '06:00:00', closing_time: '22:00:00', business_days: ['Monday'], price_range: null, average_rating: 0,
  review_count: 0, is_open: true, business_category_id: 1, municipality: { id: 1, name: 'Bansud' }, barangay: null,
}

function setup(category: string, extra: Record<string, unknown> = {}) {
  useBusinessOwnerStore.setState({ businesses: [{ id: 7, name: 'Test Place', category, status: 'approved', logo: null }], selectedBusinessId: 7 })
  api.get.mockImplementation(async (url: string) => {
    if (url === '/business-owner/businesses/7') return { ...base, category: { id: 1, name: category }, ...extra }
    if (url.includes('/resort-profile')) return { types: [{ id: 1, slug: 'beach', name: 'Beach Resort' }], facilities: [{ id: 2, slug: 'cottages', name: 'Cottages' }], custom_facilities: ['Videoke'] }
    if (url.includes('/resort-offerings')) return { offerings: [{ id: 1, category: 'cottage', category_label: 'Cottage', name: 'Beach Cottage', description: 'Day use', pricing_basis: 'per_unit', price: 300, is_published: true, images: [] }] }
    if (url.includes('/business-owner/menu')) return { data: [{ id: 5, name: 'Sisig Plate', price: 200, description: null, image: null, category: null, is_featured: false }] }
    if (url.includes('/reviews')) return { reviews: [] }
    if (url.includes('/businesses/create')) return { categories: [] }
    if (url.includes('/gallery')) return []
    return {}
  })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/business-owner/businesses/7/gallery']}>
        <Routes><Route path="/business-owner/businesses/:id/gallery" element={<BusinessOwnerBusinessGallery />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const urls = () => api.get.mock.calls.map(([u]) => String(u))

beforeEach(() => Object.values(api).forEach((fn) => fn.mockReset()))

describe('Business Gallery adapts to the business type', () => {
  it('restaurant: signature dishes, Menu tab and the dishes checklist item', async () => {
    setup('Restaurant')
    expect(await screen.findByRole('heading', { name: 'Restaurant Profile' })).toBeInTheDocument()
    expect(screen.getByText('Signature Dishes', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('At Least 3 Signature Dishes')).toBeInTheDocument()
    expect(screen.getByText('Opening Hours Added')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }))
    expect(await screen.findByText('Sisig Plate')).toBeInTheDocument()
    expect(urls().some((u) => u.includes('/resort-'))).toBe(false)
  })

  it('resort: resort highlights, Cottages & Rooms tab, no menu or dishes', async () => {
    setup('Resort')
    expect(await screen.findByRole('heading', { name: 'Resort Profile' })).toBeInTheDocument()
    const highlights = await screen.findByTestId('resort-highlights')
    expect(await within(highlights).findByText('Beach Resort')).toBeInTheDocument()
    expect(within(highlights).getByText('Cottages')).toBeInTheDocument()
    expect(within(highlights).getByText('Videoke')).toBeInTheDocument()
    expect(within(highlights).getByRole('link', { name: /Edit type & facilities/ })).toHaveAttribute('href', '/business-owner/resort/profile')

    expect(screen.queryByText('Signature Dishes', { selector: 'h2' })).toBeNull()
    expect(screen.queryByText(/signature dish/i)).toBeNull()
    expect(screen.getByText('At Least 3 Offerings Published')).toBeInTheDocument()
    expect(screen.getByText('Keep your cottages, rooms and rates up to date.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Menu$/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Cottages & Rooms/ }))
    expect(await screen.findByText('Beach Cottage')).toBeInTheDocument()
    expect(screen.getByText('₱300 / unit')).toBeInTheDocument()
    expect(urls().some((u) => u.includes('/business-owner/menu'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /Gallery/ }))
    expect(await screen.findByRole('button', { name: 'Cottages' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desserts' })).toBeNull()
  })

  it('tourist attraction: things to do, entrance fee and Visit Info', async () => {
    setup('Tourist Attraction', { details: { attraction_type: 'Nature', entrance_fee: '0', activities: 'Swimming, picnics, camping', best_time_to_visit: 'Mornings' } })
    expect(await screen.findByRole('heading', { name: 'Attraction Profile' })).toBeInTheDocument()
    const highlights = screen.getByTestId('attraction-highlights')
    expect(within(highlights).getByText('Nature')).toBeInTheDocument()
    expect(within(highlights).getByText(/Entrance: Free/)).toBeInTheDocument()
    expect(within(highlights).getByText('picnics')).toBeInTheDocument()
    expect(within(highlights).getByRole('link', { name: /Edit details/ })).toHaveAttribute('href', '/business-owner/businesses/7/tourist-attraction-edit')
    expect(screen.getByText('Activities Listed')).toBeInTheDocument()
    // Always open: no hours to set, no hours checklist item or tip.
    expect(screen.getAllByText('Always open').length).toBeGreaterThan(0)
    expect(screen.queryByText('Opening Hours Added')).toBeNull()
    expect(screen.queryByText('Keep your opening hours updated.')).toBeNull()
    expect(screen.queryByText(/^Open \d/)).toBeNull()
    expect(screen.queryByText('Signature Dishes', { selector: 'h2' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Visit Info/ }))
    expect(within(screen.getByTestId('attraction-visit-info')).getByText('Mornings')).toBeInTheDocument()
    expect(urls().some((u) => u.includes('/business-owner/menu') || u.includes('/resort-'))).toBe(false)
  })

  it('other business types get no type-specific sections', async () => {
    setup('Souvenir Shop')
    expect(await screen.findByRole('heading', { name: 'Business Profile' })).toBeInTheDocument()
    expect(screen.queryByText('Signature Dishes', { selector: 'h2' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Menu|Cottages & Rooms|Visit Info/ })).toBeNull()
  })

  it('maps categories to kinds and splits activities', () => {
    expect(['Restaurant', 'Café', 'Food Hub', 'Hotel & Restaurant Combination'].map(profileKind)).toEqual(['restaurant', 'restaurant', 'restaurant', 'restaurant'])
    expect(profileKind('Resort')).toBe('resort')
    expect(profileKind('Tourist Attraction')).toBe('attraction')
    expect(profileKind('Attractions')).toBe('attraction') // production's category name
    expect(profileKind('Hotel')).toBe('general')
    expect(splitActivities('Swimming, hiking;\npicnics ,')).toEqual(['Swimming', 'hiking', 'picnics'])
  })
})
