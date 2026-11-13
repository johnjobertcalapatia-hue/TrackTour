import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import AdminBusinessCategories from '@/features/admin/pages/AdminBusinessCategories'

const cat = (id: number, name: string, archived: boolean) => ({
  id,
  name,
  description: `${name} description`,
  archived_at: archived ? '2026-11-01T00:00:00Z' : null,
  required_documents: [],
})

const categories = [
  cat(1, 'Café', true),
  cat(2, 'Food Hub', false),
  cat(3, 'Hotel', false),
  cat(4, 'Dive Shop', true),
  cat(5, 'Restaurant', false),
]

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminBusinessCategories />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const names = (section: HTMLElement) =>
  within(section).getAllByTestId('category-card').map((card) => within(card).getByText(/^(Café|Food Hub|Hotel|Dive Shop|Restaurant)$/).textContent)

describe('Admin business categories: active and archived are separate', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockResolvedValue(categories)
    api.post.mockResolvedValue({})
  })

  it('lists active categories first and archived ones in their own section', async () => {
    renderPage()
    const active = await screen.findByRole('region', { name: 'Active categories' })
    const archived = screen.getByRole('region', { name: 'Archived categories' })

    expect(names(active)).toEqual(['Food Hub', 'Hotel', 'Restaurant'])
    expect(names(archived)).toEqual(['Café', 'Dive Shop'])
    expect(within(active).getByText('3')).toBeInTheDocument()
    expect(within(archived).getByText('2')).toBeInTheDocument()

    // Archived categories offer Restore; active ones offer Archive.
    expect(within(archived).getByRole('button', { name: 'Restore Café' })).toBeInTheDocument()
    expect(within(active).getByRole('button', { name: 'Archive Hotel' })).toBeInTheDocument()
    expect(within(active).queryByText('Archived')).toBeNull()
  })

  it('the archived section can be hidden and shown again', async () => {
    renderPage()
    const archived = await screen.findByRole('region', { name: 'Archived categories' })
    const toggle = within(archived).getByRole('button', { name: /Archived/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(archived).queryAllByTestId('category-card')).toHaveLength(0)

    fireEvent.click(toggle)
    expect(within(archived).getAllByTestId('category-card')).toHaveLength(2)
  })

  it('restoring calls the unarchive endpoint for that category', async () => {
    renderPage()
    const archived = await screen.findByRole('region', { name: 'Archived categories' })
    fireEvent.click(within(archived).getByRole('button', { name: 'Restore Dive Shop' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post.mock.calls[0]![0]).toMatch(/\/4\/unarchive$/)
  })

  it('no archived section when nothing is archived', async () => {
    api.get.mockResolvedValue(categories.filter((c) => !c.archived_at))
    renderPage()
    await screen.findByRole('region', { name: 'Active categories' })
    expect(screen.queryByRole('region', { name: 'Archived categories' })).toBeNull()
  })
})
