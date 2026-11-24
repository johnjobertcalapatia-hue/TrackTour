import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Eye, EyeOff, Globe2, Heart, Megaphone, MessageCircle, MoreHorizontal, Pencil, Percent, Send, Store, Trash2, Users } from 'lucide-react'
import { apiErrorMessage, del, get, patch } from '@/shared/services/api'
import { Modal } from '@/shared/components/Modal'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import PostMedia from '@/shared/components/posts/PostMedia'
import PostCaption from '@/shared/components/posts/PostCaption'
import { compactCount, plural, postedAgo, postedAt } from '@/shared/components/posts/post-types'
import { toAssetUrl } from '@/shared/utils'
import { useBusinessPortal } from '../../services/business-portal'
import type { DishSaleSummary, OwnerPost } from '../../services/promotions'
import OwnerPostComments from './OwnerPostComments'

interface PostPage {
  data: OwnerPost[]
  meta?: { current_page: number; last_page: number; total: number }
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Drafts' },
  { key: 'hidden', label: 'Hidden' },
] as const
type Filter = (typeof FILTERS)[number]['key']

const STATUS_PILL: Record<OwnerPost['status'], string> = {
  published: 'bg-[#EAF6ED] text-[#16803C]',
  hidden: 'bg-[#F1F3F2] text-[#56615B]',
  draft: 'bg-[#FFF3C4] text-[#7A5600]',
}
const STATUS_LABEL: Record<OwnerPost['status'], string> = { published: 'Published', hidden: 'Hidden', draft: 'Draft' }

/**
 * The business's posts as a social feed (as tourists see them) with the
 * owner's tools: a ⋯ menu to edit, publish/hide, view insights or delete.
 * Right column: the running sale, popular posts and followers.
 */
