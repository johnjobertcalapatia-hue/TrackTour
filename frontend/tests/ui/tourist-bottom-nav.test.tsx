import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import TouristLayout from '@/shared/layouts/TouristLayout'

vi.mock('@/shared/services/api', () => ({
  get: vi.fn(() => Promise.resolve({ unread_count: 0 })),
  post: vi.fn(),
  default: { get: vi.fn() },
}))

vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Test Tourist' }, token: 't', logout: () => {} }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tourist/*" element={<TouristLayout />}>
            <Route path="*" element={<div>Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const bottomNav = () => within(screen.getByRole('navigation', { name: 'Tourist bottom navigation' }))

describe('Tourist mobile bottom navigation', () => {
  it('uses the same seven items as the sidebar, in order, with full accessible names', () => {
    renderAt('/tourist/dashboard')

    const links = bottomNav().getAllByRole('link')
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual([
      'Home', 'Explore', 'Food & Dining', 'Stays', 'My Activities', 'Saved', 'Profile',
    ])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/tourist/dashboard', '/tourist/explore', '/tourist/food', '/tourist/stays', '/tourist/activities', '/tourist/favorites', '/tourist/profile',
    ])
    // Compact labels for narrow phones; full labels from sm up.
    expect(bottomNav().getByText('Food')).toBeInTheDocument()
    expect(bottomNav().getByText('Activities')).toBeInTheDocument()
  })

  it.each([
    ['/tourist/dashboard', 'Home'],
    ['/tourist/explore/map', 'Explore'],
    ['/tourist/destinations/3', 'Explore'],
    ['/tourist/food/cart', 'Food & Dining'],
    ['/tourist/food/item/501', 'Food & Dining'],
    ['/tourist/stays', 'Stays'],
    ['/tourist/trips', 'My Activities'],
    ['/tourist/favorites', 'Saved'],
    ['/tourist/profile', 'Profile'],
  ])('on %s highlights %s', (path, label) => {
    renderAt(path)

    const active = bottomNav().getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')
    expect(active.map((l) => l.getAttribute('aria-label'))).toEqual([label])
  })

  it('highlights the same item as the desktop sidebar', () => {
    renderAt('/tourist/food/7')

    const sidebarActive = within(screen.getByRole('navigation', { name: 'Tourist navigation' }))
      .getAllByRole('link').find((l) => l.getAttribute('aria-current') === 'page')
    const bottomActive = bottomNav().getAllByRole('link').find((l) => l.getAttribute('aria-current') === 'page')
    expect(sidebarActive?.getAttribute('href')).toBe(bottomActive?.getAttribute('href'))
  })
})
