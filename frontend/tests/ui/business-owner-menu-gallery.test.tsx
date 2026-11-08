import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BusinessOwnerMenuEdit from '@/features/business-owner/pages/BusinessOwnerMenuEdit'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, put: api.put, post: vi.fn(), default: { get: api.get } }))

const ITEM = {
  id: 12,
  name: 'Pork/Chicken Sisig',
  description: '',
  price: 199,
  preparation_time: null,
  offering_category_id: 3,
  is_available: true,
  is_featured: false,
  has_variations: false,
  image: 'http://api.test/storage/menu-items/main.jpg',
  gallery: [
    { path: 'menu-items/g1.jpg', url: 'http://api.test/storage/menu-items/g1.jpg' },
    { path: 'menu-items/g2.jpg', url: 'http://api.test/storage/menu-items/g2.jpg' },
  ],
  variations: [],
}

function renderEdit() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/business-owner/menu/12/edit']}>
        <Routes>
          <Route path="/business-owner/menu/:id/edit" element={<BusinessOwnerMenuEdit />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const photos = () => within(screen.getByRole('list', { name: 'More photos and videos' }))
const pick = (files: File[]) =>
  act(async () => { fireEvent.change(screen.getByTestId('gallery-input'), { target: { files } }) })
const jpg = (name: string, size = 10) => {
  const f = new File(['x'], name, { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

beforeEach(() => {
  api.get.mockReset()
  api.put.mockReset()
  api.get.mockImplementation((url: string) =>
    Promise.resolve(url === '/business-owner/menu/12' ? ITEM : { data: [{ id: 3, name: 'Best Sellers' }] }))
  api.put.mockResolvedValue(ITEM)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((f: File) => `blob:${f.name}`), revokeObjectURL: vi.fn() }))
})

describe('Edit Menu Item: more photos', () => {
  it('shows the existing extra photos with a count', async () => {
    renderEdit()
    expect(await screen.findByAltText('Photo 2 of Pork/Chicken Sisig')).toHaveAttribute('src', ITEM.gallery[0]!.url)
    expect(screen.getByAltText('Photo 3 of Pork/Chicken Sisig')).toBeInTheDocument()
    expect(screen.getByTestId('gallery-count')).toHaveTextContent('2 / 7')
    expect(screen.getByTestId('gallery-input')).toHaveAttribute('multiple')
  })

  it('adds several photos, removes one, and saves both changes with the form', async () => {
    renderEdit()
    await screen.findByAltText('Photo 2 of Pork/Chicken Sisig')

    await pick([jpg('side.jpg'), jpg('close-up.jpg')])
    expect(photos().getByAltText('New photo: side.jpg')).toBeInTheDocument()
    expect(photos().getByAltText('New photo: close-up.jpg')).toBeInTheDocument()
    fireEvent.click(photos().getByRole('button', { name: 'Remove photo 2' }))
    // The removed photo is gone; the next one moves up to 'Photo 2'.
    expect(photos().getAllByRole('img').map((i) => i.getAttribute('src'))).not.toContain(ITEM.gallery[0]!.url)
    expect(photos().getByAltText('Photo 2 of Pork/Chicken Sisig')).toHaveAttribute('src', ITEM.gallery[1]!.url)
    expect(screen.getByTestId('gallery-count')).toHaveTextContent('3 / 7')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save Changes/ })) })
    await waitFor(() => expect(api.put).toHaveBeenCalled())

    const [url, body] = api.put.mock.calls[0] as [string, FormData]
    expect(url).toBe('/business-owner/menu/12')
    expect(body.getAll('gallery_images[]').map((f) => (f as File).name)).toEqual(['side.jpg', 'close-up.jpg'])
    expect(body.getAll('remove_gallery[]')).toEqual(['menu-items/g1.jpg'])
  })

  it('rejects wrong types and big files, and stops at 7 extra photos', async () => {
    renderEdit()
    await screen.findByAltText('Photo 2 of Pork/Chicken Sisig')

    await pick([new File(['x'], 'menu.pdf', { type: 'application/pdf' })])
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG or WebP')
    await pick([jpg('huge.jpg', 6 * 1024 * 1024)])
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 5 MB')

    // 2 existing + 6 picked: only 5 fit.
    await pick(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => jpg(`${n}.jpg`)))
    expect(screen.getByTestId('gallery-count')).toHaveTextContent('7 / 7')
    expect(screen.getByRole('alert')).toHaveTextContent('up to 7 more photos')
    expect(photos().queryByRole('button', { name: 'Add photos or videos' })).not.toBeInTheDocument()
  })

  it('accepts short videos (up to 20 MB) and previews them as videos', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(url === '/business-owner/menu/12'
        ? { ...ITEM, gallery: [{ path: 'menu-items/sizzle.mp4', url: 'http://api.test/storage/menu-items/sizzle.mp4', type: 'video' }] }
        : { data: [{ id: 3, name: 'Best Sellers' }] }))
    renderEdit()

    // An existing video shows as a video thumbnail with a "Video" tag.
    expect(await screen.findByLabelText('Video 2 of Pork/Chicken Sisig')).toHaveProperty('tagName', 'VIDEO')
    expect(photos().getByText('Video')).toBeInTheDocument()
    expect(screen.getByTestId('gallery-input').getAttribute('accept')).toContain('video/mp4')

    const clip = new File(['x'], 'plating.mp4', { type: 'video/mp4' })
    Object.defineProperty(clip, 'size', { value: 15 * 1024 * 1024 })
    const tooLong = new File(['x'], 'long.mp4', { type: 'video/mp4' })
    Object.defineProperty(tooLong, 'size', { value: 21 * 1024 * 1024 })
    await pick([clip, tooLong])

    expect(photos().getByLabelText('New video: plating.mp4')).toHaveProperty('tagName', 'VIDEO')
    expect(screen.getByRole('alert')).toHaveTextContent('"long.mp4" is larger than 20 MB')
    expect(screen.getByTestId('gallery-count')).toHaveTextContent('2 / 7')
  })

  it('warns and blocks saving when new files exceed what one save can carry (~38 MB)', async () => {
    renderEdit()
    await screen.findByAltText('Photo 2 of Pork/Chicken Sisig')
    const big = (n: string) => {
      const f = new File(['x'], n, { type: 'video/mp4' })
      Object.defineProperty(f, 'size', { value: 19 * 1024 * 1024 })
      return f
    }
    await pick([big('one.mp4'), big('two.mp4'), big('three.mp4')])

    expect(screen.getByTestId('gallery-too-large')).toHaveTextContent('more than 38 MB')
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeDisabled()
  })
})