export default function PostsPanel() {
  const portal = useBusinessPortal()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState<OwnerPost | null>(null)
  const [error, setError] = useState('')
  const business = portal.businessId ? `&business_id=${portal.businessId}` : ''

  const { data, isLoading } = useQuery({
    queryKey: ['bo-posts', portal.prefix, portal.businessId, filter, page],
    queryFn: () => get<PostPage>(`${portal.prefix}/posts?page=${page}&perPage=10${business}${filter === 'all' ? '' : `&status=${filter}`}`),
    placeholderData: (previous) => previous,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['bo-posts'] })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'published' | 'hidden' }) => patch(`${portal.prefix}/posts/${id}/status`, { status }),
    onSuccess: refresh,
    onError: (e) => setError(apiErrorMessage(e, 'Could not change the post. Please try again.')),
  })
  const remove = useMutation({
    mutationFn: (id: number) => del(`${portal.prefix}/posts/${id}`),
    onSuccess: () => { setDeleting(null); refresh() },
    onError: (e) => setError(apiErrorMessage(e, 'Could not delete the post. Please try again.')),
  })

  if (isLoading) return <DashboardSkeleton />
  const posts = data?.data ?? []
  const lastPage = data?.meta?.last_page ?? 1

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,760px)_minmax(300px,360px)]">
      <section aria-label="Your posts" className="min-w-0 space-y-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show posts">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setPage(1) }}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${filter === f.key ? 'bg-[#0F4D2B] text-white' : 'border border-[#D7E8DB] bg-[#fff] text-[#2F4A3A] hover:bg-[#F3F8F4]'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {posts.length === 0 ? (
          <div className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-10 text-center">
            <Megaphone className="mx-auto mb-3 h-10 w-10 text-[#9CA3AF]" aria-hidden="true" />
            <p className="font-semibold text-[#17201B]">{filter === 'all' ? 'No posts yet' : `No ${FILTERS.find((f) => f.key === filter)!.label.toLowerCase()} posts`}</p>
            <p className="mt-1 text-sm text-[#647067]">Post a photo of today’s special or a short video of your place.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-5">
            {posts.map((p) => (
              <li key={p.id}>
                <OwnerPostCard
                  post={p}
                  onToggle={() => setStatus.mutate({ id: p.id, status: p.status === 'published' ? 'hidden' : 'published' })}
                  onDelete={() => setDeleting(p)}
                  busy={setStatus.isPending}
                />
              </li>
            ))}
          </ul>
        )}

        {lastPage > 1 && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <button type="button" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page === 1} className="rounded-lg border border-[#E2E8E3] px-3 py-1.5 disabled:opacity-40">Previous</button>
            <span className="text-[#5E6B63]">Page {page} of {lastPage}</span>
            <button type="button" onClick={() => setPage((n) => Math.min(lastPage, n + 1))} disabled={page === lastPage} className="rounded-lg border border-[#E2E8E3] px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        )}
      </section>

      <PostsSidebar />

      <Modal show={deleting !== null} onClose={() => setDeleting(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="mb-2 text-lg font-semibold text-[#17201B]">Delete this post?</h3>
          <p className="mb-6 text-sm text-[#647067]">The post, its photos or video, likes, comments and saves are removed for good. To take it down for now, hide it instead.</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setDeleting(null)} className="rounded-xl border border-[#D7E8DB] px-4 py-2 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4]">Cancel</button>
            <button type="button" onClick={() => deleting && remove.mutate(deleting.id)} disabled={remove.isPending} className="rounded-xl bg-[#B42318] px-4 py-2 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50">
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function OwnerPostCard({ post, onToggle, onDelete, busy }: { post: OwnerPost; onToggle: () => void; onDelete: () => void; busy: boolean }) {
  const portal = useBusinessPortal()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [showComments, setShowComments] = useState(false)
  const businessName = post.business?.name ?? post.business_name ?? 'Your business'
  const base = `${portal.prefix}/promotions/posts/${post.id}`

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menu])

  const item = 'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[#17201B] hover:bg-[#F3F8F4]'

  return (
    <article className="overflow-hidden rounded-[20px] border border-[#E2E8E3] bg-[#fff] shadow-[0_6px_18px_rgba(22,101,52,0.06)]" aria-label={`Post from ${postedAgo(post.published_at ?? post.created_at)}`}>
      <header className="flex items-start gap-3 px-5 pt-5">
        {post.business?.logo
          ? <img src={toAssetUrl(post.business.logo)} alt="" className="h-11 w-11 shrink-0 rounded-full border border-[#E5E9E7] object-cover" />
          : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><Store className="h-5 w-5" aria-hidden="true" /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[16px] font-bold text-[#17201B]">{businessName}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL[post.status]}`}>{STATUS_LABEL[post.status]}</span>
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-[#56615B]">
            {post.published_at
              ? <time dateTime={post.published_at} title={postedAt(post.published_at)}>{postedAgo(post.published_at)}</time>
              : <span>Draft · created {postedAgo(post.created_at)}</span>}
            {post.status === 'published' && <><span aria-hidden="true">·</span><Globe2 className="h-3.5 w-3.5" aria-label="Public" /></>}
          </p>
        </div>
        <div ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Post options" aria-haspopup="menu" aria-expanded={menu}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#56615B] hover:bg-[#F3F8F4]">
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-10 z-20 w-48 overflow-hidden rounded-xl border border-[#E2E8E3] bg-[#fff] py-1 shadow-xl">
              <button type="button" role="menuitem" className={item} onClick={() => navigate(`${base}/edit`)}><Pencil className="h-4 w-4" aria-hidden="true" /> Edit post</button>
              <button type="button" role="menuitem" className={item} disabled={busy} onClick={() => { setMenu(false); onToggle() }}>
                {post.status === 'published' ? <><EyeOff className="h-4 w-4" aria-hidden="true" /> Hide post</> : post.status === 'draft' ? <><Send className="h-4 w-4" aria-hidden="true" /> Publish now</> : <><Eye className="h-4 w-4" aria-hidden="true" /> Unhide post</>}
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => navigate(`${base}/insights`)}><BarChart3 className="h-4 w-4" aria-hidden="true" /> View insights</button>
              <button type="button" role="menuitem" className={`${item} text-[#B42318]`} onClick={() => { setMenu(false); onDelete() }}><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete post</button>
            </div>
          )}
        </div>
      </header>

      <PostCaption text={post.caption} className="px-5 pt-3 text-[15px] leading-relaxed text-[#17201B]" />
      {post.media.length > 0 && <div className="mt-4"><PostMedia media={post.media} businessName={businessName} /></div>}
      {post.sale && (
        <p className="mx-5 mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#FFF3C4] px-3 py-1 text-xs font-bold text-[#7A5600]">
          <Percent className="h-3.5 w-3.5" aria-hidden="true" /> {post.sale.label} · {post.sale.title}{post.sale.status !== 'active' ? ` (${post.sale.status === 'scheduled' ? 'scheduled' : 'ended'})` : ''}
        </p>
      )}

      <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2EF] py-3 text-[13px] text-[#56615B]">
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E0245E]"><Heart className="h-3 w-3 fill-white text-white" aria-hidden="true" /></span>
          {plural(post.likes_count, 'like')}
        </span>
        <span className="flex flex-wrap gap-x-3">
          <span>{plural(post.comments_count, 'comment')}</span>
          <span>{plural(post.shares_count, 'share')}</span>
          <span>{plural(post.saves_count, 'save')}</span>
          <span>{plural(post.views_count, 'view')}</span>
        </span>
      </div>
      <div className="flex border-t border-[#EEF2EF]">
        <Link to={`${base}/insights`} className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-semibold text-[#16803C] hover:bg-[#F3F8F4]">
          <BarChart3 className="h-4 w-4" aria-hidden="true" /> View insights
        </Link>
        <button type="button" onClick={() => setShowComments((v) => !v)} aria-expanded={showComments}
          className="flex flex-1 items-center justify-center gap-2 border-l border-[#EEF2EF] py-2.5 text-sm font-semibold text-[#16803C] hover:bg-[#F3F8F4]">
          <MessageCircle className="h-4 w-4" aria-hidden="true" /> Comment
        </button>
        <Link to={`${base}/edit`} className="flex flex-1 items-center justify-center gap-2 border-l border-[#EEF2EF] py-2.5 text-sm font-semibold text-[#16803C] hover:bg-[#F3F8F4]">
          <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
        </Link>
      </div>
      {showComments && (
        <div className="border-t border-[#EEF2EF] px-5 py-4">
          <OwnerPostComments postId={post.id} businessName={businessName} businessLogo={post.business?.logo} autoFocus />
        </div>
      )}
    </article>
  )
}

/** Right column: the running sale, the most-viewed posts and the follower count (all real data). */
function PostsSidebar() {
  const portal = useBusinessPortal()
  const business = portal.businessId ? `business_id=${portal.businessId}` : ''
  const sales = useQuery({
    queryKey: ['bo-dish-sales', portal.prefix, portal.businessId],
    queryFn: () => get<DishSaleSummary[]>(`${portal.prefix}/dish-sales${business ? `?${business}` : ''}`),
  })
  const popular = useQuery({
    queryKey: ['bo-posts', portal.prefix, portal.businessId, 'popular'],
    queryFn: () => get<PostPage>(`${portal.prefix}/posts?sort=popular&perPage=3${business ? `&${business}` : ''}`),
  })
  const followers = useQuery({
    queryKey: ['bo-post-followers', portal.prefix, portal.businessId],
    queryFn: () => get<{ followers: number }>(`${portal.prefix}/posts/followers${business ? `?${business}` : ''}`),
  })
  const running = (sales.data ?? []).find((s) => s.status === 'active')
  const top = (popular.data?.data ?? []).filter((p) => p.views_count > 0 || p.likes_count > 0)

  return (
    <aside className="space-y-5 xl:sticky xl:top-4" aria-label="Deals and posts summary">
      {running && (
        <section className="rounded-[20px] border border-[#DCEBDF] bg-gradient-to-br from-[#EEF7F0] to-[#FFFBEA] p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#16803C] text-white"><Percent className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-[#17201B]">Special offer running</h2>
              <p className="truncate text-sm text-[#3B4540]">{running.label} on {running.dishes.length} {running.dishes.length === 1 ? 'dish' : 'dishes'} · {running.title}</p>
            </div>
          </div>
          <Link to={`${portal.prefix}/promotions?tab=sales`} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#F4B400] px-4 py-2 text-sm font-bold text-[#17201B] hover:bg-[#E0A600]">View sales</Link>
        </section>
      )}

      <section className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5">
        <h2 className="mb-4 text-lg font-bold text-[#17201B]">Popular posts</h2>
        {top.length === 0 ? (
          <p className="text-sm text-[#5E6B63]">Views and likes from tourists will show your most popular posts here.</p>
        ) : (
          <ul className="divide-y divide-[#EEF2EF]">
            {top.map((p) => {
              const cover = p.media[0]
              return (
                <li key={p.id}>
                  <Link to={`${portal.prefix}/promotions/posts/${p.id}/insights`} className="flex items-center gap-3 py-2.5 hover:bg-[#F8FBF8]">
                    <span className="h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-[#F3F8F4]">
                      {cover?.type === 'image' && <img src={toAssetUrl(cover.path)} alt="" className="h-full w-full object-cover" />}
                      {cover?.type === 'video' && <video src={toAssetUrl(cover.path)} preload="metadata" muted className="h-full w-full object-cover" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-semibold text-[#17201B]">{p.caption || 'Untitled post'}</span>
                      <span className="mt-0.5 flex gap-3 text-xs text-[#5E6B63]">
                        <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> {compactCount(p.views_count)}</span>
                        <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" aria-hidden="true" /> {compactCount(p.likes_count)}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex items-center gap-3 rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EAF6ED] text-[#16803C]"><Users className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <p className="text-2xl font-bold tabular-nums text-[#17201B]">{compactCount(followers.data?.followers ?? 0)}</p>
          <p className="text-sm text-[#5E6B63]">{(followers.data?.followers ?? 0) === 1 ? 'follower' : 'followers'}</p>
        </div>
      </section>
    </aside>
  )
}
