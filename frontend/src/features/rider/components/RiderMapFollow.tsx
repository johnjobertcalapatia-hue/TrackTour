import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'

/** Street-level zoom used when the map focuses on the rider. */
export const RIDER_FOCUS_ZOOM = 17

/** Movements smaller than this (metres) don't re-pan; avoids GPS jitter churn. */
const FOLLOW_THRESHOLD_M = 5

const metresBetween = (a: [number, number], b: [number, number]) => {
  const dLat = (b[0] - a[0]) * 111_320
  const dLng = (b[1] - a[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

const isRealPoint = ([lat, lng]: [number, number]) =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)

/**
 * Keeps the rider map focused on the rider's own position.
 *
 *  - Ignores positions until a real location exists (`hasFix`), so the map
 *    never "settles" on the placeholder town centre.
 *  - The first real fix (and every re-focus) zooms in to street level on the
 *    rider; afterwards the map follows the marker as it moves.
 *  - Dragging the map pauses following (`onFollowChange(false)`) so the rider
 *    can look around; `focusSignal` (the "My location" button / going online)
 *    re-centres and resumes following.
 *  - The marker sits at the CENTRE of the visible screen: Leaflet's size is
 *    re-measured (invalidateSize) before every focus and whenever the visible
 *    viewport changes (mobile address/tool bars showing or hiding, rotation),
 *    otherwise Leaflet keeps a stale size and "centres" the rider low on the
 *    screen.
 */
export function RiderMapFollow({
  center,
  hasFix,
  following,
  focusSignal,
  onFollowChange,
  overview = null,
}: {
  center: [number, number]
  hasFix: boolean
  following: boolean
  /** Increment to force a re-focus at street level. */
  focusSignal: number
  onFollowChange: (following: boolean) => void
  /**
   * Trip overview: when `key` changes (a new trip, or the switch from the
   * pickup leg to the drop-off leg), frame all `points` (rider + target) once
   * so the whole route is visible. Following then continues at that zoom.
   */
  overview?: { key: string; points: [number, number][] } | null
}) {
  const map = useMap()
  const focusedOnce = useRef(false)
  const lastPanned = useRef<[number, number] | null>(null)
  const lastSignal = useRef(focusSignal)
  const latest = useRef({ center, hasFix, following })
  latest.current = { center, hasFix, following }

  /** Re-measure, then put the rider at the exact centre of the visible map. */
  const centreOnRider = (zoom?: number) => {
    map.invalidateSize({ pan: false })
    const { center: c } = latest.current
    if (zoom !== undefined) map.setView(c, zoom, { animate: true })
    else map.panTo(c, { animate: true, duration: 0.5 })
    lastPanned.current = c
  }

  // The visible viewport changes on phones (address bar, toolbars, keyboard,
  // rotation): re-measure and keep the rider centred while following.
  useEffect(() => {
    const onResize = () => {
      map.invalidateSize({ pan: false })
      const { center: c, hasFix: fix, following: follow } = latest.current
      if (fix && follow && isRealPoint(c) && focusedOnce.current) {
        map.panTo(c, { animate: false })
        lastPanned.current = c
      }
    }
    const vv = window.visualViewport
    vv?.addEventListener('resize', onResize)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      vv?.removeEventListener('resize', onResize)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [map])

  // Zooming (wheel, pinch, double-tap) normally zooms around the cursor/finger,
  // which shifts the map sideways and drags the centred marker left or right.
  // While following, zoom around the CENTRE instead (Leaflet reads these
  // options at gesture time), and snap back to the rider after each zoom.
  // While the rider is exploring (not following), zoom behaves normally.
  useEffect(() => {
    const opts = map.options as L.MapOptions
    const mode: boolean | 'center' = following ? 'center' : true
    opts.scrollWheelZoom = mode
    opts.touchZoom = mode
    opts.doubleClickZoom = mode
  }, [map, following])

  useEffect(() => {
    const onZoomEnd = () => {
      const { center: c, hasFix: fix, following: follow } = latest.current
      if (!fix || !follow || !isRealPoint(c) || !focusedOnce.current) return
      map.panTo(c, { animate: false })
      lastPanned.current = c
    }
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [map])

  // A user drag pauses following; programmatic pans don't fire dragstart.
  useEffect(() => {
    const onDrag = () => onFollowChange(false)
    map.on('dragstart', onDrag)
    return () => { map.off('dragstart', onDrag) }
  }, [map, onFollowChange])

  // Explicit re-focus ("My location", going online).
  useEffect(() => {
    if (focusSignal === lastSignal.current) return
    lastSignal.current = focusSignal
    if (!hasFix || !isRealPoint(center)) return
    centreOnRider(Math.max(map.getZoom(), RIDER_FOCUS_ZOOM))
    focusedOnce.current = true
    onFollowChange(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal, hasFix, center, map, onFollowChange])

  // First real fix: zoom in on the rider. Then follow while enabled.
  useEffect(() => {
    if (!hasFix || !isRealPoint(center)) return

    if (!focusedOnce.current) {
      focusedOnce.current = true
      centreOnRider(RIDER_FOCUS_ZOOM)
      return
    }

    if (!following) return
    if (lastPanned.current && metresBetween(lastPanned.current, center) < FOLLOW_THRESHOLD_M) return
    centreOnRider()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, hasFix, following, map])

  // Trip overview (runs after the first-fix focus so it takes precedence).
  const lastOverviewKey = useRef<string | null>(null)
  useEffect(() => {
    if (!overview || !hasFix) return
    const points = overview.points.filter(isRealPoint)
    if (points.length < 2 || lastOverviewKey.current === overview.key) return
    lastOverviewKey.current = overview.key
    map.invalidateSize({ pan: false })
    map.fitBounds(L.latLngBounds(points), {
      // Extra bottom space: the rider status / action panel covers the lower screen.
      paddingTopLeft: [60, 90],
      paddingBottomRight: [60, 260],
      maxZoom: RIDER_FOCUS_ZOOM,
      animate: true,
    })
    focusedOnce.current = true
    lastPanned.current = latest.current.center
    onFollowChange(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.key, overview?.points, hasFix, map])

  return null
}
