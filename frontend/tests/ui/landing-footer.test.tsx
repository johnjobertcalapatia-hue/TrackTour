import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import LandingFooter from '@/pages/components/LandingFooter'

describe('Landing footer — join TrackTour', () => {
  it('shows Become a Business Owner directly below Become a Rider', () => {
    render(<MemoryRouter><LandingFooter badge="Bansud Tourism" /></MemoryRouter>)

    const join = within(screen.getByRole('group', { name: 'Join TrackTour' }))
    const links = join.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Become a Rider', 'Become a Business Owner'])
    expect(links[0]).toHaveAttribute('href', '/become-a-rider')
    expect(links[1]).toHaveAttribute('href', '/register?role=business_owner')
  })
})
