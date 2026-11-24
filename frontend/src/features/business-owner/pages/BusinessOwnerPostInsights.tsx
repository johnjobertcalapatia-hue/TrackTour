import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, Bookmark, Eye, Heart, MessageCircle, Pencil, Share2, Users, UsersRound } from 'lucide-react'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { toAssetUrl } from '@/shared/utils'
import { compactCount, postedAgo } from '@/shared/components/posts/post-types'
import OwnerPostComments from '../components/promotions/OwnerPostComments'
import { useBusinessPortal } from '../services/business-portal'
import type { PostInsights } from '../services/promotions'

const BAR = '#1B7F3B'
const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

/**
 * Post insights: recorded views (once per viewer per 30 minutes), unique
 * viewers, likes, comments, saves, shares and followers, views per day for
 * the last 14 days, and the post's comments with Hide / Show / Delete.
 */
export default function BusinessOwnerPostInsights() {
  const { id } = useParams()
  const portal = useBusinessPortal()

  const insights = useQuery({
    queryKey: ['bo-post-insights', portal.prefix, id],
    queryFn: () => get<PostInsights>(`${portal.prefix}/posts/${id}/insights`),
  })
  if (insights.isLoading) return <DashboardSkeleton />
  if (!insights.data) return <p className="text-sm text-[#5E6B63]">This post could not be loaded.</p>
  const { post, totals, daily_views: daily, followers } = insights.data
  const cover = post.media[0]

  const tiles = [
    { label: 'Total views', value: totals.views, icon: Eye, hint: 'Once per viewer every 30 minutes' },
    { label: 'Unique viewers', value: totals.unique_viewers, icon: UsersRound },
    { label: 'Likes', value: totals.likes, icon: Heart },
    { label: 'Comments', value: totals.comments, icon: MessageCircle, hint: totals.hidden_comments ? `${totals.hidden_comments} hidden` : undefined },
    { label: 'Saves', value: totals.saves, icon: Bookmark },
    { label: 'Shares', value: totals.shares, icon: Share2 },
  ]

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Link to={`${portal.prefix}/promotions`} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Deals &amp; Posts
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-[#F3F8F4]">
          {cover?.type === 'image' && <img src={toAssetUrl(cover.path)} alt="" className="h-full w-full object-cover" />}
          {cover?.type === 'video' && <video src={toAssetUrl(cover.path)} preload="metadata" muted className="h-full w-full object-cover" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-[#17201B]">Post insights</h1>
          <p className="line-clamp-2 text-sm text-[#5E6B63]">{post.caption || 'Untitled post'}</p>
          <p className="mt-1 text-xs text-[#5E6B63]">{post.published_at ? `Published ${postedAgo(post.published_at)}` : 'Not published yet'} · {post.status === 'published' ? 'Published' : post.status === 'draft' ? 'Draft' : 'Hidden'}</p>
        </div>
        <Link to={`${portal.prefix}/promotions/posts/${post.id}/edit`} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#D7E8DB] px-4 py-2 text-sm font-semibold text-[#16803C] hover:bg-[#F3F8F4]">
          <Pencil className="h-4 w-4" aria-hidden="true" /> Edit post
        </Link>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Totals">
        {tiles.map((t) => (
          <li key={t.label} className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-[#5E6B63]"><t.icon className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> {t.label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-[#17201B]">{compactCount(t.value)}</p>
            {t.hint && <p className="mt-0.5 text-xs text-[#5E6B63]">{t.hint}</p>}
          </li>
        ))}
      </ul>

      <section className="min-w-0 overflow-hidden rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5" aria-labelledby="views-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="views-heading" className="text-lg font-bold text-[#17201B]">Views per day</h2>
            <p className="text-sm text-[#5E6B63]">Last 14 days (Philippine time)</p>
          </div>
          <p className="flex items-center gap-2 text-sm text-[#5E6B63]"><Users className="h-4 w-4" aria-hidden="true" /> {compactCount(followers)} {followers === 1 ? 'follower' : 'followers'} of your business</p>
        </div>
        <div className="relative h-56 w-full min-w-0">
          <div className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke="#EEF2EF" />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: '#5E6B63' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5E6B63' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#F3F8F4' }} labelFormatter={(v) => dayLabel(String(v))} formatter={(v) => [String(v), 'Views']} />
                <Bar dataKey="views" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <table className="sr-only">
          <caption>Views per day</caption>
          <thead><tr><th>Day</th><th>Views</th></tr></thead>
          <tbody>{daily.map((d) => <tr key={d.date}><td>{dayLabel(d.date)}</td><td>{d.views}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5" aria-labelledby="comments-heading">
        <h2 id="comments-heading" className="text-lg font-bold text-[#17201B]">Comments</h2>
        <p className="mb-4 text-sm text-[#5E6B63]">Reply as your business, hide a comment from tourists (you can show it again), or delete it for good.</p>
        <OwnerPostComments postId={post.id} businessName={post.business?.name ?? post.business_name ?? 'your business'} businessLogo={post.business?.logo} />
      </section>
    </div>
  )
}
