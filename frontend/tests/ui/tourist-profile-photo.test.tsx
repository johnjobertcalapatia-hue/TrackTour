import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristProfile from '@/features/tourist/pages/TouristProfile'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
const store = vi.hoisted(() => ({
  state: { user: null as Record<string, unknown> | null, logout: () => {}, setUser: vi.fn() },
}))

vi.mock('@/shared/services/api', () => ({
  get: api.get, post: api.post,
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
  default: { get: api.get },
}))
vi.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: (selector?: (v: typeof store.state) => unknown) => (selector ? selector(store.state) : store.state),
}))

const me = (photo: string | null) => ({ id: 1, name: 'Jayvie De Torres', email: 'j@example.com', role: 'tourist', profile_photo: photo })

function renderProfile() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristProfile /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const pick = async (file: File) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('profile-photo-input'), { target: { files: [file] } })
  })
}

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset()
  store.state.setUser = vi.fn()
  store.state.user = me(null)
  api.get.mockResolvedValue(me(null))
})

describe('Tourist profile photo', () => {
  it('uploads a photo, shows it, and updates the signed-in user (sidebar + map pin)', async () => {
    api.post.mockResolvedValue(me('profiles/new.jpg'))
    renderProfile()
    expect(await screen.findByTestId('profile-initials')).toHaveTextContent('J')

    await pick(new File(['x'], 'me.png', { type: 'image/png' }))

    const [url, body] = api.post.mock.calls[0]
    expect(url).toBe('/tourist/profile/photo')
    expect((body as FormData).get('photo')).toBeInstanceOf(File)
    expect(await screen.findByAltText('Jayvie De Torres profile photo')).toHaveAttribute('src', expect.stringContaining('/storage/profiles/new.jpg'))
    expect(store.state.setUser).toHaveBeenCalledWith(expect.objectContaining({ profile_photo: 'profiles/new.jpg' }))
    expect(screen.getByText('Profile photo updated.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument()
    // The camera button is the only way in: no separate Upload/Change text button.
    expect(screen.queryByRole('button', { name: /^(Upload|Change) photo$/ })).not.toBeInTheDocument()
  })

  it('rejects wrong types and files over 2 MB before uploading', async () => {
    renderProfile()
    await screen.findByTestId('profile-initials')

    await pick(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Please choose a JPG, PNG or WebP image.')

    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' })
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
    await pick(big)
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 2 MB')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('has no remove button: the camera button is the only photo control', async () => {
    store.state.user = me('profiles/old.jpg')
    api.get.mockResolvedValue(me('profiles/old.jpg'))
    renderProfile()
    await screen.findByAltText('Jayvie De Torres profile photo')

    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument()
  })

  it('shows an error when the upload fails', async () => {
    api.post.mockRejectedValue(new Error('500'))
    renderProfile()
    await screen.findByTestId('profile-initials')

    await pick(new File(['x'], 'me.jpg', { type: 'image/jpeg' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Could not upload the photo. Please try again.')
    expect(store.state.setUser).not.toHaveBeenCalled()
  })
})
