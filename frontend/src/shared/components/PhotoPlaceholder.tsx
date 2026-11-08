import { ImageOff } from 'lucide-react'
import { cn } from '@/shared/utils'

interface Props {
  /** Where the icon sits: centred (cards) or to the right, clear of overlaid text (hero). */
  placement?: 'center' | 'right'
  testId?: string
  className?: string
}

/**
 * Empty photo container: shown where a municipality has no photo yet, so
 * no other town's picture stands in for it. The municipality's tourism office
 * fills it by uploading photos. Overlaid white text stays readable on the
 * dark green.
 */
export default function PhotoPlaceholder({ placement = 'center', testId, className }: Props) {
  return (
    <div
      data-testid={testId}
      className={cn('absolute inset-0 bg-gradient-to-br from-[#14532D] via-[#0F3D22] to-[#0B2A17]', className)}
    >
      <div
        className={cn(
          'absolute inset-3 rounded-2xl border-2 border-dashed border-white/20 flex',
          placement === 'center' ? 'items-start justify-center pt-[18%]' : 'items-center justify-end pr-[8%]',
        )}
      >
        <span
          className={cn(
            'flex flex-col items-center gap-1.5 text-white/45',
            placement === 'right' && 'max-md:hidden',
          )}
        >
          <ImageOff className={placement === 'right' ? 'w-12 h-12' : 'w-8 h-8'} aria-hidden="true" />
          <span className="text-[11px] font-semibold uppercase tracking-wide">No photo yet</span>
        </span>
      </div>
    </div>
  )
}
