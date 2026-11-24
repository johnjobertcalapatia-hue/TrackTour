import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Business owner sign-up (/register?role=business_owner, 2026-11-24 redesign):
 * the sign-in layout with five steps; Next checks the current step (fields
 * and the required ID photos), the photos follow the server's rules (JPG, PNG
 * or PDF, 5 MB), and the submission is unchanged.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api', default: api }))

import RegisterPage from '@/features/auth/pages/RegisterPage'
import { useAuthStore } from '@/features/auth/services/auth-store'

const registerUser = vi.fn()

function renderSignUp() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/register?role=business_owner']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<p>Verify page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const next = () => fireEvent.click(screen.getByRole('button', { name: /^Next/ }))
const currentStep = () => screen.getByRole('list', { name: 'Registration steps' }).querySelector('[aria-current="step"]')
const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type })

async function fillAboutYou() {
  fill('First name', 'Maria'); fill('Last name', 'Santos'); fill('Birthdate', '1990-03-15')
  fill('Sex', 'female'); fill('Nationality', 'Filipino')
  fill('Email', 'maria@example.com'); fill('Mobile number', '09171234567')
  next()
  await waitFor(() => expect(currentStep()).toHaveTextContent('Address'))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  api.get.mockImplementation(async (url: string) => (url === '/municipalities'
    ? [{ id: 1, name: 'Bansud', slug: 'bansud', barangays: [{ id: 10, name: 'Poblacion' }] }]
    : {}))
  useAuthStore.setState({ register: registerUser } as never)
})

describe('Business owner sign-up', () => {
  it('uses the sign-in layout with a five-step indicator', () => {
    renderSignUp()
    expect(screen.getByRole('heading', { level: 1, name: 'Register your business account' })).toBeInTheDocument()
    expect(screen.getByTestId('login-background-video')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Registration steps' })).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s*\(.*\)/, ''))).toEqual(['About you', 'Address', 'ID check', 'Password', 'Review'])
    expect(currentStep()).toHaveTextContent('About you')
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument()
  })

  it('Next checks the current step before moving on', async () => {
    renderSignUp()
    next()
    expect(await screen.findByText('First name is required')).toBeInTheDocument()
    expect(screen.getByText('Sex is required')).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('About you')
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('walks through every step and submits with the ID photos', async () => {
    registerUser.mockResolvedValue({ role: 'business_owner', email: 'maria@example.com' })
    renderSignUp()
    await fillAboutYou()

    // Address: the barangay waits for the municipality; the address is pre-filled.
    expect(screen.getByLabelText('Barangay')).toBeDisabled()
    await waitFor(() => expect(within(screen.getByLabelText('Municipality')).getByRole('option', { name: 'Bansud' })).toBeInTheDocument())
    fill('Municipality', '1')
    fill('Barangay', 'Poblacion')
    await waitFor(() => expect(screen.getByLabelText('Complete address')).toHaveValue('Poblacion, Bansud, Oriental Mindoro, '))
    fill('Complete address', 'Poblacion, Bansud, Oriental Mindoro, Purok 2')
    next()
    await waitFor(() => expect(currentStep()).toHaveTextContent('ID check'))

    // ID: the front and the selfie are required; files follow the server's rules.
    fill('ID type', 'national_id'); fill('ID number', 'PSN-1234')
    next()
    expect(await screen.findByText('Upload the front of your ID.')).toBeInTheDocument()
    expect(screen.getByText('Upload a selfie holding your ID.')).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('ID check')
    fireEvent.change(screen.getByLabelText('Front of ID'), { target: { files: [file('front.webp', 'image/webp')] } })
    expect(screen.getByText('Use a JPG, PNG or PDF file.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Front of ID'), { target: { files: [file('big.png', 'image/png', 5 * 1024 * 1024 + 1)] } })
    expect(screen.getByText('The file must be 5 MB or smaller.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Front of ID'), { target: { files: [file('front.png', 'image/png')] } })
    fireEvent.change(screen.getByLabelText('Selfie holding your ID'), { target: { files: [file('selfie.pdf', 'application/pdf')] } })
    expect(screen.getByRole('img', { name: 'Front of ID preview' })).toBeInTheDocument()
    expect(screen.getByText('selfie.pdf')).toBeInTheDocument()
    next()
    await waitFor(() => expect(currentStep()).toHaveTextContent('Password'))

    fill('Password', 'Abcdefg1!'); fill('Confirm password', 'Abcdefg1!')
    next()
    await waitFor(() => expect(currentStep()).toHaveTextContent('Review'))

    // Review, with Edit going back to a step.
    expect(screen.getByRole('region', { name: 'About you' })).toHaveTextContent('Maria Santos')
    expect(screen.getByRole('region', { name: 'Address' })).toHaveTextContent('Bansud')
    expect(screen.getByRole('region', { name: 'ID check' })).toHaveTextContent('National ID · PSN-1234')
    expect(screen.getByRole('region', { name: 'ID check' })).toHaveTextContent('Not uploaded (optional)')

    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }))
    await waitFor(() => expect(registerUser).toHaveBeenCalledTimes(1))
    const sent = registerUser.mock.calls[0]![0] as FormData
    expect(sent.get('role')).toBe('business_owner')
    expect(sent.get('government_id_number')).toBe('PSN-1234')
    expect((sent.get('valid_id_front') as File).name).toBe('front.png')
    expect((sent.get('selfie_holding_id') as File).name).toBe('selfie.pdf')
    expect(sent.get('valid_id_back')).toBeNull()
    expect(await screen.findByText('Verify page')).toBeInTheDocument()
  })

  it('Back keeps what was typed', async () => {
    renderSignUp()
    await fillAboutYou()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(currentStep()).toHaveTextContent('About you')
    expect(screen.getByLabelText('First name')).toHaveValue('Maria')
  })
})
