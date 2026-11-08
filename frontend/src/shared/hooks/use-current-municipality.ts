import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'

export interface CurrentMunicipality {
  id: number
  name: string
  province?: string | null
  /** Municipality cover photo set by the Tourism Office (storage path or URL). */
  cover_photo?: string | null
  distance_km?: number
}

/** Shown until (or unless) the tourist's location resolves to a covered municipality. */
export const DEFAULT_MUNICIPALITY_NAME = 'Bansud'

const CACHE_KEY = 'tt_current_municipality'
const CACHE_TTL_MS = 10 * 60 * 1000

interface CacheEntry {
  at: number
  value: CurrentMunicipality | null
}

function readCache(): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    return Date.now() - entry.at < CACHE_TTL_MS ? entry : null
  } catch {
    return null
  }
}

function writeCache(value: CurrentMunicipality | null) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), value }))
  } catch {
    /* storage unavailable: just skip caching */
  }
}

/**
 * The municipality the tourist is currently in, from browser geolocation →
 * GET /municipalities/locate. Resolves to null when location is unavailable,
 * denied, or outside the covered municipalities; callers fall back to
 * DEFAULT_MUNICIPALITY_NAME. Cached per session for 10 minutes so page
 * changes don't re-query.
 */
export function useCurrentMunicipality(): CurrentMunicipality | null {
  const [municipality, setMunicipality] = useState<CurrentMunicipality | null>(() => readCache()?.value ?? null)

  useEffect(() => {
    if (readCache()) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return

    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const found = await get<CurrentMunicipality | null>('/municipalities/locate', {
            params: { lat: coords.latitude, lng: coords.longitude },
          })
          const value = found && found.name ? found : null
          writeCache(value)
          if (value) recordMunicipalityVisit(value)
          if (!cancelled) setMunicipality(value)
        } catch {
          /* network/API failure: keep the default, retry on a later mount */
        }
      },
      () => writeCache(null), // denied/unavailable: don't keep asking this session
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    )
    return () => { cancelled = true }
  }, [])

  return municipality
}

export interface MunicipalityPhoto {
  src: string
  caption: string
  kind: 'municipality' | 'attraction' | 'business'
}

/**
 * Real photos of a municipality (cover → attractions → businesses) from
 * GET /municipalities/{id}/photos. Empty when not located or when the
 * municipality has no photos yet; callers keep their default artwork then.
 * Shared query key, so the sidebar and Home fetch it once.
 */
export function useMunicipalityPhotos(municipalityId: number | null | undefined): MunicipalityPhoto[] {
  const { data } = useQuery({
    queryKey: ['municipality-photos', municipalityId],
    queryFn: () => get<MunicipalityPhoto[]>(`/municipalities/${municipalityId}/photos`),
    enabled: !!municipalityId,
    staleTime: 10 * 60 * 1000,
  })
  return Array.isArray(data) ? data : []
}

/** A municipality the app detected the tourist in (kept on this device). */
export interface SeenMunicipality {
  id: number
  name: string
  province?: string | null
  cover_photo?: string | null
  first_seen: number
  last_seen: number
}

const SEEN_KEY = 'tt_seen_municipalities'

export function getSeenMunicipalities(): SeenMunicipality[] {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'number' && typeof m.name === 'string') : []
  } catch {
    return []
  }
}

/** My Activities → Travels: "You were here". */
export function recordMunicipalityVisit(m: CurrentMunicipality): void {
  try {
    const now = Date.now()
    const list = getSeenMunicipalities()
    const existing = list.find((x) => x.id === m.id)
    const entry: SeenMunicipality = {
      id: m.id,
      name: m.name,
      province: m.province ?? null,
      cover_photo: m.cover_photo ?? null,
      first_seen: existing?.first_seen ?? now,
      last_seen: now,
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify([entry, ...list.filter((x) => x.id !== m.id)].slice(0, 50)))
  } catch {
    /* storage unavailable */
  }
}

