import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristActivities from '@/features/tourist/pages/TouristActivities'
import { getBrowsedPlaces, recordBrowsedPlace } from '@/shared/services/browsing-history'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
  default: { get: api.get },
}))

function CurrentPath() {
  const { pathname, search } = useLocation()
  return <output data-testid="path">{pathname + search}</output>
}

function renderAt(path = '/tourist/activities') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tourist/activities" element={<TouristActivities />} />
          <Route path="*" element={<div>Other page</div>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const seed = () => {
  const base = { logo: null, rating: null, cover_photo: null }
  recordBrowsedPlace({ ...base, id: 30, name: 'Tigbao Falls', category: 'Tourist Spot', discoveryGroup: 'spot', municipality: 'Bansud', url: '/tourist/destinations/30' })
  recordBrowsedPlace({ ...base, id: 9, name: 'Bansud Bay Resort', category: 'Resort', discoveryGroup: 'accommodation', municipality: 'Bansud', url: '/tourist/explore/9' })
  recordBrowsedPlace({ ...base, id: 7, name: 'Ekslusibo Grill', category: 'Restaurant', discoveryGroup: 'dining', municipality: 'Bansud', url: '/tourist/food/7' })
  // A dish can share an id with a restaurant: it's kept as its own entry.
  recordBrowsedPlace({ ...base, id: 7, name: 'Pork Sisig', category: 'Grill', discoveryGroup: 'dining', kind: 'food', municipality: 'Ekslusibo Grill', url: '/tourist/food/item/7' })
}

beforeEach(() => {
  localStorage.clear()
  api.get.mockReset()
  api.get.mockImplementation((url: string) => {
    if (url === '/tourist/orders') return Promise.resolve({ tab: 'all', counts: { all: 0, to_pay: 0, preparing: 0, in_transit: 0, to_receive: 0, to_review: 0 }, sections: [] })
    if (url === '/tourist/favorites') return Promise.resolve({ favorites: [{ id: 1, favoritable: { id: 7, name: 'Ekslusibo Grill', category: { name: 'Restaurant' }, municipality: { name: 'Bansud' }, cover_photo: null, average_rating: null } }] })
    if (url.startsWith('/tourist/history')) return Promise.resolve({ trips: { data: [] }, bookings: { data: [] } })
    if (url === '/tourist/travels') return Promise.resolve({ municipalities: [
      { id: 1, name: 'Bansud', province: 'Oriental Mindoro', cover_photo: null, food_orders: 2, stays: 0, trips: 0, last_visited_at: '2026-11-04T12:00:00+08:00' },
      { id: 7, name: 'Roxas', province: 'Oriental Mindoro', cover_photo: null, food_orders: 0, stays: 1, trips: 1, last_visited_at: '2026-10-20T12:00:00+08:00' },
    ] })
    return Promise.resolve({ data: [] })
  })
})

describe('My Activities', () => {
  it('has Explored, Orders, Travels and Favourites tabs (Explored first, kept in the URL)', async () => {
    renderAt()
    const tabs = within(screen.getByRole('tablist', { name: 'My activities' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Explored', 'Orders', 'Travels', 'Favourites'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    // Plain text tabs: no green box or icon; the active one is underlined in green.
    for (const t of tabs) {
      expect(t.querySelector('svg')).toBeNull()
      expect(t.className).not.toContain('bg-[#087F3F]')
      expect(t.className).not.toContain('rounded-xl')
    }
    expect(tabs[0]!.className).toContain('border-[#087F3F]')
    expect(tabs[1]!.className).toContain('border-transparent')

    fireEvent.click(tabs[2]!)
    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/activities?view=travels')
  })

  it('Explored groups what you viewed into sections: Foods, Restaurants, Attractions, Resorts & Stays', async () => {
    seed()
    renderAt()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Foods(1)', 'Restaurants(1)', 'Attractions(1)', 'Resorts & Stays(1)'])
    const section = (name: string) => within(screen.getByRole('list', { name }))
    expect(section('Foods').getByRole('link', { name: /Pork Sisig/ })).toHaveAttribute('href', '/tourist/food/item/7')
    expect(section('Restaurants').getByRole('link', { name: /Ekslusibo Grill/ })).toBeInTheDocument()
    expect(section('Attractions').getByRole('link', { name: /Tigbao Falls/ })).toBeInTheDocument()
    expect(section('Resorts & Stays').getByRole('link', { name: /Bansud Bay Resort/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Viewed just now/)).toHaveLength(4)

    // A filter shows only its own section.
    const filters = within(screen.getByRole('group', { name: 'Filter explored' }))
    for (const [label, list, name] of [['Restaurants', 'Restaurants', 'Ekslusibo Grill'], ['Attractions', 'Attractions', 'Tigbao Falls'], ['Foods', 'Foods', 'Pork Sisig'], ['Resorts', 'Resorts & Stays', 'Bansud Bay Resort']] as const) {
      fireEvent.click(filters.getByRole('button', { name: label }))
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
      expect(section(list).getByRole('link', { name: new RegExp(name) })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: /Clear history/ }))
    expect(screen.getByText('Nothing explored yet')).toBeInTheDocument()
  })

  it('Orders tab shows My Orders (without a second page title) and keeps ?view when switching its tabs', async () => {
    renderAt('/tourist/activities?view=orders')
    expect(await screen.findByRole('tablist', { name: 'Order status' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My Orders' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /To Review/ }))
    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/activities?view=orders&tab=to_review')
    expect(screen.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Travels shows the municipalities you have been to, then trips and bookings', async () => {
    // Detected on this device in Gloria (no orders there) and Bansud (merged with its deliveries).
    localStorage.setItem('tt_seen_municipalities', JSON.stringify([
      { id: 4, name: 'Gloria', province: 'Oriental Mindoro', cover_photo: null, first_seen: Date.now(), last_seen: Date.now() },
      { id: 1, name: 'Bansud', province: 'Oriental Mindoro', cover_photo: null, first_seen: 1, last_seen: 1 },
    ]))
    renderAt('/tourist/activities?view=travels')

    const list = within(await screen.findByRole('list', { name: 'Municipalities visited' }))
    await list.findByText('Roxas') // wait for the server's records
    const cards = list.getAllByRole('link')
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Gloria', 'Bansud', 'Roxas'])
    expect(cards[1]).toHaveAttribute('href', '/tourist/municipality/1')
    expect(within(cards[1]!).getByText('2 food deliveries')).toBeInTheDocument()
    expect(within(cards[1]!).getByText('You were here')).toBeInTheDocument()
    expect(within(cards[2]!).getByText('1 stay')).toBeInTheDocument()
    expect(within(cards[2]!).getByText('1 ride')).toBeInTheDocument()
    expect(within(cards[0]!).getByText('You were here')).toBeInTheDocument()
    expect(screen.getByText('3 municipalities')).toBeInTheDocument()

    // Trips & bookings below.
    expect(screen.getByRole('heading', { name: /Trips & bookings/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Transport' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bookings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Food Orders' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument()
  })

  it('Favourites shows the saved places', async () => {
    renderAt('/tourist/activities?view=favourites')
    expect(await screen.findByText('Ekslusibo Grill')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Favorites' })).not.toBeInTheDocument()
  })
})

describe('browsing history', () => {
  it('keeps dishes and places with the same id apart, and remembers more than the Home row', () => {
    seed()
    expect(getBrowsedPlaces().filter((p) => p.id === 7)).toHaveLength(2)

    act(() => {
      for (let i = 100; i < 120; i++) {
        recordBrowsedPlace({ id: i, name: `Place ${i}`, category: 'Resort', discoveryGroup: 'accommodation', municipality: '', url: `/x/${i}`, logo: null, rating: null, cover_photo: null })
      }
    })
    expect(getBrowsedPlaces().length).toBe(24) // all kept (Home shows only the latest 8)
  })

  it('the app remembers municipalities it detected the tourist in', async () => {
    const { recordMunicipalityVisit, getSeenMunicipalities } = await import('@/shared/hooks/use-current-municipality')
    recordMunicipalityVisit({ id: 4, name: 'Gloria', province: 'Oriental Mindoro' })
    recordMunicipalityVisit({ id: 4, name: 'Gloria', province: 'Oriental Mindoro' })
    recordMunicipalityVisit({ id: 1, name: 'Bansud' })
    expect(getSeenMunicipalities().map((m) => m.name)).toEqual(['Bansud', 'Gloria'])
  })
})
