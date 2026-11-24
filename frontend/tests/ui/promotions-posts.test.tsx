import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Deals & Posts (Facebook-style feed), frontend: the owner page (Posts and
 * Sales tabs, ⋯ menu, popular posts, followers), the post form (photo/video
 * rules, drafts), the tourist post card (Follow, Like, Comment, Save, Share,
 * view tracking) and the full-screen media viewer.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  ...api,
  API_BASE_URL: 'http://localhost/api',
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}))
vi.mock('recharts', async (orig) => {
  const mod = await orig<typeof import('recharts')>()
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 600, height: 200 }}>{children}</div> }
})

import BusinessOwnerPromotions from '@/features/business-owner/pages/BusinessOwnerPromotions'
import BusinessOwnerPostForm from '@/features/business-owner/pages/BusinessOwnerPostForm'
import BusinessOwnerPostInsights from '@/features/business-owner/pages/BusinessOwnerPostInsights'
import PostCard from '@/features/tourist/components/posts/PostCard'
import TouristPostViewer from '@/features/tourist/pages/TouristPostViewer'
import { resetReportedViews } from '@/features/tourist/components/posts/post-actions'
import type { FeedPost } from '@/shared/components/posts/post-types'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'
import type { User } from '@/shared/types'

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' })
const TOURIST: User = { id: 9, name: 'T', email: 't@test.com', role: 'tourist', account_status: 'approved', email_verified_at: null, created_at: '', updated_at: '' }

let location = ''
function Probe() { location = `${useLocation().pathname}${useLocation().search}`; return null }

const OWNER_POST = {
  id: 1, business_id: 7, business_name: 'Ekslusibo Grill', business: { id: 7, name: 'Ekslusibo Grill', logo: null },
  caption: 'Sarap ng ating Grilled BBQ!', status: 'published', media: [], likes_count: 1200, comments_count: 86, saves_count: 324, shares_count: 157,
  views_count: 24500, unique_viewers_count: 9000, sale: null, published_at: '2026-11-22T02:00:00Z', created_at: '2026-11-22T02:00:00Z',
}

const FEED_POST: FeedPost = {
  id: 11, business_id: 7, business: { id: 7, name: 'Ekslusibo Grill', logo: null, category: 'Restaurant', following: false },
  caption: 'Weekend deal '.repeat(30).trim(),
  media: [{ id: 1, type: 'image', path: 'businesses/posts/7/a.jpg', url: '' }, { id: 2, type: 'image', path: 'businesses/posts/7/b.jpg', url: '' }],
  likes_count: 2, comments_count: 1, saves_count: 0, shares_count: 3, views_count: 1500, liked: false, saved: false,
  published_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  sale: { id: 3, kind: 'item_sale', title: 'Weekend Sale', label: '25% off', status: 'active', ends_at: '2026-11-29T15:59:59Z',
    dishes: [{ id: 1, name: 'Sisig', image: null, business_id: 7, price: 150, original_price: 200, sale: { id: 3, title: 'Weekend Sale', label: '25% off', ends_at: '2026-11-29T15:59:59Z' } }] },
}

beforeEach(() => {
  vi.clearAllMocks()
  resetReportedViews()
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
  useBusinessOwnerStore.setState({ businesses: [{ id: 7, name: 'Ekslusibo Grill', category: 'Restaurant', status: 'approved', logo: null }], selectedBusinessId: 7 })
})
afterEach(() => useAuthStore.setState({ user: null, loading: false }))

