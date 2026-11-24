import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f, default: { get: api.get } }))

import BusinessOwnerNotifications from '@/features/business-owner/pages/BusinessOwnerNotifications'
import BusinessOwnerNotificationDetail from '@/features/business-owner/pages/BusinessOwnerNotificationDetail'
import BusinessOwnerConversation from '@/features/business-owner/pages/BusinessOwnerConversation'
import OrderMessageRestaurant from '@/features/tourist/components/OrderMessageRestaurant'
import SystemNoticeBanner from '@/shared/components/SystemNoticeBanner'
import AdminSystemNotices from '@/features/admin/pages/AdminSystemNotices'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'

const counts = { all: 4, orders: 1, messages: 2, reviews: 1, system: 0 }
const note = (id: number, category: string, title: string, read = false) => ({
  id, type: `${category}_x`, category, title, message: `${title} message`, read_at: read ? '2026-11-23T01:00:00Z' : null, created_at: '2026-11-23T01:00:00Z', has_detail: true,
})

function renderAt(path: string, routes: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><Routes>{routes}</Routes></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.patch.mockReset()
  sessionStorage.clear()
  useBusinessOwnerStore.setState({ businesses: [], selectedBusinessId: 7 })
})

describe('Owner notifications module', () => {
  it('shows unread counts per tab and every card opens its own detail page', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(
      /perPage=1$/.test(url)
        ? { data: [], meta: { current_page: 1, last_page: 1, total: 4, unread_counts: counts } }
        : { data: [note(11, 'orders', 'New Order Received'), note(12, 'system', 'Scheduled maintenance: DB', true)], meta: { current_page: 1, last_page: 1, total: 2, unread_counts: counts } },
    ))
    renderAt('/business-owner/notifications', <Route path="/business-owner/notifications" element={<BusinessOwnerNotifications />} />)

    const card = await screen.findByRole('link', { name: /New Order Received/ })
    expect(card).toHaveAttribute('href', '/business-owner/notifications/11')
    expect(screen.getByRole('tab', { name: /Messages & Concerns\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: /^System/ }))
    await waitFor(() => expect(api.get.mock.calls.some(([u]) => String(u).includes('category=system'))).toBe(true))
  })

  it('the detail page shows the order a notification is about, with only this restaurant\'s items', async () => {
    api.get.mockResolvedValue({
      notification: note(11, 'orders', 'New Order Received'),
      subject: {
        kind: 'order', id: 5, order_number: 'TT-10024', status: 'preparing', customer_name: 'Maria Santos', order_type: 'delivery',
        payment_method: 'gcash', payment_status: 'paid', created_at: '2026-11-23T01:00:00Z',
        items: [{ name: 'Latte', quantity: 1, subtotal: 120 }], items_total: 120, shared_with_other_restaurants: true, link: '/business-owner/orders/5',
      },
    })
    renderAt('/business-owner/notifications/11', <Route path="/business-owner/notifications/:id" element={<BusinessOwnerNotificationDetail />} />)

    expect(await screen.findByRole('heading', { name: 'New Order Received' })).toBeInTheDocument()
    const order = screen.getByRole('region', { name: 'Order' })
    expect(within(order).getByText('1× Latte')).toBeInTheDocument()
    expect(within(order).getByText(/Other restaurants' items are not shown/)).toBeInTheDocument()
    expect(within(order).getByRole('link', { name: /Open order/ })).toHaveAttribute('href', '/business-owner/orders/5')
    expect(api.get).toHaveBeenCalledWith('/business-owner/notifications/11')
  })

  it('the detail page shows a maintenance notice in Philippine time', async () => {
    api.get.mockResolvedValue({
      notification: { ...note(12, 'system', 'Scheduled maintenance: Database upgrade'), type: 'system_maintenance' },
      subject: { kind: 'system_notice', id: 3, title: 'Database upgrade', message: 'Ordering paused.', audience: 'business_owners', audience_label: 'Business owners', starts_at: '2026-11-28T14:00:00Z', ends_at: '2026-11-28T16:00:00Z', status: 'cancelled', recipients_count: 2, cancelled_at: '2026-11-24T00:00:00Z', created_at: '2026-11-23T00:00:00Z' },
    })
    renderAt('/business-owner/notifications/12', <Route path="/business-owner/notifications/:id" element={<BusinessOwnerNotificationDetail />} />)

    const notice = await screen.findByRole('region', { name: 'Maintenance notice' })
    expect(within(notice).getByText('Cancelled')).toBeInTheDocument()
    expect(within(notice).getByText(/Nov 28, 2026, 10:00 PM/)).toBeInTheDocument()
  })

  it('the owner replies to a customer from the conversation page', async () => {
    api.get.mockResolvedValue({
      conversation: { id: 9, order_id: 5, order_number: 'TT-10024', order_status: 'preparing', business_id: 2, business_name: 'Kape Bansud', customer_name: 'Maria Santos', last_message: 'Less sweet?', last_message_at: null, last_message_mine: false, unread: 0 },
      messages: [{ id: 1, message: 'Can the latte be less sweet?', is_mine: false, sender_name: 'Maria Santos', created_at: '2026-11-23T01:00:00Z' }],
    })
    api.post.mockResolvedValue({ id: 2, message: 'Sure!', is_mine: true, sender_name: 'You', created_at: null })
    renderAt('/business-owner/notifications/messages/9', <Route path="/business-owner/notifications/messages/:roomId" element={<BusinessOwnerConversation />} />)

    expect(await screen.findByText('Can the latte be less sweet?')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Sure!' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/business-owner/conversations/9/messages', { message: 'Sure!' }))
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''))
  })

  it('the reviews tab shows the rating summary and filters by stars', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/business-owner/reviews')
        ? {
            data: [{ key: 'food-1', kind: 'food', business_id: 1, business_name: 'Ekslusibo Grill', item_name: 'Sisig', rating: 5, comment: 'Crispy', customer_name: 'Maria Santos', order_number: 'TT-10024', images: [], created_at: '2026-11-23T01:00:00Z' }],
            meta: { current_page: 1, last_page: 1, total: 1, summary: { average: 4.5, count: 2, distribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 } } },
          }
        : { data: [], meta: { current_page: 1, last_page: 1, total: 0, unread_counts: counts } },
    ))
    renderAt('/business-owner/notifications?tab=reviews', <Route path="/business-owner/notifications" element={<BusinessOwnerNotifications />} />)

    expect(await screen.findByText('Crispy')).toBeInTheDocument()
    expect(screen.getByText('4.5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '5 stars: 1 review' }))
    await waitFor(() => expect(api.get.mock.calls.some(([u]) => String(u).includes('rating=5'))).toBe(true))
  })
})

