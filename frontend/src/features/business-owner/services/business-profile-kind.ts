import { FOOD_CATEGORIES } from './promotions'

/**
 * What kind of public profile a business has, from its category: the
 * Business Gallery page shows different highlights, a different second tab,
 * checklist item, tips and photo categories for each.
 *
 *  - restaurant: signature dishes + Menu (restaurants, cafés, food hubs, hotel-restaurants)
 *  - resort: resort type & facilities + Cottages & Rooms (resort offerings)
 *  - attraction: activities + Visit Info (attraction details)
 *  - general: any other type, without type-specific sections
 */
export type ProfileKind = 'restaurant' | 'resort' | 'attraction' | 'general'

export function profileKind(category: string | null | undefined): ProfileKind {
  if (!category) return 'general'
  if (FOOD_CATEGORIES.includes(category)) return 'restaurant'
  if (category.toLowerCase() === 'resort') return 'resort'
  // Production names its attraction category "Attractions" (BusinessModuleSeeder alias).
  if (['tourist attraction', 'attractions', 'attraction'].includes(category.toLowerCase())) return 'attraction'
  return 'general'
}

export interface GalleryCategory {
  value: string
  label: string
}

/** Photo categories per kind. Values must be in BusinessMedia::GALLERY_CATEGORIES on the server. */
const GALLERY_CATEGORIES: Record<ProfileKind, GalleryCategory[]> = {
  restaurant: [
    { value: 'signature_dish', label: 'Signature Dishes' },
    { value: 'best_seller', label: 'Best Sellers' },
    { value: 'new_menu', label: 'New Menu' },
    { value: 'promotion', label: 'Promotions' },
    { value: 'dessert', label: 'Desserts' },
    { value: 'drink', label: 'Drinks' },
    { value: 'interior', label: 'Interior' },
    { value: 'dining_area', label: 'Dining Area' },
    { value: 'event', label: 'Events' },
    { value: 'behind_the_scenes', label: 'Behind the Scenes' },
    { value: 'food', label: 'Food' },
    { value: 'restaurant', label: 'Restaurant' },
  ],
  resort: [
    { value: 'beach', label: 'Beach' },
    { value: 'pool', label: 'Pool' },
    { value: 'cottage', label: 'Cottages' },
    { value: 'room', label: 'Rooms' },
    { value: 'facility', label: 'Facilities' },
    { value: 'activity', label: 'Activities' },
    { value: 'scenery', label: 'Scenery' },
    { value: 'food', label: 'Food' },
    { value: 'event', label: 'Events' },
    { value: 'promotion', label: 'Promotions' },
  ],
  attraction: [
    { value: 'scenery', label: 'Scenery' },
    { value: 'nature', label: 'Nature' },
    { value: 'river', label: 'River & Water' },
    { value: 'beach', label: 'Beach' },
    { value: 'activity', label: 'Activities' },
    { value: 'campsite', label: 'Camping' },
    { value: 'facility', label: 'Facilities' },
    { value: 'event', label: 'Events' },
    { value: 'attraction', label: 'Attraction' },
  ],
  general: [
    { value: 'scenery', label: 'Scenery' },
    { value: 'facility', label: 'Facilities' },
    { value: 'activity', label: 'Activities' },
    { value: 'event', label: 'Events' },
    { value: 'promotion', label: 'Promotions' },
  ],
}

export function galleryCategories(kind: ProfileKind): GalleryCategory[] {
  return GALLERY_CATEGORIES[kind]
}

/** Label for a stored photo category, whichever kind it was posted under. */
export function galleryCategoryLabel(value: string | null | undefined): string | null {
  if (!value) return null
  for (const list of Object.values(GALLERY_CATEGORIES)) {
    const hit = list.find((c) => c.value === value)
    if (hit) return hit.label
  }
  return value.replace(/_/g, ' ')
}

const HIGHLIGHT_TIP: Record<ProfileKind, string | null> = {
  restaurant: 'Ensure your signature dishes are properly highlighted.',
  resort: 'Keep your cottages, rooms and rates up to date.',
  attraction: 'List the activities visitors can enjoy and the entrance fee.',
  general: null,
}

export function profileTips(kind: ProfileKind): string[] {
  return [
    'Use high-quality images for your logo and banner.',
    'Add a short and catchy welcome message.',
    HIGHLIGHT_TIP[kind],
    // Tourist attractions are always open: no hours to keep updated.
    kind === 'attraction' ? null : 'Keep your opening hours updated.',
    'Upload at least 5 gallery posts.',
    'Add your social media links.',
  ].filter((t): t is string => t !== null)
}

