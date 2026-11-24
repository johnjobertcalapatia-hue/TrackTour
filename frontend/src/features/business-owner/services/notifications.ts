import { Bell, ClipboardList, MessageSquare, Star, Wrench, type LucideIcon } from 'lucide-react'

/** Notification tabs; keys match the server's NotificationCategory. */
export type NotificationTab = 'all' | 'orders' | 'messages' | 'reviews' | 'system'
export type NotificationCategory = Exclude<NotificationTab, 'all'> | 'other'

export const NOTIFICATION_TABS: { key: NotificationTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'orders', label: 'Orders & Bookings' },
  { key: 'messages', label: 'Messages & Concerns' },
  { key: 'reviews', label: 'Reviews & Ratings' },
  { key: 'system', label: 'System' },
]

export const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  orders: ClipboardList,
  messages: MessageSquare,
  reviews: Star,
  system: Wrench,
  other: Bell,
}

export interface OwnerNotification {
  id: number
  type: string
  category: NotificationCategory
  title: string
  message: string
  read_at: string | null
  created_at: string
  has_detail: boolean
}

export type UnreadCounts = Record<NotificationTab, number>

export interface NotificationList {
  data: OwnerNotification[]
  meta?: { current_page: number; last_page: number; total: number; unread_counts?: UnreadCounts }
}

export interface ConversationSummary {
  id: number
  order_id: number | null
  order_number: string | null
  order_status: string | null
  business_id: number | null
  business_name: string | null
  customer_name: string
  last_message: string | null
  last_message_at: string | null
  last_message_mine: boolean
  unread: number
}

export interface SystemNoticeSummary {
  id: number
  title: string
  message: string
  audience: string
  audience_label: string
  starts_at: string
  ends_at: string
  status: 'scheduled' | 'in_progress' | 'ended' | 'cancelled'
  recipients_count: number
  cancelled_at: string | null
  created_at: string
}

export type NotificationSubject =
  | {
      kind: 'order'
      id: number
      order_number: string
      status: string
      customer_name: string | null
      order_type: string | null
      payment_method: string | null
      payment_status: string | null
      created_at: string | null
      items: { name: string; quantity: number; subtotal: number }[]
      items_total: number
      shared_with_other_restaurants: boolean
      link: string
    }
  | {
      kind: 'booking'
      id: number
      booking_number: string
      status: string
      customer_name: string | null
      business_name: string | null
      check_in_date: string | null
      check_out_date: string | null
      total_amount: number
      link: string
    }
  | (ConversationSummary & {
      kind: 'conversation'
      recent: { id: number; message: string; is_mine: boolean; created_at: string | null }[]
      link: string
    })
  | {
      kind: 'review'
      business_id: number
      business_name: string | null
      customer_name: string
      order_number: string | null
      restaurant: { rating: number; comment: string | null; created_at: string | null } | null
      dishes: { name: string; rating: number; comment: string | null; images: string[]; created_at: string | null }[]
      link: string
    }
  | (SystemNoticeSummary & { kind: 'system_notice' })

export const NOTICE_STATUS_LABEL: Record<SystemNoticeSummary['status'], string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  ended: 'Ended',
  cancelled: 'Cancelled',
}

/** "Saturday, Nov 28, 2026, 10:00 PM" in Philippine time, the platform's clock. */
export function formatManila(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export const statusLabel = (status: string) => status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
