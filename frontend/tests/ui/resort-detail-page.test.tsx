import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreShow from '@/features/tourist/pages/TouristExploreShow'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, default: { get: api.get } }))
vi.mock('@/features/tourist/components/RestaurantRouteMap', () => ({
  default: ({ restaurantName }: { restaurantName: string }) => <div data-testid="route-map">Route to {restaurantName}</div>,
}))

const RESORT_BUSINESS = {
  id: 9, name: 'Forest Haven', business_name: 'Forest Haven', description: 'A quiet nature and pool resort in the hills.',
  category: { id: 2, name: 'Resort' }, business_category_id: 2,
  municipality: { name: 'Gloria' }, barangay: { name: 'Malamig' }, address: 'Sitio Bato',
  latitude: 12.97, longitude: 121.47, phone: '09171234567', email: 'hello@foresthaven.ph',
  cover_photo: 'covers/forest.jpg', logo: null, is_favorited: false, status: 'approved',
  opening_time: '08:00', closing_time: '17:00', price_range: '₱150 – ₱2,500',
  category_details: { day_tour_available: '1', overnight_stay: 'yes', recreational_activities: 'Kayaking, Bird watching\nBonfire nights' },
}
const RESORT = {
  types: [{ id: 1, slug: 'pool', name: 'Pool Resort' }, { id: 2, slug: 'nature', name: 'Nature Resort' }],
  facilities: [{ id: 1, slug: 'swimming_pool', name: 'Swimming pool' }, { id: 6, slug: 'gardens', name: 'Gardens' }],
  custom_facilities: ['Videoke room'],
}

