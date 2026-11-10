import { get } from '@/shared/services/api'
import type { FoodCartItem } from '@/shared/services/food-cart'

/** My Orders data (GET /tourist/orders). */
export type TabKey = 'all' | 'to_pay' | 'preparing' | 'in_transit' | 'to_receive' | 'to_review'
export type SectionTab = Exclude<TabKey, 'all'> | 'completed' | 'cancelled'

export interface OrderLine {
  id: number
  order_id: number
  offering_id?: number | null
  name: string
  image: string | null
  restaurant: string | null
  business_id?: number | null
  business_latitude?: number | null
  business_longitude?: number | null
  notes: string | null
  quantity: number
  unit_price: number
  line_total: number
  status: string | null
  /** Buy again / Add to cart: the dish is still on the menu, at current_price. */
  can_order?: boolean
  current_price?: number | null
  reviewed?: boolean
  my_rating?: number | null
}

export interface OrderSection {
  key: string
  reference: string
  primary_order_id: number
  /** The group checkout this order belongs to (multi-restaurant); pay that as a whole. */
  group_order_id?: number | null
  placed_at: string | null
  /** Progress stage, which decides the actions. */
  tab: SectionTab
  /** Every tab the order shows in (a COD order: its progress tab + to_pay). */
  tabs?: SectionTab[]
  /** COD with the cash still due (until delivered). */
  cod_due?: boolean
  status: string
  status_label: string
  payment_method: string | null
  payment_status: string | null
  items: OrderLine[]
  subtotal: number
  delivery_fee: number
  rider_tip: number
  total: number
  rated: boolean
  rider_rated?: boolean
  delivered_at?: string | null
  /** Rider's photo of the delivered food (proof of delivery). */
  delivery_proof_url?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  delivery_address?: string | null
  rider: { name: string; photo: string | null } | null
}

export interface OrdersPayload {
  tab: TabKey
  counts: Record<TabKey, number>
  sections: OrderSection[]
}

export const myOrdersKey = (tab: TabKey) => ['tourist-orders-v2', tab] as const

export function fetchMyOrders(tab: TabKey) {
  return get<OrdersPayload>('/tourist/orders', { params: { tab } })
}

/** The checkout section an order (or one of its group orders) belongs to. */
export function findSection(sections: OrderSection[] | undefined, orderId: number): OrderSection | undefined {
  return sections?.find((s) => s.primary_order_id === orderId || s.items.some((i) => i.order_id === orderId))
}

/** Cart line for "Buy again" / "Add to cart" (today's price), or null if it can't be ordered now. */
export function lineToCartItem(line: OrderLine): Omit<FoodCartItem, 'quantity'> | null {
  if (!line.can_order || !line.offering_id || !line.business_id) return null
  return {
    id: line.offering_id,
    name: line.name,
    price: Number(line.current_price ?? line.unit_price),
    image: line.image,
    business_name: line.restaurant ?? '',
    business_id: line.business_id,
    business_latitude: line.business_latitude ?? null,
    business_longitude: line.business_longitude ?? null,
  }
}