describe('owner: Deals & Posts page', () => {
  beforeEach(() => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/posts/followers')) return { followers: 42 }
      if (url.includes('sort=popular')) return { data: [OWNER_POST], meta: { current_page: 1, last_page: 1, total: 1 } }
      if (url.includes('/posts')) return { data: [OWNER_POST, { ...OWNER_POST, id: 2, status: 'draft', caption: 'Coming soon', published_at: null, likes_count: 0, views_count: 0 }], meta: { current_page: 1, last_page: 1, total: 2 } }
      if (url.includes('/dish-sales')) return [{ id: 3, business_id: 7, business_name: 'Ekslusibo Grill', title: 'Weekend Sale', description: null, discount_type: 'percentage', discount_value: 20, label: '20% off', starts_at: '2026-11-23T02:00:00Z', ends_at: '2026-11-29T15:59:59Z', status: 'active', dishes: [{ id: 1, name: 'Sisig', image: null, price: 200, sale_price: 160 }] }]
      if (url.includes('/promotions')) return { data: [] }
      return {}
    })
    api.patch.mockResolvedValue({})
  })

  const renderPage = () => render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/business-owner/promotions']}><Probe /><BusinessOwnerPromotions /></MemoryRouter>
    </QueryClientProvider>,
  )

  it('shows posts like a feed with recorded counts, a ⋯ menu, popular posts and followers', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Deals & Posts' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Create Post/ })).toHaveAttribute('href', '/business-owner/promotions/posts/new')
    expect(screen.getByRole('link', { name: /Create Sale/ })).toHaveAttribute('href', '/business-owner/promotions/sales/new')
    expect(screen.getByRole('tab', { name: /Posts/ })).toHaveAttribute('aria-selected', 'true')

    const feed = await screen.findByRole('region', { name: 'Your posts' })
    const first = within(feed).getAllByRole('article')[0]!
    expect(within(first).getByText('Sarap ng ating Grilled BBQ!')).toBeInTheDocument()
    expect(within(first).getByText('1.2K likes')).toBeInTheDocument()
    expect(within(first).getByText('86 comments')).toBeInTheDocument()
    expect(within(first).getByText('157 shares')).toBeInTheDocument()
    expect(within(first).getByText('24K views')).toBeInTheDocument()

    fireEvent.click(within(first).getByRole('button', { name: 'Post options' }))
    const menu = within(first).getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Edit post', 'Hide post', 'View insights', 'Delete post'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hide post' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/business-owner/posts/1/status', { status: 'hidden' }))

    const draft = within(feed).getAllByRole('article')[1]!
    expect(within(draft).getByText('Draft')).toBeInTheDocument()
    fireEvent.click(within(draft).getByRole('button', { name: 'Post options' }))
    expect(within(draft).getByRole('menuitem', { name: 'Publish now' })).toBeInTheDocument()

    const side = screen.getByRole('complementary', { name: 'Deals and posts summary' })
    expect(await within(side).findByText('Special offer running')).toBeInTheDocument()
    expect(within(side).getByText('42')).toBeInTheDocument()
    expect(within(side).getByRole('link', { name: /Sarap ng ating Grilled BBQ/ })).toHaveAttribute('href', '/business-owner/promotions/posts/1/insights')
  })

  it('Sales tab holds the sales and the badges', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /Sales/ }))
    expect(await screen.findByText('Weekend Sale')).toBeInTheDocument()
    expect(await screen.findByText('No badges yet.')).toBeInTheDocument()
    expect(location).toBe('/business-owner/promotions?tab=sales')
  })
})

describe('owner: post form', () => {
  const renderForm = () => render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/business-owner/promotions/posts/new']}>
        <Routes>
          <Route path="/business-owner/promotions/posts/new" element={<BusinessOwnerPostForm />} />
          <Route path="/business-owner/promotions" element={<p>Deals list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  beforeEach(() => {
    api.get.mockResolvedValue([])
    api.post.mockResolvedValue({ id: 5 })
  })

  it('allows at most 10 photos and never photos with a video', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: Array.from({ length: 11 }, (_, i) => photo(`p${i}.jpg`)) } })
    expect(screen.getByRole('alert')).toHaveTextContent('A post can have at most 10 photos.')
    fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: [photo('a.jpg'), photo('b.jpg')] } })
    expect(screen.getAllByRole('img', { name: /New photo/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Add a video/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Choose a video'), { target: { files: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('either photos or one video')
  })

  it('saves a draft with its photos', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Sisig 25% off!' } })
    fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: [photo('a.jpg')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const [url, body, config] = api.post.mock.calls[0]!
    expect(url).toBe('/business-owner/posts')
    expect((body as FormData).get('status')).toBe('draft')
    expect((body as FormData).getAll('photos[]')).toHaveLength(1)
    expect(config).toMatchObject({ timeout: 0 })
    expect(await screen.findByText('Deals list')).toBeInTheDocument()
  })

  it('refuses an empty post before uploading', () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write a caption or add a photo or video.')
    expect(api.post).not.toHaveBeenCalled()
  })
})

