import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

const auth = vi.hoisted(() => ({ register: vi.fn() }))
vi.mock('@/features/auth/services/auth-store', () => ({ useAuthStore: () => auth }))

import RiderRegisterPage from '@/features/auth/pages/RiderRegisterPage'

const municipalities = [
  { id: 1, name: 'Bansud', barangays: [{ id: 11, name: 'Poblacion' }] },
  { id: 2, name: 'Gloria', barangays: [] },
]

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/register/rider']}>
        <Routes>
          <Route path="/register/rider" element={<RiderRegisterPage />} />
          <Route path="/rider/onboarding" element={<p>Onboarding page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const change = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function fillAboutYou() {
  change('First name', 'Juan')
  change('Last name', 'Dela Cruz')
  change('Birthdate', '1990-05-01')
  await waitFor(() => expect(screen.getByRole('option', { name: 'Bansud' })).toBeInTheDocument())
  change('Municipality', '1')
  await waitFor(() => expect(screen.getByRole('option', { name: 'Poblacion' })).toBeInTheDocument())
  change('Barangay', '11')
}

describe('Rider sign-up steps', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    auth.register.mockReset()
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/municipalities' ? municipalities : null))
    api.post.mockImplementation((url: string) => Promise.resolve(url === '/auth/check-email' ? { available: true } : { success: true }))
    auth.register.mockResolvedValue({ email: 'juan@example.com', role: 'rider', email_verified_at: '2026-11-24T00:00:00Z' })
  })

  it('stays on About you until the required fields are filled', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Next: Contact/ }))
    expect(await screen.findByText('First name is required')).toBeInTheDocument()
    expect(screen.getByText('Municipality is required')).toBeInTheDocument()
    expect(screen.getByLabelText('First name')).toBeInTheDocument()
  })

  it('rejects riders under 18', async () => {
    renderPage()
    change('Birthdate', `${new Date().getFullYear() - 16}-01-01`)
    fireEvent.click(screen.getByRole('button', { name: /Next: Contact/ }))
    expect(await screen.findByText('You must be at least 18 years old')).toBeInTheDocument()
  })

  it('needs the emailed code before Contact, then creates the account and opens onboarding', async () => {
    renderPage()
    await fillAboutYou()
    fireEvent.click(screen.getByRole('button', { name: /Next: Contact/ }))
    await screen.findByLabelText('Email')
    change('Email', 'juan@example.com')
    change('Mobile number', '09171234567')
    fireEvent.click(await screen.findByRole('button', { name: /Next: Password/ }))
    expect(await screen.findByText('Verify your email with the code before you continue.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/send-otp', { mobile_number: '09171234567', email: 'juan@example.com', type: 'registration' }))
    change('Verification code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Next: Password/ }))
    await screen.findByLabelText(/^Password$/)
    change(/^Password$/, 'Secret#123')
    change('Confirm password', 'Secret#123')
    fireEvent.click(screen.getByRole('button', { name: /Next: Review/ }))

    const aboutYou = await screen.findByRole('region', { name: 'About you' })
    expect(within(aboutYou).getByText('Juan Dela Cruz')).toBeInTheDocument()
    expect(within(aboutYou).getByText('Bansud')).toBeInTheDocument()
    expect(within(aboutYou).getByText('Poblacion')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create rider account/ }))
    expect(await screen.findByText('You must agree to the Terms and Conditions')).toBeInTheDocument()
    expect(auth.register).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(/at least 18 years old/))
    fireEvent.click(screen.getByLabelText(/Terms and Conditions/))
    fireEvent.click(screen.getByLabelText(/Privacy Policy/))
    fireEvent.click(screen.getByRole('button', { name: /Create rider account/ }))

    expect(await screen.findByText('Onboarding page')).toBeInTheDocument()
    const sent = auth.register.mock.calls[0]![0] as FormData
    expect(sent.get('role')).toBe('rider')
    expect(sent.get('municipality_id')).toBe('1')
    expect(sent.get('barangay_id')).toBe('11')
    expect(sent.get('otp_code')).toBe('123456')
  })

  it('sends the rider back to the step of a field the server rejects', async () => {
    auth.register.mockRejectedValue({ response: { data: { errors: { last_name: ['This name is already registered as a rider.'] } } } })
    renderPage()
    await fillAboutYou()
    fireEvent.click(screen.getByRole('button', { name: /Next: Contact/ }))
    await screen.findByLabelText('Email')
    change('Email', 'juan@example.com')
    change('Mobile number', '09171234567')
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))
    await screen.findByLabelText('Verification code')
    change('Verification code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await screen.findByText('Email verified')
    fireEvent.click(screen.getByRole('button', { name: /Next: Password/ }))
    await screen.findByLabelText(/^Password$/)
    change(/^Password$/, 'Secret#123')
    change('Confirm password', 'Secret#123')
    fireEvent.click(screen.getByRole('button', { name: /Next: Review/ }))
    fireEvent.click(await screen.findByLabelText(/at least 18 years old/))
    fireEvent.click(screen.getByLabelText(/Terms and Conditions/))
    fireEvent.click(screen.getByLabelText(/Privacy Policy/))
    fireEvent.click(screen.getByRole('button', { name: /Create rider account/ }))

    await waitFor(() => expect(screen.getByLabelText('Last name')).toBeInTheDocument())
    expect(screen.getAllByText('This name is already registered as a rider.').length).toBeGreaterThan(0)
  })
})
