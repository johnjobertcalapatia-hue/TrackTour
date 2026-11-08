import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Flame, Play, UtensilsCrossed } from 'lucide-react'
import { cn, toAssetUrl } from '@/shared/utils'

/** Videos uploaded by the restaurant (MP4 / MOV / WebM) play in the carousel. */
function isVideoSrc(src: string): boolean {
  return /\.(mp4|mov|webm)(\?|#|$)/i.test(src)
}

interface Props {
  /** Photo and video paths (as stored); the first is the cover. */
  images: string[]
  name: string
  popular?: boolean
}

/** Swipe distance (px) or fraction of the width that changes the slide. */
const SWIPE_MIN_PX = 40
const SWIPE_MIN_FRACTION = 0.18

/**
 * Food photo carousel: sliding track, touch/mouse swipe, keyboard arrows,
 * prev/next buttons, dots, counter and a thumbnail strip that follows the
 * active slide. With a single photo it renders a plain image (no controls).
 */
export default function FoodImageCarousel({ images, name, popular }: Props) {
  const [index, setIndex] = useState(0)
  const [dragPx, setDragPx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const thumbsRef = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null)
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([])

  const count = images.length
  const current = count > 0 ? Math.min(index, count - 1) : 0
  const hasMany = count > 1

  const go = (next: number) => {
    if (!hasMany) return
    setIndex(((next % count) + count) % count)
  }

  // The video on the visible slide autoplays (muted, looping, like a moving
  // photo); videos on other slides pause. Browsers only allow muted autoplay;
  // the tourist can unmute with the controls. Reduced-motion users press play.
  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      if (i === current) {
        if (!reduceMotion && v.paused) {
          v.muted = true
          v.play?.()?.catch?.(() => {})
        }
      } else if (!v.paused) {
        v.pause()
      }
    })
  }, [current, count])

  // Keep the active thumbnail visible in the strip.
  useEffect(() => {
    const thumb = thumbsRef.current?.children[current] as HTMLElement | undefined
    thumb?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [current])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!hasMany || (e.pointerType === 'mouse' && e.button !== 0)) return
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (s.horizontal === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      // Decide once: vertical gestures scroll the page, horizontal ones swipe.
      s.horizontal = Math.abs(dx) > Math.abs(dy)
      if (s.horizontal) {
        setDragging(true)
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      }
    }
    if (s.horizontal) setDragPx(dx)
  }

  const endDrag = (e: React.PointerEvent) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    start.current = null
    if (s.horizontal) {
      const width = viewportRef.current?.clientWidth ?? 0
      const dx = e.clientX - s.x
      // Width-relative threshold only when the width is known (never divide by 0).
      const farEnough = Math.abs(dx) >= SWIPE_MIN_PX || (width > 0 && Math.abs(dx) / width >= SWIPE_MIN_FRACTION)
      if (farEnough) {
        go(current + (dx < 0 ? 1 : -1))
      }
    }
    setDragging(false)
    setDragPx(0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1) }
  }

  return (
    <div className="min-w-0">
      <div
        ref={viewportRef}
        role="region"
        aria-roledescription="carousel"
        aria-label={`Photos of ${name}`}
        tabIndex={hasMany ? 0 : -1}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'food-carousel relative aspect-[4/3] rounded-3xl overflow-hidden bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] outline-none focus-visible:ring-4 focus-visible:ring-[#087F3F]/30 select-none',
          hasMany && 'touch-pan-y cursor-grab active:cursor-grabbing',
        )}
      >
        {count === 0 ? (
          <div className="w-full h-full flex items-center justify-center">
            <UtensilsCrossed className="w-14 h-14 text-[#087F3F]/30" aria-hidden="true" />
          </div>
        ) : (
          <div
            className={cn('flex h-full', !dragging && 'transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]')}
            style={{ transform: `translateX(calc(${-current * 100}% + ${dragPx}px))` }}
            data-testid="food-carousel-track"
          >
            {images.map((src, i) => (
              <div
                key={`${src}-${i}`}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}${isVideoSrc(src) ? ', video' : ''}`}
                aria-hidden={i !== current}
                className="w-full h-full shrink-0"
              >
                {isVideoSrc(src) ? (
                  <video
                    ref={(el) => { videoRefs.current[i] = el }}
                    src={toAssetUrl(src)}
                    controls
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={`Video of ${name}`}
                    className="w-full h-full object-cover bg-black"
                  />
                ) : (
                  <img
                    src={toAssetUrl(src)}
                    alt={i === current ? name : ''}
                    loading={i === 0 ? 'eager' : 'lazy'}
                    draggable={false}
                    className="w-full h-full object-cover pointer-events-none"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {popular && (
          <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#087F3F] text-white text-sm font-bold shadow-md">
            <Flame className="w-4 h-4" aria-hidden="true" /> Popular
          </span>
        )}

        {hasMany && (
          <>
            <span className="absolute top-4 right-4 h-8 px-3 rounded-full bg-black/55 text-white text-xs font-bold inline-flex items-center" aria-live="polite">
              {current + 1}/{count}
            </span>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => go(current - 1)}
              onPointerDown={(e) => e.stopPropagation()}
              className="food-carousel-arrow absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65 transition"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => go(current + 1)}
              onPointerDown={(e) => e.stopPropagation()}
              className="food-carousel-arrow absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65 transition"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5" role="tablist" aria-label="Choose photo">
              {images.map((src, i) => (
                <button
                  key={`dot-${src}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === current}
                  aria-label={`Show photo ${i + 1}`}
                  onClick={() => go(i)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn('food-carousel-dot h-2 rounded-full transition-all', i === current ? 'w-6 bg-white' : 'w-2 bg-white/60 hover:bg-white')}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {hasMany && (
        <div ref={thumbsRef} className="mt-3 flex gap-3 overflow-x-auto pb-1 scrollbar-hide" role="group" aria-label="Food images">
          {images.map((src, i) => (
            <button
              key={`thumb-${src}-${i}`}
              type="button"
              onClick={() => go(i)}
              aria-label={`View ${isVideoSrc(src) ? 'video' : 'image'} ${i + 1} of ${count}`}
              aria-pressed={i === current}
              className={cn(
                'food-thumb relative shrink-0 w-24 h-16 sm:w-28 sm:h-[72px] rounded-xl overflow-hidden border-2 transition',
                i === current ? 'border-[#087F3F] ring-2 ring-[#087F3F]/25' : 'border-transparent opacity-75 hover:opacity-100',
              )}
            >
              {isVideoSrc(src) ? (
                <>
                  <video src={toAssetUrl(src)} muted playsInline preload="metadata" className="w-full h-full object-cover bg-black pointer-events-none" aria-hidden="true" />
                  <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                    <span className="w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center">
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </span>
                  </span>
                </>
              ) : (
                <img src={toAssetUrl(src)} alt="" loading="lazy" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
