import { useCallback, useEffect, useState } from 'react'
import { Check, Layers } from 'lucide-react'
import { MAP_LAYER_PREVIEW } from '@/shared/components/MapLayerTile'
import { useClickOutside } from '@/shared/hooks/use-click-outside'
import { cn } from '@/shared/utils'

export type LandingMapType = 'streets' | 'satellite'

const OPTIONS: Array<{ key: LandingMapType; label: string; preview: string }> = [
  { key: 'streets', label: 'Street', preview: MAP_LAYER_PREVIEW.street },
  { key: 'satellite', label: 'Satellite', preview: MAP_LAYER_PREVIEW.satellite },
]

/**
 * Landing map layer switcher: a picture tile of the current map type that
 * opens a small menu to choose Street or Satellite.
 */
export default function LandingMapLayerMenu({
  value,
  onChange,
}: {
  value: LandingMapType
  onChange: (next: LandingMapType) => void
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useClickOutside<HTMLDivElement>(close)
  const current = OPTIONS.find((o) => o.key === value) ?? OPTIONS[0]!

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change map type"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Map type"
        className="relative block h-11 w-11 overflow-hidden rounded-xl border-2 border-white bg-[#DDE5DF] shadow-md transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F]"
      >
        <img
          src={current.preview}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Layers className="h-5 w-5 text-white drop-shadow" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Map type"
          className="absolute bottom-0 right-full mr-2 w-40 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-black/5"
        >
          {OPTIONS.map((o) => {
            const selected = o.key === value
            return (
              <button
                key={o.key}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => { onChange(o.key); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition-colors',
                  selected ? 'bg-[#E9F7EF] text-[#087F3F]' : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                <img src={o.preview} alt="" loading="lazy" draggable={false} className="h-8 w-8 shrink-0 rounded-md border border-black/10 bg-[#DDE5DF] object-cover" />
                <span className="flex-1">{o.label}</span>
                {selected && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
