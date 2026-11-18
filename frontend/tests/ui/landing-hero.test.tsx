import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LandingHero from '@/pages/components/LandingHero'
import LandingPopular, { POPULAR_ICONS } from '@/pages/components/LandingPopular'
import { useAuthStore } from '@/features/auth/services/auth-store'

function CurrentPath() {
  const location = useLocation()
  return <p data-testid="current-path">{location.pathname + location.search}</p>
}

function renderHero(onShowMap = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LandingHero
                videoSrc="/assets/tracktour-web.mp4"
                title="Discover the Beauty of"
                highlight="Oriental Mindoro"
                badge="Bansud, Oriental Mindoro"
                subtitle="Your all-in-one travel and delivery platform in Bansud."
                onShowMap={onShowMap}
              />
              <CurrentPath />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return onShowMap
}

beforeEach(() => {
  useAuthStore.setState({ user: null, loading: false })
})

describe('landing hero', () => {
  it('renders the headline with the gold highlight and the TrackTour brand', () => {
    renderHero()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Oriental Mindoro')
    expect(screen.getByText('Mindoro')).toHaveClass('text-[#FFD000]')
    expect(screen.getAllByAltText('TrackTour Logo').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Login \/ Sign Up/ })).toHaveAttribute('href', '/login')
  })

  it('searches places through the explore page', () => {
    renderHero()

    fireEvent.change(screen.getByRole('searchbox', { name: /Search for restaurants/ }), { target: { value: 'grill' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByTestId('current-path')).toHaveTextContent('/explore?q=grill')
  })

  it('opens services from the cards, with Live Map opening the map', () => {
    const onShowMap = renderHero()

    fireEvent.click(screen.getByRole('button', { name: 'Live Map' }))
    expect(onShowMap).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Food Delivery' }))
    expect(screen.getByTestId('current-path')).toHaveTextContent('/explore?tab=food')
  })

  it('uses the background video only, with no image carousel', () => {
    renderHero()

    const video = screen.getByTestId('hero-background-video')
    expect(video.tagName).toBe('VIDEO')
    expect(video.querySelector('source')).toHaveAttribute('src', '/assets/tracktour-web.mp4')
    expect(video).toHaveProperty('muted', true)
    expect(screen.queryByRole('button', { name: /slide/i })).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Choose slide' })).toBeNull()
  })

  it('shows the explore menu links', () => {
    renderHero()

    fireEvent.click(screen.getByRole('button', { name: /Explore/ }))
    expect(screen.getByRole('link', { name: 'Stays & Resorts' })).toHaveAttribute('href', '/explore?tab=stays')
  })

  it('offers the dashboard instead of login for a signed-in user', () => {
    useAuthStore.setState({ user: { id: 1, name: 'Kim', email: 'kim@example.com', role: 'tourist' } as never, loading: false })
    renderHero()

    expect(screen.getByRole('link', { name: /My Dashboard/ })).toHaveAttribute('href', '/tourist/dashboard')
    expect(screen.queryByRole('link', { name: /Login \/ Sign Up/ })).toBeNull()
  })
})

describe('popular in Bansud', () => {
  it('links every tile to its section and keeps the Map / View all shortcuts', () => {
    const onShowMap = vi.fn()
    render(
      <MemoryRouter>
        <LandingPopular
          onShowMap={onShowMap}
          tiles={[
            { label: 'Restaurants & Food Hub', to: '/explore?tab=food', image: '/f.jpg', icon: POPULAR_ICONS.food },
            { label: 'Ride Anywhere', to: '/tourist/transport', image: '/r.jpg', icon: POPULAR_ICONS.ride },
          ]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Popular in Bansud' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Restaurants & Food Hub' })).toHaveAttribute('href', '/explore?tab=food')
    expect(screen.getByRole('link', { name: 'Ride Anywhere' })).toHaveAttribute('href', '/tourist/transport')
    expect(screen.getByRole('link', { name: /Explore Now/ })).toHaveAttribute('href', '/explore')
    expect(screen.getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/explore/categories')
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }))
    expect(onShowMap).toHaveBeenCalledTimes(1)
  })
})
