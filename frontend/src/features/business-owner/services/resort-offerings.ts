/**
 * Owner-side resort offering helpers (dynamic resort system, Stage 5).
 * Mirrors the backend rules in ResortOfferingController so the form only
 * offers coherent combinations; the server remains the authority.
 */
export type BookingMode = 'day_use' | 'overnight' | 'time_slot' | 'duration'
export type PricingBasis = 'per_person' | 'per_unit' | 'per_hour' | 'per_night' | 'per_booking'
export type InventoryMode = 'units' | 'capacity' | 'slots'

export interface OwnerOffering {
  id: number
  category: string
  category_label: string
  name: string
  description: string | null
  booking_mode: BookingMode
  pricing_basis: PricingBasis
  price: number
  inventory_mode: InventoryMode
  inventory_quantity: number
  min_guests: number | null
  max_guests: number | null
  min_quantity: number | null
  max_quantity: number | null
  duration_minutes: number | null
  is_required: boolean
  bookable_independently: boolean
  requires_offering_id: number | null
  requires_offering_name: string | null
  is_published: boolean
  sort_order: number
  images: { id: number; path: string }[]
}

export interface OfferingOptions {
  categories: { value: string; label: string }[]
  booking_modes: BookingMode[]
  pricing_bases: PricingBasis[]
  inventory_modes: InventoryMode[]
  max_images: number
}

export const BOOKING_MODE_LABEL: Record<BookingMode, string> = {
  day_use: 'Day use',
  overnight: 'Overnight',
  time_slot: 'Time slot',
  duration: 'Duration-based',
}

export const PRICING_BASIS_LABEL: Record<PricingBasis, string> = {
  per_person: 'Per person',
  per_unit: 'Per unit',
  per_hour: 'Per hour',
  per_night: 'Per night',
  per_booking: 'Per booking',
}

export const INVENTORY_MODE_LABEL: Record<InventoryMode, string> = {
  units: 'Physical units (e.g. 6 cottages)',
  capacity: 'Shared capacity (e.g. 120 pool guests)',
  slots: 'Scheduled slots (per time slot)',
}

/** Pricing units that make sense for a booking mode (backend coherence rules). */
export function pricingBasesFor(mode: BookingMode): PricingBasis[] {
  const base: PricingBasis[] = ['per_person', 'per_unit', 'per_booking']
  if (mode === 'overnight') return [...base, 'per_night']
  if (mode === 'time_slot' || mode === 'duration') return [...base, 'per_hour']
  return base
}

export function inventoryModesFor(mode: BookingMode): InventoryMode[] {
  return mode === 'time_slot' ? ['units', 'capacity', 'slots'] : ['units', 'capacity']
}

export const needsDuration = (mode: BookingMode) => mode === 'time_slot' || mode === 'duration'

export interface OfferingFormValues {
  category: string
  name: string
  description: string
  booking_mode: BookingMode
  pricing_basis: PricingBasis
  price: string
  inventory_mode: InventoryMode
  inventory_quantity: string
  min_guests: string
  max_guests: string
  min_quantity: string
  max_quantity: string
  duration_minutes: string
  is_required: boolean
  bookable_independently: boolean
  requires_offering_id: string
  is_published: boolean
  sort_order: string
}

export const EMPTY_OFFERING: OfferingFormValues = {
  category: 'cottage',
  name: '',
  description: '',
  booking_mode: 'day_use',
  pricing_basis: 'per_unit',
  price: '',
  inventory_mode: 'units',
  inventory_quantity: '1',
  min_guests: '',
  max_guests: '',
  min_quantity: '1',
  max_quantity: '',
  duration_minutes: '',
  is_required: false,
  bookable_independently: true,
  requires_offering_id: '',
  is_published: false,
  sort_order: '0',
}

export function offeringToForm(o: OwnerOffering): OfferingFormValues {
  const s = (v: number | null | undefined) => (v == null ? '' : String(v))
  return {
    category: o.category,
    name: o.name,
    description: o.description ?? '',
    booking_mode: o.booking_mode,
    pricing_basis: o.pricing_basis,
    price: String(o.price),
    inventory_mode: o.inventory_mode,
    inventory_quantity: String(o.inventory_quantity),
    min_guests: s(o.min_guests),
    max_guests: s(o.max_guests),
    min_quantity: s(o.min_quantity ?? 1),
    max_quantity: s(o.max_quantity),
    duration_minutes: s(o.duration_minutes),
    is_required: o.is_required,
    bookable_independently: o.bookable_independently,
    requires_offering_id: s(o.requires_offering_id),
    is_published: o.is_published,
    sort_order: String(o.sort_order ?? 0),
  }
}

/** Multipart body for POST/PUT …/resort-offerings (booleans as 1/0, blanks omitted). */
export function offeringFormData(v: OfferingFormValues, newImages: File[] = [], removeImageIds: number[] = []): FormData {
  const fd = new FormData()
  const put = (k: string, val: string) => { if (val.trim() !== '') fd.append(k, val.trim()) }
  fd.append('category', v.category)
  fd.append('name', v.name.trim())
  put('description', v.description)
  fd.append('booking_mode', v.booking_mode)
  fd.append('pricing_basis', v.pricing_basis)
  fd.append('price', v.price.trim() || '0')
  fd.append('inventory_mode', v.inventory_mode)
  fd.append('inventory_quantity', v.inventory_quantity.trim())
  put('min_guests', v.min_guests)
  put('max_guests', v.max_guests)
  put('min_quantity', v.min_quantity)
  put('max_quantity', v.max_quantity)
  if (needsDuration(v.booking_mode)) put('duration_minutes', v.duration_minutes)
  fd.append('is_required', v.is_required ? '1' : '0')
  fd.append('bookable_independently', v.bookable_independently ? '1' : '0')
  if (!v.bookable_independently) put('requires_offering_id', v.requires_offering_id)
  fd.append('is_published', v.is_published ? '1' : '0')
  put('sort_order', v.sort_order)
  newImages.forEach((f) => fd.append('images[]', f))
  removeImageIds.forEach((id) => fd.append('remove_image_ids[]', String(id)))
  return fd
}

/** Same offering with only "published" flipped (for the list's Publish toggle). */
export function togglePublishedFormData(o: OwnerOffering): FormData {
  return offeringFormData({ ...offeringToForm(o), is_published: !o.is_published })
}

export function priceLabel(o: Pick<OwnerOffering, 'price' | 'pricing_basis'>): string {
  const unit = PRICING_BASIS_LABEL[o.pricing_basis].replace('Per ', '').toLowerCase()
  return o.price > 0 ? `₱${o.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${unit}` : 'Free'
}

/** Laravel 422 → first message per field. */
export function fieldErrors(err: unknown): Record<string, string> {
  const errors = (err as { response?: { data?: { errors?: Record<string, string[]> } } })?.response?.data?.errors ?? {}
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k.replace(/\.\d+$/, ''), v[0] ?? '']))
}
