import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { get, post, put } from '@/shared/services/api'

/**
 * Opt-in sharing of the tourist's live location with the Bansud Tourism
 * Office (admin live map). Off by default. While it is on and the app is
 * open, the phone's position is sent about every 30 seconds; only the latest
 * position is kept on the server and turning sharing off deletes it.
 */
export interface LocationSharing {
  enabled: boolean
  consented_at: string | null
  location_at: string | null
}

export const LOCATION_SHARING_KEY = ['tourist', 'location-sharing'] as const
export const SHARE_INTERVAL_MS = 30_000

export function useLocationSharing(enabled = true) {
  return useQuery({
    queryKey: LOCATION_SHARING_KEY,
    queryFn: () => get<LocationSharing>('/tourist/location-sharing'),
    enabled,
    staleTime: 60_000,
  })
}

export function useSetLocationSharing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (on: boolean) => put<LocationSharing>('/tourist/location-sharing', { enabled: on }),
    onSuccess: (data) => queryClient.setQueryData(LOCATION_SHARING_KEY, data),
  })
}

/** Asks the browser for one position; resolves null when denied or unavailable. */
export function currentPosition(timeoutMs = 10_000): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 15_000,
    })
  })
}

/**
 * Sends the position while sharing is on and the page is visible. Stops (and
 * refreshes the switch) if the server says sharing is off.
 */
export function useShareLocationHeartbeat(on: boolean) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!on) return
    let stopped = false
    const send = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      const pos = await currentPosition()
      if (!pos || stopped) return
      try {
        await post('/tourist/location-sharing/ping', {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        })
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          stopped = true
          void queryClient.invalidateQueries({ queryKey: LOCATION_SHARING_KEY })
        }
      }
    }
    void send()
    const timer = setInterval(() => { void send() }, SHARE_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void send() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [on, queryClient])
}

/** Mounted once in the tourist layout: shares the location while the tourist has it switched on. */
export function TouristLocationSharer() {
  const { data } = useLocationSharing()
  useShareLocationHeartbeat(Boolean(data?.enabled))
  return null
}
