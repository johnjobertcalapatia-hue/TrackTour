import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toAssetUrl } from '@/shared/utils'
import type { PostMediaItem } from './post-types'

interface Props {
  media: PostMediaItem[]
  businessName: string
  /** feed: inside a card (bounded height); viewer: fills the media viewer. */
  variant?: 'feed' | 'viewer'
  /** Photo index shown (controlled by the viewer); internal state otherwise. */
  index?: number
  onIndexChange?: (index: number) => void
  /** Clicking a photo (feed): open the media viewer at that photo. */
  onOpen?: (index: number) => void
  /**
   * Tourist side: the video plays by itself and loops. In the feed it starts
   * muted (browsers only autoplay muted video) and plays while mostly on
   * screen; in the viewer (opened by a tap) it tries to play with sound.
   */
  autoPlay?: boolean
}

/** Start a video without throwing when the browser blocks it (or has no media support). */
function tryPlay(v: HTMLVideoElement): Promise<boolean> {
  try {
    return Promise.resolve(v.play()).then(() => true, () => false)
  } catch {
    return Promise.resolve(false)
  }
}

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A post's photos or video, never cropped: media keep their own aspect ratio
 * (object-contain) on a dark backdrop, so portrait videos sit centred with
 * black sides. Videos play in place with the browser's controls (pause, sound,
 * fullscreen). Several photos: arrows, swipe and a counter.
 *
 * Autoplay respects "reduce motion": then the video waits for the play button.
 * A video the tourist paused stays paused when it scrolls back into view.
 */
export default function PostMedia({ media, businessName, variant = 'feed', index, onIndexChange, onOpen, autoPlay = false }: Props) {
  const [own, setOwn] = useState(0)
  const touchX = useRef<number | null>(null)
  const photos = media.filter((m) => m.type === 'image')
  const video = media.find((m) => m.type === 'video')
  const current = Math.min(index ?? own, Math.max(photos.length - 1, 0))
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v || !autoPlay || prefersReducedMotion()) return
    let ours = false // a pause we caused (scrolled away), not the tourist's
    let userPaused = false
    const onPause = () => { if (!ours) userPaused = true; ours = false }
    const onPlay = () => { userPaused = false }
    v.addEventListener('pause', onPause)
    v.addEventListener('play', onPlay)

    if (variant === 'viewer') {
      v.muted = false
      void tryPlay(v).then((ok) => { if (!ok) { v.muted = true; void tryPlay(v) } })
    }
    let observer: IntersectionObserver | undefined
    if (variant === 'feed' && typeof IntersectionObserver !== 'undefined') {
      v.muted = true
      observer = new IntersectionObserver(([entry]) => {
        if (entry?.isIntersecting) {
          if (!userPaused && v.paused) void tryPlay(v)
        } else if (!v.paused) {
          ours = true
          v.pause()
        }
      }, { threshold: 0.6 })
      observer.observe(v)
    }
    return () => {
      observer?.disconnect()
      v.removeEventListener('pause', onPause)
      v.removeEventListener('play', onPlay)
    }
  }, [autoPlay, variant, video?.id])
  const go = (i: number) => {
    const next = (i + photos.length) % photos.length
    if (onIndexChange) onIndexChange(next)
    else setOwn(next)
  }

  const frame = variant === 'viewer'
    ? 'h-full w-full'
    : 'h-[min(70vh,560px)] w-full'

  if (video) {
    return (
      <div className={`flex items-center justify-center bg-black ${frame}`}>
        <video
          ref={videoRef}
          src={toAssetUrl(video.path)}
          controls
          playsInline
          loop={autoPlay}
          muted={autoPlay && variant === 'feed'}
          preload={autoPlay ? 'auto' : 'metadata'}
          className="h-full max-h-full w-full max-w-full object-contain"
          aria-label={`Video from ${businessName}`}
        />
      </div>
    )
  }
  if (photos.length === 0) return null

  const onTouchStart = (e: TouchEvent) => { touchX.current = e.touches[0]?.clientX ?? null }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchX.current
    const end = e.changedTouches[0]?.clientX
    touchX.current = null
    if (start == null || end == null || Math.abs(end - start) < 40 || photos.length < 2) return
    go(current + (end < start ? 1 : -1))
  }
  const photo = photos[current]!
  const label = `Photo ${current + 1} of ${photos.length} from ${businessName}`

  return (
    <div className={`relative flex items-center justify-center ${variant === 'viewer' ? 'bg-black' : 'bg-[#101512]'} ${frame}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {onOpen ? (
        <button type="button" onClick={() => onOpen(current)} className="flex h-full w-full items-center justify-center" aria-label={`Open ${label.toLowerCase()} in the viewer`}>
          <img src={toAssetUrl(photo.path)} alt={label} className="max-h-full max-w-full object-contain" loading="lazy" />
        </button>
      ) : (
        <img src={toAssetUrl(photo.path)} alt={label} className="max-h-full max-w-full object-contain" />
      )}
      {photos.length > 1 && (
        <>
          <button type="button" onClick={() => go(current - 1)} aria-label="Previous photo"
            className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[#fff]/90 text-[#17201B] shadow-md hover:bg-[#fff]">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(current + 1)} aria-label="Next photo"
            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[#fff]/90 text-[#17201B] shadow-md hover:bg-[#fff]">
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden="true">
            {photos.map((p, i) => <span key={p.id} className={`h-1.5 rounded-full transition-all ${i === current ? 'w-4 bg-[#fff]' : 'w-1.5 bg-[#fff]/50'}`} />)}
          </div>
          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-semibold text-white" aria-live="polite">{current + 1}/{photos.length}</span>
        </>
      )}
    </div>
  )
}
