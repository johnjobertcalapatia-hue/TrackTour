import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BusinessOwnerResortProfile from '@/features/business-owner/pages/BusinessOwnerResortProfile'
import BusinessOwnerResortOfferings from '@/features/business-owner/pages/BusinessOwnerResortOfferings'
import BusinessOwnerResortOfferingForm from '@/features/business-owner/pages/BusinessOwnerResortOfferingForm'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'
import { offeringFormData, pricingBasesFor, inventoryModesFor, EMPTY_OFFERING } from '@/features/business-owner/services/resort-offerings'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, put: api.put, del: api.del, default: { get: api.get } }))

const RESORT = { id: 5, name: 'Blue Lagoon Resort', category: 'Resort', status: 'approved', logo: null, module_codes: ['reservation_management'] }
const CAFE = { id: 9, name: 'Kape Bansud', category: 'Restaurant', status: 'approved', logo: null, module_codes: [] }
const BASE = '/business-owner/businesses/5/resort-offerings'

const OPTIONS = {
  categories: [{ value: 'cottage', label: 'Cottage' }, { value: 'pool_access', label: 'Pool access' }, { value: 'add_on', label: 'Add-on' }],
  booking_modes: ['day_use', 'overnight', 'time_slot', 'duration'],
  pricing_bases: ['per_person', 'per_unit', 'per_hour', 'per_night', 'per_booking'],
  inventory_modes: ['units', 'capacity', 'slots'],
  max_images: 8,
}
const offering = (over: Record<string, unknown> = {}) => ({
  id: 1, category: 'cottage', category_label: 'Cottage', name: 'Family Cottage', description: null,
  booking_mode: 'day_use', pricing_basis: 'per_unit', price: 800, inventory_mode: 'units', inventory_quantity: 6,
  min_guests: null, max_guests: 10, min_quantity: 1, max_quantity: null, duration_minutes: null,
  is_required: false, bookable_independently: true, requires_offering_id: null, requires_offering_name: null,
  is_published: true, sort_order: 0, images: [], ...over,
})

function renderAt(path: string, routePath: string, element: JSX.Element) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="/business-owner/resort/offerings" element={<p>Offerings list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const formEntries = (fd: FormData) => Object.fromEntries(Array.from(fd.entries()).map(([k, v]) => [k, typeof v === 'string' ? v : (v as File).name]))
const lastBody = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![1] as FormData

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  useBusinessOwnerStore.setState({ businesses: [RESORT], selectedBusinessId: 5 })
})

describe('Resort Types & Facilities', () => {
  beforeEach(() => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/resort-catalogue'
      ? {
          types: [{ id: 1, slug: 'pool', name: 'Pool Resort', description: 'Swimming pools' }, { id: 2, slug: 'nature', name: 'Nature Resort', description: null }],
          facilities: [{ id: 10, slug: 'parking', name: 'Parking' }, { id: 11, slug: 'wifi', name: 'Wi-Fi' }],
        }
      : { types: [{ id: 1, slug: 'pool', name: 'Pool Resort' }], facilities: [{ id: 10, slug: 'parking', name: 'Parking' }], custom_facilities: ['Videoke room'] }))
  })

  it('loads the saved selection and saves types, facilities and custom facilities', async () => {
    api.put.mockResolvedValue({})
    renderAt('/p', '/p', <BusinessOwnerResortProfile />)
    expect(await screen.findByRole('checkbox', { name: /Pool Resort/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Nature Resort/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Parking' })).toBeChecked()
    expect(screen.getByText('Videoke room')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Nature Resort/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wi-Fi' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Other facilities' }), { target: { value: '  Hammock   area ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Videoke room' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })

    expect(api.put).toHaveBeenCalledWith('/business-owner/businesses/5/resort-profile', {
      resort_type_ids: [1, 2], facility_ids: [10, 11], custom_facilities: ['Hammock area'],
    })
    expect(await screen.findByText(/Resort details saved/)).toBeInTheDocument()
  })

  it('needs at least one resort type before saving', async () => {
    renderAt('/p', '/p', <BusinessOwnerResortProfile />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /Pool Resort/ }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows server field errors', async () => {
    api.put.mockRejectedValue({ response: { data: { message: 'The given data was invalid.', errors: { 'resort_type_ids.0': ['Choose a valid resort type.'] } } } })
    renderAt('/p', '/p', <BusinessOwnerResortProfile />)
    await screen.findByRole('checkbox', { name: /Pool Resort/ })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(await screen.findByText('Choose a valid resort type.')).toBeInTheDocument()
  })

  it('is not offered to non-resort businesses and loads nothing', () => {
    useBusinessOwnerStore.setState({ businesses: [CAFE], selectedBusinessId: 9 })
    renderAt('/p', '/p', <BusinessOwnerResortProfile />)
    expect(screen.getByText(/Resort setup is for Resort businesses/)).toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('resort-profile'))
  })
})

