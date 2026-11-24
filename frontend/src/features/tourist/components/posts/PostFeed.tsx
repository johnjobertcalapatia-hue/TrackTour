import { useInfiniteQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { get } from '@/shared/services/api'
import PostCard from './PostCard'
import type { FeedPage } from '@/shared/components/posts/post-types'

export type FeedKind = 'all' | 'following' | 'saved'

interface Props {
  /** Only this business's posts (business page); all businesses otherwise. */
  businessId?: number
  /** all, posts of followed businesses, or the tourist's saved posts. */
  feed?: FeedKind
  perPage?: number
  /** Render nothing when there are no posts (home page, non-restaurant pages). */
  hideWhenEmpty?: boolean
  /** Rendered above the posts when there are some (e.g. a section header). */
  header?: React.ReactNode
  /** Hide "Show more" (home preview links to the full feed instead). */
  noPaging?: boolean
  emptyText?: string
  /** center (home, business pages) or start (Explore, lined up with its tabs). */
  align?: 'center' | 'start'
  className?: string
}

/** Business posts for tourists, stacked like a social feed, newest first. */
export default function PostFeed({ businessId, feed = 'all', perPage = 6, hideWhenEmpty = false, header, noPaging = false, emptyText = 'No posts yet.', align = 'center', className = '' }: Props) {
  const query = useInfiniteQuery({
    queryKey: ['tourist-posts', feed, businessId ?? 'all', perPage],
    queryFn: ({ pageParam }) => get<FeedPage>('/tourist/posts', {
      params: { page: pageParam, perPage, ...(businessId ? { business_id: businessId } : {}), ...(feed !== 'all' ? { feed } : {}) },
    }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last?.meta && last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
  })

  const posts = query.data?.pages.flatMap((p) => p?.data ?? []) ?? []

  if (query.isLoading) {
    return hideWhenEmpty ? null : <p className="py-8 text-center text-sm text-[#56615B]">Loading posts…</p>
  }
  if (posts.length === 0) {
    if (hideWhenEmpty) return null
    return (
      <div className="rounded-[20px] border border-[#E5E9E7] bg-[#fff] p-10 text-center">
        <Megaphone className="mx-auto mb-3 h-10 w-10 text-[#9CA3AF]" aria-hidden="true" />
        <p className="text-[#56615B]">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {header}
      <div className={`flex w-full max-w-[680px] flex-col gap-5 ${align === 'center' ? 'mx-auto' : ''}`}>
        {posts.map((post) => <PostCard key={post.id} post={post} />)}
      </div>
      {!noPaging && query.hasNextPage && (
        <div className={`mt-5 w-full max-w-[680px] text-center ${align === 'center' ? 'mx-auto' : ''}`}>
          <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}
            className="rounded-xl border border-[#D3E6D8] bg-[#fff] px-5 py-2.5 text-sm font-semibold text-[#087F3F] hover:bg-[#F3F8F4] disabled:opacity-60">
            {query.isFetchingNextPage ? 'Loading…' : 'Show more posts'}
          </button>
        </div>
      )}
    </div>
  )
}
