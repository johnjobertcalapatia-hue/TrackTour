import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f = 'Request failed.') => f }))

import AdminIncidentHistory, { type Incident } from '@/features/admin/pages/AdminIncidentHistory'

const base: Omit<Incident, 'id' | 'title' | 'category' | 'code' | 'severity' | 'status'> = {
  message: null, context: null, user: null, ip_address: '10.0.0.5', method: 'POST', path: '/api/login', subject: null,
  occurred_at: '2026-11-17T05:00:00Z', resolved_at: null, resolved_by: null, resolution: null,
}
const rows: Incident[] = [
  { ...base, id: 3, category: 'server', code: 'server_error', severity: 'error', status: 'open', title: 'Server error: QueryException', message: 'Connection refused', context: { exception: 'QueryException', where: 'Connection.php:813' } },
  { ...base, id: 2, category: 'upload', code: 'upload_rejected', severity: 'warning', status: 'recorded', title: 'Upload rejected: photo', user: { id: 7, name: 'Ana Reyes', role: 'business_owner' } },
  { ...base, id: 1, category: 'auth', code: 'login_failed', severity: 'warning', status: 'resolved', title: 'Failed login: wrong password', resolved_by: 'Office', resolution: 'Owner reset the password.', resolved_at: '2026-11-17T06:00:00Z' },
]
const meta = {
  current_page: 1, last_page: 2, per_page: 25, total: 30,
  by_category: { server: 10, upload: 12, auth: 8 },
  stats: { open: 4, today: 9, failed_logins_today: 3, resolved_this_week: 5 },
}

function Location() {
  return <output data-testid="search">{useLocation().search}</output>
}

function renderPage(path = '/admin/settings/incidents') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/admin/settings/incidents" element={<><AdminIncidentHistory /><Location /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const lastParams = () => api.get.mock.calls.filter((c) => c[0] === '/admin/system/incidents').at(-1)?.[1]?.params

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url: string) => {
    if (url === '/admin/system/incidents') return Promise.resolve({ data: rows, meta })
    if (url === '/admin/system/incidents/3') {
      return Promise.resolve({
        ...rows[0],
        similar: { total: 3, open: 3, first_at: '2026-11-16T01:00:00Z', last_at: '2026-11-17T05:00:00Z', recent: [{ id: 9, title: 'Server error: QueryException', status: 'resolved', occurred_at: '2026-11-16T01:00:00Z', resolved_at: '2026-11-16T02:00:00Z', resolved_by: 'Office', resolution: 'Restarted the database.' }] },
        history: [],
      })
    }
    if (url === '/admin/system/incidents/1') {
      return Promise.resolve({
        ...rows[2],
        similar: { total: 1, open: 0, first_at: null, last_at: null, recent: [] },
        history: [
          { action: 'resolved', description: 'Marked 1 incident(s) as fixed', by: 'Office', at: '2026-11-17T05:30:00Z' },
          { action: 'reopened', description: 'Reopened incident', by: 'Office', at: '2026-11-17T05:40:00Z' },
          { action: 'resolved', description: 'Owner reset the password.', by: 'Office', at: '2026-11-17T06:00:00Z' },
        ],
      })
    }
    return Promise.resolve({})
  })
})

