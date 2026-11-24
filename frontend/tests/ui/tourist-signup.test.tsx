import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tourist sign-up (/register, 2026-11-24 redesign): same layout as the
 * sign-in page, grouped fields with an error under each, a live password
 * checklist, and the unchanged registration call.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api', default: api }))

import RegisterPage from '@/features/auth/pages/RegisterPage'
import { useAuthStore } from '@/features/auth/services/auth-store'

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname}</output>
}

function renderSignUp(path = '/register') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<p>Verify page</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const registerUser = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  api.get.mockResolvedValue({})
  useAuthStore.setState({ register: registerUser } as never)
})

describe('Tourist sign-up', () => {
  it('uses the sign-in layout: brand panel, heading and a link back to sign in', () => {
    renderSignUp()
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByTestId('login-background-video')).toBeInTheDocument()
    expect(screen.getByText('Start exploring')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    // Labelled fields in three groups.
    for (const name of ['First name', 'Middle name (optional)', 'Last name', 'Birthdate', 'Email', 'Mobile number', 'Password', 'Confirm password']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('group').map((g) => g.querySelector('legend')?.textContent)).toEqual(['About you', 'How to reach you', 'Password'])
  })

  it('shows each problem under its field, not in a banner', async () => {
    renderSignUp()
    fireEvent.click(screen.getByRole('button', { name: /Create account/ }))
    expect(await screen.findByText('First name is required')).toBeInTheDocument()
    expect(screen.getByText('Last name is required')).toBeInTheDocument()
    expect(screen.getByText('Please enter a valid email')).toBeInTheDocument()
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-describedby', 'first_name-error')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(registerUser).not.toHaveBeenCalled()
  })

  it('ticks the password rules as they are met', () => {
    renderSignUp()
    const rules = within(screen.getByRole('list', { name: 'Password requirements' }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'abc' } })
    expect(rules.getByText('A lowercase letter')).toHaveTextContent('(done)')
    expect(rules.getByText('At least 8 characters')).toHaveTextContent('(not yet)')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Abcdefg1!' } })
    for (const rule of ['At least 8 characters', 'An uppercase letter', 'A lowercase letter', 'A number', 'A symbol']) {
      expect(rules.getByText(rule)).toHaveTextContent('(done)')
    }
    // One toggle shows both password fields.
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text')
  })

  it('registers the tourist and goes to email verification', async () => {
    registerUser.mockResolvedValue({ role: 'tourist', email: 'juan@example.com' })
    renderSignUp()
    const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fill('First name', 'Juan')
    fill('Last name', 'Dela Cruz')
    fill('Birthdate', '2000-05-01')
    fill('Email', 'juan@example.com')
    fill('Mobile number', '09171234567')
    fill('Password', 'Abcdefg1!')
    fill('Confirm password', 'Abcdefg1!')
    fireEvent.click(screen.getByRole('button', { name: /Create account/ }))

    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1))
    const sent = registerUser.mock.calls[0]![0] as FormData
    expect(sent.get('role')).toBe('tourist')
    expect(sent.get('first_name')).toBe('Juan')
    expect(sent.get('mobile_number')).toBe('09171234567')
    expect(await screen.findByText('Verify page')).toBeInTheDocument()
  })

  it('shows a server error in the banner', async () => {
    registerUser.mockRejectedValue({ response: { data: { errors: { email: ['The email has already been taken.'] } } } })
    renderSignUp()
    const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fill('First name', 'Juan'); fill('Last name', 'Dela Cruz'); fill('Birthdate', '2000-05-01')
    fill('Email', 'juan@example.com'); fill('Mobile number', '09171234567')
    fill('Password', 'Abcdefg1!'); fill('Confirm password', 'Abcdefg1!')
    fireEvent.click(screen.getByRole('button', { name: /Create account/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The email has already been taken.')
  })
})
