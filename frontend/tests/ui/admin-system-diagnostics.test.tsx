import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f = 'Request failed.') => f }))

import AdminSystemDiagnostics, { type Diagnostics } from '@/features/admin/pages/AdminSystemDiagnostics'

const fix = (action: string, label: string, extra: Record<string, unknown> = {}) => ({ action, label, description: `${label} (technical description)`, ...extra })

const diagnostics: Diagnostics = {
  generated_at: '2026-11-17T06:00:00Z',
  summary: { ok: 2, warning: 1, error: 2 },
  health: {
    score: 72,
    grade: 'Fair',
    window: 'Last 7 days',
    measures: [
      { key: 'db_latency', group: 'performance', label: 'Database response', value: 6, display: '6 ms', target: '≤ 100 ms', status: 'ok', hint: 'Time for the database to answer a query.', ratio: 0.012 },
      { key: 'scheduler_lag', group: 'performance', label: 'Scheduler last tick', value: null, display: 'Never', target: '≤ 2 min', status: 'error', hint: 'The scheduler has not ticked.', ratio: 1 },
      { key: 'dispatch_success', group: 'service', label: 'Dispatch success', value: 75, display: '75%', target: '≥ 90%', status: 'warning', hint: '3 of 4 dispatches found a rider.', ratio: 0.75 },
      { key: 'gps_freshness', group: 'service', label: 'Rider GPS freshness', value: null, display: 'No riders online', target: '≥ 90%', status: 'idle', hint: 'Measured while riders are online.', ratio: null },
    ],
  },
  checks: [
    { key: 'database', area: 'platform', title: 'Database', status: 'ok', summary: 'Connected · answered in 9 ms.', details: [], count: null, fixes: [], link: null },
    { key: 'queue', area: 'platform', title: 'Background jobs', status: 'warning', summary: '3 background job(s) failed.', details: ['#9 (default): Boom'], count: 3,
      fixes: [fix('retry_failed_jobs', 'Retry failed jobs'), fix('clear_failed_jobs', 'Clear failed jobs', { confirm: true, danger: true })], link: null },
    { key: 'scheduler', area: 'automation', title: 'Scheduler', status: 'error', summary: 'The scheduler stopped 10 minutes ago.', details: ['Restart it on the server: php artisan schedule:work.'], count: null,
      fixes: [fix('run_automation', 'Run automation now')], link: null },
    { key: 'double_deliveries', area: 'operations', title: 'One delivery per rider', status: 'error', summary: '1 rider(s) have more than one open delivery.', details: ['Rina — 2 open deliveries'], count: 1, fixes: [], link: '/admin/live/deliveries' },
    { key: 'integrity', area: 'integrity', title: 'Transaction integrity', status: 'ok', summary: 'Every recent transaction history verifies.', details: [], count: null, fixes: [fix('verify_integrity', 'Verify again')], link: null },
  ],
  recent_fixes: [{ id: 1, description: 'Release riders: 1 rider(s) checked and repaired.', by: 'Bansud Office', at: '2026-11-17T05:00:00Z' }],
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AdminSystemDiagnostics /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The "Things to fix" cards, in display order. */
async function problemCards() {
  const section = await screen.findByRole('heading', { name: /^Things to fix/ })
  const list = section.parentElement!.querySelector('ol')!
  return Array.from(list.children) as HTMLElement[]
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue(diagnostics)
})

