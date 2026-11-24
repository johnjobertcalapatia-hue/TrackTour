import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api' }))

import AdminLayout from '@/features/admin/components/AdminLayout'
import AdminSectionTabs from '@/features/admin/components/AdminSectionTabs'
import AdminSettingsLayout, { AdminSettingsHome } from '@/features/admin/components/AdminSettingsLayout'
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
            <Route path="settings" element={<AdminSettingsLayout sections={SETTINGS_TABS} />}>
              <Route index element={<AdminSettingsHome sections={SETTINGS_TABS} />} />
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
      // System Notices (2026-11-23): the admin sends maintenance notices to owners, riders, tourists or everyone.
      System: ['Office Profile', 'System Notices', 'Settings'],
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

  it('opens Settings as a page of buttons, one per settings area (no tab bar)', () => {
    renderAt('/admin/settings')
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('configuration page')).toBeNull()
    const buttons = within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('link')
    const labels = ['Platform Configuration', 'Access Control', 'Document Verification', 'Security', 'Data Backup', 'System Diagnostics', 'Incident History']
    expect(buttons).toHaveLength(labels.length)
    buttons.forEach((b, i) => expect(b.textContent).toMatch(new RegExp(`^${labels[i]}`)))
    expect(within(screen.getByRole('navigation', { name: 'Admin navigation' })).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  })

  it('a settings button opens its own page, with a way back to Settings', () => {
    renderAt('/admin/settings')
    fireEvent.click(screen.getByRole('link', { name: /^System Diagnostics/ }))
    expect(screen.getByText('diagnostics page')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'System Diagnostics', level: 1 })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Settings' }))
    expect(screen.queryByText('diagnostics page')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
  })

  it.each([
    ['/admin/settings/security', 'security', /preventing unauthorised access/],
    ['/admin/settings/diagnostics', 'diagnostics', /finding technical problems/],
    ['/admin/settings/incidents', 'incidents', /tracking problems and how they were fixed/],
  ])('keeps the single Settings entry active on %s, with a back link and no tab bar', (path, name, about) => {
    renderAt(path)
    expect(screen.getByText(`${name} page`)).toBeInTheDocument()
    const sidebar = within(screen.getByRole('navigation', { name: 'Admin navigation' }))
    expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(sidebar.queryByRole('link', { name: /Security|Backup|Diagnostics|Incident History/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/settings')
    // Security has its own title; Diagnostics and Incident History get one (with what they are for) from the layout.
    if (name !== 'security') expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent(about)
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
