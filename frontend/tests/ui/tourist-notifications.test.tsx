import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Notifications page: GET /tourist/notifications sends a PAGINATED page
 * ({ data: [...], current_page, … }) under `notifications`. The page called
 * .filter on that object and crashed (reported 2026-11-09).
 */

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, patch: api.patch }))

import TouristNotifications from '@/features/tourist/pages/TouristNotifications'

const N = (id: number, read: boolean) => ({
  id, title: `Notice ${id}`, message: `Message ${id}`, type: 'general',
  read_at: read ? '2026-11-09T01:00:00Z' : null, created_at: '2026-11-09T00:00:00Z',
})

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristNotifications /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => api.get.mockReset())

describe('TouristNotifications', () => {
  it('shows a paginated response (the real API shape) without crashing', async () => {
    api.get.mockResolvedValue({ notifications: { current_page: 1, data: [N(1, false), N(2, true)], total: 2 } })
    renderPage()
    expect(await screen.findByText('Notice 1')).toBeInTheDocument()
    expect(screen.getByText('Notice 2')).toBeInTheDocument()
    expect(screen.getByText('1 unread notification')).toBeInTheDocument()
  })

  it('still accepts a plain list', async () => {
    api.get.mockResolvedValue({ notifications: [N(3, true)] })
    renderPage()
    expect(await screen.findByText('Notice 3')).toBeInTheDocument()
    expect(screen.getByText('All caught up')).toBeInTheDocument()
  })

  it('empty or odd responses show "No notifications yet."', async () => {
    api.get.mockResolvedValue({ notifications: {} })
    renderPage()
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument()
  })
})
