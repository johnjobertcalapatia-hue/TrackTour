import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('stays on screen while the page scrolls (never hidden on scroll)', () => {
    renderAt('/tourist/activities')
    const bar = screen.getByRole('navigation', { name: 'Tourist bottom navigation' })
    for (const y of [400, 1200, 300, 0]) {
      act(() => {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
        window.dispatchEvent(new Event('scroll'))
      })
      expect(bar).toBeVisible()
      expect(bar.className).toMatch(/(^| )fixed( |$)/)
      expect(bar.className).toMatch(/(^| )bottom-0( |$)/)
      // (lg:hidden = desktop only, where the sidebar takes over)
      expect(bar.className).not.toMatch(/(^| )(hidden|invisible|opacity-0)( |$)|translate-y/)
    }
    // Own compositing layer + safe-area padding (index.css).
    expect(bar).toHaveClass('tourist-bottom-nav', 'safe-bottom')
  })

  it('is rendered straight into <body> (nothing in the page can push it off screen) with the tourist theme', () => {
    renderAt('/tourist/explore')
    const bar = screen.getByRole('navigation', { name: 'Tourist bottom navigation' })
    expect(bar.parentElement).toBe(document.body)
    expect(bar).toHaveClass('tourist-ui', 'clay-ui', 'fixed', 'bottom-0', 'lg:hidden')
  })

  it('sizes itself to the screen: bar, icons, labels and pill come from the screen-size variables', () => {
    renderAt('/tourist/explore')
    const bar = screen.getByRole('navigation', { name: 'Tourist bottom navigation' })
    expect(bar.firstElementChild).toHaveClass('tourist-bottom-nav-grid')
    const link = within(bar).getByRole('link', { name: 'Explore' })
    expect(link.querySelector('.tourist-bottom-nav-pill')).not.toBeNull()
    expect(link.querySelector('svg.tourist-bottom-nav-icon')).not.toBeNull()
    expect(link.querySelector('.tourist-bottom-nav-label')).not.toBeNull()
    // No fixed sizes left that would ignore the screen.
    expect(bar.innerHTML).not.toMatch(/h-16|text-\[10px\]|w-11 h-7|w-\[20px\]/)
    // The page's bottom padding follows the bar (index.css .tourist-main), not a fixed pb-24.
    expect(document.querySelector('main.tourist-main')!.className).not.toMatch(/pb-/)
  })

  it('index.css defines the bar size per screen width (small phone -> tablet, landscape) and none on desktop', () => {
    const css = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8')
    for (const [query, height] of [['', '58px'], ['(min-width: 360px)', '64px'], ['(min-width: 640px)', '68px'], ['(min-width: 768px)', '72px']] as const) {
      const at = query ? css.indexOf(`@media ${query} {
  :root {
    --tourist-bottom-nav-h: ${height}`) : css.indexOf(`--tourist-bottom-nav-h: ${height}`)
      expect(at, `${query || 'default'} -> ${height}`).toBeGreaterThan(-1)
    }
    expect(css).toMatch(/@media \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?--tourist-bottom-nav-h: 50px[\s\S]*?\.tourist-bottom-nav-label \{\s*display: none/)
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*:root \{[\s\S]*?--tourist-bottom-nav-space: 0px/)
    expect(css).toMatch(/\.tourist-map-page \{\s*height: calc\(100dvh - var\(--tourist-header-h\) - var\(--tourist-bottom-nav-space\)\)/)
  })

  it('the header has no backdrop blur on phones / tablets (desktop only)', () => {
    renderAt('/tourist/explore')
    const header = document.querySelector('header.tourist-topbar')!
    expect(header.className).toMatch(/(^| )lg:backdrop-blur-xl( |$)/)
    expect(header.className).not.toMatch(/(^| )backdrop-blur/)
  })
})
