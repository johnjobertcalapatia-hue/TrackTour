import { Loader2, Phone, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/shared/utils'
import { sosStatusText, type SenderSos } from './sos'

/**
 * The sender's own SOS (tourist or rider): its status, Call 911, and
 * "I'm safe now". Only the sender sees this; the other party is never told.
 */
export default function SosStatusCard({ sos, onSafe, safePending = false, className }: {
  sos: SenderSos
  onSafe?: () => void
  safePending?: boolean
  className?: string
}) {
  const { title, body } = sosStatusText(sos)
  const Icon = sos.active ? ShieldAlert : ShieldCheck

  return (
    <section
      aria-label="Your SOS"
      role="status"
      className={cn('rounded-2xl border p-4', sos.active ? 'border-red-200 bg-red-50' : 'border-[#CFE5D7] bg-[#F3FAF6]', className)}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-6 w-6 shrink-0', sos.active ? 'text-red-600' : 'text-[#087F3F]')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={cn('font-bold', sos.active ? 'text-red-700' : 'text-[#17201B]')}>{title}</p>
          <p className="mt-0.5 text-sm text-[#3F4B43]">{body}</p>
          {sos.active && sos.sender_safe_at && (
            <p className="mt-1 text-sm text-[#3F4B43]">You said you&apos;re safe. The Tourism Office will confirm and close it.</p>
          )}
          <p className="mt-1 text-xs text-[#68736D]">Reference {sos.reference}</p>
        </div>
      </div>
      {sos.active && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href="tel:911" className="flex h-11 items-center justify-center gap-2 rounded-full bg-red-600 text-sm font-bold text-white hover:bg-red-700">
            <Phone className="h-4 w-4" aria-hidden="true" /> Call 911
          </a>
          {!sos.sender_safe_at && onSafe ? (
            <button
              type="button"
              onClick={onSafe}
              disabled={safePending}
              className="flex h-11 items-center justify-center gap-2 rounded-full border-2 border-[#087F3F] bg-white text-sm font-semibold text-[#087F3F] disabled:opacity-60"
            >
              {safePending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} I&apos;m safe now
            </button>
          ) : <span />}
        </div>
      )}
    </section>
  )
}
