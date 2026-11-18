import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import LandingNav from '@/pages/components/LandingNav'

describe('Landing navigation', () => {
  it('shows Login / Sign Up without a search icon button beside it', () => {
    render(<MemoryRouter><LandingNav /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /Login \/ Sign Up/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search places' })).not.toBeInTheDocument()
  })
})
