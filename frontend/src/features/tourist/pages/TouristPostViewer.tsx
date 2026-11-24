import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bookmark, Eye, Heart, Link2, MessageCircle, MoreHorizontal, Share2, Store, Tag, X } from 'lucide-react'
import { get } from '@/shared/services/api'
import { SalePrice } from '@/shared/components/SalePrice'
import PostMedia from '@/shared/components/posts/PostMedia'
import PostCaption from '@/shared/components/posts/PostCaption'
import { compactCount, plural, postLink, postedAgo, postedAt, type FeedPost } from '@/shared/components/posts/post-types'
import { toAssetUrl } from '@/shared/utils'
import { usePostActions, useTrackView } from '@/features/tourist/components/posts/post-actions'
import PostComments from '@/features/tourist/components/posts/PostComments'

/**
 * Full-screen media viewer for one post (/tourist/posts/:id, also the link a
 * share copies). Top: back, business, date, more. Centre: the photo or video,
 * never cropped. Right: Heart, Comment, Save, Share (in that order) with their
 * counts. Bottom: business, full caption, views, the linked sale and
 * "Shop the deal". Opening it reports a view (counted by the server's rule).
 */
export default function TouristPostViewer() {
  const { id } = useParams()
  const postId = Number(id)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [photo, setPhoto] = useState(Number(params.get('photo') ?? 0) || 0)
  const [commentsOpen, setCommentsOpen] = useState(params.get('comments') === '1')
  const [menuOpen, setMenuOpen] = useState(false)

  const query = useQuery({
    queryKey: ['tourist-post', postId],
    queryFn: () => get<FeedPost>(`/tourist/posts/${postId}`),
    enabled: Number.isFinite(postId),
    retry: false,
  })
  useTrackView(postId, true)

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/tourist/explore'))

  if (query.isLoading) {
    return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black text-white/70">Loading post…</div>
  }
  if (!query.data) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <p className="text-lg font-semibold">This post is no longer available.</p>
        <Link to="/tourist/explore" className="rounded-xl bg-[#087F3F] px-4 py-2 text-sm font-semibold">See Deals &amp; Posts</Link>
      </div>
    )
  }

  return <Viewer post={query.data} photo={photo} setPhoto={setPhoto} commentsOpen={commentsOpen} setCommentsOpen={setCommentsOpen} menuOpen={menuOpen} setMenuOpen={setMenuOpen} onBack={back} />
}

