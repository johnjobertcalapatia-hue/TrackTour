import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { locationSyncWarning } from '@/features/rider/gps'
import RiderDiagnosticsSheet, { OPEN_RIDER_DIAGNOSTICS_EVENT, RunDiagnosticsLink } from '@/features/rider/components/RiderDiagnosticsSheet'

/** Rider self-diagnostics and "Fix problems" (2026-11-10). */

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, default: { get: api.get, post: api.post } }))

function setGps(lat: number, lng: number, accuracy = 10) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition) },
  })
}

function renderSheet(onFreshFix = vi.fn()) {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <RiderDiagnosticsSheet isOpen onClose={vi.fn()} onFreshFix={onFreshFix} />
    </QueryClientProvider>,
  )
  return { invalidate, onFreshFix }
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  setGps(12.86, 121.45)
})

describe('Rider diagnostics', () => {
  it('runs the phone and server checks when opened', async () => {
    api.get.mockResolvedValue({
      ok: false,
      repaired: [],
      checks: [
        { key: 'account', status: 'ok', title: 'Account', message: 'Your rider account is approved.' },
        { key: 'status', status: 'needs_action', title: 'Status', message: 'You are marked "on a trip" but have no delivery. Tap "Fix problems".' },
      ],
    })
    renderSheet()

    expect(await screen.findByText('Your rider account is approved.')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/rider/diagnostics')
    expect(document.querySelector('[data-check="gps"]')).toHaveAttribute('data-status', 'ok')
    expect(document.querySelector('[data-check="status"]')).toHaveAttribute('data-status', 'needs_action')
    expect(screen.getByRole('button', { name: /Fix problems/ })).toBeEnabled()
  })

  it('reports a blocked or invalid phone location', async () => {
    setGps(12.96, 0)
    api.get.mockResolvedValue({ ok: true, repaired: [], checks: [] })
    renderSheet()

    await waitFor(() => expect(document.querySelector('[data-check="gps"]')).toHaveAttribute('data-status', 'needs_action'))
    expect(screen.getByText(/invalid location/)).toBeInTheDocument()
  })

  it('Fix problems sends the fresh fix, reloads rider screens and shows what was fixed', async () => {
    api.get.mockResolvedValue({ ok: false, repaired: [], checks: [{ key: 'status', status: 'needs_action', title: 'Status', message: 'Stuck.' }] })
    api.post.mockResolvedValue({
      ok: true,
      repaired: ['Released a stale "busy" status (no live delivery).'],
      checks: [{ key: 'status', status: 'fixed', title: 'Status', message: 'You are available again.' }],
    })
    const { invalidate, onFreshFix } = renderSheet()
    const fix = await screen.findByRole('button', { name: /Fix problems/ })

    await act(async () => { fireEvent.click(fix) })

    expect(api.post).toHaveBeenCalledWith('/rider/diagnostics/repair', { latitude: 12.86, longitude: 121.45, accuracy: 10 })
    expect(onFreshFix).toHaveBeenCalledWith(12.86, 121.45)
    expect(invalidate).toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('Fixed 1 problem. You can try the step again.')
    expect(document.querySelector('[data-check="status"]')).toHaveAttribute('data-status', 'fixed')
  })

  it('never sends an invalid phone location to the repair', async () => {
    setGps(0, 121.45)
    api.get.mockResolvedValue({ ok: true, repaired: [], checks: [] })
    api.post.mockResolvedValue({ ok: true, repaired: [], checks: [] })
    renderSheet()
    const resync = await screen.findByRole('button', { name: /Fix problems|Re-sync/ })

    await act(async () => { fireEvent.click(resync) })

    expect(api.post).toHaveBeenCalledWith('/rider/diagnostics/repair', {})
  })

  it('flags a phone fix too coarse for the server to save (DevTools default ±150 m)', async () => {
    setGps(12.8669, 121.4501, 150)
    api.get.mockResolvedValue({ ok: true, repaired: [], checks: [] })
    renderSheet()

    await waitFor(() => expect(document.querySelector('[data-check="gps"]')).toHaveAttribute('data-status', 'warn'))
    expect(screen.getByText(/not precise enough \(±150 m; needs 50 m or better\)/)).toBeInTheDocument()
  })

  it('says so when the server cannot be reached', async () => {
    api.get.mockRejectedValue(new Error('Network Error'))
    renderSheet()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
  })

  it('the "Run diagnostics" link under a trip error opens the sheet', () => {
    const listener = vi.fn()
    window.addEventListener(OPEN_RIDER_DIAGNOSTICS_EVENT, listener)
    render(<RunDiagnosticsLink />)

    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }))

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(OPEN_RIDER_DIAGNOSTICS_EVENT, listener)
  })

  it('explains why the map position is not being saved', () => {
    expect(locationSyncWarning('low_accuracy', 150)).toMatch(/not precise enough \(±150 m\)\. It needs 50 m or better/)
    expect(locationSyncWarning('implausible_movement')).toMatch(/another tab or phone, close it, then wait 2 minutes/)
    expect(locationSyncWarning(undefined)).toBeNull()
  })
})
