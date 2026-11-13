import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BookRideSheet from '@/features/tourist/components/BookRideSheet'

vi.mock('@/shared/services/api', () => ({ get: vi.fn(() => Promise.resolve({})), post: vi.fn(), default: { get: vi.fn(), post: vi.fn() } }))

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TileLayer: Empty,
    Marker: Empty,
    Popup: Empty,
    Polyline: Empty,
    useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
    useMapEvents: () => undefined,
  }
})

vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), icon: vi.fn(() => ({})) } }))

function renderSheet(props: Partial<React.ComponentProps<typeof BookRideSheet>> = {}) {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <BookRideSheet isOpen onClose={onClose} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onClose }
}

beforeEach(() => localStorage.clear())

describe('BookRideSheet: starting from a known trip', () => {
  it('a destination with coordinates starts at the pickup step; Back returns to the destination step', () => {
    renderSheet({ destination: 'Eksklusibo Grill and Restaurant', destinationAddress: 'Bansud, Oriental Mindoro', destinationCoords: { lat: 12.86, lng: 121.46 }, initialVehicle: 'car' })
    expect(screen.getByRole('heading', { name: 'Pickup location' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Where to?' })).toBeInTheDocument()
  })

  it('no destination starts at "Where to?", and the close button is labelled', () => {
    const { onClose } = renderSheet({ initialQuery: 'falls' })
    expect(screen.getByRole('heading', { name: 'Where to?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('pickup and drop-off confirmed on the page: opens at the trip summary, with no way back to change them', () => {
    renderSheet({
      destination: 'Tambangan Falls', destinationAddress: 'Gloria', destinationCoords: { lat: 12.95, lng: 121.46 },
      pickupPoint: { name: 'Hotel, Bansud', lat: 12.86, lng: 121.45 },
    })
    expect(screen.getByRole('heading', { name: 'Trip summary' })).toBeInTheDocument()
    expect(screen.getByText('Hotel, Bansud')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })
})
