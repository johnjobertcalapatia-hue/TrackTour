import { useEffect } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'

/**
 * The whole Philippines (Batanes → Tawi-Tawi, Palawan → Davao Oriental) with
 * a small margin. Used as the farthest a map may zoom out / be panned.
 */
export const PHILIPPINES_BOUNDS = L.latLngBounds([4.2, 116.0], [21.3, 127.2])
const PAN_MARGIN = 0.15 // fraction of the bounds allowed beyond the edges when panning

/**
 * Limits zoom-out so the farthest view still shows the whole Philippines
 * (and never more of the world), and keeps panning inside the country.
 * The zoom level that fits depends on the screen size, so it is recomputed
 * on load and whenever the map container resizes.
 */
export function MapZoomOutLimit({ bounds = PHILIPPINES_BOUNDS }: { bounds?: L.LatLngBounds }) {
  const map = useMap()

  useEffect(() => {
    const apply = () => {
      map.invalidateSize({ pan: false })
      // Largest zoom at which the whole bounds is still visible.
      const fitZoom = map.getBoundsZoom(bounds, false)
      map.setMinZoom(fitZoom)
      if (map.getZoom() < fitZoom) map.setZoom(fitZoom)
    }

    map.setMaxBounds(bounds.pad(PAN_MARGIN))
    map.options.maxBoundsViscosity = 1
    apply()
    map.on('resize', apply)
    return () => { map.off('resize', apply) }
  }, [map, bounds])

  return null
}
