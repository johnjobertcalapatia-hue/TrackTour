import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristOrderDetails from '@/features/tourist/pages/TouristOrderDetails'
import TouristWriteReview from '@/features/tourist/pages/TouristWriteReview'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
  default: { get: api.get },
}))

const SECTION = {
  key: 'order-40', reference: 'TT-62973', primary_order_id: 40, placed_at: '2026-11-04T12:13:00+08:00',
  tab: 'to_review', tabs: ['to_review'], status: 'delivered', status_label: 'Delivered', payment_method: 'gcash', payment_status: 'paid',
  items: [
    { id: 1, order_id: 40, offering_id: 501, name: 'Pork Sisig', image: 'menu-items/sisig.jpg', restaurant: 'Ekslusibo Grill', business_id: 7, business_latitude: 12.86, business_longitude: 121.45, notes: null, quantity: 2, unit_price: 199, line_total: 398, status: 'ready', can_order: true, current_price: 199, reviewed: false, my_rating: null },
  ],
  subtotal: 398, delivery_fee: 95, rider_tip: 20, total: 513, rated: false, rider_rated: false,
  delivered_at: '2026-11-04T13:05:00+08:00', customer_name: 'Jayvie De Torres', customer_phone: '09171234567', delivery_address: 'Poblacion, Bansud, Oriental Mindoro',
  rider: { name: 'Rico Rider', photo: null },
}

function CurrentPath() {
  const { pathname } = useLocation()
  return <output data-testid="path">{pathname}</output>
}

function renderAt(entries: string[]) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/tourist/orders/:id/details" element={<TouristOrderDetails />} />
          <Route path="/tourist/orders/:orderId/items/:itemId/review" element={<TouristWriteReview />} />
          <Route path="*" element={<div>Other page</div>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.get.mockResolvedValue({ tab: 'all', counts: {}, sections: [SECTION] })
  api.post.mockResolvedValue({})
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((f: File) => `blob:${f.name}`), revokeObjectURL: vi.fn() }))
})

describe('Order details page', () => {
  it('shows the order id, delivery date, recipient, number, address, items and total payment', async () => {
    renderAt(['/tourist/orders/40/details'])
    const page = await screen.findByRole('main', { name: 'Order details' })

    expect(within(page).getByText('#TT-62973')).toBeInTheDocument()
    const delivery = within(within(page).getByRole('region', { name: 'Delivery information' }))
    expect(delivery.getByText(/^Delivered /)).toBeInTheDocument()
    expect(delivery.getByText('Jayvie De Torres')).toBeInTheDocument()
    expect(delivery.getByText('09171234567')).toBeInTheDocument()
    expect(delivery.getByText('Poblacion, Bansud, Oriental Mindoro')).toBeInTheDocument()

    const items = within(within(page).getByRole('region', { name: 'Items' }))
    // On this page the dish opens the food item information page.
    expect(items.getByRole('link', { name: 'Pork Sisig, view details' })).toHaveAttribute('href', '/tourist/food/item/501')
    expect(items.getByRole('link', { name: /Write review/ })).toHaveAttribute('href', '/tourist/orders/40/items/1/review')

    const payment = within(within(page).getByRole('region', { name: 'Payment' }))
    expect(payment.getByText('Total payment').nextSibling).toHaveTextContent('₱513.00')
    expect(payment.getByText('₱95.00')).toBeInTheDocument()
    expect(payment.getByText(/Paid with GCash/)).toBeInTheDocument()

    // No proof photo on this order: nothing is shown.
    expect(delivery.queryByRole('img', { name: /delivered food/ })).not.toBeInTheDocument()
  })

  it("shows the rider's proof-of-delivery photo", async () => {
    api.get.mockResolvedValue({ tab: 'all', counts: {}, sections: [{ ...SECTION, delivery_proof_url: 'http://api.test/storage/delivery-proofs/p.jpg' }] })
    renderAt(['/tourist/orders/40/details'])
    const page = await screen.findByRole('main', { name: 'Order details' })
    const delivery = within(within(page).getByRole('region', { name: 'Delivery information' }))

    expect(delivery.getByRole('img', { name: 'Photo of your delivered food, taken by the rider' }))
      .toHaveAttribute('src', 'http://api.test/storage/delivery-proofs/p.jpg')
    expect(delivery.getByText('Proof of delivery taken by your rider')).toBeInTheDocument()
  })
})

describe('Write review page', () => {
  it('sends the stars, feedback, photos and rider stars, then goes back', async () => {
    renderAt(['/tourist/orders?tab=to_review', '/tourist/orders/40/items/1/review'])
    const page = await screen.findByRole('main', { name: 'Write a review' })
    const submit = within(page).getByRole('button', { name: 'Submit review' })
    expect(submit).toBeDisabled()

    fireEvent.click(within(within(page).getByRole('radiogroup', { name: 'Food rating' })).getByRole('radio', { name: '5 stars' }))
    expect(within(page).getByText('Excellent')).toBeInTheDocument()
    fireEvent.change(within(page).getByLabelText('Your feedback'), { target: { value: 'Crispy and hot!' } })
    await act(async () => {
      fireEvent.change(screen.getByTestId('review-photo-input'), { target: { files: [new File(['x'], 'plate.jpg', { type: 'image/jpeg' })] } })
    })
    expect(within(page).getByAltText('Photo 1: plate.jpg')).toBeInTheDocument()
    fireEvent.click(within(within(page).getByRole('radiogroup', { name: 'Rider rating' })).getByRole('radio', { name: '4 stars' }))

    await act(async () => { fireEvent.click(submit) })

    const [url, body] = api.post.mock.calls[0] as [string, FormData]
    expect(url).toBe('/tourist/food/order/40/items/1/review')
    expect(body.get('rating')).toBe('5')
    expect(body.get('review')).toBe('Crispy and hot!')
    expect(body.get('delivery_rating')).toBe('4')
    expect((body.getAll('images[]')[0] as File).name).toBe('plate.jpg')
    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/orders')
  })

  it('rejects wrong photo types and caps at 5 photos', async () => {
    renderAt(['/tourist/orders/40/items/1/review'])
    await screen.findByRole('main', { name: 'Write a review' })

    await act(async () => {
      fireEvent.change(screen.getByTestId('review-photo-input'), { target: { files: [new File(['x'], 'menu.pdf', { type: 'application/pdf' })] } })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG or WebP')

    await act(async () => {
      fireEvent.change(screen.getByTestId('review-photo-input'), { target: { files: Array.from({ length: 6 }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' })) } })
    })
    expect(within(screen.getByRole('list', { name: 'Review photos' })).getAllByRole('img')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Add photo/ })).not.toBeInTheDocument()
  })
})
