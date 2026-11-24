import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { categoryName, formatCurrency, safeText, toAssetUrl } from '@/shared/utils'
import { getDiscoveryGroup } from '@/shared/utils/category'
import type { MunicipalityPhoto } from '@/shared/hooks/use-current-municipality'
import { BedDouble, Compass, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import LandingShell from './components/LandingShell'
import LandingItemCard, { LandingEmpty, LandingSpinner, type LandingItem } from './components/LandingItemCard'

interface BizCategory {
  id: number
  name: string
}

interface MunicipalityInfo {
  id: number
  name: string
  district?: string
  province?: string
  latitude?: string | number
  longitude?: string | number
}

interface Biz {
  id: number
  business_name?: string
  name?: string
  cover_photo?: string | null
  address?: string
  average_rating?: number
  review_count?: number
  is_open?: boolean
  price_range?: string | null
  category?: BizCategory | null
  municipality?: { id: number; name: string } | null
}

interface Dest {
  id: number
  name: string
  address?: string
  entrance_fee?: number
  images?: string[]
  rating?: number | null
  category?: { id: number; name: string; slug: string } | null
  municipality?: { id: number; name: string } | null
}

interface MunicipalityResponse {
  municipality: MunicipalityInfo
  businesses: {
    data?: Biz[]
    total?: number
  }
}

export default function LandingMunicipalityPage() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery<MunicipalityResponse>({
    queryKey: ['landing-municipality', id],
    queryFn: () => get(`/tourist/explore/municipality/${id}`),
    enabled: !!id,
  })

  const { data: destData, isLoading: loadingDestinations } = useQuery<{ data: Dest[] }>({
    queryKey: ['landing-municipality-destinations', id],
    queryFn: () => get('/tourist/destinations', { params: { municipality: id } }),
    enabled: !!id,
  })

  const { data: photos = [] } = useQuery({
    queryKey: ['municipality-photos', Number(id)],
    queryFn: () => get<MunicipalityPhoto[]>(`/municipalities/${id}/photos`),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  })

  const municipality = data?.municipality
  const businesses = data?.businesses?.data ?? []
  const destinations = (destData?.data ?? []).filter((d) => d.id && d.name)

  const groupOf = (b: Biz) => getDiscoveryGroup(categoryName(b.category), b.category?.id)
  const restaurants = businesses.filter((b) => groupOf(b) === 'dining')
  const resorts = businesses.filter((b) => groupOf(b) === 'accommodation')
  const others = businesses.filter((b) => {
    const group = groupOf(b)
    return group !== 'dining' && group !== 'accommodation'
  })

  const businessCover = (b: Biz) => (b.cover_photo ? toAssetUrl(b.cover_photo) : null)
  const businessLocation = (b: Biz) => b.address || safeText(b.municipality) || 'Oriental Mindoro'
  const businessCategory = (b: Biz) => categoryName(b.category) || 'Place'
  const businessRank = (b: Biz) => (b.average_rating ?? 0) > 0 ? Number(b.average_rating) : null

  const bizLink = (b: Biz) => (groupOf(b) === 'dining' ? `/explore/food/${b.id}` : `/explore/place/${b.id}`)

  const toBizItems = (list: Biz[], icon: LucideIcon): LandingItem[] =>
    list.map((b) => ({
      key: `biz-${b.id}`,
      to: bizLink(b),
      title: b.business_name ?? b.name ?? '',
      image: businessCover(b),
      category: businessCategory(b),
      location: businessLocation(b),
      rating: businessRank(b),
      icon,
    }))

  const placeItems: LandingItem[] = destinations.map((d) => ({
    key: `place-${d.id}`,
    to: `/tourist/destinations/${d.id}`,
    title: d.name,
    image: d.images?.[0] ? toAssetUrl(d.images[0]) : null,
    category: categoryName(d.category) || 'Tourist Spot',
    location: d.municipality?.name || d.address || 'Oriental Mindoro',
    rating: d.rating ? Number(d.rating) : null,
    note: d.entrance_fee && d.entrance_fee > 0 ? `Entrance ${formatCurrency(d.entrance_fee)}` : null,
    icon: Compass,
  }))

  const sections: { key: string; title: string; icon: LucideIcon; items: LandingItem[] }[] = [
    { key: 'restaurants', title: 'Restaurants', icon: UtensilsCrossed, items: toBizItems(restaurants, UtensilsCrossed) },
    { key: 'resorts', title: 'Resorts & Stays', icon: BedDouble, items: toBizItems(resorts, BedDouble) },
    { key: 'places', title: 'Tourist Spots', icon: Compass, items: placeItems },
    ...(others.length > 0 ? [{ key: 'others', title: 'More Places & Services', icon: Store, items: toBizItems(others, Store) }] : []),
  ]

  const totalPlaces = sections.reduce((n, sec) => n + sec.items.length, 0)
  const backdrop = photos[0]?.src ? toAssetUrl(photos[0].src) : null
  const back = { to: '/', label: 'Back to Home', onClick: () => sessionStorage.setItem('tracktour_scroll_to_content', '1') }

  if (isLoading) {
    return (
      <LandingShell back={back}>
        <LandingSpinner />
      </LandingShell>
    )
  }

  if (!municipality) {
    return (
      <LandingShell back={back} title="Municipality not found" subtitle="The municipality you’re looking for doesn’t exist.">
        <LandingEmpty message="Pick another municipality from the home page." />
      </LandingShell>
    )
  }

  return (
    <LandingShell
      back={back}
      backdrop={backdrop}
      eyebrow={[municipality.district, municipality.province || 'Oriental Mindoro'].filter(Boolean).join(' · ')}
      title={municipality.name}
      subtitle={totalPlaces > 0 ? `${totalPlaces} ${totalPlaces === 1 ? 'place' : 'places'} to explore — food, stays and tourist spots.` : 'Places are joining TrackTour soon.'}
      bandExtra={
        <div className="flex flex-wrap gap-2">
          {sections.map((sec) => (
            <a
              key={sec.key}
              href={`#municipality-${sec.key}`}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/20"
            >
              <sec.icon className="h-4 w-4 text-[#FFD000]" aria-hidden="true" /> {sec.title}
              <span className="rounded-full bg-[#FFD000] px-2 text-xs font-bold text-[#14351F]">{sec.items.length}</span>
            </a>
          ))}
        </div>
      }
    >
      <div className="space-y-14">
        {sections.map((sec) => (
          <section key={sec.key} id={`municipality-${sec.key}`} className="scroll-mt-6" aria-labelledby={`municipality-${sec.key}-heading`}>
            <div className="mb-6 flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0B5D2E] text-[#FFD000] shadow-md">
                <sec.icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <h2 id={`municipality-${sec.key}-heading`} className="text-2xl font-bold text-[#0B5D2E] sm:text-3xl">{sec.title}</h2>
                <p className="text-sm text-[#5B6A60]">{sec.items.length} in {municipality.name}</p>
              </div>
            </div>
            {loadingDestinations && sec.key === 'places' ? (
              <LandingSpinner />
            ) : sec.items.length === 0 ? (
              <LandingEmpty message="Nothing listed here yet." />
            ) : (
              <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sec.items.map((item, i) => (
                  <li key={item.key}>
                    <LandingItemCard item={item} index={i} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </LandingShell>
  )
}
