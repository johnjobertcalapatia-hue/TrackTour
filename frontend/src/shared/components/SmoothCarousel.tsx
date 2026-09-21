import { useRef, useState } from 'react'
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion'
import { MapPin, Star, Compass, ChevronLeft, ChevronRight } from 'lucide-react'

export interface CarouselItem {
  name: string
  location: string
  image?: string
  category?: string
  rating?: number
}

interface SmoothCarouselProps {
  cardWidth?: number
  cardHeight?: number
  gap?: number
  className?: string
}

const TOURIST_ITEMS: CarouselItem[] = [
  { name: 'White Beach', location: 'Puerto Galera', category: 'Beach', rating: 4.8 },
  { name: 'Tamaraw Falls', location: 'Puerto Galera', category: 'Nature', rating: 4.6 },
  { name: 'Apo Reef', location: 'Sablayan', category: 'Diving', rating: 4.9 },
  { name: 'Mt. Halcon', location: 'Baco', category: 'Adventure', rating: 4.7 },
  { name: 'Bulalacao Beaches', location: 'Bulalacao', category: 'Beach', rating: 4.5 },
  { name: 'Sabang Bay', location: 'Puerto Galera', category: 'Marine', rating: 4.4 },
  { name: 'Mangyan Village', location: 'Oriental Mindoro', category: 'Culture', rating: 4.3 },
]

const RESTAURANT_ITEMS: CarouselItem[] = [
  { name: 'Seaside Grill', location: 'Puerto Galera', category: 'Grill', rating: 4.6 },
  { name: 'Beachside Cafe', location: 'Sabang', category: 'Cafe', rating: 4.4 },
  { name: 'Island Flavors', location: 'Calapan', category: 'Filipino', rating: 4.7 },
  { name: 'The Lobster House', location: 'Puerto Galera', category: 'Seafood', rating: 4.5 },
  { name: 'Coconut & Spice', location: 'Bongabong', category: 'Asian', rating: 4.3 },
  { name: 'Harold’s Kitchen', location: 'Baco', category: 'Homestyle', rating: 4.4 },
]

const HOTEL_ITEMS: CarouselItem[] = [
  { name: 'Blue Horizon Resort', location: 'Puerto Galera', category: 'Resort', rating: 4.8 },
  { name: 'Lalaguna Villas', location: 'Sabang', category: 'Hotel', rating: 4.6 },
  { name: 'Marina Bay Hotel', location: 'Calapan', category: 'Hotel', rating: 4.3 },
  { name: 'Sunset Paradise Inn', location: 'Bulalacao', category: 'Inn', rating: 4.4 },
  { name: 'The Cliffhouse', location: 'Baco', category: 'Lodge', rating: 4.5 },
  { name: 'Ridgeview Suites', location: 'San Teodoro', category: 'Hotel', rating: 4.2 },
]

type TabKey = 'tourist' | 'restaurants' | 'hotels'

const TABS: { key: TabKey; label: string; items: CarouselItem[] }[] = [
  { key: 'tourist', label: 'Tourist Spots', items: TOURIST_ITEMS },
  { key: 'restaurants', label: 'Restaurants', items: RESTAURANT_ITEMS },
  { key: 'hotels', label: 'Hotels', items: HOTEL_ITEMS },
]