describe('Tourist chat per order', () => {
  it('opens a conversation with the chosen restaurant of a group order', async () => {
    api.get.mockResolvedValue([
      { business_id: 1, business_name: 'Ekslusibo Grill', room_id: null, unread: 0 },
      { business_id: 2, business_name: 'Kape Bansud', room_id: 9, unread: 1 },
    ])
    api.post.mockResolvedValue({ room_id: 9 })
    renderAt('/tourist/orders/5/details', <>
      <Route path="/tourist/orders/:id/details" element={<OrderMessageRestaurant orderId={5} />} />
      <Route path="/tourist/messages/:roomId" element={<p>Conversation page</p>} />
    </>)

    fireEvent.click(await screen.findByRole('button', { name: /Message Kape Bansud/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/orders/5/chats', { business_id: 2 }))
    expect(await screen.findByText('Conversation page')).toBeInTheDocument()
  })
})

describe('System maintenance notices', () => {
  it('the banner shows active notices and can be dismissed for the session', async () => {
    api.get.mockResolvedValue([{ id: 3, title: 'Database upgrade', message: 'Ordering paused.', starts_at: '2026-11-28T14:00:00Z', ends_at: '2026-11-28T16:00:00Z', status: 'scheduled' }])
    renderAt('/', <Route path="/" element={<SystemNoticeBanner />} />)

    expect(await screen.findByText(/Scheduled maintenance: Database upgrade/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice: Database upgrade' }))
    expect(screen.queryByText(/Database upgrade/)).toBeNull()
    expect(sessionStorage.getItem('tt-dismissed-notices')).toBe('[3]')
  })

  it('the admin confirms before a notice is sent to the audience', async () => {
    api.get.mockResolvedValue({ data: [] })
    api.post.mockResolvedValue({ id: 3, recipients_count: 12 })
    renderAt('/admin/system-notices', <Route path="/admin/system-notices" element={<AdminSystemNotices />} />)

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Database upgrade' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Ordering paused.' } })
    fireEvent.change(screen.getByLabelText('Starts (PH time)'), { target: { value: '2026-11-28T22:00' } })
    fireEvent.change(screen.getByLabelText('Ends (PH time)'), { target: { value: '2026-11-28T21:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent('The end must be after the start.')
    fireEvent.change(screen.getByLabelText('Ends (PH time)'), { target: { value: '2026-11-29T00:00' } })

    fireEvent.click(screen.getByRole('button', { name: /Send notice/ }))
    expect(api.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/system-notices', {
      title: 'Database upgrade', message: 'Ordering paused.', audience: 'business_owners', starts_at: '2026-11-28T22:00', ends_at: '2026-11-29T00:00',
    }))
    expect(await screen.findByText('Notice sent to 12 users.')).toBeInTheDocument()
  })
})
