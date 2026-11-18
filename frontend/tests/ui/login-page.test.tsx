import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn().mockResolvedValue({ hero_video: '/assets/tracktour-web.mp4' }) }))
vi.mock('@/shared/services/api', () => ({ get: api.get }))
vi.mock('@/shared/services/preferences', () => ({ applyGuestPreferences: vi.fn().mockResolvedValue(undefined) }))

import LoginPage from '@/features/auth/pages/LoginPage'
import { useAuthStore } from '@/features/auth/services/auth-store'

function CurrentPath() {
  const location = useLocation()
  return <p data-testid="current-path">{location.pathname}</p>
}

function renderLogin() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="*" element={<><LoginPage /><CurrentPath /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function fillAndSubmit(email = 'kim@example.com', password = 'Password123!') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /Sign In/ }))
}

describe('login page', () => {
  const login = vi.fn()

  beforeEach(() => {
    login.mockReset()
    useAuthStore.setState({ user: null, loading: false, login } as never)
  })

  it('shows the brand panel with the landing video and the sign-in form', () => {
    renderLogin()

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to TrackTour' })).toBeInTheDocument()
    expect(screen.getByTestId('login-background-video').querySelector('source')).toHaveAttribute('src', '/assets/tracktour-web.mp4')
    // No role selection: creating an account goes straight to tourist registration.
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register?role=tourist')
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })

  it('signs in and goes to the role dashboard', async () => {
    login.mockResolvedValue({ id: 1, role: 'rider' })
    renderLogin()

    fillAndSubmit()

    await waitFor(() => expect(login).toHaveBeenCalledWith('kim@example.com', 'Password123!'))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/rider/map'))
  })

  it('shows the server message and the lockout countdown', async () => {
    login.mockRejectedValue({ response: { data: { message: 'Too many attempts. Account locked for 15 minutes.' } } })
    renderLogin()

    fillAndSubmit()

    expect(await screen.findByText('Account Locked')).toBeInTheDocument()
    expect(screen.getByText(/Locked - try again in 15:00/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeDisabled()
  })

  it('toggles password visibility', () => {
    renderLogin()

    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
  })
})
