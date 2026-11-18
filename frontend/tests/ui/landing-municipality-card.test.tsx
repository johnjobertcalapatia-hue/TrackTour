import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LandingMunicipalityCard from '@/pages/components/LandingMunicipalityCard'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get }))

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LandingMunicipalityCard municipality={{ id: 1, name: 'Bansud', businesses_count: 2 }} index={0} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Landing municipality card photo', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockResolvedValue([{ src: '/storage/businesses/covers/bansud.jpg', caption: 'Bansud', kind: 'business' }])
  })

  it('loads the first available municipality photo from the shared photos endpoint', async () => {
    renderCard()

    const image = await screen.findByRole('img', { name: 'Bansud tourism' })
    expect(image.getAttribute('src')).toContain('/storage/businesses/covers/bansud.jpg')
    expect(api.get).toHaveBeenCalledWith('/municipalities/1/photos')
    expect(screen.getByRole('link', { name: /Bansud.*2 Places to Explore/ })).toHaveAttribute('href', '/explore/municipality/1')
  })

  it('keeps the card background when its photo cannot load', async () => {
    renderCard()

    const image = await screen.findByRole('img', { name: 'Bansud tourism' })
    image.dispatchEvent(new Event('error'))

    await waitFor(() => expect(screen.queryByRole('img', { name: 'Bansud tourism' })).not.toBeInTheDocument())
    expect(screen.getByTestId('municipality-card-background')).toBeInTheDocument()
  })
})