function renderAt(id = 9) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/tourist/explore/${id}`]}>
        <Routes>
          <Route path="/tourist/explore/:id" element={<TouristExploreShow />} />
          <Route path="/tourist/food/:id" element={<div>Restaurant page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  api.get.mockReset()
  api.post.mockReset()
  api.post.mockResolvedValue({})
})

describe('Resort detail page (Stage 3)', () => {
  it('assembles the page from real data: gallery, types, facilities, about, activities, availability, reviews, location, contact', async () => {
    api.get.mockResolvedValue({
      business: RESORT_BUSINESS,
      resort: RESORT,
      gallery: [{ id: 1, type: 'Gallery', file_path: 'media/pool.jpg' }, { id: 2, type: 'Gallery', file_path: 'media/garden.jpg' }],
      reviews: [{ id: 5, rating: 5, review: 'Peaceful and clean.', created_at: '2026-11-01T10:00:00+08:00', user: { name: 'Ana Reyes' } }],
      avgRating: 4.5, reviewsCount: 2, isFavorited: false,
    })
    renderAt()

    const page = await screen.findByRole('main', { name: 'Forest Haven resort' })
    expect(within(page).getByRole('heading', { level: 1, name: 'Forest Haven' })).toBeInTheDocument()
    expect(within(within(page).getByRole('list', { name: 'Resort types' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Pool Resort', 'Nature Resort'])
    expect(within(page).getByText('Malamig, Gloria')).toBeInTheDocument()
    expect(within(page).getByText('4.5')).toBeInTheDocument()

    // Gallery thumbnails switch the main photo.
    const thumbs = within(within(page).getByRole('group', { name: 'Resort photos' })).getAllByRole('button')
    expect(thumbs).toHaveLength(2)
    fireEvent.click(thumbs[1]!)
    expect(within(page).getByAltText('Forest Haven photo 2').getAttribute('src')).toContain('/storage/media/garden.jpg')

    const headings = within(page).getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.replace(/·.*/, '').trim())
    expect(headings).toEqual(['Facilities', 'About', 'Activities', 'Availability', 'Reviews', 'Location', 'Contact'])
    expect(within(within(page).getByRole('list', { name: 'Facilities' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Swimming pool', 'Gardens', 'Videoke room'])
    expect(within(within(page).getByRole('list', { name: 'Activities' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Kayaking', 'Bird watching', 'Bonfire nights'])
    const availability = within(within(page).getByRole('list', { name: 'Availability' }))
    expect(availability.getByText('Day tour available')).toBeInTheDocument()
    expect(availability.getByText('Overnight stays')).toBeInTheDocument()
    expect(availability.getByText('Open 8:00 AM – 5:00 PM')).toBeInTheDocument()
    expect(within(page).getByText('Peaceful and clean.')).toBeInTheDocument()
    expect(within(page).getByTestId('route-map')).toHaveTextContent('Route to Forest Haven')
    expect(within(page).getByRole('link', { name: /09171234567/ })).toHaveAttribute('href', 'tel:09171234567')
    expect(within(page).getByRole('link', { name: /hello@foresthaven.ph/ })).toHaveAttribute('href', 'mailto:hello@foresthaven.ph')
    // No reservation builder or offering sections yet (later stages): nothing fake.
    expect(within(page).queryByText(/cottages? from|reserve now|book now/i)).not.toBeInTheDocument()

    fireEvent.click(within(page).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/favorites/toggle', { business_id: 9 }))
  })

  it('shows published offerings in Cottages & stays and Activities & services (Stage 4)', async () => {
    const offering = (over: Record<string, unknown>) => ({
      id: 1, category: 'cottage', category_label: 'Cottage', name: 'Family cottage', description: 'Shaded, near the pool',
      booking_mode: 'day_use', pricing_basis: 'per_unit', price: 800, inventory_mode: 'units', inventory_quantity: 6,
      min_guests: null, max_guests: 10, duration_minutes: null, is_required: false, bookable_independently: true, requires_offering_name: null,
      images: [{ id: 3, path: 'resort-offerings/cottage.jpg' }], ...over,
    })
    api.get.mockResolvedValue({
      business: RESORT_BUSINESS,
      resort: { ...RESORT, offerings: [
        offering({}),
        offering({ id: 2, category: 'activity', category_label: 'Activity', name: 'Kayaking', booking_mode: 'time_slot', pricing_basis: 'per_person', price: 250, inventory_mode: 'slots', inventory_quantity: 8, max_guests: null, duration_minutes: 60, images: [] }),
        offering({ id: 3, category: 'other', category_label: 'Other', name: 'Grilling area', price: 200, max_guests: null, bookable_independently: false, requires_offering_name: 'Family cottage', images: [] }),
        offering({ id: 4, category: 'pool_access', category_label: 'Pool access', name: 'Pool entrance', pricing_basis: 'per_person', price: 150, inventory_mode: 'capacity', inventory_quantity: 120, max_guests: null, is_required: true, images: [] }),
      ] },
      gallery: [], reviews: [], avgRating: 0, reviewsCount: 0,
    })
    renderAt()

    const page = await screen.findByRole('main', { name: 'Forest Haven resort' })
    const stays = within(within(page).getByRole('list', { name: 'Cottages & stays' }))
    expect(stays.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Family cottage'])
    const cottage = within(stays.getByRole('list', { name: 'Family cottage details' }))
    expect(cottage.getByText('Day use')).toBeInTheDocument()
    expect(cottage.getByText('Up to 10 guests')).toBeInTheDocument()
    expect(cottage.getByText('6 available')).toBeInTheDocument()
    expect(stays.getByText('₱800', { exact: false })).toHaveTextContent('₱800 / unit')

    const services = within(within(page).getByRole('list', { name: 'Activities & services' }))
    expect(services.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Kayaking', 'Grilling area', 'Pool entrance'])
    expect(within(services.getByRole('list', { name: 'Kayaking details' })).getByText('Time slot · 1 h')).toBeInTheDocument()
    expect(within(services.getByRole('list', { name: 'Kayaking details' })).getByText('8 per slot')).toBeInTheDocument()
    expect(within(services.getByRole('list', { name: 'Grilling area details' })).getByText('Only with Family cottage')).toBeInTheDocument()
    expect(within(services.getByRole('list', { name: 'Pool entrance details' })).getByText('Required')).toBeInTheDocument()
    // Offering sections sit between About and the rest, in order.
    const headings = within(page).getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.replace(/·.*/, '').trim())
    expect(headings.slice(0, 4)).toEqual(['Facilities', 'About', 'Cottages & stays', 'Activities & services'])
    // Still no reserve button until the reservation builder exists.
    expect(within(page).queryByRole('button', { name: /reserve|book/i })).not.toBeInTheDocument()
  })

  it('hides every section that has no published content', async () => {
    api.get.mockResolvedValue({
      business: { ...RESORT_BUSINESS, description: '', category_details: {}, opening_time: null, closing_time: null, phone: '', email: null, latitude: null, longitude: null, address: null, municipality: null, barangay: null, price_range: null, cover_photo: null },
      resort: { types: [{ id: 7, slug: 'other', name: 'Other Resort' }], facilities: [], custom_facilities: [] },
      gallery: [], reviews: [], avgRating: 0, reviewsCount: 0,
    })
    renderAt()

    const page = await screen.findByRole('main', { name: 'Forest Haven resort' })
    expect(within(page).queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(within(page).getByText('No reviews yet')).toBeInTheDocument()
    expect(within(page).queryByRole('group', { name: 'Resort photos' })).not.toBeInTheDocument()
    expect(within(page).queryByTestId('route-map')).not.toBeInTheDocument()
  })

  it('attractions keep the existing place page and restaurants still go to the restaurant page', async () => {
    api.get.mockResolvedValue({
      business: { ...RESORT_BUSINESS, name: 'Tigbao Falls', business_name: 'Tigbao Falls', category: { id: 7, name: 'Tourist Attraction' }, business_category_id: 7 },
      resort: null, gallery: [], reviews: [],
    })
    const view = renderAt()
    expect(await screen.findByText('Tigbao Falls', { selector: 'h1' })).toBeInTheDocument()
    expect(screen.queryByRole('main', { name: /resort$/ })).not.toBeInTheDocument()
    view.unmount()

    api.get.mockResolvedValue({ business: { ...RESORT_BUSINESS, category: { id: 4, name: 'Restaurant' }, business_category_id: 4 }, resort: null })
    renderAt()
    expect(await screen.findByText('Restaurant page')).toBeInTheDocument()
  })
})
