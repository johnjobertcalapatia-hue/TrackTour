import type { ResortOfferingItem } from './ResortDetail'

/** One chosen offering in the reservation builder. */
export interface LineChoice {
  quantity: number
  /** People staying in unit offerings (cottages, rooms). */
  guests?: number
  /** Start time for time-slot offerings. */
  slot?: string
}

export type Choices = Record<number, LineChoice>

/** GET /tourist/resorts/{id}/availability (Stage 6). */
export interface AvailabilityCalendar {
  closed_dates: string[]
  offerings: {
    id: number
    capacity: number
    booking_mode: string
    dates: { date: string; available: number; blocked: boolean; closed: boolean; slots?: { slot: string; available: number }[] }[]
  }[]
}

/** Today in the Philippines, YYYY-MM-DD. */
export function manilaDate(offsetDays = 0, now: Date = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const usesPeople = (o: ResortOfferingItem) => o.inventory_mode !== 'units'

/** Highest quantity that may be chosen (the server checks again). */
export function maxQuantity(o: ResortOfferingItem & { max_quantity?: number | null }, available: number | null): number {
  const cap = o.max_quantity ?? o.inventory_quantity
  return Math.max(0, Math.min(cap, available ?? cap))
}

/**
 * Lowest availability over the dates an offering would use (one date for day
 * use, each night for overnight), or the slot's for time slots. null = unknown.
 */
export function availableFor(calendar: AvailabilityCalendar | undefined, offeringId: number, slot?: string): number | null {
  const row = calendar?.offerings.find((o) => o.id === offeringId)
  if (!row || row.dates.length === 0) return null
  if (row.booking_mode === 'time_slot') {
    if (!slot) return Math.max(...row.dates[0]!.slots?.map((s) => s.available) ?? [0])
    return row.dates[0]!.slots?.find((s) => s.slot === slot)?.available ?? 0
  }
  const days = row.booking_mode === 'overnight' ? row.dates : row.dates.slice(0, 1)
  return Math.min(...days.map((d) => d.available))
}

/** The request lines for the quote / reservation. */
export function toLines(choices: Choices, offerings: ResortOfferingItem[]) {
  return offerings
    .filter((o) => (choices[o.id]?.quantity ?? 0) > 0)
    .map((o) => {
      const c = choices[o.id]!
      return {
        offering_id: o.id,
        quantity: c.quantity,
        ...(usesPeople(o) ? {} : { guests: c.guests }),
        ...(o.booking_mode === 'time_slot' ? { slot: c.slot } : {}),
      }
    })
}

/** Default choice when an offering is picked: 1 unit (with the party), or the whole party for per-person places. */
export function defaultChoice(o: ResortOfferingItem, guests: number): LineChoice {
  if (usesPeople(o)) return { quantity: Math.max(1, Math.min(guests, o.max_guests ?? guests)) }
  return { quantity: 1, guests: Math.max(1, Math.min(guests, o.max_guests ?? guests)) }
}
