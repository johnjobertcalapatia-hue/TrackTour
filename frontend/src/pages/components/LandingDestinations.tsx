import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import LandingMunicipalityCard from './LandingMunicipalityCard'

interface MunicipalityLite {
  id: number
  name: string
  destinations_count?: number
  businesses_count?: number
}

/** "Where to Next?" — scrollable municipality cards with arrow controls. */
export default function LandingDestinations({ municipalities }: { municipalities: MunicipalityLite[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  if (municipalities.length === 0) return null

  const scrollBy = (direction: 1 | -1) => {
    scroller.current?.scrollBy({ left: direction * 480, behavior: 'smooth' })
  }

  return (
    <section aria-labelledby="where-next-heading" style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Oriental Mindoro · District 2
          </p>
          <h2 id="where-next-heading" className="mt-2 text-3xl font-bold text-[#0B5D2E] sm:text-4xl">Where to Next?</h2>
          <p className="mt-1 text-[#3F4B43]">Pick a municipality and discover its spots, food and stays.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Scroll municipalities left"
            onClick={() => scrollBy(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#CFE5D7] bg-white text-[#0B5D2E] shadow-sm transition hover:bg-[#0B5D2E] hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Scroll municipalities right"
            onClick={() => scrollBy(1)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#CFE5D7] bg-white text-[#0B5D2E] shadow-sm transition hover:bg-[#0B5D2E] hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div ref={scroller} className="no-scrollbar -mx-2 flex snap-x snap-mandatory gap-5 overflow-x-auto px-2 pb-6 pt-1">
        {municipalities.map((m, i) => (
          <LandingMunicipalityCard key={m.id} municipality={m} index={i} />
        ))}
      </div>
    </section>
  )
}
