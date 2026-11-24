import { Link } from 'react-router-dom'
import { ArrowRight, Compass, MapPin, Star, type LucideIcon } from 'lucide-react'

const FALLBACKS = [
  'from-[#0B5D2E] to-[#2E8B57]',
  'from-[#0F4C3A] to-[#0E7490]',
  'from-[#14532D] to-[#65A30D]',
  'from-[#1D4E2A] to-[#B8860B]',
]

export interface LandingItem {
  key: string
  to: string
  title: string
  image: string | null
  category?: string | null
  location?: string | null
  rating?: number | null
  note?: string | null
  icon?: LucideIcon
}

/** Place / business card used across the public landing pages. */
export default function LandingItemCard({ item, index = 0 }: { item: LandingItem; index?: number }) {
  const Icon = item.icon ?? Compass
  return (
    <Link
      to={item.to}
      className="group flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-[0_12px_28px_rgba(6,40,20,0.10)] ring-1 ring-[#E7E2D6] transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(6,40,20,0.18)]"
    >
      <div className="relative h-48 overflow-hidden">
        {item.image ? (
          <img src={item.image} alt={item.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
        ) : (
          <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${FALLBACKS[index % FALLBACKS.length]}`}>
            <Icon className="h-10 w-10 text-white/45" aria-hidden="true" />
          </div>
        )}
        {item.category && (
          <span className="absolute left-3 top-3 max-w-[70%] truncate rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-[#0B5D2E] shadow">{item.category}</span>
        )}
        {item.rating != null && Number(item.rating) > 0 && (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-[#14351F]/80 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
            <Star className="h-3 w-3 fill-[#FFD000] text-[#FFD000]" aria-hidden="true" />
            {Number(item.rating).toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-bold leading-snug text-[#14351F] sm:text-lg">{item.title}</h3>
        {item.location && (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[#5B6A60]">
            <MapPin className="h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" />
            <span className="truncate">{item.location}</span>
          </p>
        )}
        {item.note && <p className="mt-1 text-sm font-semibold text-[#B8860B]">{item.note}</p>}
        <span className="mt-auto flex items-center gap-1.5 pt-4 text-sm font-semibold text-[#0B5D2E] group-hover:text-[#E0A800]">
          View details <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}

export function LandingEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#CFE5D7] bg-white px-6 py-8 text-center">
      <Compass className="mx-auto h-8 w-8 text-[#9CB8A5]" aria-hidden="true" />
      <p className="mt-3 text-sm text-[#68736D]">{message}</p>
    </div>
  )
}

export function LandingSpinner() {
  return (
    <div className="flex items-center justify-center py-20" role="status" aria-label="Loading">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#0B5D2E] border-t-transparent" />
    </div>
  )
}
