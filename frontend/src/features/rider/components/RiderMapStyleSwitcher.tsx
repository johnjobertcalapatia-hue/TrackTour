import { useEffect, useRef, useState } from 'react'
import { Check, Layers, Map as MapIcon, Moon, Satellite, type LucideIcon } from 'lucide-react'
import { MAP_STYLES, MAP_STYLE_ORDER, type MapStyleId } from '@/shared/utils/map-tiles'

const SWATCH: Record<MapStyleId, string> = {
  standard: 'bg-[#E8F0E6] border-[#C9D6CD] text-[#16803C]',
  dark: 'bg-[#1B2230] border-[#2E3A4F] text-[#C3CDDC]',
  satellite: 'bg-gradient-to-br from-[#3F5A3A] to-[#6B7F4F] border-[#4B5E45] text-white',
}

const ICON: Record<MapStyleId, LucideIcon> = {
  standard: MapIcon,
  dark: Moon,
  satellite: Satellite,
}

/** "Map type" button + menu for the rider map (Standard / Dark / Satellite). */
export function RiderMapStyleSwitcher({
  value,
  onChange,
  className = '',
}: {
  value: MapStyleId
  onChange: (style: MapStyleId) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Map type"
        aria-haspopup="true"
        aria-expanded={open}
        className="w-11 h-11 rounded-full border shadow-md flex items-center justify-center backdrop-blur bg-white/95 border-[#E4E9E6] text-[#16803C] hover:bg-white transition"
      >
        <Layers className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <div role="radiogroup" aria-label="Map type" className="absolute right-0 bottom-full mb-2 w-44 rounded-2xl border border-[#E4E9E6] bg-white shadow-xl p-1.5">
          {MAP_STYLE_ORDER.map((id) => {
            const selected = id === value
            const Icon = ICON[id]
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { onChange(id); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-left transition ${selected ? 'bg-[#F0FAF3] text-[#16803C] font-semibold' : 'text-[#17201B] hover:bg-[#F6F8F6]'}`}
              >
                <span className={`w-7 h-7 rounded-lg border shrink-0 flex items-center justify-center ${SWATCH[id]}`} aria-hidden="true">
                  <Icon className="w-4 h-4" data-testid={`map-style-icon-${id}`} />
                </span>
                <span className="flex-1">{MAP_STYLES[id].label}</span>
                {selected && <Check className="w-4 h-4" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
