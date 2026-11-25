import {
  Activity, Archive, BarChart3, BedDouble, Bell, BookOpen, Building2, CalendarCheck, CalendarDays, ChefHat, ClipboardCheck,
  ClipboardList, Compass, CreditCard, DollarSign, Eye, FileBarChart, FileText, Home, Image, LayoutDashboard, MapPin, Megaphone,
  Settings2, Shield, ShoppingCart, Star, Tag, User, UserPlus, UtensilsCrossed, Wallet,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { profileKind, type ProfileKind } from '../services/business-profile-kind'

/**
 * The business owner sidebar, built from the business chosen in the switcher
 * (2026-11-24): every business gets the shared sections (Main, Business,
 * Staff & Access, Finance, Settings, System); on top of those it loads the
 * modules of its own type —
 *
 *  - restaurant: orders, POS, kitchen display, menu, workforce
 *  - resort: reservations, cottages & offerings, resort types & facilities
 *  - tourist attraction: attraction details, visitor reviews
 *  - others (e.g. hotel): their own list, when they have one
 *
 * and Deals & Posts for every type that has the promotions module. Inside each,
 * an item shows only when the business has that module switched on. With "All
 * Businesses" selected, each type present gets its sections, labelled by type.
 */

export interface OwnerNavBusiness {
  id: number
  name?: string
  category?: string
  module_codes?: string[]
}

export interface OwnerNavItem {
  to: string
  label: string
  icon: ReactNode
  /** Shown only when the business has one of these modules. */
  module?: string | string[]
  /** Not shown for these business types (e.g. payment pages for a free attraction). */
  hideFor?: ProfileKind[]
}

export interface OwnerNavSection {
  label?: string
  items: OwnerNavItem[]
}

const icon = (C: typeof Home) => <C className="w-5 h-5" />

const dealsAndPosts: OwnerNavItem = { to: '/business-owner/promotions', label: 'Deals & Posts', icon: icon(Megaphone), module: 'promotions' }

const SHARED_TOP: OwnerNavSection[] = [
  { label: 'Main', items: [
    { to: '/business-owner/dashboard', label: 'Dashboard', icon: icon(LayoutDashboard) },
    { to: '/business-owner/businesses', label: 'My Businesses', icon: icon(Building2) },
    { to: '/business-owner/reports', label: 'Reports & Analytics', icon: icon(BarChart3), module: ['reports', 'earnings_reports'] },
  ]},
  { label: 'Business', items: [
    { to: '/business-owner/profile', label: 'Business Profile', icon: icon(User) },
    { to: '/business-owner/gallery', label: 'Business Gallery', icon: icon(Image) },
    { to: '/business-owner/archive', label: 'Archive Vault', icon: icon(Archive) },
  ]},
]

const SHARED_BOTTOM: OwnerNavSection[] = [
  { label: 'Staff & Access', items: [
    { to: '/business-owner/staff', label: 'Staff Management', icon: icon(UserPlus), module: 'staff_management' },
    { to: '/business-owner/roles', label: 'User Roles & Permissions', icon: icon(Shield), module: 'staff_management' },
  ]},
  { label: 'Finance', items: [
    // Attractions have no Finance section: they take no payments in the app
    // (free entry, no bookings) and keep no vendor expenses here.
    { to: '/business-owner/settings?tab=payments', label: 'Payment Tracking', icon: icon(CreditCard), hideFor: ['attraction'] },
    { to: '/business-owner/expenses', label: 'Vendor & Expenses', icon: icon(CreditCard), module: 'expenses', hideFor: ['attraction'] },
  ]},
  { label: 'Settings', items: [
    { to: '/business-owner/settings?tab=location', label: 'Location', icon: icon(MapPin) },
    { to: '/business-owner/settings?tab=visibility', label: 'Visibility', icon: icon(Eye) },
    { to: '/business-owner/settings?tab=documents', label: 'Documents', icon: icon(FileText) },
    { to: '/business-owner/settings?tab=payment-methods', label: 'Payment Methods', icon: icon(Wallet), hideFor: ['attraction'] },
  ]},
  { label: 'System', items: [
    { to: '/business-owner/activity-logs', label: 'Activity Logs', icon: icon(Activity) },
    { to: '/business-owner/notifications', label: 'Notifications', icon: icon(Bell) },
  ]},
]

/** Each type's own modules. `businessId` is for pages about one business. */
const TYPE_SECTIONS: Record<ProfileKind, (businessId: number) => OwnerNavSection[]> = {
  restaurant: () => [
    { label: 'Orders & Sales', items: [
      { to: '/business-owner/orders', label: 'Orders', icon: icon(ShoppingCart), module: 'food_ordering' },
      { to: '/business-owner/pos', label: 'POS & Sales', icon: icon(CreditCard), module: 'pos_sales' },
      { to: '/business-owner/kitchen', label: 'Kitchen Display System', icon: icon(ChefHat), module: 'kitchen_orders' },
      dealsAndPosts,
    ]},
    { label: 'Menu', items: [
      { to: '/business-owner/menu', label: 'Menu Items', icon: icon(UtensilsCrossed), module: 'menu_management' },
      { to: '/business-owner/offerings/categories', label: 'Menu Categories', icon: icon(Tag), module: 'food_categories' },
    ]},
    { label: 'Workforce', items: [
      { to: '/business-owner/attendance', label: 'Attendance', icon: icon(ClipboardCheck), module: 'attendance' },
      { to: '/business-owner/scheduling', label: 'Employee Scheduling', icon: icon(CalendarDays), module: 'employee_scheduling' },
      { to: '/business-owner/payroll', label: 'Payroll', icon: icon(DollarSign), module: 'payroll' },
    ]},
    { label: 'Operational Reports', items: [
      { to: '/business-owner/operational-reports', label: 'Operational Reports', icon: icon(FileBarChart), module: 'operational_reports' },
    ]},
  ],
  // Setup is gated server-side by Resort category + ownership, not by module.
  resort: () => [
    { label: 'Resort', items: [
      { to: '/business-owner/bookings', label: 'Reservations', icon: icon(CalendarCheck), module: 'reservation_management' },
      { to: '/business-owner/resort/offerings', label: 'Cottages & Offerings', icon: icon(Home) },
      { to: '/business-owner/resort/profile', label: 'Resort Types & Facilities', icon: icon(Settings2) },
      dealsAndPosts,
    ]},
  ],
  attraction: (businessId) => [
    { label: 'Attraction', items: [
      { to: `/business-owner/businesses/${businessId}/tourist-attraction-edit`, label: 'Attraction Details', icon: icon(Compass) },
      { to: '/business-owner/notifications?tab=reviews', label: 'Visitor Reviews', icon: icon(Star), module: 'customer_reviews' },
      dealsAndPosts,
    ]},
  ],
  general: () => [],
}

/** Types without a profile kind of their own that still have their own modules. */
const CATEGORY_SECTIONS: Record<string, OwnerNavSection[]> = {
  Hotel: [
    { label: 'Hotel', items: [
      { to: '/business-owner/offerings', label: 'Room Management', icon: icon(BedDouble), module: 'room_management' },
      { to: '/business-owner/offerings/categories', label: 'Room Categories', icon: icon(Tag), module: 'room_management' },
      { to: '/business-owner/bookings', label: 'Reservations', icon: icon(CalendarCheck), module: ['table_reservations', 'reservation_management'] },
      { to: '/business-owner/bookings', label: 'Check-in / Check-out', icon: icon(ClipboardList), module: 'check_in_out' },
      dealsAndPosts,
    ]},
  ],
}

const GENERAL_FALLBACK: OwnerNavSection[] = [
  { label: 'Operations', items: [
    { to: '/business-owner/bookings', label: 'Bookings', icon: icon(BookOpen), module: ['reservation_management', 'booking_requests'] },
    dealsAndPosts,
  ]},
]

const KIND_LABEL: Record<ProfileKind, string> = { restaurant: 'Restaurant', resort: 'Resort', attraction: 'Attraction', general: '' }

function sectionsForBusiness(b: OwnerNavBusiness): OwnerNavSection[] {
  const kind = profileKind(b.category)
  if (kind !== 'general') return TYPE_SECTIONS[kind](b.id)
  return CATEGORY_SECTIONS[b.category ?? ''] ?? GENERAL_FALLBACK
}

/**
 * Unknown module codes (an older store entry): do not hide by module. A
 * type-hidden item still shows when any business in view is another type.
 */
function allowed(item: OwnerNavItem, codes: string[] | undefined, kinds: ProfileKind[]): boolean {
  if (item.hideFor && kinds.length > 0 && kinds.every((k) => item.hideFor!.includes(k))) return false
  if (!item.module || codes === undefined) return true
  const needed = Array.isArray(item.module) ? item.module : [item.module]
  return needed.some((c) => codes.includes(c))
}

function filterSections(sections: OwnerNavSection[], codes: string[] | undefined, seen: Set<string>, kinds: ProfileKind[]): OwnerNavSection[] {
  const out: OwnerNavSection[] = []
  for (const section of sections) {
    const items = section.items.filter((item) => {
      const key = `${item.to}|${item.label}`
      if (seen.has(key) || !allowed(item, codes, kinds)) return false
      seen.add(key)
      return true
    })
    if (items.length > 0) out.push({ label: section.label, items })
  }
  return out
}

/**
 * The sidebar for the switcher's business (or, with none selected, all of the
 * owner's businesses together).
 */
export function buildOwnerNav(businesses: OwnerNavBusiness[], selectedId: number | null): OwnerNavSection[] {
  const selected = selectedId !== null ? businesses.find((b) => b.id === selectedId) : undefined
  const scope = selected ? [selected] : businesses
  // Shared sections: the business's modules, or any business's for "All".
  const unionCodes = scope.some((b) => b.module_codes === undefined)
    ? undefined
    : [...new Set(scope.flatMap((b) => b.module_codes ?? []))]

  const kinds = [...new Set(scope.map((b) => profileKind(b.category)))]
  const seen = new Set<string>()
  const top = filterSections(SHARED_TOP, unionCodes, seen, kinds)

  const typeSections: OwnerNavSection[] = []
  const typesDone = new Set<string>()
  for (const b of scope) {
    const typeKey = profileKind(b.category) === 'general' ? `cat:${b.category ?? ''}` : profileKind(b.category)
    if (typesDone.has(typeKey)) continue
    typesDone.add(typeKey)
    // "All": a type's modules are those of any business of that type.
    const sameType = scope.filter((x) => (profileKind(x.category) === 'general' ? `cat:${x.category ?? ''}` : profileKind(x.category)) === typeKey)
    const codes = sameType.some((x) => x.module_codes === undefined) ? undefined : [...new Set(sameType.flatMap((x) => x.module_codes ?? []))]
    const label = KIND_LABEL[profileKind(b.category)] || b.category || ''
    for (const section of filterSections(sectionsForBusiness(b), codes, seen, [profileKind(b.category)])) {
      typeSections.push(!selected && label && section.label !== label ? { ...section, label: `${label} — ${section.label}` } : section)
    }
  }

  return [...top, ...typeSections, ...filterSections(SHARED_BOTTOM, unionCodes, seen, kinds)]
}

/** Path part of a nav link (without ?tab=…). */
const pathOf = (to: string) => to.split('?')[0] ?? to

const under = (pathname: string, to: string) => {
  const p = pathOf(to)
  return pathname === p || pathname.startsWith(`${p}/`)
}

/**
 * Pages that only some businesses have: every type's own pages, plus shared
 * pages behind a module. Other pages (dashboard, profile, account, settings,
 * notifications…) suit every business.
 */
const GATED_ROUTES: string[] = [
  ...(['restaurant', 'resort', 'general'] as ProfileKind[]).flatMap((k) => TYPE_SECTIONS[k](0)),
  ...Object.values(CATEGORY_SECTIONS).flat(),
  ...GENERAL_FALLBACK,
  ...SHARED_TOP,
  ...SHARED_BOTTOM,
].flatMap((s) => s.items)
  .filter((item) => item.module || !SHARED_TOP.concat(SHARED_BOTTOM).some((s) => s.items.includes(item)))
  .map((item) => item.to)
  .concat(['/business-owner/food', '/business-owner/tables', '/business-owner/dispatch', '/business-owner/customers'])

/**
 * Whether the page at `pathname` still fits after switching business: a page
 * only another type (or a module this business lacks) has, or a page about
 * another business, is left for the dashboard.
 */
export function pageBelongsTo(sections: OwnerNavSection[], pathname: string, selectedId: number | null): boolean {
  const own = pathname.match(/^\/business-owner\/businesses\/(\d+)(\/.*)?$/)
  if (own && selectedId !== null && Number(own[1]) !== selectedId) {
    // The gallery page moves itself to the selected business.
    return own[2] === '/gallery'
  }
  if (!GATED_ROUTES.some((to) => under(pathname, to))) return true
  return sections.some((s) => s.items.some((item) => under(pathname, item.to)))
}

/**
 * Where to load after switching to business `id`: the same page when the new
 * business has it, otherwise its Dashboard.
 */
export function pageAfterSwitch(businesses: OwnerNavBusiness[], id: number | null, pathname: string, search: string): string {
  return pageBelongsTo(buildOwnerNav(businesses, id), pathname, id) ? `${pathname}${search}` : '/business-owner/dashboard'
}

/** A full page load (switching business reloads everything). Separate so tests can replace it. */
export const fullPageLoad = {
  to(path: string) {
    window.location.assign(path)
  },
}
