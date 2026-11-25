import { describe, expect, it } from 'vitest'
import { buildOwnerNav, pageBelongsTo, type OwnerNavBusiness } from '@/features/business-owner/navigation/owner-nav'

/**
 * The owner sidebar loads the modules of the switcher's business type:
 * restaurant, resort or tourist attraction (module lists as seeded for those
 * categories).
 */
const RESTAURANT: OwnerNavBusiness = {
  id: 2, name: 'Ekslusibo Grill', category: 'Restaurant',
  module_codes: ['business_profile', 'staff_management', 'promotions', 'customer_reviews', 'reports', 'expenses', 'menu_management', 'food_categories', 'food_ordering', 'pos_sales', 'kitchen_orders', 'operational_reports', 'gallery'],
}
const RESORT: OwnerNavBusiness = {
  id: 7, name: 'RJM Beach Resort', category: 'Resort',
  module_codes: ['business_profile', 'staff_management', 'promotions', 'customer_reviews', 'reports', 'expenses', 'room_management', 'reservation_management', 'cottage_management', 'facility_management', 'gallery'],
}
const ATTRACTION: OwnerNavBusiness = {
  id: 8, name: 'Batong Buwaya River', category: 'Tourist Attraction',
  module_codes: ['business_profile', 'staff_management', 'promotions', 'customer_reviews', 'expenses', 'facility_management', 'gallery', 'booking_requests'],
}
const ALL = [RESTAURANT, RESORT, ATTRACTION]

const labels = (id: number | null, list = ALL) => buildOwnerNav(list, id).flatMap((s) => s.items.map((i) => i.label))
const sectionNames = (id: number | null, list = ALL) => buildOwnerNav(list, id).map((s) => s.label)

const RESTAURANT_ONLY = ['Orders', 'POS & Sales', 'Kitchen Display System', 'Menu Items', 'Menu Categories', 'Operational Reports']
const RESORT_ONLY = ['Reservations', 'Cottages & Offerings', 'Resort Types & Facilities']
const ATTRACTION_ONLY = ['Attraction Details', 'Visitor Reviews']
const SHARED = ['Dashboard', 'My Businesses', 'Business Profile', 'Business Gallery', 'Staff Management', 'User Roles & Permissions', 'Notifications']
const FINANCE = ['Payment Tracking', 'Vendor & Expenses', 'Payment Methods']

describe('owner sidebar by business type', () => {
  it('restaurant: restaurant modules only', () => {
    const l = labels(2)
    for (const x of [...SHARED, ...FINANCE, ...RESTAURANT_ONLY, 'Deals & Posts', 'Reports & Analytics']) expect(l).toContain(x)
    for (const x of [...RESORT_ONLY, ...ATTRACTION_ONLY]) expect(l).not.toContain(x)
  })

  it('resort: resort modules only', () => {
    const l = labels(7)
    for (const x of [...SHARED, ...FINANCE, ...RESORT_ONLY, 'Deals & Posts']) expect(l).toContain(x)
    for (const x of [...RESTAURANT_ONLY, ...ATTRACTION_ONLY]) expect(l).not.toContain(x)
    expect(sectionNames(7)).toContain('Resort')
  })

  it('tourist attraction: attraction modules only, details link to this attraction', () => {
    const nav = buildOwnerNav(ALL, 8)
    const l = nav.flatMap((s) => s.items.map((i) => i.label))
    for (const x of [...SHARED, ...ATTRACTION_ONLY, 'Deals & Posts']) expect(l).toContain(x)
    for (const x of [...RESTAURANT_ONLY, ...RESORT_ONLY, 'Reports & Analytics', 'Payment Tracking', 'Vendor & Expenses', 'Payment Methods']) expect(l).not.toContain(x)
    expect(nav.map((s) => s.label)).not.toContain('Finance')
    expect(nav.flatMap((s) => s.items).find((i) => i.label === 'Attraction Details')?.to).toBe('/business-owner/businesses/8/tourist-attraction-edit')
  })

  it('the production "Attractions" category gets the attraction modules', () => {
    expect(labels(8, [{ ...ATTRACTION, category: 'Attractions' }])).toEqual(expect.arrayContaining(ATTRACTION_ONLY))
  })

  it('a module switched off hides its item', () => {
    const noPromos = { ...RESORT, module_codes: RESORT.module_codes!.filter((c) => c !== 'promotions') }
    expect(labels(7, [noPromos])).not.toContain('Deals & Posts')
  })

  it('"All Businesses": every type present, each labelled, no item twice', () => {
    const nav = buildOwnerNav(ALL, null)
    // Finance stays: the restaurant and resort have it, even though the attraction does not.
    expect(nav.flatMap((s) => s.items.map((i) => i.label))).toEqual(expect.arrayContaining(FINANCE))
    const l = nav.flatMap((s) => s.items.map((i) => `${i.to}|${i.label}`))
    expect(new Set(l).size).toBe(l.length)
    const names = nav.map((s) => s.label)
    expect(names).toContain('Restaurant — Menu')
    expect(names).toContain('Resort')
    expect(names).toContain('Attraction')
  })

  it('a hotel keeps its own rooms section', () => {
    expect(labels(9, [{ id: 9, category: 'Hotel', module_codes: ['room_management', 'reservation_management', 'promotions'] }])).toEqual(expect.arrayContaining(['Room Management', 'Reservations', 'Deals & Posts']))
  })
})

describe('switching business leaves pages the new type does not have', () => {
  it('a restaurant page is left when switching to a resort; shared pages stay', () => {
    const resortNav = buildOwnerNav(ALL, 7)
    expect(pageBelongsTo(resortNav, '/business-owner/menu', 7)).toBe(false)
    expect(pageBelongsTo(resortNav, '/business-owner/orders/15', 7)).toBe(false)
    expect(pageBelongsTo(resortNav, '/business-owner/resort/offerings/new', 7)).toBe(true)
    expect(pageBelongsTo(resortNav, '/business-owner/promotions/posts/new', 7)).toBe(true)
    expect(pageBelongsTo(resortNav, '/business-owner/account-settings', 7)).toBe(true)
    expect(pageBelongsTo(resortNav, '/business-owner/staff/3', 7)).toBe(true)
  })

  it('pages about another business are left, except the gallery (it follows the switcher)', () => {
    const nav = buildOwnerNav(ALL, 2)
    expect(pageBelongsTo(nav, '/business-owner/businesses/8/tourist-attraction-edit', 2)).toBe(false)
    expect(pageBelongsTo(nav, '/business-owner/businesses/8/gallery', 2)).toBe(true)
    expect(pageBelongsTo(nav, '/business-owner/businesses/2/edit', 2)).toBe(true)
  })

  it('an attraction leaves reports it does not have', () => {
    expect(pageBelongsTo(buildOwnerNav(ALL, 8), '/business-owner/reports', 8)).toBe(false)
  })
})
