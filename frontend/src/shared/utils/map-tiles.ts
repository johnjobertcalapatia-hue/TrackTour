/**
 * Base-map presets shared by the app's Leaflet maps.
 *
 * Only providers whose tiles may be used directly in Leaflet:
 *  - standard:  OpenStreetMap
 *  - dark:      the same free OpenStreetMap tiles, rendered as a navy night
 *               map by a CSS filter (.map-style-dark in index.css). No extra
 *               provider, account, API key or usage plan.
 *  - satellite: Esri World Imagery
 * Google/Mapbox navigation styles cannot be loaded as Leaflet tiles without
 * their own SDK / key, so they are intentionally not offered.
 */
export type MapStyleId = 'standard' | 'dark' | 'satellite'

export interface MapStylePreset {
  id: MapStyleId
  label: string
  url: string
  attribution: string
  subdomains?: string
  maxNativeZoom: number
  /** Extra class on the map container (e.g. the dark tint + background). */
  containerClass?: string
}

export const MAP_STYLES: Record<MapStyleId, MapStylePreset> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    // Slightly dimmed tiles (see .map-style-standard) — easier on the eyes.
    containerClass: 'map-style-standard',
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    // Free: standard OSM tiles, darkened client-side (see .map-style-dark).
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    containerClass: 'map-style-dark',
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    // Esri has imagery over Bansud only up to zoom 18; zoom 19+ returns its
    // "Map data not yet available" placeholder tiles (checked 2026-11-08 at
    // several points across the municipality). Capping the native zoom makes
    // Leaflet enlarge the zoom-18 photo instead of requesting missing tiles.
    maxNativeZoom: 18,
  },
}

export const MAP_STYLE_ORDER: MapStyleId[] = ['standard', 'dark', 'satellite']

const isMapStyle = (v: unknown): v is MapStyleId => typeof v === 'string' && v in MAP_STYLES

/** Read a saved style (per device), falling back to `fallback`. */
export function loadMapStyle(storageKey: string, fallback: MapStyleId = 'standard'): MapStyleId {
  try {
    const saved = localStorage.getItem(storageKey)
    return isMapStyle(saved) ? saved : fallback
  } catch {
    return fallback
  }
}

export function saveMapStyle(storageKey: string, style: MapStyleId): void {
  try {
    localStorage.setItem(storageKey, style)
  } catch {
    // Storage unavailable (private mode): the choice simply isn't remembered.
  }
}
