import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BedDouble, Compass, Map as MapIcon, MapPin, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { get } from '@/shared/services/api'
import { formatCurrency, toAssetUrl } from '@/shared/utils'
import LandingShell from './components/LandingShell'
import LandingItemCard, { LandingEmpty, LandingSpinner, type LandingItem } from './components/LandingItemCard'

interface ExploreItem {
  id: number
  name: string
  cover_photo: string | null
  logo?: string | null
  rating: number | null
  municipality: string
  type: 'place' | 'food' | 'stay'
  starting_price?: number
}

interface MapBusiness {
  id: number
  name: string
  cover_photo?: string | null
  municipality?: string | null
  category?: string | null
  average_rating?: number
  review_count?: number
}

interface ExploreData {
  places: ExploreItem[]
  food: ExploreItem[]
  stays: ExploreItem[]
  municipalities?: { id: number; name: string; businesses_count?: number }[]
  counts?: { places: number; food: number; stays: number }
}

interface Section {
  key: 'places' | 'food' | 'businesses' | 'stays'
  title: string
  blurb: string
  count: number
  countLabel: [string, string]
  icon: LucideIcon
  items: LandingItem[]
}

/** How many cards each category previews before "See all". */
const PREVIEW = 8

/** Public "All Categories" page: a preview of every category. */
export default function LandingAllCategoriesPage() {
  // Municipality filter, kept in the URL (?municipality=) so a filtered view can be shared.
  const [searchParams, setSearchParams] = useSearchParams()
  const municipalityId = Number(searchParams.get('municipality')) || null
  const chooseMunicipality = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('municipality', id)
    else next.delete('municipality')
    setSearchParams(next, { replace: true })
  }

  const { data, isLoading } = useQuery({
    queryKey: ['landing-explore', municipalityId],
    queryFn: () => get<ExploreData>('/tourist/explore', municipalityId ? { params: { municipality_id: municipalityId } } : undefined),
  })
  // The municipality list stays complete whichever municipality is chosen.
  const municipalities = [...(data?.municipalities ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const municipalityName = municipalities.find((m) => m.id === municipalityId)?.name ?? null

  const { data: businessData } = useQuery({
    queryKey: ['landing-explore-businesses'],
    queryFn: () => get<MapBusiness[]>('/map/businesses'),
  })

  const counts = data?.counts ?? { places: 0, food: 0, stays: 0 }

  const fromExplore = (list: ExploreItem[], category: string, icon: LucideIcon): LandingItem[] =>
    list.map((item) => ({
      key: `${item.type}-${item.id}`,
      to: item.type === 'place' ? `/tourist/destinations/${item.id}` : item.type === 'food' ? `/explore/food/${item.id}` : `/explore/place/${item.id}`,
      title: item.name,
      image: item.cover_photo ? toAssetUrl(item.cover_photo) : null,
      category,
      location: item.municipality,
      rating: item.rating,
      note: item.starting_price && item.starting_price > 0 ? `From ${formatCurrency(item.starting_price)}` : null,
      icon,
    }))

  const businessItems: LandingItem[] = (businessData ?? []).filter((b) => !municipalityName || b.municipality === municipalityName).map((b) => ({
    key: `business-${b.id}`,
    to: `/explore/place/${b.id}`,
    title: b.name,
    image: b.cover_photo ? toAssetUrl(b.cover_photo) : null,
    category: b.category ?? 'Business',
    location: b.municipality ?? null,
    rating: b.average_rating ?? null,
    icon: Store,
  }))

  const sections: Section[] = [
    { key: 'places', title: 'Tourist Spots', blurb: 'Waterfalls, viewpoints, parks and heritage sites.', count: counts.places, countLabel: ['tourist spot', 'tourist spots'], icon: Compass, items: fromExplore(data?.places ?? [], 'Tourist Spot', Compass) },
    { key: 'food', title: 'Food', blurb: 'Local restaurants and food hubs that deliver.', count: counts.food, countLabel: ['restaurant', 'restaurants'], icon: UtensilsCrossed, items: fromExplore(data?.food ?? [], 'Restaurant', UtensilsCrossed) },
    { key: 'businesses', title: 'Businesses', blurb: 'Shops and services run by local owners.', count: businessItems.length, countLabel: ['business', 'businesses'], icon: Store, items: businessItems },
    { key: 'stays', title: 'Resorts', blurb: 'Resorts and stays for every kind of trip.', count: counts.stays, countLabel: ['resort', 'resorts'], icon: BedDouble, items: fromExplore(data?.stays ?? [], 'Resort & Stay', BedDouble) },
  ]

  return (
    <LandingShell
      eyebrow="Browse"
      title="Explore All Categories"
      subtitle={municipalityName ? `Everything on TrackTour in ${municipalityName}, grouped by what you want to do.` : 'Everything on TrackTour, grouped by what you want to do.'}
      back={{ to: '/', label: 'Back to Home', onClick: () => sessionStorage.setItem('tracktour_scroll_to_content', '1') }}
      bandExtra={
        <div className="flex flex-wrap items-center gap-2">
          {sections.map((s) => (
            <a
              key={s.key}
              href={`#category-${s.key}`}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/20"
            >
              <s.icon className="h-4 w-4 text-[#FFD000]" aria-hidden="true" /> {s.title}
              <span className="rounded-full bg-[#FFD000] px-2 text-xs font-bold text-[#14351F]">{s.count}</span>
            </a>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-white/25 sm:block" aria-hidden="true" />
          <label className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#14351F] shadow">
            <MapPin className="h-4 w-4 text-[#0B5D2E]" aria-hidden="true" />
            <span className="sr-only">Municipality</span>
            <select
              aria-label="Municipality"
              value={municipalityId ?? ''}
              onChange={(e) => chooseMunicipality(e.target.value)}
              className="bg-transparent font-semibold outline-none"
            >
              <option value="">All municipalities</option>
              {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <Link
            to="/?view=map"
            className="inline-flex items-center gap-2 rounded-full bg-[#FFD000] px-4 py-2 text-sm font-bold text-[#14351F] shadow hover:bg-[#FFDD33]"
          >
            <MapIcon className="h-4 w-4" aria-hidden="true" /> Map view
          </Link>
        </div>
      }
    >
      {isLoading ? (
        <LandingSpinner />
      ) : (
        <div className="space-y-16">
          {sections.map((section) => (
            <section key={section.key} id={`category-${section.key}`} className="scroll-mt-6" aria-labelledby={`category-${section.key}-heading`}>
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0B5D2E] text-[#FFD000] shadow-md">
                    <section.icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 id={`category-${section.key}-heading`} className="text-2xl font-bold text-[#0B5D2E] sm:text-3xl">
                      {section.title}
                    </h2>
                    <p className="text-sm text-[#5B6A60]">
                      {section.count} {section.countLabel[section.count === 1 ? 0 : 1]} · {section.blurb}
                    </p>
                  </div>
                </div>
                {section.items.length > PREVIEW && (
                  <Link
                    to={`/explore?tab=${section.key}`}
                    className="inline-flex items-center gap-1.5 self-start rounded-full bg-[#FFD000] px-5 py-2.5 text-sm font-bold text-[#14351F] shadow hover:bg-[#FFDD33] sm:self-auto"
                  >
                    See all {section.title.toLowerCase()} <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>

              {section.items.length === 0 ? (
                <LandingEmpty message="Nothing found in this category yet." />
              ) : (
                <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {section.items.slice(0, PREVIEW).map((item, i) => (
                    <li key={item.key}>
                      <LandingItemCard item={item} index={i} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </LandingShell>
  )
}
