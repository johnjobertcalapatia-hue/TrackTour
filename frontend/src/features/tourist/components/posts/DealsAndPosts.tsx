import { Link, useSearchParams } from 'react-router-dom'
import { Bookmark, Newspaper, UserCheck } from 'lucide-react'
import { useAuthStore } from '@/features/auth/services/auth-store'
import PostFeed, { type FeedKind } from './PostFeed'

const FEEDS: { key: FeedKind; label: string; icon: typeof Newspaper; needsLogin: boolean }[] = [
  { key: 'all', label: 'All posts', icon: Newspaper, needsLogin: false },
  { key: 'following', label: 'Following', icon: UserCheck, needsLogin: true },
  { key: 'saved', label: 'Saved', icon: Bookmark, needsLogin: true },
]

/**
 * Deals & Posts, the default Explore view: posts from approved businesses,
 * stacked like a social feed, with All / Following / Saved (?feed=). Following
 * and Saved need a tourist login.
 */
export default function DealsAndPosts() {
  const user = useAuthStore((s) => s.user)
  const isTourist = user?.role === 'tourist'
  const [params, setParams] = useSearchParams()
  const raw = params.get('feed') as FeedKind | null
  const feed: FeedKind = raw && FEEDS.some((f) => f.key === raw) ? raw : 'all'
  const current = FEEDS.find((f) => f.key === feed)!

  return (
    <div className="w-full max-w-[680px] space-y-5">
      <div role="tablist" aria-label="Posts feed" className="flex gap-2 overflow-x-auto pb-1">
        {FEEDS.map((f) => {
          const active = f.key === feed
          return (
            <button key={f.key} type="button" role="tab" aria-selected={active} onClick={() => setParams(f.key === 'all' ? {} : { feed: f.key }, { replace: true })}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${active ? 'bg-[#0F4D2B] text-white' : 'border border-[#D7E8DB] bg-[#fff] text-[#2F4A3A] hover:bg-[#F3F8F4]'}`}>
              <f.icon className="h-4 w-4" aria-hidden="true" /> {f.label}
            </button>
          )
        })}
      </div>

      {current.needsLogin && !isTourist ? (
        <div className="rounded-[20px] border border-[#E5E9E7] bg-[#fff] p-10 text-center">
          <p className="text-[#56615B]"><Link to="/login" className="font-semibold text-[#087F3F] hover:underline">Log in</Link> as a tourist to see {feed === 'saved' ? 'your saved posts' : 'posts from businesses you follow'}.</p>
        </div>
      ) : (
        <PostFeed
          key={feed}
          feed={feed}
          perPage={8}
          align="start"
          emptyText={feed === 'saved' ? 'You have not saved any posts yet.' : feed === 'following' ? 'Follow a business to see its posts here.' : 'No posts yet.'}
        />
      )}
    </div>
  )
}
