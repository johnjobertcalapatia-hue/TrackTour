import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bookmark, Check, Globe2, Heart, MessageCircle, Plus, Share2, Store, Tag } from 'lucide-react'
import { SalePrice } from '@/shared/components/SalePrice'
import PostMedia from '@/shared/components/posts/PostMedia'
import PostCaption from '@/shared/components/posts/PostCaption'
import { compactCount, plural, postedAgo, postedAt, type FeedPost } from '@/shared/components/posts/post-types'
import { toAssetUrl } from '@/shared/utils'
import { usePostActions, useTrackView } from './post-actions'
import PostComments from './PostComments'

export type { FeedPage, FeedPost } from '@/shared/components/posts/post-types'

const endsOn = (iso: string | null | undefined) => (iso
  ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }).format(new Date(iso))
  : '')

/**
 * A business post in the tourist feed, laid out like a Facebook post: header
 * (business, Follow, date, Public), caption with See more, the photos or video
 * at full width, the engagement summary (recorded counts only) and the action
 * bar (Like, Comment, Save, Share). Clicking a photo opens the media viewer.
 */
export default function PostCard({ post }: { post: FeedPost }) {
  const navigate = useNavigate()
  const { isTourist, like, save, follow, share, notice } = usePostActions(post)
  const viewRef = useTrackView(post.id)
  const [showComments, setShowComments] = useState(false)
  const businessName = post.business?.name ?? 'Business'
  const runningSale = post.sale?.status === 'active' ? post.sale : null
  const loginHint = 'Log in as a tourist to do this'

  const action = 'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[15px] font-semibold transition disabled:cursor-default disabled:opacity-60'

  return (
    <article ref={(el) => { viewRef.current = el }} className="min-w-0 overflow-hidden rounded-[20px] border border-[#E5E9E7] bg-[#fff] shadow-[0_6px_18px_rgba(23,32,27,0.06)]" aria-label={`Post by ${businessName}`}>
      <header className="flex items-start gap-3 px-5 pt-5">
        <Link to={`/tourist/explore/${post.business_id}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
          {post.business?.logo
            ? <img src={toAssetUrl(post.business.logo)} alt="" className="h-11 w-11 rounded-full border border-[#E5E9E7] object-cover" />
            : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><Store className="h-5 w-5" /></span>}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/tourist/explore/${post.business_id}`} className="truncate text-[16px] font-bold text-[#17201B] hover:underline">{businessName}</Link>
            {isTourist && (
              <button
                type="button"
                onClick={() => follow.mutate(!post.business?.following)}
                disabled={follow.isPending}
                aria-pressed={!!post.business?.following}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold transition ${post.business?.following ? 'bg-[#EAF6ED] text-[#16803C]' : 'bg-[#087F3F] text-white hover:bg-[#066B35]'}`}
              >
                {post.business?.following ? <><Check className="h-3 w-3" aria-hidden="true" /> Following</> : <><Plus className="h-3 w-3" aria-hidden="true" /> Follow</>}
              </button>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-[#56615B]">
            <time dateTime={post.published_at ?? undefined} title={postedAt(post.published_at)}>{postedAgo(post.published_at)}</time>
            <span aria-hidden="true">·</span>
            <Globe2 className="h-3.5 w-3.5" aria-label="Public" />
          </p>
        </div>
        {runningSale && <span className="shrink-0 rounded-full bg-[#FFF3C4] px-2.5 py-1 text-xs font-bold text-[#7A5600]">{runningSale.label}</span>}
      </header>

      <PostCaption text={post.caption} className="px-5 pt-3 text-[15px] leading-relaxed text-[#17201B]" />

      {post.media.length > 0 && (
        <div className="mt-4">
          <PostMedia media={post.media} businessName={businessName} autoPlay onOpen={(i) => navigate(`/tourist/posts/${post.id}?photo=${i}`)} />
        </div>
      )}

      {runningSale && runningSale.kind === 'item_sale' && (runningSale.dishes?.length ?? 0) > 0 && (
        <div className="mx-5 mt-4 rounded-2xl border border-[#F2D58A] bg-[#FFFBEA] p-4">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[#17201B]">
            <Tag className="h-4 w-4 text-[#B7791F]" aria-hidden="true" /> {runningSale.title}
            {runningSale.ends_at && <span className="font-normal text-[#56615B]">· until {endsOn(runningSale.ends_at)}</span>}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {runningSale.dishes!.slice(0, 4).map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                {d.image ? <img src={toAssetUrl(d.image)} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-lg bg-[#F3F8F4]" />}
                <span className="min-w-0 flex-1 truncate text-[#17201B]">{d.name}</span>
                <SalePrice price={d.price} original_price={d.original_price} sale={d.sale} className="font-bold text-[#087F3F]" compact />
              </li>
            ))}
          </ul>
          <Link to={`/tourist/food/${post.business_id}`} className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-[#F4B400] px-4 py-2 text-sm font-bold text-[#17201B] hover:bg-[#E0A600]">
            Shop the deal
          </Link>
        </div>
      )}
      {post.sale?.kind === 'item_sale' && (post.sale.status === 'ended' || post.sale.status === 'stopped') && (
        <p className="mx-5 mt-4 rounded-xl bg-[#F1F3F2] px-3 py-2 text-xs text-[#56615B]">This sale has ended.</p>
      )}

      {/* Engagement summary: recorded counts only */}
      <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF2EF] pb-2.5 text-[13px] text-[#56615B]">
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E0245E]"><Heart className="h-3 w-3 fill-white text-white" aria-hidden="true" /></span>
          {compactCount(post.likes_count)}<span className="sr-only"> likes</span>
        </span>
        <span className="flex flex-wrap gap-x-3">
          <button type="button" onClick={() => setShowComments((v) => !v)} className="hover:underline">{plural(post.comments_count, 'comment')}</button>
          <span>{plural(post.shares_count, 'share')}</span>
          <span>{plural(post.views_count, 'view')}</span>
        </span>
      </div>

      {/* Action bar */}
      <div className="flex gap-1 px-3 py-1.5">
        <button type="button" onClick={() => like.mutate(!post.liked)} disabled={!isTourist || like.isPending} aria-pressed={!!post.liked} title={isTourist ? undefined : loginHint}
          className={`${action} ${post.liked ? 'text-[#E0245E]' : 'text-[#3B4540] hover:bg-[#F3F8F4]'}`}>
          <Heart className={`h-5 w-5 ${post.liked ? 'fill-current' : ''}`} aria-hidden="true" /> {post.liked ? 'Liked' : 'Like'}
        </button>
        <button type="button" onClick={() => setShowComments((v) => !v)} aria-expanded={showComments} className={`${action} text-[#3B4540] hover:bg-[#F3F8F4]`}>
          <MessageCircle className="h-5 w-5" aria-hidden="true" /> Comment
        </button>
        <button type="button" onClick={() => save.mutate(!post.saved)} disabled={!isTourist || save.isPending} aria-pressed={!!post.saved} title={isTourist ? undefined : loginHint}
          className={`${action} ${post.saved ? 'text-[#087F3F]' : 'text-[#3B4540] hover:bg-[#F3F8F4]'}`}>
          <Bookmark className={`h-5 w-5 ${post.saved ? 'fill-current' : ''}`} aria-hidden="true" /> {post.saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" onClick={() => void share()} className={`${action} text-[#3B4540] hover:bg-[#F3F8F4]`}>
          <Share2 className="h-5 w-5" aria-hidden="true" /> Share
        </button>
      </div>
      {notice && <p role="status" className="px-5 pb-2 text-center text-xs font-semibold text-[#087F3F]">{notice}</p>}

      {showComments && (
        <div className="border-t border-[#EEF2EF] px-5 py-4">
          <PostComments postId={post.id} />
        </div>
      )}
    </article>
  )
}
