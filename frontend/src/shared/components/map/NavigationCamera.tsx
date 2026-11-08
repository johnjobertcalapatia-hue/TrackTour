import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'

/** Navigate zooms in to (at least) this street-level zoom. */
export const NAV_ZOOM = 18

/**
 * Wheel / double-click zoom step in the navigation view: whole levels. The
 * map snaps zoom to whole levels (zoomSnap 1), so a half step would be
 * rounded back while its re-centring still applied: each wheel notch then
 * PANNED the map instead of zooming (reproduced in Chromium, 2026-11-08).
 */
const NAV_ZOOM_STEP = 1

/** Ignore wheel events closer together than this (one notch = one step). */
const WHEEL_THROTTLE_MS = 90

type LatLng = { lat: number; lng: number }

/**
 * Where the map centre must be so `location` lands at `screenOffset` (px from
 * the centre, y down) on a map turned by `bearing` degrees, at `zoom`.
 */
function centreFor(map: L.Map, location: LatLng, bearing: number, screenOffset: { x: number; y: number }, zoom: number): L.LatLngExpression {
  const { x: dx, y: dy } = screenOffset
  if ((dx === 0 && dy === 0) || typeof map.project !== 'function' || typeof map.unproject !== 'function') {
    return [location.lat, location.lng]
  }
  // The screen is the map turned by -bearing. The map centre lies at screen
  // vector (-dx, -dy) from the marker; turn that back by +bearing to get the
  // same vector in (unrotated) map pixels.
  const rad = (bearing * Math.PI) / 180
  const vx = -dx
  const vy = -dy
  const p = map.project([location.lat, location.lng], zoom)
  return map.unproject(
    L.point(p.x + vx * Math.cos(rad) - vy * Math.sin(rad), p.y + vx * Math.sin(rad) + vy * Math.cos(rad)),
    zoom,
  )
}

/**
 * Navigation view camera: on "Navigate" it zooms in and puts the user's marker
 * at `screenOffset`, then keeps it there as they move while the map (rotated
 * by the wrapper) keeps the travel direction up. Shared by the tourist
 * Explore map and the rider map.
 *
 * The marker stays anchored to the user's real position while zooming:
 *  - dragging is off;
 *  - wheel and double-click zoom AROUND THE USER (setZoomAround), so the
 *    marker never moves during the zoom;
 *  - pinch zoom (Leaflet can only anchor it at the screen centre) is snapped
 *    back onto the user when the gesture ends;
 *  - `recenterSignal` (the "My location" button) re-centres at street zoom.
 */
export function NavigationCamera({ active, location, bearing, screenOffset, recenterSignal = 0 }: {
  active: boolean
  location: LatLng | null
  /** Map bearing (degrees): the screen's "up" points this way. */
  bearing: number
  /** Where the marker sits on screen, relative to the map centre (px, y down). */
  screenOffset: { x: number; y: number }
  /** Increment to re-centre on the user at street-level zoom. */
  recenterSignal?: number
}) {
  const map = useMap()
  const enteredRef = useRef(false)
  const lastRecenter = useRef(recenterSignal)
  // Latest inputs for the event handlers (registered once per activation).
  const latest = useRef({ location, bearing, screenOffset })
  latest.current = { location, bearing, screenOffset }

  /** Put the user back at the marker's screen spot, keeping `zoom`. */
  const anchor = (zoom: number, animate: boolean) => {
    const { location: loc, bearing: b, screenOffset: off } = latest.current
    if (!loc) return
    map.setView(centreFor(map, loc, b, off, zoom), zoom, { animate })
  }

  useEffect(() => {
    if (!active) return
    const opts = (map as unknown as { options?: Record<string, unknown> }).options
    const saved = opts ? { scrollWheelZoom: opts.scrollWheelZoom, touchZoom: opts.touchZoom, doubleClickZoom: opts.doubleClickZoom } : null
    if (opts) opts.touchZoom = 'center'
    // Wheel and double-click are handled here so they zoom around the user.
    map.scrollWheelZoom?.disable()
    map.doubleClickZoom?.disable()
    map.dragging?.disable()

    const clampZoom = (z: number) => Math.min(map.getMaxZoom?.() ?? 20, Math.max(map.getMinZoom?.() ?? 0, z))
    /** Zoom one whole level in (+1) or out (-1) around the user; no-op at the limits. */
    const zoomAroundUser = (direction: 1 | -1) => {
      const loc = latest.current.location
      if (!loc) return
      const current = Math.round(map.getZoom?.() ?? NAV_ZOOM)
      const next = clampZoom(current + direction * NAV_ZOOM_STEP)
      if (next === current) return
      if (typeof map.setZoomAround === 'function') map.setZoomAround([loc.lat, loc.lng], next, { animate: false })
      // Exactly back under the marker (also covers any rounding).
      anchor(map.getZoom?.() ?? next, false)
    }

    let lastWheel = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheel < WHEEL_THROTTLE_MS || e.deltaY === 0) return
      lastWheel = now
      zoomAroundUser(e.deltaY < 0 ? 1 : -1)
    }
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault()
      zoomAroundUser(e.shiftKey ? -1 : 1)
    }
    // Pinch zoom ends anchored at the screen centre: put the user back.
    const onZoomEnd = () => anchor(map.getZoom?.() ?? NAV_ZOOM, false)

    const container = map.getContainer?.()
    container?.addEventListener('wheel', onWheel, { passive: false })
    container?.addEventListener('dblclick', onDblClick)
    map.on?.('zoomend', onZoomEnd)

    return () => {
      container?.removeEventListener('wheel', onWheel)
      container?.removeEventListener('dblclick', onDblClick)
      map.off?.('zoomend', onZoomEnd)
      map.dragging?.enable()
      map.scrollWheelZoom?.enable()
      map.doubleClickZoom?.enable()
      if (opts && saved) Object.assign(opts, saved)
      map.invalidateSize?.({ pan: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, map])

  useEffect(() => {
    if (!active) {
      enteredRef.current = false
      return
    }
    if (!location) return
    // The rotator just resized to the map's diagonal: let Leaflet re-measure
    // so "centre" is the true middle of the screen.
    map.invalidateSize?.({ pan: false })
    // Entering (or "My location"): zoom in to street level. Otherwise keep the user's zoom.
    const recenter = recenterSignal !== lastRecenter.current
    lastRecenter.current = recenterSignal
    const current = map.getZoom?.() ?? NAV_ZOOM
    const zoom = !enteredRef.current || recenter ? Math.max(current, NAV_ZOOM) : current
    enteredRef.current = true
    map.setView(centreFor(map, location, bearing, screenOffset, zoom), zoom, { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, location?.lat, location?.lng, Math.round(bearing), screenOffset.x, screenOffset.y, recenterSignal, map])

  return null
}