describe('Bansud System Diagnostics (plain language)', () => {
  it('opens with one plain sentence and the health score explained', async () => {
    renderPage()

    const status = within(await screen.findByRole('region', { name: 'System status' }))
    expect(status.getByRole('heading', { name: 'Your system needs attention: 3 things to fix' })).toBeInTheDocument()
    expect(status.getByText('2 are urgent and may stop orders, riders or payments from working.')).toBeInTheDocument()
    expect(status.getByRole('img', { name: 'Health score 72 of 100, Fair' })).toBeInTheDocument()
    expect(status.getByText('Working, but some things need attention.')).toBeInTheDocument()
  })

  it('lists things to fix, urgent first, each with what it means, how to fix it and who can', async () => {
    renderPage()

    const cards = await problemCards()
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Automatic tasks have stopped',
      'A rider has two deliveries at once',
      'Background tasks need attention',
    ])

    const scheduler = within(cards[0]!)
    expect(scheduler.getByText('Urgent')).toBeInTheDocument()
    expect(scheduler.getByText(/New orders are not sent to riders automatically/)).toBeInTheDocument()
    expect(scheduler.getByText('You can fix this here')).toBeInTheDocument()
    expect(scheduler.getByRole('button', { name: 'Run them once now' })).toBeInTheDocument()
    expect(scheduler.getByText('To stop it happening again, ask your technical person:')).toBeInTheDocument()
    expect(scheduler.getByText('php artisan schedule:work')).toBeInTheDocument()
    expect(scheduler.getByRole('button', { name: /Copy/ })).toBeInTheDocument()
    // Technical wording is one click away, not in the way.
    expect(scheduler.queryByText(/The scheduler stopped 10 minutes ago/)).not.toBeInTheDocument()
    fireEvent.click(scheduler.getByRole('button', { name: /Technical details/ }))
    expect(scheduler.getByText(/The scheduler stopped 10 minutes ago/)).toBeInTheDocument()

    // A rule a person must decide: no fix button, a plain next step, a link to the deliveries.
    const rider = within(cards[1]!)
    expect(rider.getByText('Needs a staff decision')).toBeInTheDocument()
    expect(rider.queryByRole('button', { name: /fix|Free|Run/i })).not.toBeInTheDocument()
    expect(rider.getByText(/decide which one to reassign/)).toBeInTheDocument()
    expect(rider.getByRole('link', { name: /Open deliveries/ })).toHaveAttribute('href', '/admin/live/deliveries')

    const queue = within(cards[2]!)
    expect(queue.getByText('Fix soon')).toBeInTheDocument()
    expect(queue.getByText('Affected: 3')).toBeInTheDocument()
    expect(queue.getByRole('button', { name: 'Try them again' })).toBeInTheDocument()
  })

  it('explains a fix in plain words, runs it and shows that it is done', async () => {
    const after = { ...diagnostics, summary: { ok: 3, warning: 1, error: 1 }, checks: diagnostics.checks.map((c) => (c.key === 'scheduler' ? { ...c, status: 'ok' as const } : c)) }
    api.post.mockResolvedValue({ action: 'run_automation', message: 'Automation ran once.', output: 'schedule:dispatch: Processed 1', diagnostics: after })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Run them once now' }))
    expect(screen.getByText(/Sends waiting orders to riders, moves on unanswered offers/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, fix it' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/system/diagnostics/fix', { action: 'run_automation', confirm: false }))
    const banner = await screen.findByRole('status', { name: 'Fix result' })
    expect(banner).toHaveTextContent('Done: Automation ran once.')
    expect(screen.getByRole('heading', { name: 'Your system needs attention: 2 things to fix' })).toBeInTheDocument()
    fireEvent.click(within(banner).getByRole('button', { name: 'Technical details' }))
    expect(screen.getByText('schedule:dispatch: Processed 1')).toBeInTheDocument()
  })

  it('makes a permanent action confirm first', async () => {
    api.post.mockResolvedValue({ action: 'clear_failed_jobs', message: 'Failed-job records cleared.', output: '', diagnostics })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete failed tasks' }))
    const run = screen.getByRole('button', { name: 'Yes, fix it' })
    expect(run).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I understand this cannot be undone.'))
    fireEvent.click(run)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/system/diagnostics/fix', { action: 'clear_failed_jobs', confirm: true }))
  })

  it('folds away what is working and names the health measures in everyday words', async () => {
    renderPage()

    const working = within(await screen.findByRole('region', { name: 'Everything that is working' }))
    expect(working.queryByText('Database is working')).not.toBeInTheDocument()
    fireEvent.click(working.getByRole('button', { name: /Everything that is working \(2\)/ }))
    expect(working.getByText('Database is working')).toBeInTheDocument()
    expect(working.getByRole('button', { name: 'Check again' })).toBeInTheDocument()

    const health = within(screen.getByRole('region', { name: 'Health measures' }))
    expect(health.getByRole('listitem', { name: 'Database speed: 6 ms, Good' })).toHaveTextContent('Target: ≤ 100 ms')
    expect(health.getByRole('listitem', { name: 'Automatic tasks last ran: Never, Not working' })).toBeInTheDocument()
    expect(health.getByRole('listitem', { name: 'Orders that found a rider: 75%, Needs attention' })).toBeInTheDocument()
    expect(health.getByRole('listitem', { name: 'Riders sharing location: No riders online, No data yet' })).toBeInTheDocument()
    expect(health.getByRole('heading', { name: /How well we are serving people\s*Last 7 days/ })).toBeInTheDocument()

    expect(screen.getByText('Release riders: 1 rider(s) checked and repaired.')).toBeInTheDocument()
  })

  it('says so plainly when everything works', async () => {
    api.get.mockResolvedValue({ ...diagnostics, summary: { ok: 5, warning: 0, error: 0 }, checks: diagnostics.checks.map((c) => ({ ...c, status: 'ok' as const })) })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Everything is working' })).toBeInTheDocument()
    expect(screen.getByText('Nothing to fix — everything is working.')).toBeInTheDocument()
  })
})
