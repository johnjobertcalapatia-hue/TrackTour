import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BedDouble, Compass, LayoutGrid, MapPin, Star, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { cn, toAssetUrl } from '@/shared/utils'

/**
 * One landing card, served live by GET /api/landing/cards. `key` is
 * `biz-{businessId}` or `spot-{destinationId}`; `types` lists the tabs it
 * belongs to.
 */
export interface LandingCard {
  key: string
  types: string[]
  title: string
  location: string | null
  category: string
  rating: number | null
  image: string | null
}

const TABS: { label: string; type: string | null; icon: LucideIcon }[] = [
  { label: 'All', type: null, icon: LayoutGrid },
  { label: 'Tourist Spots', type: 'spot', icon: Compass },
  { label: 'Food', type: 'food', icon: UtensilsCrossed },
  { label: 'Businesses', type: 'business', icon: Store },
  { label: 'Resorts', type: 'resort', icon: BedDouble },
]

const FALLBACKS = [
  'from-[#0B5D2E] to-[#2E8B57]',
  'from-[#0F4C3A] to-[#0E7490]',
  'from-[#14532D] to-[#65A30D]',
  'from-[#1D4E2A] to-[#B8860B]',
]

/** Where a landing card leads: restaurants to their public food page, other businesses to their public place page. */
export function landingCardLink(card: LandingCard): string {
  const [kind, id] = card.key.split('-')
  if (kind === 'spot') return `/tourist/destinations/${id}`
  if (card.types.includes('food')) return `/explore/food/${id}`
  return `/explore/place/${id}`
}

/** "Places to Discover": filter tabs over the live place cards. */
export default function LandingPlaces({ cards, pending }: { cards: LandingCard[]; pending: boolean }) {
  const [active, setActive] = useState('All')
  const tab = TABS.find((t) => t.label === active) ?? TABS[0]!
  const visible = cards.filter((c) => !tab.type || c.types.includes(tab.type))

  return (
    <section aria-labelledby="places-heading" style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Featured
          </p>
          <h2 id="places-heading" className="mt-2 text-3xl font-bold text-[#0B5D2E] sm:text-4xl">Places to Discover</h2>
          <p className="mt-1 text-[#3F4B43]">Spots, restaurants, stays and local businesses on TrackTour.</p>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-full bg-white p-1.5 shadow-[0_8px_24px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6]" role="tablist" aria-label="Filter places">
          {TABS.map((t) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={active === t.label}
              onClick={() => setActive(t.label)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                active === t.label ? 'bg-[#0B5D2E] text-white shadow' : 'text-[#14351F] hover:bg-[#EAF6ED]'
              )}
            >
              <t.icon className={cn('h-4 w-4', active === t.label ? 'text-[#FFD000]' : 'text-[#0B5D2E]')} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {pending ? (
        <p className="py-12 text-center text-sm text-[#68736D]">Loading places…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#CFE5D7] bg-white py-14 text-center">
          <Compass className="mx-auto h-10 w-10 text-[#9CB8A5]" aria-hidden="true" />
          <p className="mt-3 text-sm text-[#68736D]">{`No ${active === 'All' ? 'places' : active.toLowerCase()} published yet.`}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((card, i) => (
            <li key={card.key}>
              <Link
                to={landingCardLink(card)}
                className="group flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-[0_12px_28px_rgba(6,40,20,0.10)] ring-1 ring-[#E7E2D6] transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(6,40,20,0.18)]"
              >
                <div className="relative h-52 overflow-hidden">
                  {card.image ? (
                    <img src={toAssetUrl(card.image)} alt={card.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                  ) : (
                    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${FALLBACKS[i % FALLBACKS.length]}`}>
                      <Compass className="h-10 w-10 text-white/40" aria-hidden="true" />
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-[#0B5D2E] shadow">{card.category}</span>
                  {card.rating != null && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-[#14351F]/80 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                      <Star className="h-3 w-3 fill-[#FFD000] text-[#FFD000]" aria-hidden="true" />
                      {Number(card.rating).toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-lg font-bold leading-snug text-[#14351F]">{card.title}</h3>
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[#5B6A60]">
                    <MapPin className="h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" />
                    {card.location ?? 'Oriental Mindoro'}
                  </p>
                  <span className="mt-auto flex items-center gap-1.5 pt-4 text-sm font-semibold text-[#0B5D2E] group-hover:text-[#E0A800]">
                    View details <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
