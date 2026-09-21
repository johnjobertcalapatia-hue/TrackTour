import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Slide {
  title: string
  highlight: string
  subtitle: string
  description: string
  cta: string
  ctaTo: string
  gradient: string
}

const SLIDES: Slide[] = [
  {
    title: 'Discover the Beauty of',
    highlight: 'Bansud',
    subtitle: 'Oriental Mindoro',
    description: 'Tropical beaches, stunning islands, rich culture, and warm people — your adventure begins here.',
    cta: 'Explore Destinations',
    ctaTo: '/tourist/destinations',
    gradient: 'from-[#0B5E2D] via-[#087F3F] to-[#1A9E44]',
  },
  {
    title: 'Experience Island',
    highlight: 'Hopping',
    subtitle: 'Bansud Adventures',
    description: 'Crystal-clear waters, vibrant coral reefs, and breathtaking island views await you.',
    cta: 'View Experiences',
    ctaTo: '/tourist/explore/map',
    gradient: 'from-[#0C4A6E] via-[#0369A1] to-[#0EA5E9]',
  },
  {
    title: 'Taste the Flavors of',
    highlight: 'Mindoro',
    subtitle: 'Local Food Trip',
    description: 'From fresh seafood to authentic Filipino cuisine — taste the best of Bansud.',
    cta: 'Explore Food',
    ctaTo: '/tourist/food',
    gradient: 'from-[#7C2D12] via-[#C2410C] to-[#F97316]',
  },
  {
    title: 'Relax at Premium',
    highlight: 'Beach Resorts',
    subtitle: 'Hotels & Stays',
    description: 'Unwind at world-class resorts with stunning ocean views and premium amenities.',
    cta: 'View Resorts',
    ctaTo: '/tourist/stays',
    gradient: 'from-[#4C1D95] via-[#7C3AED] to-[#A78BFA]',
  },
  {
    title: 'Join Exciting',
    highlight: 'Local Events',
    subtitle: 'Festivals & Activities',
    description: 'Experience the vibrant culture of Bansud through festivals, markets, and community events.',
    cta: 'View Events',
    ctaTo: '/tourist/events',
    gradient: 'from-[#831843] via-[#BE185D] to-[#EC4899]',
  },
]

export default function HeroCarousel() {
  const [current, setCurrent] = useState(0)

  const next = useCallback(() => setCurrent((c) => (c + 1) % SLIDES.length), [])
  const prev = useCallback(() => setCurrent((c) => (c - 1 + SLIDES.length) % SLIDES.length), [])

  useEffect(() => {
    const timer = setInterval(next, 6000)
    return () => clearInterval(timer)
  }, [next])

  const slide = SLIDES[current]!

  return (
    <div className="relative rounded-2xl overflow-hidden group">
      {/* Background */}
      <div className={`relative h-[280px] lg:h-[320px] bg-gradient-to-br ${slide.gradient} transition-all duration-700`}>
        {/* Decorative elements */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-8 right-12 w-40 h-40 rounded-full bg-white/20 blur-2xl" />
          <div className="absolute bottom-6 left-16 w-56 h-56 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center h-full px-8 lg:px-12 max-w-2xl">
          <p className="text-white/70 text-sm font-medium mb-1 tracking-wide">{slide.subtitle}</p>
          <h2 className="text-white/90 text-lg lg:text-xl font-medium mb-0.5">{slide.title}</h2>
          <h1 className="text-white text-4xl lg:text-5xl font-extrabold mb-3 leading-tight">{slide.highlight}</h1>
          <p className="text-white/80 text-sm lg:text-base leading-relaxed mb-5 max-w-md">{slide.description}</p>
          <a
            href={slide.ctaTo}
            className="inline-flex items-center gap-2 bg-white text-[#087F3F] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#F3F8F4] transition w-fit shadow-lg shadow-black/10"
          >
            {slide.cta} →
          </a>
        </div>

        {/* Controls */}
        <button onClick={prev} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-white/30">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button onClick={next} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-white/30">
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* Dots */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'bg-white w-6' : 'bg-white/40 w-1.5 hover:bg-white/60'}`}
            />
          ))}
        </div>

        {/* Slide counter */}
        <div className="absolute top-4 right-4 bg-black/20 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-full">
          {current + 1} / {SLIDES.length}
        </div>
      </div>
    </div>
  )
}
