import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
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

function renderLayout() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/tourist/page-a']}>
        <Routes>
          <Route path="/tourist" element={<TouristLayout />}>
            <Route path="page-a" element={<div>Page A <Link to="/tourist/page-b">to B</Link></div>} />
            <Route path="page-b" element={<div>Page B</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Tourist page transition', () => {
  it('wraps each page in a fresh animated container on navigation', () => {
    renderLayout()

    const first = screen.getByText(/Page A/).closest('.tourist-page-enter')
    expect(first).not.toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'to B' }))

    const second = screen.getByText('Page B').closest('.tourist-page-enter')
    expect(second).not.toBeNull()
    // A new element (not the same node re-used) is what restarts the CSS animation.
    expect(second).not.toBe(first)
    expect(first?.isConnected).toBe(false)
  })
})
