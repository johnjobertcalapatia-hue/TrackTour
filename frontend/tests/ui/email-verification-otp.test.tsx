import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VerifyEmailPage from '@/features/auth/pages/VerifyEmailPage'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  fetchUser: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@/shared/services/api', () => ({ post: mocks.post }))
vi.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: () => ({
    user: {
      id: 8,
      email: 'tourist@example.com',
      role: 'tourist',
      email_verified_at: null,
    },
    fetchUser: mocks.fetchUser,
    logout: mocks.logout,
  }),
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="current-path">{location.pathname}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <LocationProbe />
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/tourist/dashboard" element={<div>Tourist dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('email verification OTP page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.post.mockResolvedValue({ retry_after: 0 })
    mocks.fetchUser.mockResolvedValue(undefined)
  })

  it('requests a code and submits the entered code before navigating', async () => {
    renderPage()

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/email/verification-notification')
    })
    expect(await screen.findByText('tourist@example.com')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Six-digit email verification code'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }))

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/email/verification-otp', { otp_code: '123456' })
      expect(mocks.fetchUser).toHaveBeenCalled()
      expect(screen.getByTestId('current-path')).toHaveTextContent('/tourist/dashboard')
    })
  })

  it('shows API validation failures without leaving the verification page', async () => {
    mocks.post
      .mockResolvedValueOnce({ retry_after: 0 })
      .mockRejectedValueOnce({ response: { data: { message: 'Invalid or expired verification code.' } } })
    renderPage()

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/email/verification-notification'))
    fireEvent.change(screen.getByLabelText('Six-digit email verification code'), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }))

    expect(await screen.findByText('Invalid or expired verification code.')).toBeInTheDocument()
    expect(screen.getByTestId('current-path')).toHaveTextContent('/verify-email')
  })
})