export default function SmoothCarousel({
  cardWidth = 260,
  cardHeight = 420,
  gap = 16,
  className,
}: SmoothCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(1)
  const [activeTab, setActiveTab] = useState<TabKey>('tourist')

  // Container shows: half card | full center card | half card  → 2 card widths + 2 gaps
  const containerWidth = cardWidth * 2 + gap * 2
  const span = cardWidth * 1.5

  const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0]!
  const visibleItems = tab.items

  const x = useMotionValue(-cardWidth / 2)
  const springX = useSpring(x, { stiffness: 220, damping: 32 })

  const lastIndex = Math.max(1, visibleItems.length - 2)
  const offsetFor = (i: number) => containerWidth / 2 - (i * (cardWidth + gap) + cardWidth / 2)

  // Animate so the clicked card becomes the centered card
  const goTo = (index: number) => {
    const clamped = Math.max(1, Math.min(index, lastIndex))
    animate(x, offsetFor(clamped), { type: 'spring', stiffness: 220, damping: 32 })
    setCurrentIndex(clamped)
  }

  const selectTab = (key: TabKey) => {
    if (key === activeTab) return
    setActiveTab(key)
    setCurrentIndex(1)
    animate(x, offsetFor(1), { type: 'spring', stiffness: 220, damping: 32 })
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ width: containerWidth, touchAction: 'pan-y' }}
    >
      {/* Category tabs */}
      <div className="flex items-center justify-center gap-6 pb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => selectTab(t.key)}
            className={`relative text-sm font-semibold pb-1 transition-colors ${
              activeTab === t.key ? 'text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            {t.label}
            {activeTab === t.key && (
              <motion.span
                layoutId="carousel-tab-underline"
                className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded-full bg-emerald-300"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
          </button>
        ))}
      </div>

      <motion.div className="flex" style={{ x: springX, gap }}>
        {visibleItems.map((item, i) => (
          <CarouselCard
            key={`${item.name}-${i}`}
            item={item}
            index={i}
            x={springX}
            cardWidth={cardWidth}
            cardHeight={cardHeight}
            gap={gap}
            containerWidth={containerWidth}
            span={span}
            isCentered={i === currentIndex}
            onSelect={() => goTo(i)}
          />
        ))}
      </motion.div>

      {/* Left / Right navigation */}
      {currentIndex > 1 && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => goTo(currentIndex - 1)}
          aria-label="Previous"
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-[#087F3F] shadow-lg flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </motion.button>
      )}
      {currentIndex < lastIndex && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => goTo(currentIndex + 1)}
          aria-label="Next"
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-[#087F3F] shadow-lg flex items-center justify-center transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </motion.button>
      )}
    </div>
  )
}

function CarouselCard({
  item,
  index,
  x,
  cardWidth,
  cardHeight,
  gap,
  containerWidth,
  span,
  isCentered,
  onSelect,
}: {
  item: CarouselItem
  index: number
  x: MotionValue<number>
  cardWidth: number
  cardHeight: number
  gap: number
  containerWidth: number
  span: number
  isCentered: boolean
  onSelect: () => void
}) {
  const center = index * (cardWidth + gap) + cardWidth / 2
  const target = containerWidth / 2
  const offset = center - target
  const input = [-offset - span, -offset, -offset + span]

  const opacity = useTransform(x, input, [0.45, 1, 0.45])
  const scale = useTransform(x, input, [0.88, 1, 0.88])
  const blur = useTransform(x, input, [3, 0, 3])
  const filter = useMotionTemplate`blur(${blur}px)`

  return (
    <motion.div
      style={{ width: cardWidth, opacity, scale, filter }}
      className={`shrink-0 select-none ${isCentered ? '' : 'cursor-pointer'}`}
      onClick={onSelect}
    >
      <div
        className="relative rounded-2xl overflow-hidden border border-[#E5E9E7] shadow-[0_10px_30px_rgba(22,101,52,0.12)] group transition-transform"
        style={{ height: cardHeight }}
      >
        {item.image ? (
          <>
            <img
              src={item.image}
              alt={item.name}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c2a17]/90 via-[#0c2a17]/10 to-transparent" />
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#E9F7EF] to-[#F3F8F4]">
            <div className="w-16 h-16 rounded-2xl bg-white border border-[#BFE3CB] flex items-center justify-center">
              <Compass className="w-8 h-8 text-[#087F3F]" />
            </div>
            <span className="text-xs text-[#6B7280]">Photo coming soon</span>
          </div>
        )}

        {item.category && (
          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-white/90 backdrop-blur text-[11px] font-semibold text-[#087F3F]">
            {item.category}
          </span>
        )}

        {item.rating != null && (
          <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 backdrop-blur text-[11px] font-semibold text-[#17201B]">
            <Star className="w-3 h-3 text-[#B08600] fill-[#B08600]" />
            {item.rating.toFixed(1)}
          </span>
        )}

        <div className="absolute bottom-0 inset-x-0 p-4">
          <h3 className="text-white font-bold text-lg leading-tight">{item.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-200">
            <MapPin className="w-3.5 h-3.5 text-emerald-300" />
            {item.location}
          </p>
        </div>
      </div>
    </motion.div>
  )
}
