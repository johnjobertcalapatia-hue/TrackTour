import { useLayoutEffect, useState } from 'react'

/** Same spacing as between the stacked map buttons (Tailwind gap-2). */
export const RIDER_CONTROLS_GAP_PX = 8

/** The Rider Status panel of the fixed rider bottom bar (DashboardLayout). */
export const RIDER_STATUS_SELECTOR = '.rider-status-panel'

/**
 * `bottom` (px) that puts an absolutely positioned element exactly `gap` px
 * above the Rider Status panel, measured against the element's positioned
 * container. Null when either can't be measured (not rendered, no layout);
 * callers then keep their CSS fallback.
 */
export function bottomAboveRiderStatus(el: HTMLElement | null, gap = RIDER_CONTROLS_GAP_PX): number | null {
  const container = el?.offsetParent as HTMLElement | null
  const status = document.querySelector<HTMLElement>(RIDER_STATUS_SELECTOR)
  if (!container || !status) return null
  const s = status.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  if (!s.height || !c.height) return null
  return Math.max(0, Math.round(c.bottom - s.top + gap))
}

/**
 * Keeps the rider map buttons `gap` px above the Rider Status panel. The bar's
 * height depends on the phone, the safe area and the rider's state, so it is
 * measured, and re-measured on resize and after the bar's transitions.
 *
 * Returns a callback ref for the element (so measuring starts whenever it
 * mounts, e.g. after the map's loading state) and the `bottom` to apply.
 */
export function useAboveRiderStatus(gap = RIDER_CONTROLS_GAP_PX): [(el: HTMLElement | null) => void, number | null] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [bottom, setBottom] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!el) return
    const update = () => {
      const next = bottomAboveRiderStatus(el, gap)
      setBottom((prev) => (prev === next ? prev : next))
    }
    update()

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    const status = document.querySelector<HTMLElement>(RIDER_STATUS_SELECTOR)
    if (observer) {
      if (status) observer.observe(status)
      if (status?.parentElement) observer.observe(status.parentElement)
      if (el.offsetParent) observer.observe(el.offsetParent)
    }
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    // The bar animates (online/offline); settle on the final position. Only
    // the bar's own transitions: every map tile's fade-in also fires
    // transitionend, and re-measuring on each one cost layout work (2026-11-12).
    const onTransitionEnd = (e: Event) => {
      const target = e.target as Node | null
      const bar = document.querySelector<HTMLElement>(RIDER_STATUS_SELECTOR)
      if (target && bar && (bar.contains(target) || target.contains(bar))) update()
    }
    document.addEventListener('transitionend', onTransitionEnd, true)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      document.removeEventListener('transitionend', onTransitionEnd, true)
    }
  }, [el, gap])

  return [setEl, bottom]
}
