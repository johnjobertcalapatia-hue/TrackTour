import { Link } from 'react-router-dom'
import { ArrowRight, BedDouble, Camera, Car, ChevronRight, MapPinned, UtensilsCrossed, type LucideIcon } from 'lucide-react'

export interface PopularTile {
  label: string
  to: string
  image: string
  icon: LucideIcon
}

export const POPULAR_ICONS = { food: UtensilsCrossed, stays: BedDouble, places: Camera, ride: Car }

/**
 * "Popular in Bansud" strip: heading + call to action beside four image tiles,
 * with the Map and View all shortcuts above the tiles.
 */
export default function LandingPopular({ tiles, onShowMap }: { tiles: PopularTile[]; onShowMap: () => void }) {
  return (
    <section id="about" className="mx-auto max-w-[1400px] px-5 py-14 lg:px-8" style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }} aria-labelledby="popular-heading">
      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[280px_1fr]">
        <div>
          <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Explore more
          </p>
          <h2 id="popular-heading" className="mt-3 text-4xl font-bold text-[#0B5D2E]">Popular in Bansud</h2>
          <p className="mt-2 text-lg text-[#3F4B43]">Food, places, and experiences you&apos;ll love.</p>
          <Link
            to="/explore"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#FFD000] px-7 py-3.5 text-base font-bold text-[#14351F] shadow-[0_10px_24px_rgba(224,168,0,0.35)] hover:bg-[#FFDD33]"
          >
            Explore Now <ArrowRight className="h-5 w-5" />
          </Link>
        </div>

        <div>
        <div className="mb-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onShowMap}
            className="flex h-[38px] items-center gap-2 rounded-full bg-[#0B5D2E] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#094A25]"
            aria-label="Show map"
            title="Show map"
          >
            <MapPinned className="h-4 w-4" />
            Map
          </button>
          <Link
            to="/explore/categories"
            className="inline-flex h-[38px] items-center gap-1 rounded-full bg-[#0B5D2E] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#094A25]"
          >
            View all
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => (
            <Link key={t.label} to={t.to} className="group relative h-48 overflow-hidden rounded-3xl shadow-lg" aria-label={t.label}>
              <img src={t.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/40 text-white ring-2 ring-white/70 backdrop-blur">
                  <t.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-[15px] font-bold leading-tight text-white drop-shadow">{t.label}</span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B5D2E] text-white ring-2 ring-white/70 transition group-hover:bg-[#FFD000] group-hover:text-[#14351F]">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          ))}
        </div>
        </div>
      </div>
    </section>
  )
}