describe('owner: post insights', () => {
  it('shows recorded totals, views per day and lets the owner hide a comment', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/insights')) {
        return {
          post: OWNER_POST,
          totals: { views: 120, unique_viewers: 80, likes: 30, comments: 4, hidden_comments: 1, saves: 6, shares: 2 },
          daily_views: [{ date: '2026-11-23', views: 50 }, { date: '2026-11-24', views: 70 }],
          followers: 12,
        }
      }
      if (url.includes('/comments')) return { data: [{ id: 5, body: 'Sarap!', author: { name: 'Maria S.', avatar: null }, mine: false, hidden: false, created_at: '2026-11-24T01:00:00Z' }], meta: { current_page: 1, last_page: 1 } }
      return {}
    })
    api.patch.mockResolvedValue({})
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/business-owner/promotions/posts/1/insights']}>
          <Routes><Route path="/business-owner/promotions/posts/:id/insights" element={<BusinessOwnerPostInsights />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const totals = await screen.findByRole('list', { name: 'Totals' })
    expect(within(totals).getByText('Total views').parentElement).toHaveTextContent('120')
    expect(within(totals).getByText('Unique viewers').parentElement).toHaveTextContent('80')
    expect(within(totals).getByText('1 hidden')).toBeInTheDocument()
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('70')

    fireEvent.click(await screen.findByRole('button', { name: 'Hide comment by Maria S.' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/business-owner/posts/1/comments/5', { hidden: true }))
  })
})

