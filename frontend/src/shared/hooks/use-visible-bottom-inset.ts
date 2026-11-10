import { useEffect, useState } from 'react'

/** A text field has focus: the on-screen keyboard is (probably) up. */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(type)
}

/**
 * How far (px) the bottom of the VISIBLE screen sits above the bottom of the
 * layout viewport, which is what `position: fixed; bottom: 0` anchors to.
 *
 * They are the same on a normal phone screen (0). They differ when only part
 * of the page is visible: pinch-zoom, a browser / simulator showing a shorter
 * area than the page's viewport, etc. A bottom bar moved up by this amount
 * stays anchored to the bottom of what the user actually sees.
 *
 * While typing (keyboard up) it stays 0: the bar then stays behind the
 * keyboard instead of jumping over the field being filled in.
 */
export function useVisibleBottomInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    let frame = 0
    const measure = () => {
      frame = 0
      const layoutBottom = document.documentElement.clientHeight || window.innerHeight
      const visibleBottom = vv.offsetTop + vv.height
      const next = typing() ? 0 : Math.max(0, Math.round(layoutBottom - visibleBottom))
      setInset((prev) => (prev === next ? prev : next))
    }
    const schedule = () => {
      if (frame) return
      frame = -1
      const id = window.requestAnimationFrame(measure)
      if (frame === -1) frame = id
    }
    measure()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    return () => {
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      if (frame > 0) window.cancelAnimationFrame(frame)
    }
  }, [])

  return inset
}
