import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, apiErrorMessage: (_e: unknown, f: string) => f }))

const trip = vi.hoisted(() => ({ value: { activeDelivery: null as null | { id: number }, riderPosition: [12.5, 121.3] as [number, number], positionKnown: true } }))
vi.mock('@/features/rider/context/RiderActiveTripContext', () => ({ useRiderActiveTrip: () => trip.value }))

import HoldToSendButton from '@/shared/components/HoldToSendButton'
import RiderSosButton from '@/features/rider/components/RiderSosButton'
import AdminLiveSOS, { type AdminSos } from '@/features/admin/pages/AdminLiveSOS'
import AdminSosAlarm from '@/features/admin/components/AdminSosAlarm'

/** SOS (owner decisions 2026-11-18): hold 3 s; rider + tourist send; the Bansud Tourism Office handles it. */

const wrap = (ui: React.ReactNode, path = '/') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
  </QueryClientProvider>,
)

const SENDER_SOS = { id: 4, reference: 'SOS-261118-RD01', status: 'pending', active: true, raised_at: '2026-11-18T06:00:00Z', acknowledged_at: null, responding_at: null, responder: null, sender_safe_at: null, resolved_at: null }

const ALERT: AdminSos = {
  id: 9, reference: 'SOS-261118-TR09', status: 'pending', active: true, raised_by_role: 'tourist', service: 'ride',
  reporter: { name: 'Jayvie De Torres', phone: '09170000001' },
  other_party: { role: 'driver', name: 'Aldrin Robledo', phone: '09170000002', vehicle_type: 'motorcycle', plate_number: 'ABC 1234' },
  order: { id: 31, order_number: 'TRP-31', pickup: 'Bansud Plaza', dropoff: 'Pagasa' },
  trip_status: 'in_transit', current_trip_status: 'in_transit', message: 'Driver is going the wrong way',
  location: { latitude: 12.55, longitude: 121.35, accuracy_m: 12, at: '2026-11-18T06:00:00Z', source: 'device' },
  live_location: { latitude: 12.556, longitude: 121.351, accuracy_m: 9, at: new Date().toISOString() },
  raised_at: new Date().toISOString(), sender_safe_at: null, acknowledged_at: null, acknowledged_by: null,
  responding_at: null, responding_by: null, responder: null, response_note: null,
  resolved_at: null, resolved_by: null, outcome: null, resolution_note: null,
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.post.mockResolvedValue({})
  trip.value = { activeDelivery: null, riderPosition: [12.5, 121.3], positionKnown: true }
})

describe('Hold to send', () => {
  it('fires only after 3 s held; letting go early cancels; works with the keyboard', () => {
    vi.useFakeTimers()
    try {
      const done = vi.fn()
      render(<HoldToSendButton ariaLabel="SOS" label="SOS" onComplete={done} />)
      const btn = screen.getByRole('button', { name: 'SOS' })

      fireEvent.click(btn)
      fireEvent.pointerDown(btn)
      act(() => { vi.advanceTimersByTime(2900) })
      fireEvent.pointerLeave(btn)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(done).not.toHaveBeenCalled()

      fireEvent.keyDown(btn, { key: ' ' })
      act(() => { vi.advanceTimersByTime(3000) })
      expect(done).toHaveBeenCalledTimes(1)
      fireEvent.keyUp(btn, { key: ' ' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Rider SOS', () => {
  it('is hidden without an active trip', () => {
    wrap(<RiderSosButton />)
    expect(screen.queryByRole('button', { name: /SOS/ })).toBeNull()
  })

  it('held for 3 s during a trip: sends with the rider position, then shows the status and "I\'m safe now"', async () => {
    trip.value = { ...trip.value, activeDelivery: { id: 55 } }
    api.get.mockResolvedValueOnce({ sos: null })
    wrap(<RiderSosButton />)
    const btn = await screen.findByRole('button', { name: /^SOS: hold for 3 seconds/ })

    api.post.mockImplementation(async (url: string) => {
      if (url === '/rider/deliveries/55/sos') api.get.mockResolvedValue({ sos: SENDER_SOS })
      return {}
    })
    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(btn)
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rider/deliveries/55/sos', { latitude: 12.5, longitude: 121.3 }))

    const card = await screen.findByRole('status', { name: 'Your SOS' })
    expect(card).toHaveTextContent('SOS sent')
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: "I'm safe now" })) })
    expect(api.post).toHaveBeenCalledWith('/rider/deliveries/55/sos/safe')
  })
})

describe('Admin SOS Alerts', () => {
  it('shows who needs help, who is with them (not told), where, and lets the office acknowledge, send help and resolve', async () => {
    api.get.mockResolvedValue({ data: [ALERT], summary: { active: 1, pending: 1 } })
    wrap(<AdminLiveSOS />, '/admin/live/sos')
    const card = await screen.findByRole('article', { name: 'SOS SOS-261118-TR09' })

    expect(card).toHaveTextContent('Waiting for the office')
    expect(card).toHaveTextContent('Tourist · Ride')
    expect(card).toHaveTextContent('Jayvie De Torres')
    expect(card).toHaveTextContent('Driver (not told)')
    expect(card).toHaveTextContent('motorcycle · ABC 1234')
    expect(card).toHaveTextContent('Driver is going the wrong way')
    expect(within(card).getByRole('link', { name: /09170000001/ })).toHaveAttribute('href', 'tel:09170000001')
    expect(within(card).getByRole('link', { name: /Where the SOS was sent/ })).toHaveAttribute('href', 'https://www.google.com/maps?q=12.55,121.35')
    expect(within(card).getByRole('link', { name: /Live position/ })).toHaveAttribute('href', 'https://www.google.com/maps?q=12.556,121.351')

    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Acknowledge' })) })
    expect(api.post).toHaveBeenCalledWith('/admin/live/sos/9/acknowledge', {})

    fireEvent.click(within(card).getByRole('button', { name: 'Send help' }))
    fireEvent.change(within(card).getByLabelText('Who was sent?'), { target: { value: 'PNP Bansud' } })
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Save' })) })
    expect(api.post).toHaveBeenCalledWith('/admin/live/sos/9/respond', { responder: 'PNP Bansud', note: undefined })

    await waitFor(() => expect(within(card).getByRole('button', { name: 'Resolve' })).toBeInTheDocument())
    fireEvent.click(within(card).getByRole('button', { name: 'Resolve' }))
    fireEvent.click(within(card).getByRole('radio', { name: 'False alarm' }))
    fireEvent.change(within(card).getByLabelText('What happened?'), { target: { value: 'Pressed by mistake; called the tourist.' } })
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Resolve' })) })
    expect(api.post).toHaveBeenCalledWith('/admin/live/sos/9/resolve', { outcome: 'false_alarm', note: 'Pressed by mistake; called the tourist.' })
  })
})

describe('Admin SOS alarm', () => {
  it('a red banner on admin pages while an SOS waits, linking to SOS Alerts; hidden on that page and when none wait', async () => {
    api.get.mockResolvedValue({ active: 2, pending: 2, latest_pending: { id: 9, reference: 'SOS-1', raised_by_role: 'rider', service: 'food', name: 'Aldrin Robledo', raised_at: null } })
    const { unmount } = wrap(<AdminSosAlarm />, '/admin/dashboard')
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('SOS: Aldrin Robledo (rider, food delivery) needs help. 2 alerts are waiting.')
    expect(within(banner).getByRole('link', { name: 'Open SOS Alerts' })).toHaveAttribute('href', '/admin/live/sos')
    unmount()

    wrap(<AdminSosAlarm />, '/admin/live/sos')
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
