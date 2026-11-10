import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'

/** Navigate zooms in to (at least) this street-level zoom. */
export const NAV_ZOOM = 18

/**
 * Wheel / double-click zoom step WITHOUT explore gestures (tourist map): whole
 * levels. That map snaps zoom to whole levels (zoomSnap 1), so a half step
 * would be rounded back while its re-centring still applied: each wheel notch
 * then PANNED the map instead of zooming (reproduced in Chromium, 2026-11-08).
 */
const NAV_ZOOM_STEP = 1

/** Ignore wheel events closer together than this (whole-step wheel only). */
const WHEEL_THROTTLE_MS = 90

/** A press must move this far (px) before it counts as a drag, not a tap. */
const DRAG_START_PX = 6

/** Explore wheel zoom: levels per wheel pixel (a mouse notch ≈ 100 px ≈ half a level). */
const WHEEL_ZOOM_PER_PX = 1 / 200
/** One wheel event never zooms more than this. */
const MAX_WHEEL_ZOOM = 1

/** Desktop rotate (right-drag or Ctrl+drag): degrees per px moved sideways. */
const ROTATE_DEG_PER_PX = 0.4

/**
 * While following, a two-finger gesture only zooms (around the user, who
 * stays under the puck) — until it twists or slides this much, which turns
 * it into exploring (pan + zoom + rotate around the fingers).
 */
const PINCH_EXPLORE_TWIST_DEG = 12
const PINCH_EXPLORE_SLIDE_PX = 40

type LatLng = { lat: number; lng: number }
type Point = { x: number; y: number }

/** Turn a vector by `deg` degrees (screen convention: y down, clockwise positive). */
function turn(v: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) }
}

/** A real Leaflet map whose map.remove() already ran (it deletes the map pane). */
function isRemovedLeafletMap(map: L.Map): boolean {
  return typeof L.Map === 'function' && map instanceof L.Map && (map as unknown as { _mapPane?: unknown })._mapPane === undefined
}

/** Degrees in [0, 360). */
function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Smallest signed difference a - b in degrees, in (-180, 180]. */
function angleDiff(a: number, b: number): number {
  const d = normDeg(a - b)
  return d > 180 ? d - 360 : d
}

/**
 * Where the map centre must be so `location` lands at `screenOffset` (px from
 * the centre, y down) on a map turned by `bearing` degrees, at `zoom`.
 */
function centreFor(map: L.Map, location: LatLng, bearing: number, screenOffset: Point, zoom: number): L.LatLngExpression {
  const { x: dx, y: dy } = screenOffset
  if ((dx === 0 && dy === 0) || typeof map.project !== 'function' || typeof map.unproject !== 'function') {
    return [location.lat, location.lng]
  }
  // The screen is the map turned by -bearing. The map centre lies at screen
  // vector (-dx, -dy) from the marker; turn that back by +bearing to get the
  // same vector in (unrotated) map pixels.
  const v = turn({ x: -dx, y: -dy }, bearing)
  const p = map.project([location.lat, location.lng], zoom)
  return map.unproject(L.point(p.x + v.x, p.y + v.y), zoom)
}

/**
 * Navigation view camera: on "Navigate" it zooms in and puts the user's marker
 * at `screenOffset`, then keeps it there as they move while the map (rotated
 * by the wrapper) keeps the travel direction up. Shared by the tourist
 * Explore map and the rider map.
 *
 * While FOLLOWING, the marker stays anchored to the user's real position:
 *  - dragging is off; wheel / double-click / pinch zoom AROUND THE USER;
 *  - `recenterSignal` (the "My location" button) re-centres at street zoom.
 *
 * EXPLORE gestures (opt-in with `onFreeLookChange`; Google-Maps-like):
 *  - one-finger / mouse drag pans: the map moves with the finger (forward,
 *    backward, sideways — whatever way the finger goes);
 *  - two fingers: pinch zooms around the fingers, twist rotates the map,
 *    sliding pans;
 *  - mouse wheel / trackpad zooms smoothly around the RIDER (their marker
 *    never moves while scrolling — following or exploring);
 *  - right-drag or Ctrl+drag rotates (desktop);
 *  - the first pan / twist enters free look (`onFreeLookChange(true)`): the
 *    camera stops following; rotations are reported with `onBearingChange`
 *    (the parent owns the bearing); `onGestureChange` tells the parent a
 *    gesture is running (so it can drop its rotation easing).
 *  Screen points are mapped onto the (tilted) map plane with
 *  `screenToPlanePoint`, then the rotation is undone with the bearing, so the
 *  spot under the finger stays under the finger.
 */