function Viewer({ post, photo, setPhoto, commentsOpen, setCommentsOpen, menuOpen, setMenuOpen, onBack }: {
  post: FeedPost
  photo: number
  setPhoto: (i: number) => void
  commentsOpen: boolean
  setCommentsOpen: (v: boolean) => void
  menuOpen: boolean
  setMenuOpen: (v: boolean) => void
  onBack: () => void
}) {
  const { isTourist, like, save, share, notice } = usePostActions(post)
  const businessName = post.business?.name ?? 'Business'
  const runningSale = post.sale?.status === 'active' ? post.sale : null
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (commentsOpen ? setCommentsOpen(false) : onBack()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commentsOpen, onBack, setCommentsOpen])

  const tool = 'flex flex-col items-center gap-1 text-white disabled:opacity-60'
  const circle = 'flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25'

  return (
    <div className="fixed inset-0 z-[60] flex bg-black text-white" role="dialog" aria-modal="true" aria-label={`Post by ${businessName}`}>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Top */}
        <div className="flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
          <button ref={closeRef} type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          {post.business?.logo
            ? <img src={toAssetUrl(post.business.logo)} alt="" className="h-9 w-9 rounded-full object-cover" />
            : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0F4D2B]"><Store className="h-4 w-4" aria-hidden="true" /></span>}
          <div className="min-w-0 flex-1">
            <Link to={`/tourist/explore/${post.business_id}`} className="block truncate font-semibold hover:underline">{businessName}</Link>
            <time className="text-xs text-white/70" dateTime={post.published_at ?? undefined} title={postedAt(post.published_at)}>{postedAgo(post.published_at)}</time>
          </div>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="More options" aria-expanded={menuOpen} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15">
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-11 z-10 w-52 overflow-hidden rounded-xl bg-[#fff] py-1 text-sm text-[#17201B] shadow-xl">
                <button type="button" role="menuitem" onClick={() => { void navigator.clipboard?.writeText(postLink(post.id)); setMenuOpen(false) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[#F3F8F4]">
                  <Link2 className="h-4 w-4" aria-hidden="true" /> Copy link
                </button>
                <Link role="menuitem" to={`/tourist/explore/${post.business_id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-[#F3F8F4]">
                  <Store className="h-4 w-4" aria-hidden="true" /> View business
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Media + right toolbar */}
        <div className="relative min-h-0 flex-1">
          {post.media.length > 0 ? (
            <PostMedia media={post.media} businessName={businessName} variant="viewer" index={photo} onIndexChange={setPhoto} autoPlay />
          ) : (
            <div className="flex h-full items-center justify-center px-8">
              <PostCaption text={post.caption} full className="max-w-2xl text-center text-2xl font-semibold leading-relaxed" />
            </div>
          )}

          <div className="absolute bottom-6 right-3 flex flex-col items-center gap-5 sm:right-5" aria-label="Post actions">
            <button type="button" className={tool} onClick={() => like.mutate(!post.liked)} disabled={!isTourist || like.isPending} aria-pressed={!!post.liked} title={isTourist ? undefined : 'Log in as a tourist to like'}>
              <span className={circle}><Heart className={`h-6 w-6 ${post.liked ? 'fill-[#E0245E] text-[#E0245E]' : ''}`} aria-hidden="true" /></span>
              <span className="text-xs font-semibold">{compactCount(post.likes_count)}<span className="sr-only"> likes, {post.liked ? 'liked' : 'like'}</span></span>
            </button>
            <button type="button" className={tool} onClick={() => setCommentsOpen(!commentsOpen)} aria-expanded={commentsOpen}>
              <span className={circle}><MessageCircle className="h-6 w-6" aria-hidden="true" /></span>
              <span className="text-xs font-semibold">{compactCount(post.comments_count)}<span className="sr-only"> comments, open comments</span></span>
            </button>
            <button type="button" className={tool} onClick={() => save.mutate(!post.saved)} disabled={!isTourist || save.isPending} aria-pressed={!!post.saved} title={isTourist ? undefined : 'Log in as a tourist to save'}>
              <span className={circle}><Bookmark className={`h-6 w-6 ${post.saved ? 'fill-[#F4B400] text-[#F4B400]' : ''}`} aria-hidden="true" /></span>
              <span className="text-xs font-semibold">{compactCount(post.saves_count)}<span className="sr-only"> saves, {post.saved ? 'saved' : 'save'}</span></span>
            </button>
            <button type="button" className={tool} onClick={() => void share()}>
              <span className={circle}><Share2 className="h-6 w-6" aria-hidden="true" /></span>
              <span className="text-xs font-semibold">{compactCount(post.shares_count)}<span className="sr-only"> shares, share</span></span>
            </button>
          </div>
          {notice && <p role="status" className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-[#fff] px-3 py-1 text-xs font-semibold text-[#087F3F]">{notice}</p>}
        </div>

        {/* Bottom */}
        <div className="max-h-[40vh] overflow-y-auto bg-gradient-to-t from-black via-black/90 to-black/70 px-4 pb-5 pt-3 sm:px-6">
          <p className="font-semibold">{businessName}</p>
          {post.media.length > 0 && <PostCaption text={post.caption} className="mt-1 max-w-3xl text-sm leading-relaxed text-white/90" />}
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/70"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> {plural(post.views_count, 'view')}</p>

          {runningSale && (
            <div className="mt-3 max-w-3xl rounded-2xl bg-white/10 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Tag className="h-4 w-4 text-[#F4B400]" aria-hidden="true" /> {runningSale.title} <span className="rounded-full bg-[#F4B400] px-2 py-0.5 text-[11px] font-bold text-[#17201B]">{runningSale.label}</span></p>
              {(runningSale.dishes?.length ?? 0) > 0 && (
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {runningSale.dishes!.slice(0, 4).map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <SalePrice price={d.price} original_price={d.original_price} sale={d.sale} className="font-bold text-[#7EE2A8]" compact />
                    </li>
                  ))}
                </ul>
              )}
              {runningSale.kind === 'item_sale' && (
                <Link to={`/tourist/food/${post.business_id}`} className="mt-3 inline-flex items-center justify-center rounded-xl bg-[#F4B400] px-4 py-2 text-sm font-bold text-[#17201B] hover:bg-[#E0A600]">Shop the deal</Link>
              )}
            </div>
          )}
        </div>
      </div>

      {commentsOpen && (
        <aside className="absolute inset-x-0 bottom-0 z-20 flex max-h-[70vh] flex-col rounded-t-2xl bg-[#121815] lg:static lg:max-h-none lg:w-[380px] lg:rounded-none lg:border-l lg:border-white/10" aria-label="Comments panel">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="font-semibold">Comments ({compactCount(post.comments_count)})</h2>
            <button type="button" onClick={() => setCommentsOpen(false)} aria-label="Close comments" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <PostComments postId={post.id} dark autoFocus />
          </div>
        </aside>
      )}
    </div>
  )
}
