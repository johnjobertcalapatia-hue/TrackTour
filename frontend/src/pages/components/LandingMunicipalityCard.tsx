import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Sparkles } from 'lucide-react'
import { get } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import type { MunicipalityPhoto } from '@/shared/hooks/use-current-municipality'

interface MunicipalityLite {
  id: number
  name: string
  destinations_count?: number
  businesses_count?: number
}

// Brand-toned fallbacks (forest → heritage green, teal, gold) used until a
// municipality has a real photo.
const PLACEHOLDER_COLORS = [
  'from-[#0B5D2E] via-[#1F7A45] to-[#2E8B57]',
  'from-[#0F4C3A] via-[#0E6B5C] to-[#0E7490]',
  'from-[#14532D] via-[#3F7D20] to-[#65A30D]',
  'from-[#073D1E] via-[#0B5D2E] to-[#1F7A45]',
  'from-[#1D4E2A] via-[#6B5A12] to-[#B8860B]',
  'from-[#064E3B] via-[#0B6E68] to-[#0891B2]',
]

export default function LandingMunicipalityCard({
  municipality,
  index,
}: {
  municipality: MunicipalityLite
  index: number
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const { data: photos = [] } = useQuery({
    queryKey: ['municipality-photos', municipality.id],
    queryFn: () => get<MunicipalityPhoto[]>(`/municipalities/${municipality.id}/photos`),
    staleTime: 10 * 60 * 1000,
  })
  const image = photos[0]?.src
  const showImage = Boolean(image && image !== failedImage)
  const places = (municipality.destinations_count ?? 0) + (municipality.businesses_count ?? 0)
  const isHome = municipality.name.toLowerCase() === 'bansud'

  return (
    <Link
      to={`/explore/municipality/${municipality.id}`}
      className="group relative h-[300px] w-[230px] shrink-0 snap-start overflow-hidden rounded-3xl shadow-[0_14px_30px_rgba(6,40,20,0.16)] ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_rgba(6,40,20,0.24)]"
    >
      <div
        data-testid="municipality-card-background"
        className={`absolute inset-0 bg-gradient-to-br ${PLACEHOLDER_COLORS[(index + 2) % PLACEHOLDER_COLORS.length]}`}
      >
        {!showImage && (
          <span className="absolute -right-3 -top-6 select-none text-[150px] font-extrabold leading-none text-white/10" aria-hidden="true">
            {municipality.name.charAt(0)}
          </span>
        )}
      </div>
      {showImage && (
        <img
          src={toAssetUrl(image)}
          alt={`${municipality.name} tourism`}
          loading="lazy"
          onError={() => setFailedImage(image ?? null)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#04190C]/90 via-[#04190C]/25 to-transparent" />

      {isHome && (
        <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-[#FFD000] px-2.5 py-1 text-[11px] font-bold text-[#14351F] shadow">
          <Sparkles className="h-3 w-3" aria-hidden="true" /> Home of TrackTour
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-5">
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold leading-tight text-white drop-shadow">{municipality.name}</h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-white/85">
            <MapPin className="h-3.5 w-3.5 text-[#FFD000]" aria-hidden="true" />
            {places > 0 ? `${places} ${places === 1 ? 'Place' : 'Places'} to Explore` : 'Coming soon'}
          </p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/50 backdrop-blur transition group-hover:bg-[#FFD000] group-hover:text-[#14351F]">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}
