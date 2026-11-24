import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Add staff member (redesign 2026-11-24): grouped cards, labelled fields, and
 * the server's answers shown where they belong (a 422 for an email that
 * already has a TrackTour account appears under Email, not only in a banner
 * at the top of a long page).
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api', apiErrorMessage: (_e: unknown, f: string) => f }))

import BusinessOwnerStaffCreate from '@/features/business-owner/pages/BusinessOwnerStaffCreate'

const DUPLICATE = 'This email already has a TrackTour account. Staff need their own new account for your business.'

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter><BusinessOwnerStaffCreate /></MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillValidForm() {
  await screen.findByText('Order & Pickup Staff')
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Maria' } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Santos' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maria@example.com' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Order & Pickup Staff/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  api.get.mockImplementation(async (url: string) => (url.includes('/staff/roles')
    ? [{ id: 3, name: 'Order & Pickup Staff', description: 'Orders and handover' }]
    : [{ id: 7, name: 'Ekslusibo Grill' }]))
})

describe('Add staff member', () => {
  it('groups the form in labelled cards', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Add staff member' })).toBeInTheDocument()
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Business and roles', 'Personal details', 'Contact', 'Employment'])
    expect(within(screen.getByRole('region', { name: 'Business and roles' })).getByText('Ekslusibo Grill')).toBeInTheDocument()
    for (const label of ['First name', 'Last name', 'Middle name (optional)', 'Suffix (optional)', 'Gender (optional)', 'Date of birth (optional)', 'Email', 'Mobile number (optional)', 'Home address (optional)', 'Status', 'Pay', 'Date hired (optional)']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Gender (optional)')).toHaveValue('') // no gender assumed
  })

  it('shows "email already has an account" under Email and focuses it', async () => {
    api.post.mockRejectedValue({ response: { status: 422, data: { message: DUPLICATE, errors: { email: [DUPLICATE] } } } })
    renderPage()
    await fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: /Send invitation/ }))

    const email = screen.getByLabelText('Email')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(document.getElementById('staff-email-error')).toHaveTextContent(DUPLICATE)
    expect(email).toHaveAttribute('aria-describedby', 'staff-email-error')
    expect(email).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // not repeated in a banner
    const sent = api.post.mock.calls[0]![1] as FormData
    expect(sent.getAll('staff_role_ids[]')).toEqual(['3'])
    expect(sent.get('gender')).toBeNull()
  })

  it('an error no field shows appears beside the Send invitation button', async () => {
    api.post.mockRejectedValue({ response: { status: 422, data: { message: 'That role is not available for this type of business.' } } })
    renderPage()
    await fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: /Send invitation/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That role is not available for this type of business.')
    expect(alert.compareDocumentPosition(screen.getByRole('button', { name: /Send invitation/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('checks the photo before uploading and sends the invitation', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:photo')
    URL.revokeObjectURL = vi.fn()
    api.post.mockResolvedValue({ staff: { id: 41, name: 'Maria Santos', email: 'maria@example.com' }, mail_sent: true, activation_url: null })
    renderPage()
    await fillValidForm()
    const photo = screen.getByLabelText('Profile photo (optional)')
    fireEvent.change(photo, { target: { files: [new File(['x'], 'p.gif', { type: 'image/gif' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Use a JPG or PNG photo.')
    fireEvent.change(photo, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } })
    expect(screen.getByRole('img', { name: 'Profile photo preview' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Send invitation/ }))
    expect(await screen.findByRole('heading', { name: 'Invitation sent' })).toBeInTheDocument()
    expect((api.post.mock.calls[0]![1] as FormData).get('profile_picture')).toBeInstanceOf(File)
  })

  it('switching business clears the roles; filling in the only business does not', async () => {
    api.get.mockImplementation(async (url: string) => (url.includes('/staff/roles')
      ? [{ id: 3, name: 'Order & Pickup Staff' }]
      : [{ id: 7, name: 'Ekslusibo Grill' }, { id: 9, name: 'Kape Bansud' }]))
    renderPage()
    fireEvent.change(await screen.findByLabelText('Business'), { target: { value: '7' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: /Order & Pickup Staff/ }))
    expect(screen.getByRole('checkbox', { name: /Order & Pickup Staff/ })).toBeChecked()
    fireEvent.change(screen.getByLabelText('Business'), { target: { value: '9' } })
    expect(await screen.findByRole('checkbox', { name: /Order & Pickup Staff/ })).not.toBeChecked()
  })
})
