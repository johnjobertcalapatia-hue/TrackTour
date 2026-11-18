import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import LandingNav, { LANDING_SERVICES, type LandingService } from './LandingNav'

interface LandingHeroProps {
  videoSrc: string
  title: string
  highlight: string
  badge: string
  subtitle: string
  onShowMap: () => void
}

const POPPINS = { fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }
const SCRIPT = { fontFamily: "'Kaushan Script', 'Brush Script MT', cursive" }

/**
 * Landing header + hero: transparent nav over the full-bleed background video,
 * headline with a Banana Gold highlight, place search, and the service cards
 * that overlap the bottom of the hero.
 */
export default function LandingHero({ videoSrc, title, highlight, badge, subtitle, onShowMap }: LandingHeroProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const words = highlight.trim().split(/\s+/)
  const goldWord = words.length > 1 ? words.pop()! : ''
  const whiteWords = words.join(' ')

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore')
  }

  const openService = (s: LandingService) => {
    if (s.map) onShowMap()
    else if (s.to) navigate(s.to)
  }

  return (
    <header className="relative" style={POPPINS}>
      <section className="relative h-[92vh] max-h-[860px] min-h-[640px] overflow-hidden" aria-label="Featured">
        {/* key: swap the <video> when the admin changes the hero video */}
        <video
          key={videoSrc}
          data-testid="hero-background-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/assets/placeholder.svg"
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-[#062814]/70 via-[#062814]/35 to-[#062814]/60" />

        <LandingNav badge={badge} active="home" onShowMap={onShowMap} />

        {/* Headline + search */}
        <div className="relative z-20 mx-auto flex max-w-4xl flex-col items-center px-5 pt-14 text-center sm:pt-20">
          <p className="text-3xl font-bold text-white drop-shadow sm:text-5xl">{title}</p>
          <h1 className="mt-1 text-5xl font-extrabold italic leading-none tracking-tight text-white drop-shadow-lg sm:text-7xl lg:text-8xl">
            {whiteWords && <span>{whiteWords} </span>}
            <span className="relative inline-block text-[#FFD000]">
              {goldWord || highlight}
              <svg className="absolute -bottom-3 left-0 h-4 w-full" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
                <path d="M4 14 C 80 4, 200 2, 296 10" stroke="#FFD000" strokeWidth="5" fill="none" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="mt-6 text-2xl font-bold text-white drop-shadow">Explore. Discover. Enjoy.</p>
          <p className="mt-3 max-w-xl text-base font-medium text-white/95 drop-shadow sm:text-lg">{subtitle}</p>

          <form onSubmit={submitSearch} role="search" className="mt-7 flex w-full max-w-2xl items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-2xl ring-4 ring-white/30">
            <Search className="h-5 w-5 shrink-0 text-[#14351F]" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for restaurants, resorts, attractions..."
              aria-label="Search for restaurants, resorts, attractions"
              className="min-w-0 flex-1 !border-0 bg-transparent !px-0 py-2.5 text-sm text-[#14351F] placeholder-[#6B7280] !shadow-none !outline-none !ring-0 focus:!ring-0 sm:text-base"
            />
            <button type="submit" className="rounded-full bg-[#0B5D2E] px-6 py-3 text-sm font-bold text-white hover:bg-[#094A25] sm:px-8 sm:text-base">
              Search
            </button>
          </form>
        </div>

        <p className="pointer-events-none absolute right-10 top-[52%] z-10 hidden -rotate-12 text-5xl leading-tight text-white drop-shadow-lg xl:block" style={SCRIPT} aria-hidden="true">
          Explore
          <br />
          <span className="ml-8">Bansud!</span>
          <svg className="mt-1 h-4 w-48" viewBox="0 0 200 16" aria-hidden="true">
            <path d="M4 12 C 70 2, 140 2, 196 8" stroke="#FFD000" strokeWidth="4" fill="none" strokeLinecap="round" />
          </svg>
        </p>
      </section>

      {/* Service cards overlapping the hero */}
      <div className="relative z-20 mx-auto -mt-20 max-w-[1400px] px-5 lg:px-8">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {LANDING_SERVICES.map((s) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => openService(s)}
                aria-label={s.title}
                className="group relative flex h-full w-full items-start gap-3 rounded-3xl border border-white/70 bg-gradient-to-br from-white/95 to-[#EAF3E4]/95 p-5 text-left shadow-[0_12px_30px_rgba(6,40,20,0.15)] backdrop-blur transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(6,40,20,0.22)]"
              >
                <s.icon className="h-9 w-9 shrink-0 text-[#0B5D2E]" strokeWidth={2.2} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-nowrap text-[17px] font-bold leading-tight text-[#14351F]">{s.title}</span>
                  <span className="mt-1.5 block pr-8 text-sm leading-snug text-[#4B5A50]">{s.text}</span>
                </span>
                <span className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#0B5D2E] shadow transition group-hover:bg-[#0B5D2E] group-hover:text-white">
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}
