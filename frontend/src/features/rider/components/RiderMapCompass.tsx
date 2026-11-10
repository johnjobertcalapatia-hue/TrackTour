import { cn } from '@/shared/utils'

/**
 * Compass for the rider's (and tourist's) navigation view (like Google Maps). The needle's
 * red tip always points to north on screen: the map turns by `bearing`, so
 * the needle turns the other way. Tap: face north (in heading-up, or while
 * exploring); tap again in north-up: back to the travel direction.
 */
export function RiderMapCompass({ bearing, northUp, onClick, className }: {
  /** Map bearing (degrees): the screen's "up" points this way. */
  bearing: number
  /** The map is north-up now. */
  northUp: boolean
  onClick: () => void
  /** Extra / overriding classes (e.g. the tourist map's square buttons). */
  className?: string
}) {
  const label = northUp ? 'Compass: north up. Tap to face your travel direction' : 'Compass: tap to face north'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={northUp ? 'Face travel direction' : 'Face north'}
      aria-pressed={northUp}
      className={cn('w-11 h-11 rounded-full border bg-white/95 border-[#E4E9E6] shadow-md flex items-center justify-center backdrop-blur transition hover:bg-white', className)}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        aria-hidden="true"
        data-testid="rider-map-compass-needle"
        style={{ transform: `rotate(${-bearing}deg)`, transition: 'transform 0.2s ease-out' }}
      >
        <text x="14" y="6.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="#DC2626">N</text>
        <path d="M14 8 L17.5 15 L14 14 L10.5 15 Z" fill="#DC2626" />
        <path d="M14 22 L17.5 15 L14 16 L10.5 15 Z" fill="#9CA3AF" />
      </svg>
    </button>
  )
}