export function NavigationCamera({
  active,
  location,
  bearing,
  screenOffset,
  recenterSignal = 0,
  freeLook = false,
  onFreeLookChange,
  onBearingChange,
  onGestureChange,
  screenToPlanePoint,
}: {
  active: boolean
  location: LatLng | null
  /** Map bearing (degrees): the screen's "up" points this way. */
  bearing: number
  /** Where the marker sits on screen, relative to the map centre (px, y down). */
  screenOffset: Point
  /** Increment to re-centre on the user at street-level zoom. */
  recenterSignal?: number
  /** The user is exploring the map: don't follow them. */
  freeLook?: boolean
  /** Enables explore gestures: called with true on the first pan/twist, false on re-centre. */
  onFreeLookChange?: (free: boolean) => void
  /** Explore rotation (twist / right-drag): the new bearing. */
  onBearingChange?: (bearing: number) => void
  /** An explore gesture started (true) / ended (false). */
  onGestureChange?: (active: boolean) => void
  /**
   * A screen point (client px) → the same point on the map plane, as an
   * offset from the plane's centre (px, still turned by the bearing). Undoes
   * a tilt on the map wrapper; defaults to no tilt.
   */
  screenToPlanePoint?: (p: Point) => Point
}) {
  const map = useMap()
  const enteredRef = useRef(false)
  const lastRecenter = useRef(recenterSignal)
  // Latest inputs for the event handlers (registered once per activation).
  const latest = useRef({ location, bearing, screenOffset, freeLook, onFreeLookChange, onBearingChange, onGestureChange, screenToPlanePoint })
  latest.current = { location, bearing, screenOffset, freeLook, onFreeLookChange, onBearingChange, onGestureChange, screenToPlanePoint }

  /** Put the user back at the marker's screen spot, keeping `zoom`. */
  const anchor = (zoom: number, animate: boolean) => {
    const { location: loc, bearing: b, screenOffset: off } = latest.current
    if (!loc) return
    map.setView(centreFor(map, loc, b, off, zoom), zoom, { animate })
  }

  useEffect(() => {
    if (!active) return
    const explore = typeof latest.current.onFreeLookChange === 'function'
    const opts = (map as unknown as { options?: Record<string, unknown> }).options
    const saved = opts
      ? { scrollWheelZoom: opts.scrollWheelZoom, touchZoom: opts.touchZoom, doubleClickZoom: opts.doubleClickZoom, zoomSnap: opts.zoomSnap }
      : null
    if (opts) {
      opts.touchZoom = 'center'
      // Explore: smooth (fractional) zoom for pinch and wheel, like Google Maps.
      if (explore) opts.zoomSnap = 0
    }
    // Wheel and double-click are handled here so they zoom around the user.
    map.scrollWheelZoom?.disable()
    map.doubleClickZoom?.disable()
    map.dragging?.disable()
    // Explore handles two-finger gestures itself (zoom + twist + slide).
    if (explore) map.touchZoom?.disable()

    // Leaving the page: Leaflet may destroy the map before this effect's
    // cleanup runs (map.remove() fires "unload").
    let removed = false
    const onUnload = () => { removed = true }
    map.on?.('unload', onUnload)

    const clampZoom = (z: number) => Math.min(map.getMaxZoom?.() ?? 20, Math.max(map.getMinZoom?.() ?? 0, z))
    const container = map.getContainer?.()

    /** Zoom by `dz` levels around the user, keeping them under the marker. */
    const zoomAroundUserBy = (dz: number) => {
      const loc = latest.current.location
      if (!loc) return
      const current = map.getZoom?.() ?? NAV_ZOOM
      const next = clampZoom(current + dz)
      if (next === current) return
      if (typeof map.setZoomAround === 'function') map.setZoomAround([loc.lat, loc.lng], next, { animate: false })
      // Exactly back under the marker (also covers any rounding).
      anchor(map.getZoom?.() ?? next, false)
    }
    /** Whole-step zoom around the user (no explore: the tourist map). */
    const stepAroundUser = (direction: 1 | -1) => {
      const current = Math.round(map.getZoom?.() ?? NAV_ZOOM)
      const next = clampZoom(current + direction * NAV_ZOOM_STEP)
      if (next === current) return
      zoomAroundUserBy(next - (map.getZoom?.() ?? current))
    }

    /** Client point → plane offset from the centre (px, turned by the bearing). */
    const toPlane = (p: Point): Point => {
      const fn = latest.current.screenToPlanePoint
      if (fn) return fn(p)
      const r = container?.getBoundingClientRect()
      return r ? { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) } : p
    }
    /** Plane offset → Leaflet container point (the container is the unturned plane). */
    const containerPointFor = (p: Point, b: number): L.Point => {
      const size = map.getSize?.() ?? L.point(0, 0)
      const c = turn(p, b)
      return L.point(size.x / 2 + c.x, size.y / 2 + c.y)
    }
    /** The map spot shown at plane point `p` right now. */
    const latLngAt = (p: Point): LatLng => {
      const ll = map.containerPointToLatLng(containerPointFor(p, latest.current.bearing))
      return { lat: ll.lat, lng: ll.lng }
    }

    /**
     * Show map spot `spot` at plane point `p`, at zoom `z` and bearing `b`.
     * Gestures always place the spot grabbed at their start (not step by
     * step): Leaflet rounds the view to whole pixels on every change, and
     * step-by-step zooming let that rounding pile up — 30 px off after a
     * 60-event pinch (measured in Chromium, 2026-11-09).
     */
    const place = (spot: LatLng, p: Point, z: number, b: number) => {
      const nz = clampZoom(z)
      const nb = normDeg(b)
      if (Math.abs(angleDiff(nb, latest.current.bearing)) > 1e-6) {
        latest.current.bearing = nb // until the parent re-renders with it
        latest.current.onBearingChange?.(nb)
      }
      map.setView(centreFor(map, spot, nb, p, nz), nz, { animate: false })
    }

    let gestureOn = false
    let moved = false
    /** A pan / twist turns following into exploring. */
    const beginExplore = () => {
      moved = true
      if (!latest.current.freeLook) latest.current.onFreeLookChange?.(true)
      latest.current.freeLook = true // until the parent re-renders
      if (!gestureOn) {
        gestureOn = true
        latest.current.onGestureChange?.(true)
      }
    }

    // ── Wheel / double-click ─────────────────────────────────────────────
    /**
     * Exploring: zoom by `dz` around the RIDER — their marker stays exactly
     * where it is on screen (product decision 2026-11-09: scrolling never
     * moves the marker, never zooms around the cursor).
     */
    const zoomAtUser = (dz: number) => {
      const loc = latest.current.location
      if (!loc || typeof map.latLngToContainerPoint !== 'function') return
      const b = latest.current.bearing
      const size = map.getSize?.() ?? L.point(0, 0)
      const cp = map.latLngToContainerPoint([loc.lat, loc.lng])
      // Container point → plane offset: undo the turn.
      const p = turn({ x: cp.x - size.x / 2, y: cp.y - size.y / 2 }, -b)
      place(loc, p, (map.getZoom?.() ?? NAV_ZOOM) + dz, b)
    }
    /** Following: zoom by `dz`, the user staying under the marker. */
    const zoomFollowing = (dz: number) => {
      if (!latest.current.location) return
      anchor(clampZoom((map.getZoom?.() ?? NAV_ZOOM) + dz), false)
    }
    let lastWheel = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY === 0) return
      if (!explore) {
        const now = Date.now()
        if (now - lastWheel < WHEEL_THROTTLE_MS) return
        lastWheel = now
        stepAroundUser(e.deltaY < 0 ? 1 : -1)
        return
      }
      const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1)
      const dz = Math.max(-MAX_WHEEL_ZOOM, Math.min(MAX_WHEEL_ZOOM, -px * WHEEL_ZOOM_PER_PX))
      // Always around the rider: following, they stay under the puck;
      // exploring, their marker stays where it is on screen.
      if (latest.current.freeLook) zoomAtUser(dz)
      else zoomFollowing(dz)
    }
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault()
      const direction = e.shiftKey ? -1 : 1
      if (!explore) return stepAroundUser(direction)
      if (latest.current.freeLook) zoomAtUser(direction)
      else zoomFollowing(direction)
    }
    // Pinch zoom (Leaflet's, tourist map) ends anchored at the screen centre:
    // put the user back — unless they are exploring the map.
    const onZoomEnd = () => {
      if (latest.current.freeLook) return
      anchor(map.getZoom?.() ?? NAV_ZOOM, false)
    }

    // ── Explore pointer gestures ─────────────────────────────────────────
    type Mode = 'idle' | 'pending' | 'pan' | 'rotate-pending' | 'rotate' | 'pinch'
    const pts = new Map<number, Point>()
    let mode: Mode = 'idle'
    let pressStart: Point = { x: 0, y: 0 }
    /** Two-finger gesture while following: zoom only, until it twists/slides. */
    let pinchFollowing = false
    /** What the running gesture holds on to: its start state. */
    let grip: { spot: LatLng; zoom: number; bearing: number; dist: number; angle: number; mid: Point; x: number } | null = null

    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    const twoFinger = () => {
      const [a, b] = [...pts.values()]
      const pa = toPlane(a!)
      const pb = toPlane(b!)
      return {
        mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
        dist: Math.hypot(pb.x - pa.x, pb.y - pa.y),
        angle: (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI,
      }
    }
    /** Hold the map spot under plane point `p` (and the current view) for this gesture. */
    const gripAt = (p: Point, extra: { dist?: number; angle?: number; x?: number } = {}) => {
      grip = {
        spot: latLngAt(p),
        zoom: map.getZoom?.() ?? NAV_ZOOM,
        bearing: latest.current.bearing,
        dist: extra.dist ?? 0,
        angle: extra.angle ?? 0,
        mid: p,
        x: extra.x ?? 0,
      }
    }
    const gripTwoFinger = () => {
      const g = twoFinger()
      gripAt(g.mid, { dist: g.dist, angle: g.angle })
    }
    const listen = (on: boolean) => {
      if (on) {
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerUp)
      } else {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      if (pts.size >= 2) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        moved = false
        pressStart = { x: e.clientX, y: e.clientY }
        const wantsRotate = e.pointerType === 'mouse' && (e.button === 2 || e.ctrlKey)
        mode = wantsRotate ? 'rotate-pending' : 'pending'
        listen(true)
      } else {
        mode = 'pinch'
        pinchFollowing = !latest.current.freeLook
        gripTwoFinger()
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pts.has(e.pointerId)) return
      const at = { x: e.clientX, y: e.clientY }

      if (mode === 'pending' || mode === 'rotate-pending') {
        if (Math.hypot(at.x - pressStart.x, at.y - pressStart.y) < DRAG_START_PX) return
        beginExplore()
        if (mode === 'pending') {
          mode = 'pan'
          gripAt(toPlane(pressStart))
        } else {
          mode = 'rotate'
          gripAt({ x: 0, y: 0 }, { x: pressStart.x })
        }
      }
      pts.set(e.pointerId, at)
      if (!grip) return

      if (mode === 'pan') {
        // The spot grabbed stays under the finger: forward, back, sideways.
        place(grip.spot, toPlane(at), grip.zoom, grip.bearing)
        return
      }
      if (mode === 'rotate') {
        // Desktop: sideways mouse movement turns the map around the screen centre.
        place(grip.spot, { x: 0, y: 0 }, grip.zoom, grip.bearing - (at.x - grip.x) * ROTATE_DEG_PER_PX)
        return
      }
      if (mode === 'pinch' && pts.size === 2) {
        const g = twoFinger()
        const zoom = grip.zoom + (grip.dist > 0 && g.dist > 0 ? Math.log2(g.dist / grip.dist) : 0)
        if (pinchFollowing) {
          const twisted = Math.abs(angleDiff(g.angle, grip.angle)) > PINCH_EXPLORE_TWIST_DEG
          const slid = Math.hypot(g.mid.x - grip.mid.x, g.mid.y - grip.mid.y) > PINCH_EXPLORE_SLIDE_PX
          if (!twisted && !slid) {
            // Following: zoom only; the user stays under the marker.
            moved = true
            if (latest.current.location) anchor(clampZoom(zoom), false)
            return
          }
          // Turned into exploring: from here on, hold what is under the fingers now.
          pinchFollowing = false
          beginExplore()
          gripTwoFinger()
          return
        }
        // Zoom around, turn with and slide with the fingers.
        place(grip.spot, g.mid, zoom, grip.bearing - angleDiff(g.angle, grip.angle))
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!pts.has(e.pointerId)) return
      pts.delete(e.pointerId)
      if (pts.size === 1) {
        // A finger lifted from a pinch: the other one carries on panning.
        const [rest] = [...pts.values()]
        pressStart = rest!
        if (latest.current.freeLook) {
          mode = 'pan'
          gripAt(toPlane(rest!))
        } else {
          mode = 'pending'
          grip = null
        }
        return
      }
      if (pts.size > 0) return
      if (moved) {
        // The press ended on whatever was under it: don't let that count as a tap.
        container?.addEventListener('click', swallowClick, { capture: true, once: true })
        setTimeout(() => container?.removeEventListener('click', swallowClick, { capture: true }), 0)
      }
      mode = 'idle'
      grip = null
      listen(false)
      if (gestureOn) {
        gestureOn = false
        latest.current.onGestureChange?.(false)
      }
    }
    const onContextMenu = (e: Event) => e.preventDefault() // right-drag rotates

    const savedTouchAction = container?.style.touchAction ?? ''
    container?.addEventListener('wheel', onWheel, { passive: false })
    container?.addEventListener('dblclick', onDblClick)
    if (explore && container) {
      // With Leaflet's dragging off, the browser would claim finger moves.
      container.style.touchAction = 'none'
      container.addEventListener('pointerdown', onPointerDown)
      container.addEventListener('contextmenu', onContextMenu)
    }
    map.on?.('zoomend', onZoomEnd)

    return () => {
      container?.removeEventListener('wheel', onWheel)
      container?.removeEventListener('dblclick', onDblClick)
      if (explore && container) {
        container.style.touchAction = savedTouchAction
        container.removeEventListener('pointerdown', onPointerDown)
        container.removeEventListener('contextmenu', onContextMenu)
        container.removeEventListener('click', swallowClick, { capture: true })
      }
      listen(false)
      if (gestureOn) latest.current.onGestureChange?.(false)
      map.off?.('zoomend', onZoomEnd)
      map.off?.('unload', onUnload)
      if (opts && saved) Object.assign(opts, saved)
      // Leaving the page in the Navigation view: Leaflet may already have
      // destroyed the map (map.remove() deletes its panes), and any view call
      // then throws "Cannot read properties of undefined (reading
      // '_leaflet_pos')" (reported 2026-11-09). Only restore a live map.
      if (removed || isRemovedLeafletMap(map)) return
      map.dragging?.enable()
      map.scrollWheelZoom?.enable()
      map.doubleClickZoom?.enable()
      if (explore) map.touchZoom?.enable()
      // Back to whole zoom levels for the overview.
      if (explore) {
        const z = map.getZoom?.()
        if (typeof z === 'number' && !Number.isInteger(z)) map.setZoom?.(Math.round(z), { animate: false })
      }
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
    // "My location" ends free look (the parent normally clears it already).
    if (recenter && freeLook) onFreeLookChange?.(false)
    // Exploring the map: leave the camera where the user put it.
    else if (freeLook) return
    const current = map.getZoom?.() ?? NAV_ZOOM
    const zoom = !enteredRef.current || recenter ? Math.max(current, NAV_ZOOM) : current
    enteredRef.current = true
    map.setView(centreFor(map, location, bearing, screenOffset, zoom), zoom, { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, location?.lat, location?.lng, Math.round(bearing), screenOffset.x, screenOffset.y, recenterSignal, freeLook, map])

  return null
}
