import { Layers } from 'lucide-react'
import { cn } from '@/shared/utils'

export type MapLayerKind = 'street' | 'satellite'

/**
 * Preview thumbnails: one map tile over Bansud (z12) from the same providers
 * the maps use, so the tile shows what the other view really looks like.
 */
const PREVIEW: Record<MapLayerKind, string> = {
  street: 'https://tile.openstreetmap.org/12/3429/1900.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1900/3429',
}

const LABEL: Record<MapLayerKind, string> = {
  street: 'Map',
  satellite: 'Satellite',
}

interface Props {
  /** Layer currently shown on the map. */
  value: MapLayerKind
  onChange: (next: MapLayerKind) => void
  className?: string
}

/**
 * Map-app style layer switcher: a small picture tile previewing the *other*
 * layer; one tap switches to it.
 */
export default function MapLayerTile({ value, onChange, className }: Props) {
  const next: MapLayerKind = value === 'street' ? 'satellite' : 'street'

  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={next === 'satellite' ? 'Switch to satellite view' : 'Switch to map view'}
      title={next === 'satellite' ? 'Satellite view' : 'Map view'}
      className={cn(
        'map-layer-tile group relative w-12 h-12 rounded-lg overflow-hidden border-2 border-white bg-[#DDE5DF] shadow-[0_2px_8px_rgba(0,0,0,0.25)] transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F]',
        className,
      )}
    >
      <img
        src={PREVIEW[next]}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover"
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/75 to-black/0 pt-2 pb-0.5 text-[9px] leading-none font-bold text-white">
        <Layers className="w-2.5 h-2.5" aria-hidden="true" />
        {LABEL[next]}
      </span>
    </button>
  )
}
