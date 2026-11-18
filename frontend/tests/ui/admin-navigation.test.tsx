import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api' }))

import AdminLayout from '@/features/admin/components/AdminLayout'
import AdminSectionTabs from '@/features/admin/components/AdminSectionTabs'
import { ADMIN_REDIRECTS, BUSINESSES_TABS, MUNICIPALITIES_TABS, SETTINGS_TABS, USERS_TABS } from '@/features/admin/sectionTabs'
import { useAuthStore } from '@/features/auth/services/auth-store'

/** Mirrors the /admin routing in App.tsx with stub pages. */
function renderAt(path: string) {
  const page = (name: string) => <p>{name} page</p>
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="dashboard" element={page('dashboard')} />
            <Route path="users" element={<AdminSectionTabs label="Users sections" tabs={USERS_TABS} />}>
              <Route index element={page('users')} />
              <Route path="tourists" element={page('tourists')} />
            </Route>
            <Route path="businesses" element={<AdminSectionTabs label="Businesses sections" tabs={BUSINESSES_TABS} />}>
              <Route index element={page('businesses')} />
              <Route path="categories" element={page('categories')} />
            </Route>
            <Route path="municipalities" element={<AdminSectionTabs label="Municipalities sections" tabs={MUNICIPALITIES_TABS} />}>
              <Route index element={page('municipalities')} />
              <Route path="accounts" element={page('municipality accounts')} />
            </Route>
            <Route path="reports" element={page('reports')} />
            <Route path="settings" element={<AdminSectionTabs label="Settings sections" title="Settings" tabs={SETTINGS_TABS} />}>
              <Route index element={<Navigate to="configuration" replace />} />
              <Route path="configuration" element={page('configuration')} />
              <Route path="access-control" element={page('roles')} />
              <Route path="document-verification" element={page('ocr')} />
              <Route path="security" element={page('security')} />
              <Route path="backup" element={page('backup')} />
              <Route path="diagnostics" element={page('diagnostics')} />
              <Route path="incidents" element={page('incidents')} />
            </Route>
            {Object.entries(ADMIN_REDIRECTS).map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 1, name: 'Bansud Tourism Office', email: 'tourism@bansud.gov.ph', role: 'bansud_tourism_office', account_status: 'approved' } as never, loading: false })
  api.get.mockResolvedValue({ stats: { pending_verifications: 0, pending_review: 0, total_municipalities: 15 } })
})

describe('Bansud admin navigation (tourism-focused)', () => {
  it('groups the sidebar into the recommended sections with no redundant modules', () => {
    renderAt('/admin/dashboard')
    const nav = screen.getByRole('navigation', { name: 'Admin navigation' })

    const groups: Record<string, string[]> = {
      Overview: ['Dashboard'],
      'Live operations': ['Live Map', 'Deliveries', 'Rider Cash', 'SOS Alerts'],
      'Tourism management': ['Businesses', 'Users', 'Riders', 'Rider Onboarding', 'Cashouts'],
      'Municipality management': ['Municipalities'],
      'Records & analytics': ['Reports', 'Audit Logs', 'Notifications'],
      System: ['Office Profile', 'Settings'],
    }
    for (const [group, items] of Object.entries(groups)) {
      const list = within(nav).getByText(group).nextElementSibling as HTMLElement
      expect(within(list).getAllByRole('link').map((l) => l.textContent)).toEqual(items)
    }
    for (const gone of ['POS & Sales', 'Tourists', 'Categories', 'Municipality Accounts', 'Roles', 'Configuration', 'OCR Settings']) {
      expect(within(nav).queryByRole('link', { name: gone })).toBeNull()
    }
  })

  it('shows merged modules as tabs inside their parent module', () => {
    renderAt('/admin/users/tourists')
    expect(screen.getByText('tourists page')).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Users sections' })
    expect(within(tabs).getByRole('link', { name: 'Tourists' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'All users' })).toHaveAttribute('href', '/admin/users')
    // The Users sidebar entry stays highlighted inside its tabs.
    expect(within(screen.getByRole('navigation', { name: 'Admin navigation' })).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens Settings on Platform Configuration with all system tabs', () => {
    renderAt('/admin/settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('configuration page')).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Platform Configuration', 'Access Control', 'Document Verification', 'Security', 'Data Backup', 'System Diagnostics', 'Incident History'])
  })

  it.each([
    ['/admin/settings/security', 'security', /preventing unauthorised access/],
    ['/admin/settings/diagnostics', 'diagnostics', /finding technical problems/],
    ['/admin/settings/incidents', 'incidents', /tracking problems and how they were fixed/],
  ])('keeps the single Settings entry active on %s and says what the tab is for', (path, name, about) => {
    renderAt(path)
    expect(screen.getByText(`${name} page`)).toBeInTheDocument()
    const sidebar = within(screen.getByRole('navigation', { name: 'Admin navigation' }))
    expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(sidebar.queryByRole('link', { name: /Security|Backup|Diagnostics|Incident History/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/: about this section$/)).toHaveTextContent(about)
  })

  it.each([
    ['/admin/tourists', 'tourists page'],
    ['/admin/business-categories', 'categories page'],
    ['/admin/municipality-accounts', 'municipality accounts page'],
    ['/admin/roles', 'roles page'],
    ['/admin/system/config', 'configuration page'],
    ['/admin/system/ocr-settings', 'ocr page'],
    ['/admin/system/security', 'security page'],
    ['/admin/system/backup', 'backup page'],
    ['/admin/pos', 'reports page'],
  ])('redirects the old URL %s to its new home', (from, page) => {
    renderAt(from)
    expect(screen.getByText(page)).toBeInTheDocument()
  })
})