describe('tourist: post card', () => {
  const renderCard = (post: FeedPost = FEED_POST) => render(
    <QueryClientProvider client={client()}>
      <MemoryRouter><Probe /><PostCard post={post} /></MemoryRouter>
    </QueryClientProvider>,
  )

  it('lays the post out like a social feed card', () => {
    renderCard()
    const card = screen.getByRole('article', { name: 'Post by Ekslusibo Grill' })
    expect(within(card).getByText('2 days ago')).toBeInTheDocument()
    expect(within(card).getByLabelText('Public')).toBeInTheDocument()
    // Long caption: See more.
    expect(within(card).getByRole('button', { name: 'See more' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(within(card).getByRole('button', { name: 'See more' }))
    expect(within(card).getByRole('button', { name: 'See less' })).toBeInTheDocument()
    // Summary and action bar.
    expect(within(card).getByText('1 comment')).toBeInTheDocument()
    expect(within(card).getByText('3 shares')).toBeInTheDocument()
    expect(within(card).getByText('1.5K views')).toBeInTheDocument()
    expect(['Like', 'Comment', 'Save', 'Share'].every((n) => within(card).getByRole('button', { name: n }))).toBe(true)
    // Sale.
    expect(within(card).getByRole('link', { name: 'Shop the deal' })).toHaveAttribute('href', '/tourist/food/7')
    // Clicking a photo opens the viewer at that photo.
    fireEvent.click(within(card).getByRole('button', { name: 'Next photo' }))
    fireEvent.click(within(card).getByRole('button', { name: /Open photo 2 of 2/ }))
    expect(location).toBe('/tourist/posts/11?photo=1')
  })

  it('a guest cannot like or save; a tourist can follow, like, save and comment', async () => {
    const { unmount } = renderCard()
    expect(screen.getByRole('button', { name: 'Like' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Follow/ })).toBeNull()
    unmount()

    useAuthStore.setState({ user: TOURIST, loading: false })
    api.post.mockImplementation(async (url: string) => (url.endsWith('/like') ? { likes_count: 3 } : url.endsWith('/save') ? { saves_count: 1 } : url.endsWith('/comments') ? { id: 9, body: 'Yum', author: { name: 'T', avatar: null }, mine: true, created_at: new Date().toISOString(), comments_count: 2 } : {}))
    api.get.mockResolvedValue({ data: [{ id: 8, body: 'Masarap!', author: { name: 'Maria S.', avatar: null }, mine: false, created_at: new Date().toISOString() }], meta: { current_page: 1, last_page: 1 } })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: /Follow/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/businesses/7/follow'))
    fireEvent.click(screen.getByRole('button', { name: 'Like' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/posts/11/like'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/posts/11/save'))

    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Masarap!')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Write a comment'), { target: { value: 'Yum' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/posts/11/comments', { body: 'Yum' }))
  })

  it('share copies the link and records the share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    api.post.mockResolvedValue({ shares_count: 4 })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/tourist/posts/11`))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/posts/11/share', { channel: 'link' }))
    expect(await screen.findByText('Link copied.')).toBeInTheDocument()
  })

  it('reports a view once the post has been half on screen for a second', async () => {
    vi.useFakeTimers()
    let trigger: (visible: boolean) => void = () => {}
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback) { trigger = (v) => cb([{ isIntersecting: v } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    api.post.mockResolvedValue({ counted: true, views_count: 1501 })
    renderCard()

    act(() => { trigger(true); vi.advanceTimersByTime(500); trigger(false); vi.advanceTimersByTime(1000) })
    expect(api.post).not.toHaveBeenCalled()
    act(() => { trigger(true); vi.advanceTimersByTime(1000) })
    expect(api.post).toHaveBeenCalledWith('/tourist/posts/11/view')
    expect(api.post).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})

describe('tourist: media viewer', () => {
  it('shows the post with Heart, Comment, Save, Share in that order and reports a view', async () => {
    api.get.mockImplementation(async (url: string) => (url.includes('/comments') ? { data: [], meta: { current_page: 1, last_page: 1 } } : FEED_POST))
    api.post.mockResolvedValue({ counted: true, views_count: 1501 })
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/tourist/posts/11?photo=1']}>
          <Routes><Route path="/tourist/posts/:id" element={<TouristPostViewer />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Post by Ekslusibo Grill' })
    expect(within(dialog).getByRole('img', { name: 'Photo 2 of 2 from Ekslusibo Grill' })).toBeInTheDocument()
    const actions = within(dialog).getByLabelText('Post actions')
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('likes'), expect.stringContaining('comments'), expect.stringContaining('saves'), expect.stringContaining('shares'),
    ])
    expect(within(dialog).getByRole('link', { name: 'Shop the deal' })).toHaveAttribute('href', '/tourist/food/7')
    expect(within(dialog).getByText('1.5K views')).toBeInTheDocument()
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/posts/11/view'))

    fireEvent.click(within(actions).getAllByRole('button')[1]!)
    expect(await within(dialog).findByRole('complementary', { name: 'Comments panel' })).toBeInTheDocument()
  })
})

describe('post videos: autoplay and loop (tourist side)', () => {
  const VIDEO = [{ id: 1, type: 'video' as const, path: 'businesses/posts/7/clip.mp4', url: '' }]
  let trigger: (visible: boolean) => void = () => {}
  let play: ReturnType<typeof vi.fn>
  let pause: ReturnType<typeof vi.fn>

  beforeEach(() => {
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback) { trigger = (v) => cb([{ isIntersecting: v } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    play = vi.fn(function (this: HTMLVideoElement) { Object.defineProperty(this, 'paused', { value: false, configurable: true }); this.dispatchEvent(new Event('play')); return Promise.resolve() })
    pause = vi.fn(function (this: HTMLVideoElement) { Object.defineProperty(this, 'paused', { value: true, configurable: true }); this.dispatchEvent(new Event('pause')) })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play as unknown as () => Promise<void>)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause as unknown as () => void)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('in the feed: muted, looping, plays on screen, pauses off screen, and respects a tourist pause', async () => {
    const { default: PostMedia } = await import('@/shared/components/posts/PostMedia')
    render(<PostMedia media={VIDEO} businessName="Ekslusibo Grill" autoPlay />)
    const video = screen.getByLabelText('Video from Ekslusibo Grill') as HTMLVideoElement
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
    expect(play).not.toHaveBeenCalled()

    act(() => trigger(true))
    expect(play).toHaveBeenCalledTimes(1)
    act(() => trigger(false))
    expect(pause).toHaveBeenCalledTimes(1)
    act(() => trigger(true))
    expect(play).toHaveBeenCalledTimes(2)

    // The tourist pauses it: scrolling away and back does not restart it.
    act(() => { video.pause() })
    act(() => { trigger(false); trigger(true) })
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('in the viewer: plays with sound, or muted when the browser refuses sound', async () => {
    const { default: PostMedia } = await import('@/shared/components/posts/PostMedia')
    play.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')))
    render(<PostMedia media={VIDEO} businessName="Ekslusibo Grill" variant="viewer" autoPlay />)
    const video = screen.getByLabelText('Video from Ekslusibo Grill') as HTMLVideoElement
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2))
    expect(video.muted).toBe(true)
    expect(video.loop).toBe(true)
  })

  it('does not autoplay with "reduce motion", nor on the owner side', async () => {
    const { default: PostMedia } = await import('@/shared/components/posts/PostMedia')
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const { unmount } = render(<PostMedia media={VIDEO} businessName="Grill" autoPlay />)
    act(() => trigger(true))
    expect(play).not.toHaveBeenCalled()
    unmount()
    vi.unstubAllGlobals()

    render(<PostMedia media={VIDEO} businessName="Grill" />)
    const video = screen.getByLabelText('Video from Grill') as HTMLVideoElement
    expect(video.loop).toBe(false)
    expect(play).not.toHaveBeenCalled()
  })
})

describe('business comments on its own posts', () => {
  it('the owner comments as the business from the post card', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/posts/1/comments')) return { data: [{ id: 5, body: 'Sarap!', author: { name: 'Maria S.', avatar: null, is_business: false }, mine: false, hidden: false, created_at: '2026-11-24T01:00:00Z' }], meta: { current_page: 1, last_page: 1 } }
      if (url.includes('/posts/followers')) return { followers: 0 }
      if (url.includes('/posts')) return { data: [OWNER_POST], meta: { current_page: 1, last_page: 1, total: 1 } }
      return []
    })
    api.post.mockResolvedValue({ id: 6 })
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/business-owner/promotions']}><BusinessOwnerPromotions /></MemoryRouter>
      </QueryClientProvider>,
    )
    const card = (await screen.findAllByRole('article'))[0]!
    fireEvent.click(within(card).getByRole('button', { name: 'Comment' }))
    expect(await within(card).findByText('Sarap!')).toBeInTheDocument()
    const box = within(card).getByLabelText('Comment as Ekslusibo Grill')
    fireEvent.change(box, { target: { value: 'Salamat po!' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/business-owner/posts/1/comments', { body: 'Salamat po!' }))
    expect(within(card).getByRole('button', { name: 'Hide comment by Maria S.' })).toBeInTheDocument()
  })

  it('tourists see the business reply with an Author badge and cannot delete it', async () => {
    useAuthStore.setState({ user: { id: 9, name: 'T', email: 't@test.com', role: 'tourist', account_status: 'approved', email_verified_at: null, created_at: '', updated_at: '' }, loading: false })
    api.get.mockResolvedValue({ data: [{ id: 6, body: 'Salamat po!', author: { name: 'Ekslusibo Grill', avatar: null, is_business: true }, mine: false, created_at: new Date().toISOString() }], meta: { current_page: 1, last_page: 1 } })
    const { default: PostComments } = await import('@/features/tourist/components/posts/PostComments')
    render(<QueryClientProvider client={client()}><MemoryRouter><PostComments postId={11} /></MemoryRouter></QueryClientProvider>)
    const name = await screen.findByText('Ekslusibo Grill')
    expect(name.closest('p')).toHaveTextContent('Author')
    expect(screen.queryByRole('button', { name: 'Delete your comment' })).toBeNull()
  })
})
