/**
 * Promotions module (owner & Menu & Promotions staff): dish sales (Part A),
 * posts (Part B) and the older label-only badges. Shapes match
 * BusinessOwnerSaleController / BusinessOwnerPostController.
 */

import type { PostMediaItem, PostSale } from '@/shared/components/posts/post-types'

/** Business types with a menu: dish sales only make sense for these. */
export const FOOD_CATEGORIES = ['Restaurant', 'Café', 'Food Hub', 'Food Hub / Food Park', 'Hotel & Restaurant Combination']

/**
 * Whether the business (or, with none chosen, any of the businesses) sells
 * food. Resorts and tourist attractions get Posts + Deals instead of dish
 * sales. An unknown category keeps the food layout (the earlier behaviour).
 */
export function sellsFood(businesses: { id: number; category?: string }[], businessId: number | null): boolean {
  const list = businessId != null ? businesses.filter((b) => b.id === businessId) : businesses
  if (list.length === 0) return true
  return list.some((b) => !b.category || FOOD_CATEGORIES.includes(b.category))
}

export type SaleStatus = 'scheduled' | 'active' | 'ended' | 'stopped'

export interface DishSaleSummary {
  id: number
  business_id: number
  business_name: string | null
  title: string
  description: string | null
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  label: string
  starts_at: string
  ends_at: string
  status: SaleStatus
  dishes: { id: number; name: string; image: string | null; price: number; sale_price: number }[]
}

export interface SaleDish {
  id: number
  name: string
  price: number
  image: string | null
  is_available: boolean
  sales: { id: number; title: string; starts_at: string; ends_at: string }[]
}

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  scheduled: 'Scheduled',
  active: 'Running',
  ended: 'Ended',
  stopped: 'Ended early',
}

export const SALE_STATUS_STYLE: Record<SaleStatus, string> = {
  scheduled: 'bg-[#EEF4FF] text-[#2F5BB7]',
  active: 'bg-[#EAF6ED] text-[#16803C]',
  ended: 'bg-[#F1F3F2] text-[#56615B]',
  stopped: 'bg-[#F1F3F2] text-[#56615B]',
}

/** Same rounding as App\Services\SalePricing (display only; the server decides). */
export function previewSalePrice(price: number, type: 'percentage' | 'fixed', value: number): number {
  if (!Number.isFinite(value) || value <= 0) return price
  const raw = type === 'percentage' ? price * (1 - value / 100) : price - value
  return Math.round(raw * 100) / 100
}

const manilaDate = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
const manilaDateTime = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function formatManilaDate(iso: string | null | undefined): string {
  return iso ? manilaDate.format(new Date(iso)) : '—'
}

export function formatManilaDateTime(iso: string | null | undefined): string {
  return iso ? manilaDateTime.format(new Date(iso)) : '—'
}

/** YYYY-MM-DD of an instant in Manila (for date inputs). */
export function manilaDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/* ------------------------------------------------------------------ posts */

export type PostStatus = 'published' | 'hidden' | 'draft'

export type PostMedia = PostMediaItem

/** A post as the owner portal gets it: counts are recorded activity only. */
export interface OwnerPost {
  id: number
  business_id: number
  business_name: string | null
  business: { id: number; name: string; logo: string | null } | null
  caption: string | null
  status: PostStatus
  media: PostMediaItem[]
  likes_count: number
  comments_count: number
  saves_count: number
  shares_count: number
  views_count: number
  unique_viewers_count: number
  sale: PostSale | null
  published_at: string | null
  created_at: string
}

export interface PostInsights {
  post: OwnerPost
  totals: { views: number; unique_viewers: number; likes: number; comments: number; hidden_comments: number; saves: number; shares: number }
  daily_views: { date: string; views: number }[]
  followers: number
}

export const POST_LIMITS = {
  maxPhotos: 10,
  photoMb: 10,
  videoMb: 100,
  captionMax: 2200,
  photoTypes: ['image/jpeg', 'image/png', 'image/webp'],
  videoTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
} as const
