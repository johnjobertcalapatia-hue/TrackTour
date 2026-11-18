import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ride-hailing vehicle types follow riders' registered vehicles: tourists see
 * only bookable types, a bicycle is food delivery only, and the Tourism Office
 * records each rider's vehicle.
 */

const availability = (available: string[]) => ['motorcycle', 'tricycle', 'car', 'van'].map((slug) => ({
  slug, name: slug[0]!.toUpperCase() + slug.slice(1), available: available.includes(slug),
  riders_registered: available.includes(slug) ? 2 : 0, riders_online: slug === 'motorcycle' ? 1 : 0,
}))

const api = vi.hoisted(() => ({
  available: ['motorcycle', 'car'] as string[],
  get: vi.fn(async () => ({ name: 'Picked location', address: '', lat: 12.86, lng: 121.45 })),
  post: vi.fn(),
  put: vi.fn(async () => ({})),
}))
vi.mock('@/shared/services/api', () => ({
  get: api.get, post: api.post, put: api.put, del: vi.fn(), openAuthenticatedDocument: vi.fn(),
  apiErrorMessage: (_e: unknown, f = 'Request failed.') => f,
  default: { get: api.get, post: api.post },
}))
vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TileLayer: Empty, Marker: Empty, Popup: Empty, Polyline: Empty,
    useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
    useMapEvents: () => undefined,
  }
})
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), icon: vi.fn(() => ({})) } }))

import BookRideSheet from '@/features/tourist/components/BookRideSheet'
import { RiderVehicleCard } from '@/features/admin/components/RiderVehicleCard'
import RiderOnboardingPage from '@/features/onboarding/pages/RiderOnboardingPage'
import { useAuthStore } from '@/features/auth/services/auth-store'

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.available = ['motorcycle', 'car']
  api.post.mockImplementation(async (url: string) => {
    if (url === '/tourist/transport/estimate') {
      return {
        distance_km: 3.2, distance_text: '3.2 km', duration_min: 10, duration_text: '10 min', service_fee: 0,
        fares: Object.fromEntries(api.available.map((v) => [v, { base_fare: 40, distance_fare: 30, fare: 70, total_fare: 70, fare_text: '', duration_min: 10 }])),
        vehicle_types: availability(api.available),
      }
    }
    if (url === '/tourist/transport/route') return { polyline: [[12.86, 121.45], [12.87, 121.46]], distance_km: 3.2, duration_min: 10, source: 'osrm' }
    return {}
  })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.86, longitude: 121.45 } } as GeolocationPosition) },
  })
})

async function openSummary(initialVehicle?: string) {
  render(wrap(<BookRideSheet isOpen onClose={vi.fn()} destination="Ekslusibo Grill" destinationCoords={{ lat: 12.875, lng: 121.462 }} initialVehicle={initialVehicle} />))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Use current location/ })) })
  await screen.findByRole('radiogroup', { name: 'Payment method' })
}

describe('tourist ride booking — vehicle types from registered riders', () => {
  it('shows only vehicle types that registered ride-hailing riders have', async () => {
    await openSummary('van')
    const vehicles = await screen.findByRole('radiogroup', { name: 'Vehicle' })
    await waitFor(() => expect(within(vehicles).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Motorcycle', 'Car']))
    // The requested van is not registered by any rider: the first available type is chosen.
    expect(within(vehicles).getByRole('radio', { name: 'Motorcycle' })).toHaveAttribute('aria-checked', 'true')
    expect(within(vehicles).getByText(/1 online/)).toBeInTheDocument()
  })

  it('says so and blocks booking when no ride vehicle is registered', async () => {
    api.available = []
    await openSummary()
    expect(await screen.findByText('No ride-hailing vehicles are registered yet. Please try again later.')).toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup', { name: 'Vehicle' })).queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Book Ride Now/ })).toBeDisabled()
  })
})

describe('Tourism Office — registered vehicle', () => {
  it('records a vehicle and explains what it can do', async () => {
    render(wrap(<RiderVehicleCard riderId={5} vehicle={{ vehicle_type: null, vehicle_plate: null, can_ride_hail: false }} />))

    expect(screen.getByText('Not registered')).toBeInTheDocument()
    expect(screen.getByText(/cannot do ride-hailing until one is recorded/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Register vehicle/ }))
    fireEvent.change(screen.getByLabelText('Vehicle type'), { target: { value: 'motorcycle' } })
    fireEvent.change(screen.getByLabelText('Plate number'), { target: { value: 'ABC 1234' } })
    fireEvent.click(screen.getByRole('button', { name: /Save vehicle/ }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/riders/5/vehicle', { vehicle_type: 'motorcycle', vehicle_plate_number: 'ABC 1234', vehicle_make: null, vehicle_model: null }))
  })

  it('labels a bicycle as food delivery only', () => {
    render(wrap(<RiderVehicleCard riderId={8} vehicle={{ vehicle_type: 'bicycle', vehicle_plate: null, can_ride_hail: false }} />))
    expect(screen.getByText('Food delivery only — a bicycle cannot carry passengers.')).toBeInTheDocument()
  })
})

describe('rider application — a bicycle is food delivery only', () => {
  it('disables ride-hailing when a bicycle is chosen and relaxes plate and license', async () => {
    useAuthStore.setState({ user: { id: 9, name: 'Ana', email: 'ana@example.com', role: 'rider', account_status: 'pending_review' } as never, loading: false })
    api.get.mockResolvedValue({
      reference: null, account_status: 'pending_review', rejection_remarks: null, office: null, appointment: null, stages: [],
      application: {
        submitted: false, submitted_at: null, requested_services: ['food', 'transport'], vehicle_type: 'motorcycle', vehicle_make: null, vehicle_model: null,
        vehicle_plate_number: null, vehicle_year: null, license_number: null, license_expiry: null, documents: [],
      },
    } as never)
    render(wrap(<RiderOnboardingPage />))

    const rideHailing = await screen.findByRole('checkbox', { name: /Ride-Hailing/ })
    expect(rideHailing).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('radio', { name: 'Bicycle' }))
    expect(rideHailing).toBeDisabled()
    expect(rideHailing).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/a bicycle is for food delivery only/)).toBeInTheDocument()
    expect(screen.getByLabelText('Plate number (not needed for a bicycle)')).not.toBeRequired()
    expect(screen.getByLabelText("Driver's license number (optional)")).not.toBeRequired()
  })
})
