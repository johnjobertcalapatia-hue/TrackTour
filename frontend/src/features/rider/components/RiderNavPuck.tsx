import { NAV_PERSPECTIVE_PX, NAV_TILT_DEG } from '@/features/rider/navigation-view'

/**
 * The rider's position in the navigation view: the SAME marker as the
 * overview map (riderNavigationMarkerIcon) — a green circle with a white ring
 * and a white arrow. The map is heading-up, so the arrow points up (the way
 * the rider is going). No shadow or glow (product decision).
 *
 * Drawn as a fixed screen overlay — not inside the tilted map — so it never
 * turns with the map and stays crisp. Its centre is the
 * rider's exact position: the navigation camera keeps the real position under
 * it while moving and zooming.
 *
 * It lies back at the map's own tilt (same angle and perspective as the
 * markers drawn on the tilted map), around its centre, so it looks flat on the
 * ground without leaving the rider's position.
 */
export function RiderNavPuck({ offsetY, offsetX = 0, perspective = NAV_PERSPECTIVE_PX }: { offsetY: number; offsetX?: number; perspective?: number }) {
  return (
    <div
      data-testid="rider-nav-puck"
      aria-label="Your location"
      role="img"
      className="pointer-events-none absolute left-1/2 top-1/2 z-[500]"
      style={{ transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))` }}
    >
      {/* Same geometry and colours as riderNavigationMarkerIcon (shared/utils/map-markers.ts). */}
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        aria-hidden="true"
        data-testid="rider-nav-puck-marker"
        className="block"
        style={{ transform: `perspective(${perspective}px) rotateX(${NAV_TILT_DEG}deg)`, transformOrigin: '50% 50%' }}
      >
        <circle cx="22" cy="22" r="16.5" fill="#087F3F" stroke="#FFFFFF" strokeWidth="3" />
        <path d="M 22 10 L 30 29 L 22 24 L 14 29 Z" fill="#FFFFFF" />
      </svg>
    </div>
  )
}
