/**
 * Commission rates (Earnings Stage 1, 2026-11-24 — docs/secure-transaction-audit.md §R).
 * Shared by the Bansud admin page and the municipal office page.
 */

export const TOWN_FIELDS = [
  'ride_driver_percent',
  'ride_driver_minimum',
  'food_system_fee_percent',
  'food_office_percent',
  'fast_platform_percent',
  'fast_rider_percent',
  'fast_office_percent',
  'cashout_fee_percent',
] as const

export const DISTRICT_FIELDS = ['platform_net_percent', 'fast_amount_minimum', 'fast_amount_maximum'] as const

export type TownField = (typeof TOWN_FIELDS)[number]
export type DistrictField = (typeof DISTRICT_FIELDS)[number]
export type RateField = TownField | DistrictField
export type RateSource = 'default' | 'district' | 'town'

export type Rates = Record<RateField, number>

/** Bansud's allowed range for a town's own value (§R5). */
export interface Limit {
  min: number
  max: number
}

export type Limits = Record<TownField, Limit>

export interface EffectiveRates {
  municipality_id: number | null
  rates: Rates
  fast_amount_options: number[]
  sources: Record<RateField, RateSource>
}

export interface DistrictRates extends Omit<EffectiveRates, 'municipality_id'> {
  limits: Limits
}

export type TownOverrides = Record<TownField, number | null>

export interface RateFieldMeta {
  label: string
  unit: '%' | '₱'
  hint: string
}

export const FIELD_META: Record<RateField, RateFieldMeta> = {
  ride_driver_percent: { label: 'Driver share of the fare', unit: '%', hint: 'The driver earns this share of each ride fare.' },
  ride_driver_minimum: { label: 'Driver minimum per ride', unit: '₱', hint: 'The driver never earns less than this on a ride.' },
  food_system_fee_percent: { label: 'System fee added to food', unit: '%', hint: 'Added on top of the food price at checkout.' },
  food_office_percent: { label: 'Office share of food + fee', unit: '%', hint: 'The office keeps this share; the restaurant gets the rest.' },
  fast_platform_percent: { label: 'TrackTour', unit: '%', hint: 'TrackTour share of the Fast Delivery fee.' },
  fast_rider_percent: { label: 'Rider', unit: '%', hint: 'Rider share of the Fast Delivery fee.' },
  fast_office_percent: { label: 'Tourism Office', unit: '%', hint: 'Office share of the Fast Delivery fee.' },
  cashout_fee_percent: { label: 'Online cash-out fee', unit: '%', hint: "Taken from a rider's online cash-out; goes to the rider's town office." },
  platform_net_percent: { label: "TrackTour share of each town's net earnings", unit: '%', hint: "Of each municipality's office commissions minus its recorded expenses, per period. Nothing when net is zero or less." },
  fast_amount_minimum: { label: 'Lowest Fast Delivery amount', unit: '₱', hint: 'The smallest amount a tourist may choose.' },
  fast_amount_maximum: { label: 'Highest Fast Delivery amount', unit: '₱', hint: 'The largest amount a tourist may choose.' },
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Ride: the driver earns max(minimum, percent of fare), never more than the fare; the office gets the exact rest. */
export function rideSplit(fare: number, percent: number, minimum: number) {
  const driver = round2(Math.min(fare, Math.max(minimum, (fare * percent) / 100)))
  return { driver, office: round2(fare - driver) }
}

/** Food: fee on top of the food; office keeps its share of (food + fee); restaurant gets the rest. */
export function foodSplit(food: number, feePercent: number, officePercent: number) {
  const fee = round2((food * feePercent) / 100)
  const base = round2(food + fee)
  const office = round2((base * officePercent) / 100)
  return { fee, base, office, restaurant: round2(base - office) }
}

/** Fast Delivery: TrackTour and rider rounded; the office gets the exact rest. */
export function fastSplit(amount: number, platformPercent: number, riderPercent: number) {
  const platform = round2((amount * platformPercent) / 100)
  const rider = round2((amount * riderPercent) / 100)
  return { platform, rider, office: round2(amount - platform - rider) }
}

export function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatRate(field: RateField, value: number): string {
  return FIELD_META[field].unit === '₱' ? peso(value) : `${Number(value.toFixed(2))}%`
}

export function formatRange(field: RateField, limit: Limit): string {
  return `${formatRate(field, limit.min)}–${formatRate(field, limit.max)}`
}

/** A typed value outside the allowed range (blank or not a number is not flagged here). */
export function outsideLimit(raw: string | undefined, limit: Limit | undefined): boolean {
  if (!limit || raw === undefined || raw === '' || Number.isNaN(Number(raw))) return false
  const n = Number(raw)
  return n < limit.min - 0.0001 || n > limit.max + 0.0001
}

export type LimitDraft = Record<TownField, { min: string; max: string }>

export function limitDraft(limits: Limits): LimitDraft {
  const out = {} as LimitDraft
  for (const field of TOWN_FIELDS) out[field] = { min: String(limits[field].min), max: String(limits[field].max) }
  return out
}

export function limitPayload(draft: LimitDraft): Record<TownField, { min: number | null; max: number | null }> {
  const out = {} as Record<TownField, { min: number | null; max: number | null }>
  for (const field of TOWN_FIELDS) {
    out[field] = {
      min: draft[field].min === '' ? null : Number(draft[field].min),
      max: draft[field].max === '' ? null : Number(draft[field].max),
    }
  }
  return out
}

/** Draft limits as numbers, for the live range hints (an unfinished field keeps the saved value). */
export function limitsFromDraft(draft: LimitDraft, saved: Limits): Limits {
  const out = {} as Limits
  for (const field of TOWN_FIELDS) {
    const num = (raw: string, fallback: number) => (raw === '' || Number.isNaN(Number(raw)) ? fallback : Number(raw))
    out[field] = { min: num(draft[field].min, saved[field].min), max: num(draft[field].max, saved[field].max) }
  }
  return out
}

/** A town's saved overrides as form strings ('' = uses the district default). */
export function townDraft(overrides: TownOverrides): Partial<Record<RateField, string>> {
  const draft: Partial<Record<RateField, string>> = {}
  for (const field of TOWN_FIELDS) draft[field] = overrides[field] === null ? '' : String(overrides[field])
  return draft
}

/** Form strings → the PUT payload for a town (blank → null = use the district default). */
export function townPayload(draft: Partial<Record<RateField, string>>): Record<TownField, number | null> {
  const out = {} as Record<TownField, number | null>
  for (const field of TOWN_FIELDS) {
    const raw = draft[field] ?? ''
    out[field] = raw === '' ? null : Number(raw)
  }
  return out
}

/** Shown on both pages while only the rates (not yet the amounts) use these settings. */
export const STAGE_ONE_NOTICE =
  'Saved rates are recorded with every new order and ride from now on. Amounts charged and paid still follow the current rules until the commission update goes live.'
