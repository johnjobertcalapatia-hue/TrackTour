import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BedDouble, Car, MapPin, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { get } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'

export const AUTH_FONT = { fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }
const SCRIPT = { fontFamily: "'Kaushan Script', 'Brush Script MT', cursive" }

export interface AuthHighlight { icon: LucideIcon; text: string }

const HIGHLIGHTS: AuthHighlight[] = [
  { icon: UtensilsCrossed, text: 'Order food from local restaurants' },
  { icon: BedDouble, text: 'Book resorts and stays' },
  { icon: Car, text: 'Ride safely around Bansud' },
  { icon: MapPin, text: 'Track your delivery live' },
]

interface Props {
  /** Small gold line above the headline. */
  eyebrow: string
  /** Headline before the highlighted (gold, underlined) words. */
  headline: string
  highlight: string
  description: ReactNode
  /** What TrackTour offers this reader (defaults to the tourist list). */
  highlights?: AuthHighlight[]
}

/**
 * Left half of the sign-in and sign-up pages: the landing hero video under a
 * forest-green overlay, the TrackTour logo, a headline, what TrackTour offers
 * and the script line. Phones: a short band above the form.
 */
export default function AuthBrandPanel({ eyebrow, headline, highlight, description, highlights = HIGHLIGHTS }: Props) {
  // Same background video as the landing hero (admin Landing Content).
  const { data: landing } = useQuery({
    queryKey: ['landing-content'],
    queryFn: () => get<{ hero_video?: string }>('/landing-content'),
    staleTime: 5 * 60 * 1000,
  })
  const video = landing?.hero_video || '/assets/tracktour-web.mp4'
  const videoSrc = video.startsWith('/storage/') ? toAssetUrl(video) : video

  return (
    <aside className="relative overflow-hidden bg-[#062814] text-white">
      <video
        key={videoSrc}
        data-testid="login-background-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-br from-[#062814]/85 via-[#0B5D2E]/50 to-[#062814]/80" />
      <svg className="absolute -bottom-24 -left-24 h-80 w-80 text-[#FFD000]/15" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="16" />
      </svg>

      <div className="relative flex h-full flex-col px-6 py-6 sm:px-10 lg:min-h-screen lg:px-14 lg:py-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" aria-label="TrackTour home">
            <img src="/assets/logo/tracktour.png" alt="TrackTour Logo" className="h-12 w-12 rounded-2xl bg-white object-contain p-1 shadow-lg lg:h-14 lg:w-14" />
            <span className="leading-tight">
              <span className="block text-xl font-extrabold tracking-tight lg:text-2xl">
                Track<span className="text-[#FFD000]">Tour</span>
              </span>
              <span className="block text-[11px] text-white/85 sm:text-xs">Bansud, Oriental Mindoro</span>
            </span>
          </Link>
          <Link to="/" className="hidden items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/25 backdrop-blur hover:bg-white/20 sm:inline-flex">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </div>

        <div className="mt-8 lg:my-auto">
          <p className="hidden items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#FFD000] sm:flex">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> {eyebrow}
          </p>
          <p className="mt-3 text-2xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">
            {headline}{' '}
            <span className="relative inline-block italic text-[#FFD000]">
              {highlight}
              <svg className="absolute -bottom-2 left-0 h-3 w-full" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
                <path d="M4 14 C 80 4, 200 2, 296 10" stroke="#FFD000" strokeWidth="5" fill="none" strokeLinecap="round" />
              </svg>
            </span>
          </p>
          <p className="mt-5 hidden max-w-md text-base text-white/90 sm:block">{description}</p>
          <ul className="mt-8 hidden max-w-md grid-cols-2 gap-3 lg:grid">
            {highlights.map((h) => (
              <li key={h.text} className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 text-sm font-medium ring-1 ring-white/20 backdrop-blur">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFD000] text-[#14351F]">
                  <h.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {h.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 hidden -rotate-3 text-3xl text-white/95 lg:block" style={SCRIPT} aria-hidden="true">
          Let&apos;s Explore Bansud Together!
        </p>
      </div>
    </aside>
  )
}