const NOUN: Record<ProfileKind, string> = {
  restaurant: 'restaurant',
  resort: 'resort',
  attraction: 'attraction',
  general: 'business',
}

export function profileNoun(kind: ProfileKind): string {
  return NOUN[kind]
}

/** Activities are stored as one free-text detail ("Swimming, hiking, picnics"). */
export function splitActivities(value: string | null | undefined): string[] {
  return (value ?? '').split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean)
}

/**
 * The business type of the Deals & Posts pages: the chosen business, or —
 * with "All businesses" — the one type they share ('general' when mixed).
 */
export function portalKind(businesses: { id: number; category?: string }[], businessId: number | null): ProfileKind {
  const list = businessId != null ? businesses.filter((b) => b.id === businessId) : businesses
  const kinds = [...new Set(list.map((b) => profileKind(b.category)))]
  return kinds.length === 1 ? kinds[0]! : 'general'
}

export interface DealsCopy {
  subtitle: string
  postsEmpty: string
  postPlaceholder: string
  /** Promotion form (the "20% OFF" deal / badge). */
  dealNoun: string
  dealFormSubtitle: string
  dealTitlePlaceholder: string
  dealDescriptionPlaceholder: string
  /** How a label-only deal is honoured (Deals tab). */
  dealsExplainer: string
}

const DEALS_COPY: Record<ProfileKind, DealsCopy> = {
  restaurant: {
    subtitle: 'Share updates, promote special offers, and attract more customers.',
    postsEmpty: 'Post a photo of today’s special or a short video of your place.',
    postPlaceholder: 'What’s new? e.g. Our sisig is 25% off this weekend!',
    dealNoun: 'Promotion',
    dealFormSubtitle: 'Create a new promotion to attract customers.',
    dealTitlePlaceholder: 'e.g. Summer Sale',
    dealDescriptionPlaceholder: 'Describe the promotion...',
    dealsExplainer: 'A badge such as “20% OFF” on your business page. Badges do not change prices; use a sale for that.',
  },
  resort: {
    subtitle: 'Share resort updates and promote deals on cottages, rooms and day tours to attract more guests.',
    postsEmpty: 'Post photos of your beach, cottages or rooms, or a short video of your resort.',
    postPlaceholder: 'What’s new? e.g. 20% off cottages this weekend!',
    dealNoun: 'Deal',
    dealFormSubtitle: 'Create a deal for your cottages, rooms or day tours to attract more guests.',
    dealTitlePlaceholder: 'e.g. Weekday Cottage Deal',
    dealDescriptionPlaceholder: 'e.g. 20% off all cottages from Monday to Thursday.',
    dealsExplainer: 'A deal such as “20% OFF” shown on your resort page and in the deals tourists browse. Deals do not change booking prices automatically, so honour them when the guest arrives.',
  },
  attraction: {
    subtitle: 'Share photos, news and events to attract more visitors.',
    postsEmpty: 'Post photos of the attraction or a short video, and share news or upcoming events.',
    postPlaceholder: 'What’s new? e.g. The river is clear and calm today — perfect for swimming!',
    dealNoun: 'Deal',
    dealFormSubtitle: 'Create a deal for visitors, such as a group or student discount.',
    dealTitlePlaceholder: 'e.g. Group Visit Discount',
    dealDescriptionPlaceholder: 'e.g. 10% off the cottage rental for groups of 10 or more.',
    dealsExplainer: 'A deal such as “10% OFF” shown on your attraction page and in the deals tourists browse. Deals do not change any fee automatically, so honour them at the entrance.',
  },
  general: {
    subtitle: 'Share updates, promote special offers, and attract more customers.',
    postsEmpty: 'Post a photo or a short video of your place.',
    postPlaceholder: 'What’s new? Share an update or a special offer.',
    dealNoun: 'Deal',
    dealFormSubtitle: 'Create a deal to attract more customers.',
    dealTitlePlaceholder: 'e.g. Holiday Deal',
    dealDescriptionPlaceholder: 'Describe the deal...',
    dealsExplainer: 'A deal such as “20% OFF” shown on your business page and in the deals tourists browse. Deals do not change prices automatically, so honour them when the customer arrives.',
  },
}

export function dealsCopy(kind: ProfileKind): DealsCopy {
  return DEALS_COPY[kind]
}
