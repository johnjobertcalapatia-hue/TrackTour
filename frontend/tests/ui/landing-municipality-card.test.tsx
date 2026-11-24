import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import LandingMunicipalityCard from '@/pages/components/LandingMunicipalityCard'

/**
 * "Where to Next?" cards show the municipal Tourism Office logo (from
 * GET /municipalities), never a business photo (2026-11-24).
 */
function renderCard(municipality: { id: number; name: string; businesses_count?: number; logo_url?: string | null; cover_url?: string | null }) {
  return render(
    <MemoryRouter>
      <LandingMunicipalityCard municipality={municipality} index={0} />
    </MemoryRouter>,
  )
}

describe('Landing municipality card', () => {
  it("shows the municipality's Tourism Office logo and links to the municipality", () => {
    renderCard({ id: 2, name: 'Gloria', businesses_count: 2, logo_url: 'municipalities/2/seal.png' })
    const logo = screen.getByRole('img', { name: 'Gloria Tourism Office logo' })
    expect(logo.getAttribute('src')).toContain('/storage/municipalities/2/seal.png')
    expect(logo).toHaveClass('object-contain') // a seal is never cropped
    expect(screen.getByRole('link', { name: /Gloria.*2 Places to Explore/ })).toHaveAttribute('href', '/explore/municipality/2')
  })

  it('Bansud falls back to the Bansud Tourism Office logo', () => {
    renderCard({ id: 1, name: 'Bansud', businesses_count: 1, logo_url: null })
    expect(screen.getByRole('img', { name: 'Bansud Tourism Office logo' })).toHaveAttribute('src', '/assets/logo/bansud-tourism-office.jpg')
    expect(screen.getByText('Home of TrackTour')).toBeInTheDocument()
  })

  it('a municipality without a logo keeps the lettered card (no business photo)', () => {
    renderCard({ id: 3, name: 'Bulalacao', logo_url: null })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('municipality-card-background')).toHaveTextContent('B')
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  it('hides a logo that cannot load', async () => {
    renderCard({ id: 2, name: 'Gloria', logo_url: '/storage/municipalities/2/missing.png' })
    screen.getByRole('img', { name: 'Gloria Tourism Office logo' }).dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
  })

  it("uses the office's cover photo as the card background, behind the logo", () => {
    renderCard({ id: 2, name: 'Gloria', logo_url: 'municipalities/2/seal.png', cover_url: 'municipalities/2/plaza.jpg' })
    const cover = screen.getByTestId('municipality-card-cover')
    expect(cover.getAttribute('src')).toContain('/storage/municipalities/2/plaza.jpg')
    expect(cover).toHaveAttribute('alt', '') // decorative; the logo and name carry the meaning
    expect(cover.compareDocumentPosition(screen.getByRole('img', { name: 'Gloria Tourism Office logo' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a cover that cannot load leaves the green card', async () => {
    renderCard({ id: 2, name: 'Gloria', cover_url: 'municipalities/2/missing.jpg' })
    screen.getByTestId('municipality-card-cover').dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.queryByTestId('municipality-card-cover')).not.toBeInTheDocument())
    expect(screen.getByTestId('municipality-card-background')).toHaveTextContent('G')
  })
})