describe('Incident History', () => {
  it('lists the history newest first with plain status, type and who', async () => {
    renderPage()

    const list = within(await screen.findByRole('region', { name: 'Incidents' }))
    expect(await list.findByText('30 records')).toBeInTheDocument()
    const items = list.getAllByRole('button', { name: /,/ })
    expect(items.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Server error: QueryException, Needs fixing',
      'Upload rejected: photo, History only',
      'Failed login: wrong password, Fixed',
    ])
    expect(list.getByText('Ana Reyes (business owner)')).toBeInTheDocument()

    const summary = within(screen.getByRole('region', { name: 'Incident summary' }))
    expect(summary.getByRole('button', { name: /4\s*Needs fixing/ })).toBeInTheDocument()
    expect(summary.getByRole('button', { name: /3\s*Failed logins today/ })).toBeInTheDocument()
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument()
  })

  it('organises filters into date, type, status and severity rows — kept in the address bar', async () => {
    renderPage()
    const filters = within(await screen.findByRole('region', { name: 'Filters' }))
    await screen.findByText('30 records')
    const row = (name: string) => within(filters.getByRole('group', { name }))

    // Type chips show counts and combine.
    expect(row('Type').getByRole('button', { name: /All types\s*30/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(row('Type').getByRole('button', { name: /Uploads\s*12/ }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, category: 'upload' }))
    fireEvent.click(row('Type').getByRole('button', { name: /Logins\s*8/ }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, category: 'upload,auth' }))

    expect(row('Status').getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Needs fixing', 'History only', 'Fixed', 'Dismissed'])
    fireEvent.click(row('Status').getByRole('button', { name: 'Needs fixing' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'open' }))

    expect(row('Severity').getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Any', 'Low', 'Medium', 'High', 'Critical'])
    fireEvent.click(row('Severity').getByRole('button', { name: 'High' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ severity: 'error' }))

    // Date: presets, and a custom range that reveals the date fields.
    expect(row('Date').getAllByRole('button').map((b) => b.textContent)).toEqual(['All time', 'Today', '7 days', '30 days', 'Custom range'])
    fireEvent.click(row('Date').getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(lastParams()?.from).toBeTruthy())
    expect(row('Date').getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')
    expect(filters.queryByLabelText('From date')).not.toBeInTheDocument()
    fireEvent.click(row('Date').getByRole('button', { name: 'Custom range' }))
    fireEvent.change(filters.getByLabelText('From date'), { target: { value: '2026-11-10' } })
    fireEvent.change(filters.getByLabelText('To date'), { target: { value: '2026-11-15' } })
    await waitFor(() => expect(lastParams()).toMatchObject({ from: '2026-11-10', to: '2026-11-15' }))

    fireEvent.change(filters.getByRole('searchbox', { name: 'Search incidents' }), { target: { value: 'ana@example.com' } })
    fireEvent.submit(filters.getByRole('searchbox', { name: 'Search incidents' }).closest('form')!)
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, category: 'upload,auth', status: 'open', severity: 'error', from: '2026-11-10', to: '2026-11-15', q: 'ana@example.com' }))
    expect(screen.getByTestId('search').textContent).toContain('q=ana%40example.com')

    fireEvent.click(filters.getByRole('button', { name: /Clear filters/ }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1 }))
  })

  it('explains what will appear when nothing has been recorded yet', async () => {
    api.get.mockImplementation(() => Promise.resolve({ data: [], meta: { ...meta, total: 0, last_page: 1, by_category: {}, stats: { open: 0, today: 0, failed_logins_today: 0, resolved_this_week: 0 } } }))
    renderPage()

    expect(await screen.findByText('No incidents recorded yet')).toBeInTheDocument()
    expect(screen.getByText(/will appear here automatically as they happen/)).toBeInTheDocument()
  })

  it('opens filters from the address bar and pages through older records', async () => {
    renderPage('/admin/settings/incidents?category=server&status=open')
    await screen.findByText(/30 records match the filters/)
    expect(lastParams()).toEqual({ page: 1, category: 'server', status: 'open' })

    fireEvent.click(screen.getByRole('button', { name: /Older/ }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 2, category: 'server', status: 'open' }))
  })

  it('shows an incident in full and records how it was fixed', async () => {
    api.post.mockResolvedValue({ ...rows[0], status: 'resolved' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Server error: QueryException, Needs fixing' }))
    const dialog = within(await screen.findByRole('document', { name: 'Incident details' }))
    const section = (name: string) => within(dialog.getByRole('region', { name }))
    expect(await dialog.findByText('Connection refused')).toBeInTheDocument()
    expect(section('Timestamps').getByText(/3 times · first/)).toBeInTheDocument()
    expect(section('Affected module').getByText('Server errors')).toBeInTheDocument()
    expect(section('Affected module').getByText('POST /api/login')).toBeInTheDocument()
    expect(section('Description').getByText('Connection refused')).toBeInTheDocument()
    expect(section('Responsible action').getByText(/Share the technical details with your technical person/)).toBeInTheDocument()
    expect(dialog.getByRole('list', { name: 'Resolution history' })).toHaveTextContent(/Recorded automatically.*Now:\s*Needs fixing/)
    // Earlier occurrences show how they were fixed.
    expect(dialog.getByText('Same problem, earlier')).toBeInTheDocument()
    expect(dialog.getByText('Office: Restarted the database.')).toBeInTheDocument()

    fireEvent.click(dialog.getByRole('button', { name: 'Mark as fixed' }))
    fireEvent.change(dialog.getByRole('textbox', { name: /What was done to fix it/ }), { target: { value: 'Restarted MySQL.' } })
    fireEvent.click(dialog.getByLabelText('Also close the other 2 times this happened'))
    fireEvent.click(dialog.getByRole('button', { name: /Save as fixed/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/system/incidents/3/resolve', { note: 'Restarted MySQL.', include_similar: true }))
  })

  it('shows the fix record of a fixed incident and lets it be reopened', async () => {
    api.post.mockResolvedValue({ ...rows[2], status: 'open' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Failed login: wrong password, Fixed' }))
    const dialog = within(await screen.findByRole('document', { name: 'Incident details' }))
    const history = within(await dialog.findByRole('list', { name: 'Resolution history' }))
    // Every step is kept, including the fix before the reopen.
    expect(history.getAllByText('Marked as fixed')).toHaveLength(2)
    expect(history.getByText('Reopened')).toBeInTheDocument()
    expect(history.getByText('Owner reset the password.')).toBeInTheDocument()
    expect(within(dialog.getByRole('region', { name: 'Responsible action' })).getByText('Handled by Office.')).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Mark as fixed' })).not.toBeInTheDocument()

    // Reopen asks first (a double-click on "Save as fixed" used to land on Reopen).
    fireEvent.click(dialog.getByRole('button', { name: /Reopen/ }))
    expect(api.post).not.toHaveBeenCalledWith('/admin/system/incidents/1/reopen', {})
    const confirm = within(dialog.getByRole('group', { name: 'Confirm reopen' }))
    fireEvent.click(confirm.getByRole('button', { name: 'Cancel' }))
    expect(dialog.queryByRole('group', { name: 'Confirm reopen' })).toBeNull()
    expect(api.post).not.toHaveBeenCalledWith('/admin/system/incidents/1/reopen', {})

    fireEvent.click(dialog.getByRole('button', { name: /Reopen/ }))
    fireEvent.click(within(dialog.getByRole('group', { name: 'Confirm reopen' })).getByRole('button', { name: /Yes, reopen/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/system/incidents/1/reopen', {}))
  })
})
