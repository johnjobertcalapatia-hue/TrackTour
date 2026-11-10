import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristTransport from '@/features/tourist/pages/TouristTransport'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const sheet = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))

vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn(), default: { get: api.get, post: vi.fn() } }))

// The sheet itself has its own tests: here, only what the page opens it with.
vi.mock('@/features/tourist/components/BookRideSheet', () => ({
  default: (props: Record<string, unknown>) => {
    sheet.props = props
    return props.isOpen ? <div data-testid="ride-sheet" /> : null
  },
}))

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TouristTransport />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const BOOKING = {
  destination: { name: 'Eksklusibo Grill and Restaurant', address: 'Bansud, Oriental Mindoro' },
  distanceKm: 12.47,
  vehicle: 'car',
  lat: 12.86,
  lng: 121.46,
}

beforeEach(() => {
  localStorage.clear()
  sheet.props = null
  api.get.mockReset()
  api.get.mockResolvedValue({ data: [] })
})

describe('Ride Hailing page', () => {
  it('search row: input and button share one height and shape; the hint is readable', async () => {
    renderPage()
    const input = await screen.findByRole('textbox', { name: 'Destination' })
    const button = screen.getByRole('button', { name: /Book a Ride/ })
    expect(input.className).toContain('h-11')
    expect(button.className).toContain('h-11')
    // Beats the global input rule (unlayered index.css) so it matches the button.
    expect(input.className).toMatch(/(^| )rounded-xl!( |$)/)
    expect(button.className).toContain('rounded-xl')
    const hint = screen.getByText(/confirm your pickup point/)
    expect(hint.className).toContain('text-xs')
    expect(hint.className).not.toContain('text-[10px]')
  })

  it('"Book a Ride" opens the booking sheet with what was typed', async () => {
    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Destination' }), { target: { value: 'Tambangan Falls' } })
    fireEvent.click(screen.getByRole('button', { name: /Book a Ride/ }))
    expect(screen.getByTestId('ride-sheet')).toBeInTheDocument()
    expect(sheet.props).toMatchObject({ isOpen: true, initialQuery: 'Tambangan Falls', destination: undefined })
  })

  it('a trip from the map shows as "Your trip" with a way to continue it at the pickup step', async () => {
    localStorage.setItem('tracktour_pending_booking', JSON.stringify(BOOKING))
    renderPage()

    const trip = await screen.findByRole('region', { name: 'Your trip' })
    expect(within(trip).getByText('Eksklusibo Grill and Restaurant')).toBeInTheDocument()
    expect(within(trip).getByText('Bansud, Oriental Mindoro')).toBeInTheDocument()
    expect(within(trip).getByText('Car')).toBeInTheDocument()
    expect(within(trip).getByText('12.5 km')).toBeInTheDocument()
    // Above the search, which now offers somewhere else.
    expect(trip.compareDocumentPosition(screen.getByRole('region', { name: 'Book a ride' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Going somewhere else?')).toBeInTheDocument()
    // Read once: a refresh doesn't bring it back.
    expect(localStorage.getItem('tracktour_pending_booking')).toBeNull()

    fireEvent.click(within(trip).getByRole('button', { name: /Continue booking/ }))
    expect(sheet.props).toMatchObject({
      isOpen: true,
      destination: 'Eksklusibo Grill and Restaurant',
      destinationAddress: 'Bansud, Oriental Mindoro',
      destinationCoords: { lat: 12.86, lng: 121.46 },
      initialVehicle: 'car',
      initialQuery: undefined,
    })
  })

  it('an older trip hand-off without coordinates continues by searching its name', async () => {
    const { lat: _lat, lng: _lng, ...old } = BOOKING
    localStorage.setItem('tracktour_pending_booking', JSON.stringify(old))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Continue booking/ }))
    expect(sheet.props).toMatchObject({ isOpen: true, initialQuery: 'Eksklusibo Grill and Restaurant', destination: undefined })
  })

  it('"Change destination" opens an empty search; the trip can be dismissed', async () => {
    localStorage.setItem('tracktour_pending_booking', JSON.stringify(BOOKING))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Change destination' }))
    expect(sheet.props).toMatchObject({ isOpen: true, initialQuery: undefined, destination: undefined })
    ;(sheet.props!.onClose as () => void)()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this trip' }))
    expect(screen.queryByRole('region', { name: 'Your trip' })).not.toBeInTheDocument()
    expect(screen.getByText('Where are you going?')).toBeInTheDocument()
  })

  it('ignores a broken hand-off', async () => {
    localStorage.setItem('tracktour_pending_booking', '{not json')
    renderPage()
    await screen.findByRole('textbox', { name: 'Destination' })
    expect(screen.queryByRole('region', { name: 'Your trip' })).not.toBeInTheDocument()
  })

  it('lists recent rides with status pills, and shows an empty state when there are none', async () => {
    api.get.mockResolvedValue({
      data: [
        { id: 3, order_number: 'RIDE-3', status: 'completed', subtotal: 80, delivery_fee: 0, total: 80, payment_method: 'cash', created_at: '2026-11-01T10:00:00Z', delivery_address: 'Gloria Bay Resort' },
        { id: 4, order_number: 'RIDE-4', status: 'cancelled', subtotal: 60, delivery_fee: 0, total: 60, payment_method: 'gcash', created_at: '2026-11-02T10:00:00Z', delivery_address: 'Tambangan Falls' },
      ],
    })
    renderPage()
    const recent = await screen.findByRole('region', { name: 'Recent rides' })
    expect(within(recent).getByText('Gloria Bay Resort')).toBeInTheDocument()
    expect(within(recent).getByText('Completed').className).toContain('bg-[#E9F7EF]')
    expect(within(recent).getByText('Cancelled').className).toContain('bg-red-50')
  })

  it('empty recent rides', async () => {
    renderPage()
    expect(await screen.findByText('No rides yet')).toBeInTheDocument()
  })
})
