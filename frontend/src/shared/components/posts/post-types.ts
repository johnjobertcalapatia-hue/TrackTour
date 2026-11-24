import type { DishSale } from '@/shared/components/SalePrice'

/**
 * Deals & Posts: the post shape from GET /tourist/posts (tourist) and
 * /{business-owner|staff}/posts (owner). Every count is recorded activity
 * from the server (App\Services\PostEngagement), never a sample figure.
 */
export interface PostSaleDish {
  id: number
  name: string
  image: string | null
  business_id: number
  price: number
  original_price: number | null
  sale: DishSale | null
}

export interface PostSale {
  id: number
  kind: 'label' | 'item_sale'
  title: string
  label: string
  status: 'scheduled' | 'active' | 'ended' | 'stopped'
  ends_at?: string | null
  dishes?: PostSaleDish[]
}

export interface PostMediaItem {
  id: number
  type: 'image' | 'video'
  path: string
  url: string
}

export interface FeedPost {
  id: number
  business_id: number
  business: { id: number; name: string; logo: string | null; category: string | null; following?: boolean } | null
  caption: string | null
  media: PostMediaItem[]
  likes_count: number
  comments_count: number
  saves_count: number
  shares_count: number
  views_count: number
  liked?: boolean
  saved?: boolean
  published_at: string | null
  sale: PostSale | null
}

export interface FeedPage {
  data: FeedPost[]
  meta?: { current_page: number; last_page: number; total: number }
}

export interface PostComment {
  id: number
  body: string
  /** is_business: written by the business itself (shown with an "Author" badge). */
  author: { name: string; avatar: string | null; is_business?: boolean }
  mine: boolean
  hidden?: boolean
  created_at: string
}

/** 1234 → "1.2K", 2_400_000 → "2.4M". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n)
  const [value, unit] = n < 1_000_000 ? [n / 1000, 'K'] : [n / 1_000_000, 'M']
  return `${value >= 10 ? Math.floor(value) : Math.floor(value * 10) / 10}${unit}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${compactCount(n)} ${n === 1 ? one : many}`
}

/** "Just now", "5 min ago", "3 h ago", "2 days ago", then "Nov 20" (Manila). */
export function postedAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  const days = Math.round(minutes / (60 * 24))
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

/** Full date and time for a title tooltip (Manila). */
export function postedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso))
}

export function postLink(id: number): string {
  return `${window.location.origin}/tourist/posts/${id}`
}
