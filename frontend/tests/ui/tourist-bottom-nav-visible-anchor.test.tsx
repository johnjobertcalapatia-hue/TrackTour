import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** A fake visual viewport: the part of the page the user actually sees. */
class FakeVisualViewport extends EventTarget {
  height = 800
  offsetTop = 0
}
let vv: FakeVisualViewport

function renderLayout() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/tourist/explore']}>
        <Routes>
          <Route path="/tourist/*" element={<TouristLayout />}>
            <Route path="*" element={<input aria-label="Search" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const bar = () => screen.getByRole('navigation', { name: 'Tourist bottom navigation' })
function showVisible(height: number, offsetTop = 0) {
  act(() => {
    vv.height = height
    vv.offsetTop = offsetTop
    vv.dispatchEvent(new Event('resize'))
  })
}

beforeEach(() => {
  vv = new FakeVisualViewport()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
  // The layout viewport (what position:fixed; bottom:0 anchors to): 800 px tall.
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 1 })
})
afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
})

describe('Tourist bottom bar: anchored to the bottom of the visible screen', () => {
  it('sits at the screen bottom when the whole viewport is visible', () => {
    renderLayout()
    expect(bar()).toHaveAttribute('data-bottom-inset', '0')
    expect(bar().style.transform).toBe('')
  })

  it('moves up with the visible area when less of the page is shown (small / cropped screen, zoom)', () => {
    renderLayout()
    showVisible(690) // bottom 110 px of the viewport are not on screen
    expect(bar()).toHaveAttribute('data-bottom-inset', '110')
    expect(bar().style.transform).toBe('translate3d(0, -110px, 0)')

    showVisible(600, 50) // zoomed and panned: visible bottom at 650
    expect(bar().style.transform).toBe('translate3d(0, -150px, 0)')

    showVisible(800) // back to the whole screen
    expect(bar().style.transform).toBe('')
  })

  it('stays put behind the on-screen keyboard while typing (does not jump over the field)', () => {
    renderLayout()
    const field = screen.getByRole('textbox', { name: 'Search' })
    act(() => { field.focus(); fireEvent.focusIn(field) })
    showVisible(450) // keyboard up
    expect(bar()).toHaveAttribute('data-bottom-inset', '0')

    act(() => { field.blur(); fireEvent.focusOut(field) })
    showVisible(450)
    expect(bar()).toHaveAttribute('data-bottom-inset', '350')
  })
})
