import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  apiErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  apiErrorMessage: api.apiErrorMessage,
}))

import AdminOfficeProfile from '@/features/admin/pages/AdminOfficeProfile'

/**
 * Bansud Tourism Office profile (/admin/profile).
 *
 * The office sets its own logo, cover photo and contact details here, all of
 * which live in the shared tourism_settings store — so the page must post the
 * exact multipart payload the backend validates and keep the shared query
 * cache in sync with the saved values.
 */

const DEFAULTS = {
  name: 'Bansud Tourism Office',
  about: '',
  email: '',
  phone: '',
  address: 'Municipal Hall, Bansud, Oriental Mindoro',
  logo_url: null as string | null,
  cover_url: null as string | null,
  updated_at: null as string | null,
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminOfficeProfile />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function sentFormData(call = 0): FormData {
  return api.post.mock.calls[call][1] as FormData
}

describe('Bansud Tourism Office profile', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.apiErrorMessage.mockReset()
    api.apiErrorMessage.mockImplementation((_error: unknown, fallback: string) => fallback)
    api.get.mockResolvedValue(DEFAULTS)
    api.post.mockImplementation((_url: string, payload: FormData) =>
      Promise.resolve({ ...DEFAULTS, name: String(payload.get('name') ?? DEFAULTS.name) }),
    )
  })

  it('shows the office defaults before anything has been configured', async () => {
    renderPage()

    expect(await screen.findByDisplayValue('Bansud Tourism Office')).toBeInTheDocument()
    expect(screen.getByLabelText('About the office')).toHaveValue('')
    expect(screen.getByLabelText('Contact email')).toHaveValue('')
    expect(screen.getByLabelText('Contact number')).toHaveValue('')
    expect(screen.getByLabelText('Office address')).toHaveValue('Municipal Hall, Bansud, Oriental Mindoro')

    // Nothing uploaded yet → prompts instead of images.
    expect(screen.queryByAltText('Bansud Tourism Office logo')).toBeNull()
    expect(screen.queryByAltText('Bansud Tourism Office cover')).toBeNull()
    expect(screen.getByText('Add a cover photo for the office')).toBeInTheDocument()
    expect(screen.getByTestId('office-logo-preview').querySelector('svg')).not.toBeNull()
  })

  it('keeps the logo above the cover photo (no overlap)', async () => {
    api.get.mockResolvedValue({
      ...DEFAULTS,
      logo_url: '/storage/office/logo/bansud-seal.png',
      cover_url: '/storage/office/cover/bansud.jpg',
    })

    renderPage()

    await screen.findByAltText('Bansud Tourism Office cover')
    await screen.findByAltText('Bansud Tourism Office logo')

    // The cover block is `relative`; the override row must be positioned and
    // raised above it, otherwise the cover paints over the overlapping logo.
    const cover = screen.getByTestId('office-cover-preview')
    const logoRow = screen.getByTestId('office-logo-preview').parentElement!
    expect(cover).toHaveClass('relative')
    expect(logoRow).toHaveClass('relative', 'z-10')
    expect(cover.compareDocumentPosition(logoRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('stages a logo and posts it as multipart form data on save', async () => {
    const saved = { ...DEFAULTS, name: 'Bansud Tourism Office', logo_url: '/storage/office/logo/seal.png' }
    api.post.mockResolvedValueOnce(saved)

    renderPage()
    await screen.findByDisplayValue('Bansud Tourism Office')

    const file = new File(['seal'], 'bansud-seal.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('office-logo-input'), { target: { files: [file] } })

    // The form knows there are unsaved changes as soon as a file is staged.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    expect(await screen.findByText('Office profile saved.')).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post.mock.calls[0][0]).toBe('/admin/profile')

    const payload = sentFormData()
    expect(payload).toBeInstanceOf(FormData)
    expect(payload.get('logo')).toBe(file)
    expect(payload.get('name')).toBe('Bansud Tourism Office')
    expect(payload.get('address')).toBe('Municipal Hall, Bansud, Oriental Mindoro')
    expect(payload.get('remove_logo')).toBeNull()

    // The saved logo is now the preview (shared cache, no reload needed).
    expect(await screen.findByAltText('Bansud Tourism Office logo')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('removes a stored cover photo by flagging it for deletion', async () => {
    api.get.mockResolvedValue({ ...DEFAULTS, cover_url: '/storage/office/cover/bansud.jpg' })
    api.post.mockResolvedValueOnce({ ...DEFAULTS, cover_url: null })

    renderPage()

    expect(await screen.findByAltText('Bansud Tourism Office cover')).toBeInTheDocument()

    const cover = screen.getByTestId('office-cover-preview')
    fireEvent.click(within(cover).getByRole('button', { name: /Remove/ }))

    // Removal is staged locally first — nothing is deleted until Save.
    expect(api.post).not.toHaveBeenCalled()
    expect(screen.queryByAltText('Bansud Tourism Office cover')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    expect(await screen.findByText('Office profile saved.')).toBeInTheDocument()
    expect(sentFormData().get('remove_cover')).toBe('1')
    // No file staged, so no upload field is sent.
    expect(sentFormData().get('cover')).toBeNull()
  })

  it('sends edited contact details', async () => {
    renderPage()
    await screen.findByDisplayValue('Bansud Tourism Office')

    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'tourism@bansud.gov.ph' } })
    fireEvent.change(screen.getByLabelText('Contact number'), { target: { value: '0917 000 0000' } })
    fireEvent.change(screen.getByLabelText('About the office'), {
      target: { value: 'Promoting the beauty of Bansud.' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    expect(await screen.findByText('Office profile saved.')).toBeInTheDocument()
    const payload = sentFormData()
    expect(payload.get('email')).toBe('tourism@bansud.gov.ph')
    expect(payload.get('phone')).toBe('0917 000 0000')
    expect(payload.get('about')).toBe('Promoting the beauty of Bansud.')
  })

  it('rejects an oversized image before it reaches the server', async () => {
    renderPage()
    await screen.findByDisplayValue('Bansud Tourism Office')

    const huge = new File(['x'], 'huge-logo.png', { type: 'image/png' })
    Object.defineProperty(huge, 'size', { value: 6 * 1024 * 1024 })
    fireEvent.change(screen.getByTestId('office-logo-input'), { target: { files: [huge] } })

    expect(await screen.findByText(/logo may not be larger than 5 MB/)).toBeInTheDocument()
    // The rejected file is not staged, so there is nothing unsaved yet.
    expect(screen.queryByText('Unsaved changes')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    await screen.findByText('Office profile saved.')
    // The rejected file never goes into the payload.
    expect(sentFormData().get('logo')).toBeNull()
  })

  it('surfaces the server error when saving fails', async () => {
    api.apiErrorMessage.mockImplementationOnce(() => 'The logo must be a JPG, PNG or WebP image.')
    api.post.mockRejectedValueOnce(new Error('422'))

    renderPage()
    await screen.findByDisplayValue('Bansud Tourism Office')

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    expect(await screen.findByText('The logo must be a JPG, PNG or WebP image.')).toBeInTheDocument()
    expect(screen.queryByText('Office profile saved.')).toBeNull()
  })
})
