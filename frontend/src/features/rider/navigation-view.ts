/**
 * Rider map view modes (rider trip flow, Stage C).
 *
 *  - overview:   flat, north-up map; the whole route is framed ("bird's-eye").
 *  - navigation: Google-Maps-style driving view — heading-up (the road ahead
 *                points up), tilted in 3D so the map looks like the ground,
 *                street-level zoom, the rider's position fixed just above the
 *                Go Online button.
 *
 * The tilt is a CSS perspective on the (already rotated) map wrapper; this
 * module holds the geometry so the camera can put the rider exactly at the
 * chosen screen spot despite the perspective.
 */
export type RiderMapViewMode = 'overview' | 'navigation'

/** How far the map tips back in the navigation view (degrees). */
export const NAV_TILT_DEG = 50
/** CSS perspective distance for the tilt (px). Smaller = stronger 3D. */
export const NAV_PERSPECTIVE_PX = 1000
/**
 * The tilted plane's far edge shrinks toward the horizon; make the rotated
 * square this many times the screen diagonal so no blank corner shows.
 */
export const NAV_TILT_SIZE_FACTOR = 1.9
/** Gap between the rider's position puck and the top of the Go Online button. */
export const NAV_PUCK_GAP_PX = 30
/** Half the puck's height (44 px marker): the puck is centred on the rider's position. */
export const NAV_PUCK_HALF_PX = 22

/**
 * A point at `planeY` px below the centre of a plane tilted by `tiltDeg`
 * (rotateX, top away from the viewer) under `perspective` appears at
 *   screenY = planeY·cosθ · p / (p − planeY·sinθ).
 * Inverse: the plane offset that lands at a desired screen offset.
 */
export function planeOffsetForScreenY(screenY: number, tiltDeg = NAV_TILT_DEG, perspective = NAV_PERSPECTIVE_PX): number {
  const t = (tiltDeg * Math.PI) / 180
  return (screenY * perspective) / (perspective * Math.cos(t) + screenY * Math.sin(t))
}

/** Forward projection (used by tests and to verify the inverse). */
export function screenYForPlaneOffset(planeY: number, tiltDeg = NAV_TILT_DEG, perspective = NAV_PERSPECTIVE_PX): number {
  const t = (tiltDeg * Math.PI) / 180
  return (planeY * Math.cos(t) * perspective) / (perspective - planeY * Math.sin(t))
}

/**
 * Where the rider's puck sits in the navigation view, as a screen offset from
 * the centre of the map area: horizontally centred, vertically 30 px above the
 * Go Online / Go Offline button. Falls back to 25 % of the height below the
 * centre when the button isn't on screen.
 */
export function navPuckScreenOffset(mapArea: HTMLElement | null): { x: number; y: number } {
  if (!mapArea || typeof document === 'undefined') return { x: 0, y: 0 }
  const area = mapArea.getBoundingClientRect()
  if (area.width <= 0 || area.height <= 0) return { x: 0, y: 0 }
  const centreY = area.top + area.height / 2
  const button = document.querySelector<HTMLElement>('.rider-availability-button')
  const rect = button?.getBoundingClientRect()
  const anchorY = rect && rect.height > 0
    ? rect.top - NAV_PUCK_GAP_PX - NAV_PUCK_HALF_PX
    : centreY + area.height * 0.25
  const y = Math.max(-area.height / 2 + 80, Math.min(area.height / 2 - NAV_PUCK_HALF_PX, anchorY - centreY))
  return { x: 0, y: Math.round(y) }
}

/**
 * Inverse of the tilt for a whole point: a screen offset (px from the centre
 * of the map area, y down) → the offset on the tilted plane (still turned by
 * the map's bearing). Used to turn a finger drag on the tilted map into the
 * matching map pan. Points above the horizon are clamped just below it.
 */
export function planePointForScreen(screenX: number, screenY: number, tiltDeg = NAV_TILT_DEG, perspective = NAV_PERSPECTIVE_PX): { x: number; y: number } {
  const t = (tiltDeg * Math.PI) / 180
  // The horizon sits at screenY = -p·cosθ/sinθ; stay well below it.
  const minY = -0.8 * perspective * (Math.cos(t) / Math.sin(t))
  const sy = Math.max(minY, screenY)
  const py = planeOffsetForScreenY(sy, tiltDeg, perspective)
  const px = (screenX * (perspective - py * Math.sin(t))) / perspective
  return { x: px, y: py }
}