describe('Cottages & Offerings list', () => {
  const list = () => within(screen.getByRole('list', { name: 'Offerings' }))

  it('lists offerings with price, inventory and status from the API', async () => {
    api.get.mockResolvedValue({
      offerings: [
        offering(),
        offering({ id: 2, name: 'Extra mattress', category: 'add_on', category_label: 'Add-on', price: 150, pricing_basis: 'per_booking', inventory_quantity: 20, max_guests: null, is_published: false, bookable_independently: false, requires_offering_id: 1, requires_offering_name: 'Family Cottage' }),
      ],
      options: OPTIONS,
    })
    renderAt('/l', '/l', <BusinessOwnerResortOfferings />)
    expect(await screen.findByText('Family Cottage', { selector: 'h2' })).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith(BASE)
    expect(list().getByText('₱800 / unit')).toBeInTheDocument()
    expect(list().getByText(/6 units · up to 10 guests/)).toBeInTheDocument()
    expect(list().getByText('Published')).toBeInTheDocument()
    expect(list().getByText('Draft')).toBeInTheDocument()
    expect(list().getByText(/only with Family Cottage/)).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 published/)).toBeInTheDocument()
  })

  it('shows an empty state with a create link when there are none', async () => {
    api.get.mockResolvedValue({ offerings: [], options: OPTIONS })
    renderAt('/l', '/l', <BusinessOwnerResortOfferings />)
    expect(await screen.findByText('No offerings yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add your first offering/ })).toHaveAttribute('href', '/business-owner/resort/offerings/new')
  })

  it('publish toggle resends the offering with only is_published flipped', async () => {
    api.get.mockResolvedValue({ offerings: [offering({ is_published: false })], options: OPTIONS })
    api.put.mockResolvedValue({})
    renderAt('/l', '/l', <BusinessOwnerResortOfferings />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Publish/ })) })
    expect(api.put.mock.calls[0]![0]).toBe(`${BASE}/1`)
    const body = formEntries(lastBody(api.put))
    expect(body).toMatchObject({ name: 'Family Cottage', price: '800', inventory_quantity: '6', is_published: '1', bookable_independently: '1' })
    expect(await screen.findByText(/now visible to tourists/)).toBeInTheDocument()
  })

  it('deletes after confirmation and reports a blocked delete', async () => {
    api.get.mockResolvedValue({ offerings: [offering()], options: OPTIONS })
    api.del.mockRejectedValue({ response: { data: { message: 'Other offerings depend on this one. Remove them first.' } } })
    const confirm = vi.spyOn(window, 'confirm')
    renderAt('/l', '/l', <BusinessOwnerResortOfferings />)
    const del = await screen.findByRole('button', { name: /Delete/ })

    confirm.mockReturnValueOnce(false)
    fireEvent.click(del)
    expect(api.del).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    await act(async () => { fireEvent.click(del) })
    expect(api.del).toHaveBeenCalledWith(`${BASE}/1`)
    expect(await screen.findByText('Other offerings depend on this one. Remove them first.')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('is not offered to non-resort businesses', () => {
    useBusinessOwnerStore.setState({ businesses: [CAFE], selectedBusinessId: 9 })
    renderAt('/l', '/l', <BusinessOwnerResortOfferings />)
    expect(screen.getByText(/Cottages & offerings are for Resort businesses/)).toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })
})

describe('Offering form', () => {
  const NEW = '/business-owner/resort/offerings/new'
  const EDIT_ROUTE = '/business-owner/resort/offerings/:offeringId/edit'
  const options = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.getAttribute('value'))

  it('only offers pricing and inventory that fit the booking mode', async () => {
    api.get.mockResolvedValue({ offerings: [], options: OPTIONS })
    renderAt(NEW, NEW, <BusinessOwnerResortOfferingForm />)
    const pricing = await screen.findByLabelText('Charged')
    expect(options(pricing)).toEqual(['per_person', 'per_unit', 'per_booking'])
    expect(options(screen.getByLabelText('How availability is counted'))).toEqual(['units', 'capacity'])
    expect(screen.queryByLabelText('Duration (minutes)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Overnight' }))
    expect(options(screen.getByLabelText('Charged'))).toContain('per_night')
    fireEvent.change(screen.getByLabelText('Charged'), { target: { value: 'per_night' } })

    // Switching to time slot drops the now-invalid per_night and offers slots + duration.
    fireEvent.click(screen.getByRole('radio', { name: 'Time slot' }))
    expect(screen.getByLabelText('Charged')).toHaveValue('per_unit')
    expect(options(screen.getByLabelText('Charged'))).toContain('per_hour')
    expect(options(screen.getByLabelText('How availability is counted'))).toContain('slots')
    expect(screen.getByLabelText('Duration (minutes)')).toBeInTheDocument()
  })

  it('creates an offering with photos and returns to the list', async () => {
    api.get.mockResolvedValue({ offerings: [], options: OPTIONS })
    api.post.mockResolvedValue({})
    renderAt(NEW, NEW, <BusinessOwnerResortOfferingForm />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Pool Entrance' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'pool_access' } })
    fireEvent.change(screen.getByLabelText('Charged'), { target: { value: 'per_person' } })
    fireEvent.change(screen.getByLabelText('Price (₱)'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('How availability is counted'), { target: { value: 'capacity' } })
    fireEvent.change(screen.getByLabelText('Capacity (guests)'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Published/ }))
    await act(async () => { fireEvent.change(screen.getByLabelText('Add photos'), { target: { files: [new File(['x'], 'pool.jpg', { type: 'image/jpeg' })] } }) })
    expect(screen.getByText('pool.jpg')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create offering/ })) })
    expect(api.post.mock.calls[0]![0]).toBe(BASE)
    expect(formEntries(lastBody(api.post))).toMatchObject({
      category: 'pool_access', name: 'Pool Entrance', booking_mode: 'day_use', pricing_basis: 'per_person', price: '100',
      inventory_mode: 'capacity', inventory_quantity: '120', is_published: '1', bookable_independently: '1', 'images[]': 'pool.jpg',
    })
    expect(await screen.findByText('Offerings list page')).toBeInTheDocument()
  })

  it('edits an add-on: limits "only available with" to top-level offerings and removes a photo', async () => {
    api.get.mockResolvedValue({
      offerings: [
        offering(),
        offering({ id: 2, name: 'Kubo Hut' }),
        offering({ id: 3, name: 'Lunch set', requires_offering_id: 1, bookable_independently: false, requires_offering_name: 'Family Cottage' }),
        offering({ id: 4, name: 'Extra mattress', category: 'add_on', images: [{ id: 40, path: 'resort-offerings/m.jpg' }] }),
      ],
      options: OPTIONS,
    })
    api.put.mockResolvedValue({})
    renderAt(`/business-owner/resort/offerings/4/edit`, EDIT_ROUTE, <BusinessOwnerResortOfferingForm />)
    expect(await screen.findByLabelText('Name')).toHaveValue('Extra mattress')

    fireEvent.click(screen.getByRole('checkbox', { name: /Can be reserved on its own/ }))
    const parent = screen.getByLabelText('Only available with')
    expect(within(parent).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose an offering…', 'Family Cottage', 'Kubo Hut'])
    fireEvent.change(parent, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save changes/ })) })
    expect(api.put.mock.calls[0]![0]).toBe(`${BASE}/4`)
    expect(formEntries(lastBody(api.put))).toMatchObject({ bookable_independently: '0', requires_offering_id: '1', 'remove_image_ids[]': '40' })
  })

  it('keeps an offering with dependents bookable on its own', async () => {
    api.get.mockResolvedValue({ offerings: [offering(), offering({ id: 3, name: 'Lunch set', requires_offering_id: 1, bookable_independently: false })], options: OPTIONS })
    renderAt(`/business-owner/resort/offerings/1/edit`, EDIT_ROUTE, <BusinessOwnerResortOfferingForm />)
    expect(await screen.findByRole('checkbox', { name: /Can be reserved on its own/ })).toBeDisabled()
  })

  it('shows server validation errors next to the fields', async () => {
    api.get.mockResolvedValue({ offerings: [], options: OPTIONS })
    api.post.mockRejectedValue({ response: { data: { message: 'The given data was invalid.', errors: { max_guests: ['Max guests must be at least min guests.'], price: ['The price field must be at least 0.'] } } } })
    renderAt(NEW, NEW, <BusinessOwnerResortOfferingForm />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Cottage' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create offering/ })) })
    expect(await screen.findByText('Max guests must be at least min guests.')).toBeInTheDocument()
    expect(screen.getByText('The price field must be at least 0.')).toBeInTheDocument()
    expect(screen.queryByText('Offerings list page')).not.toBeInTheDocument()
  })

  it('reports a missing offering instead of an empty form', async () => {
    api.get.mockResolvedValue({ offerings: [offering()], options: OPTIONS })
    renderAt(`/business-owner/resort/offerings/99/edit`, EDIT_ROUTE, <BusinessOwnerResortOfferingForm />)
    expect(await screen.findByText(/This offering was not found/)).toBeInTheDocument()
  })
})

describe('offering helpers mirror the backend coherence rules', () => {
  it('maps booking modes to pricing and inventory', () => {
    expect(pricingBasesFor('day_use')).not.toContain('per_night')
    expect(pricingBasesFor('day_use')).not.toContain('per_hour')
    expect(pricingBasesFor('overnight')).toContain('per_night')
    expect(pricingBasesFor('duration')).toContain('per_hour')
    expect(inventoryModesFor('overnight')).not.toContain('slots')
    expect(inventoryModesFor('time_slot')).toContain('slots')
  })

  it('omits duration outside timed modes and blanks for optional numbers', () => {
    const body = formEntries(offeringFormData({ ...EMPTY_OFFERING, name: 'X', price: '5', duration_minutes: '60' }))
    expect(body).not.toHaveProperty('duration_minutes')
    expect(body).not.toHaveProperty('max_guests')
    expect(body).not.toHaveProperty('requires_offering_id')
    const timed = formEntries(offeringFormData({ ...EMPTY_OFFERING, name: 'X', booking_mode: 'duration', duration_minutes: '60' }))
    expect(timed.duration_minutes).toBe('60')
  })
})

