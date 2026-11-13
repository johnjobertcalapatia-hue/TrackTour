import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

const mapTap = vi.hoisted(() => ({ handler: null as null | ((e: { latlng: { lat: number; lng: number } }) => void) }))
vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'leaflet-map' }, children),
    TileLayer: () => null,
    Marker: ({ position }: { position: [number, number] }) =>
      React.createElement('span', { 'data-testid': 'destination-marker', 'data-pos': position.join(',') }),
    useMap: () => ({ flyTo: vi.fn(), getZoom: () => 13 }),
    useMapEvents: (h: { click?: (e: { latlng: { lat: number; lng: number } }) => void }) => {
      mapTap.handler = h.click ?? null
      return {}
    },
  }
})
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }))

import RiderDestinationSheet, { useRiderDestination, type RiderDestinationState } from '@/features/rider/components/RiderDestinationSheet'

const off: RiderDestinationState = { active: false, destination: null, corridor_km: 2, arrival_radius_m: 300, duration_minutes: 180 }
const on: RiderDestinationState = {
  ...off,
  active: true,
  destination: { label: 'Home', latitude: 12.95, longitude: 121.46, set_at: '2026-11-11T08:00:00Z', expires_at: '2026-11-11T11:00:00Z' },
}

function Harness() {
  const destination = useRiderDestination()
  return (
    <>
      <p data-testid="notice">{destination.endedNotice ?? ''}</p>
      <RiderDestinationSheet isOpen onClose={() => {}} riderPosition={[12.865, 121.452]} destination={destination} />
    </>
  )
}

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, ...render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>) }
}

describe('Rider My Destination', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/rider/destination') return Promise.resolve(off)
      if (url === '/rider/locations/search') return Promise.resolve([{ id: 1, name: 'Sumagui Terminal', address: 'Sumagui, Bansud', lat: 12.93, lng: 121.46 }])
      return Promise.resolve(null)
    })
    api.put.mockResolvedValue(on)
    api.del.mockResolvedValue(off)
  })

  it('needs a destination before turning on, then saves the tapped point with its name', async () => {
    renderSheet()
    const dialog = await screen.findByRole('dialog', { name: 'My Destination' })
    expect(within(dialog).getByText('Tap the map where you are heading')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Turn on My Destination/ }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/tap the map/i)
    expect(api.put).not.toHaveBeenCalled()

    act(() => mapTap.handler?.({ latlng: { lat: 12.95, lng: 121.46 } }))
    expect(within(dialog).getByTestId('destination-marker')).toHaveAttribute('data-pos', '12.95,121.46')
    fireEvent.click(within(dialog).getByRole('button', { name: /Turn on My Destination/ }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/rider/destination', { latitude: 12.95, longitude: 121.46, label: 'Home' }))
    expect(await screen.findByTestId('destination-active')).toHaveTextContent('Heading to Home')
  })

  it('search picks a place and uses its name', async () => {
    renderSheet()
    const dialog = await screen.findByRole('dialog', { name: 'My Destination' })
    fireEvent.change(within(dialog).getByLabelText('Search destination'), { target: { value: 'Sumagui' } })
    fireEvent.click(await within(dialog).findByRole('option', { name: /Sumagui Terminal/ }))

    expect(within(dialog).getByLabelText('Destination name')).toHaveValue('Sumagui Terminal')
    fireEvent.click(within(dialog).getByRole('button', { name: /Turn on My Destination/ }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/rider/destination', { latitude: 12.93, longitude: 121.46, label: 'Sumagui Terminal' }),
    )
    expect(api.get).toHaveBeenCalledWith('/rider/locations/search', { params: { q: 'Sumagui' } })
  })

  it('when on, explains the rule and can be turned off', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/rider/destination' ? on : null))
    renderSheet()
    const active = await screen.findByTestId('destination-active')
    expect(active).toHaveTextContent('within 2 km of your route')
    expect(active).toHaveTextContent('turns off when you arrive')

    fireEvent.click(within(active).getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/rider/destination'))
    expect(await screen.findByRole('button', { name: /Turn on My Destination/ })).toBeInTheDocument()
    // Turned off by the rider: no "you arrived" notice.
    expect(screen.getByTestId('notice')).toHaveTextContent('')
  })

  it('tells the rider when it ended by itself (arrived or 3 hours)', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/rider/destination' ? on : null))
    const { client } = renderSheet()
    await screen.findByTestId('destination-active')

    api.get.mockImplementation((url: string) => Promise.resolve(url === '/rider/destination' ? off : null))
    await act(() => client.invalidateQueries({ queryKey: ['rider-destination'] }))

    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('My Destination is off (Home)'))
  })
})

describe('Rider board marks offers on the way while My Destination is on', () => {
  it('shows "On your way" and "Off your route" badges', async () => {
    const { default: RiderOrderBoard } = await import('@/features/rider/components/RiderOrderBoard')
    for (const fn of Object.values(api)) fn.mockReset()
    api.get.mockResolvedValue({
      eligibility: { online: true, available: true, account_approved: true, location_ok: true, has_active_delivery: false },
      destination: { label: 'Home', latitude: 12.95, longitude: 121.46 },
      orders: [
        { delivery_id: 1, order_number: 'TT-ONWAY', rider_status: 'looking_for_riders', can_accept: true, on_your_way: true },
        { delivery_id: 2, order_number: 'TT-OFFWAY', rider_status: 'looking_for_riders', can_accept: true, on_your_way: false },
        { delivery_id: 3, order_number: 'TT-PLAIN', rider_status: 'looking_for_riders', can_accept: true, on_your_way: null },
      ],
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RiderOrderBoard />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Order #TT-ONWAY')).toBeInTheDocument()
    expect(screen.getAllByText('On your way')).toHaveLength(1)
    expect(screen.getAllByText('Off your route')).toHaveLength(1)
  })
})
