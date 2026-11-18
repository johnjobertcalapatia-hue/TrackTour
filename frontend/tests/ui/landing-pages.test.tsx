import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get }))

import LandingExplorePage from '@/pages/LandingExplorePage'
import LandingAllCategoriesPage from '@/pages/LandingAllCategoriesPage'
import LandingNav from '@/pages/components/LandingNav'
import { useAuthStore } from '@/features/auth/services/auth-store'

const explore = {
  places: [{ id: 3, name: 'Manihala Falls', cover_photo: null, rating: 4.7, municipality: 'Bansud', type: 'place' }],
  food: [{ id: 7, name: 'Ekslusibo Grill', cover_photo: null, rating: 4.5, municipality: 'Bansud', type: 'food', starting_price: 150 }],
  stays: [{ id: 9, name: 'Seaside Resort', cover_photo: null, rating: null, municipality: 'Gloria', type: 'stay' }],
  municipalities: [{ id: 1, name: 'Bansud' }, { id: 4, name: 'Gloria' }],
  counts: { places: 1, food: 1, stays: 1 },
}

function CurrentPath() {
  const location = useLocation()
  return <p data-testid="current-path">{location.pathname + location.search}</p>
}

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<>{element}<CurrentPath /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: null, loading: false })
  api.get.mockImplementation((url: string) =>
    Promise.resolve(url === '/map/businesses' ? [{ id: 12, name: 'Bansud Hardware', cover_photo: null, municipality: 'Bansud', category: 'Retail' }] : explore),
  )
})

describe('landing explore page', () => {
  it('shows the shared nav, title band and linked place cards', async () => {
    renderAt('/explore', <LandingExplorePage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Explore Bansud & District 2' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Manihala Falls/ })).toHaveAttribute('href', '/tourist/destinations/3')
    expect(screen.getByRole('link', { name: /Ekslusibo Grill/ })).toHaveAttribute('href', '/explore/food/7')
    expect(screen.getByText('From ₱150.00')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('filters with the tabs and the search, keeping both in the URL', async () => {
    renderAt('/explore?q=falls', <LandingExplorePage />)

    expect(await screen.findByRole('link', { name: /Manihala Falls/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ekslusibo Grill/ })).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search places' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: /Resorts/ }))

    expect(screen.getByTestId('current-path')).toHaveTextContent('/explore?tab=stays')
    expect(await screen.findByRole('link', { name: /Seaside Resort/ })).toHaveAttribute('href', '/tourist/explore/9')
  })
})

describe('landing all categories page', () => {
  it('previews every category with counts', async () => {
    renderAt('/explore/categories', <LandingAllCategoriesPage />)

    const businesses = await screen.findByRole('region', { name: 'Businesses' })
    expect(within(businesses).getByRole('link', { name: /Bansud Hardware/ })).toHaveAttribute('href', '/tourist/explore/12')
    expect(screen.getByRole('region', { name: 'Tourist Spots' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Food\s*1/ })).toHaveAttribute('href', '#category-food')
  })

  it('offers a Map view button and a municipality filter kept in the URL', async () => {
    renderAt('/explore/categories', <LandingAllCategoriesPage />)
    await screen.findByRole('region', { name: 'Businesses' })

    expect(screen.getByRole('link', { name: /Map view/ })).toHaveAttribute('href', '/?view=map')

    const select = screen.getByLabelText('Municipality')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All municipalities', 'Bansud', 'Gloria'])
    fireEvent.change(select, { target: { value: '4' } })

    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/explore/categories?municipality=4'))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tourist/explore', { params: { municipality_id: 4 } }))
    // Businesses from another municipality are filtered out.
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Businesses' })).queryByRole('link', { name: /Bansud Hardware/ })).toBeNull())
    expect(screen.getByText(/Everything on TrackTour in Gloria/)).toBeInTheDocument()
  })
})

describe('landing nav on inner pages', () => {
  it('opens the home map from Services and Explore links from the menu', () => {
    renderAt('/explore', <LandingNav active="explore" />)

    fireEvent.click(screen.getByRole('button', { name: /Services/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Live Map' }))
    expect(screen.getByTestId('current-path')).toHaveTextContent('/?view=map')

    fireEvent.click(screen.getByRole('button', { name: /Explore/ }))
    expect(screen.getByRole('link', { name: 'All Categories' })).toHaveAttribute('href', '/explore/categories')
  })
})
