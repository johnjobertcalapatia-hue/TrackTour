import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import LiveMapPanel, { type RiderFilter } from '@/features/admin/live-map/LiveMapPanel'
import { routeWaypoints, sosPoint, type BusinessPin, type LiveRider, type PanelTab, type Selection, type SosPin } from '@/features/admin/live-map/types'

const businesses: BusinessPin[] = [
  { id: 1, name: 'Ekslusibo Grill', lat: 12.8, lng: 121.4, address: 'Poblacion', category: 'Restaurant', status: 'approved', municipality: 'Bansud' },
  { id: 2, name: 'Batong Buwaya River', lat: 12.9, lng: 121.5, address: 'Pag-asa', category: 'Attractions', status: 'approved', municipality: 'Bansud' },
  { id: 3, name: 'Gloria Resort', lat: 12.95, lng: 121.45, address: 'Gloria', category: 'Resort', status: 'approved', municipality: 'Gloria' },
]

const foodRider: LiveRider = {
  id: 10, name: 'Juan Rider', phone: '0917', photo: null, municipality: 'Bansud', rider_status: 'busy', service: 'food',
  vehicle_type: 'motorcycle', plate_number: 'ABC 123', activity: 'delivering',
  location: { lat: 12.85, lng: 121.44, accuracy_m: 5, at: new Date().toISOString() },
  trip: {
    id: 5, order_number: 'ORD-1', type: 'food', status: 'en_route_pickup', stage: 'to_pickup', customer_name: 'Ana',
    pickups: [{ name: 'Ekslusibo Grill', address: 'Poblacion', collected: false, lat: 12.8, lng: 121.4 }],
    dropoff: { address: 'Pag-asa, Bansud', lat: 12.9, lng: 121.5 }, assigned_at: null, picked_up_at: null,
  },
}
const idleRider: LiveRider = { ...foodRider, id: 11, name: 'Pedro Idle', activity: 'available', trip: null }

function Harness({ onTown = () => {} }: { onTown?: (m: string) => void }) {
  const [tab, setTab] = useState<PanelTab>('businesses')
  const [category, setCategory] = useState('')
  const [riderFilter, setRiderFilter] = useState<RiderFilter>('all')
  const [selection, setSelection] = useState<Selection>(null)
  const riders = [foodRider, idleRider].filter((r) => riderFilter === 'all' || r.activity === riderFilter)
  return (
    <MemoryRouter>
      <LiveMapPanel
        tab={tab} onTab={setTab} search="" onSearch={() => {}}
        category={category} onCategory={setCategory}
        categories={[{ name: 'Attractions', count: 1 }, { name: 'Resort', count: 1 }, { name: 'Restaurant', count: 1 }]}
        municipality="" onMunicipality={onTown}
        towns={[{ name: 'Bansud', logo: null, count: 2 }, { name: 'Gloria', logo: null, count: 1 }]}
        riderFilter={riderFilter} onRiderFilter={setRiderFilter}
        businesses={businesses.filter((b) => !category || b.category === category)}
        riders={riders} sos={[] as SosPin[]}
        counts={{ businesses: 3, riders: 2, tourists: 1 }}
        tourists={[{ id: 50, name: 'Tina Tourist', phone: '0918', photo: null, municipality: 'Gloria', location: { lat: 12.97, lng: 121.47, accuracy_m: 10, at: new Date().toISOString() } }]}
        riderCounts={{ all: 2, available: 1, busy: 0, delivering: 1, transporting: 0 }}
        selection={selection} onSelect={setSelection} loading={false}
      />
    </MemoryRouter>
  )
}

describe('Admin live map panel', () => {
  it('lists businesses as cards and filters them by category', () => {
    render(<Harness />)
    expect(screen.getByText('Ekslusibo Grill')).toBeInTheDocument()
    expect(screen.getByText('Gloria Resort')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Attractions' } })
    expect(screen.getByText('Batong Buwaya River')).toBeInTheDocument()
    expect(screen.queryByText('Ekslusibo Grill')).toBeNull()
  })

  it('lists towns with counts and opens one on click', () => {
    const onTown = vi.fn()
    render(<Harness onTown={onTown} />)
    expect(screen.getByText('Start with a town')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Gloria\s*Places to see/ }))
    expect(onTown).toHaveBeenCalledWith('Gloria')
  })

  it('switches to riders, filters by status and opens a rider with their trip', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: /Riders/ }))
    expect(screen.getByText('Juan Rider')).toBeInTheDocument()
    expect(screen.getByText('Pedro Idle')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Rider status'), { target: { value: 'delivering' } })
    expect(screen.queryByText('Pedro Idle')).toBeNull()

    fireEvent.click(screen.getByText('Juan Rider'))
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeInTheDocument()
    expect(screen.getByText('On the way to pick up the food')).toBeInTheDocument()
    expect(screen.getAllByText(/Ekslusibo Grill/).length).toBeGreaterThan(0)
    expect(screen.getByText('next')).toBeInTheDocument()
    expect(screen.getByText('Pag-asa, Bansud')).toBeInTheDocument()
  })

  it('shows opted-in tourists on their own tab and opens one', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: /Tourists/ }))
    expect(screen.getByText(/sharing live/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Tina Tourist'))
    expect(screen.getByText('Sharing live location')).toBeInTheDocument()
    expect(screen.getAllByText('Near Gloria').length).toBeGreaterThan(0)
  })

  it('routes a rider through the remaining pickups to the drop-off', () => {
    expect(routeWaypoints(foodRider)).toEqual([[12.85, 121.44], [12.8, 121.4], [12.9, 121.5]])
    const delivering: LiveRider = { ...foodRider, trip: { ...foodRider.trip!, stage: 'to_dropoff', pickups: [{ ...foodRider.trip!.pickups[0]!, collected: true }] } }
    expect(routeWaypoints(delivering)).toEqual([[12.85, 121.44], [12.9, 121.5]])
    expect(routeWaypoints(idleRider)).toEqual([])
  })

  it('pins an SOS on whoever raised it: the rider live GPS, or the tourist own phone location', () => {
    const base: SosPin = {
      id: 1, reference: 'SOS-1', status: 'pending', raised_by_role: 'rider', service: 'ride', reporter: { name: 'R', phone: null },
      message: null, raised_at: null, order: null,
      location: { latitude: 12.1, longitude: 121.1 }, live_location: { latitude: 12.9, longitude: 121.9, at: null },
    }
    expect(sosPoint(base)).toEqual([12.9, 121.9])
    expect(sosPoint({ ...base, raised_by_role: 'tourist' })).toEqual([12.1, 121.1])
    expect(sosPoint({ ...base, raised_by_role: 'tourist', location: null })).toEqual([12.9, 121.9])
    expect(sosPoint({ ...base, location: null, live_location: null })).toBeNull()
  })
})
