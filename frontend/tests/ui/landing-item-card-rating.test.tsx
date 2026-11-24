import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import LandingItemCard, { type LandingItem } from '@/pages/components/LandingItemCard'

/**
 * Regression (2026-11-24): once reviews were shown, MySQL sent averages as
 * strings ("5.0000") and `item.rating.toFixed` crashed the landing page.
 * The API now sends numbers; the card also copes with a string.
 */
const base: LandingItem = { key: 'b-2', to: '/explore/place/2', title: 'Batong Buwaya River', image: null }

describe('Landing item card rating', () => {
  it('shows a numeric rating', () => {
    render(<MemoryRouter><LandingItemCard item={{ ...base, rating: 4.5 }} /></MemoryRouter>)
    expect(screen.getByText('4.5')).toBeInTheDocument()
  })

  it('does not crash on a rating sent as a string', () => {
    render(<MemoryRouter><LandingItemCard item={{ ...base, rating: '5.0000' as unknown as number }} /></MemoryRouter>)
    expect(screen.getByText('5.0')).toBeInTheDocument()
  })

  it('hides a zero rating', () => {
    render(<MemoryRouter><LandingItemCard item={{ ...base, rating: '0.0000' as unknown as number }} /></MemoryRouter>)
    expect(screen.queryByText('0.0')).toBeNull()
  })
})
