import { formatCurrency } from '@/shared/utils'

/** A running dish sale, as the tourist APIs send it (Promotions Part A). */
export interface DishSale {
  id: number
  title: string
  label: string
  ends_at: string
}

/** Price fields the tourist APIs add to a dish: `price` is what the tourist pays now. */
export interface SalePriced {
  price: number | string
  original_price?: number | string | null
  sale?: DishSale | null
}

export function isOnSale(item: SalePriced): boolean {
  return item.sale != null && item.original_price != null && Number(item.original_price) > Number(item.price)
}

interface Props extends SalePriced {
  /** Classes for the price the tourist pays (size and colour come from the page). */
  className?: string
  /** Hide the "25% off" chip where space is tight. */
  compact?: boolean
  /** Price multiplier (e.g. quantity) for totals. */
  quantity?: number
}

/**
 * The price a tourist pays, with the menu price struck through and the sale
 * chip while a dish sale runs. The price itself always comes from the server.
 */
export function SalePrice({ price, original_price, sale, className = 'font-extrabold text-[#087F3F]', compact = false, quantity = 1 }: Props) {
  const now = Number(price) * quantity
  if (!isOnSale({ price, original_price, sale })) {
    return <span className={className}>{formatCurrency(now)}</span>
  }
  const was = Number(original_price) * quantity

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className={className}>
        <span className="sr-only">Sale price </span>{formatCurrency(now)}
      </span>
      <s className="text-[0.8em] font-medium text-[#56615B]">
        <span className="sr-only">was </span>{formatCurrency(was)}
      </s>
      {!compact && (
        <span className="rounded-full bg-[#FDECEC] px-1.5 py-0.5 text-[11px] font-bold leading-none text-[#B42318]" title={sale!.title}>
          {sale!.label}
        </span>
      )}
    </span>
  )
}
