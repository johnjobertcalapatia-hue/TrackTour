import { useEffect } from 'react'
import { cn } from '@/shared/utils'
import { AlertTriangle, LogIn, LogOut } from 'lucide-react'

interface SessionTimeoutModalProps {
  show: boolean
  countdown: number
  onStayLoggedIn: () => void
  onLogout: () => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function SessionTimeoutModal({
  show,
  countdown,
  onStayLoggedIn,
  onLogout,
}: SessionTimeoutModalProps) {
  // Prevent closing via Escape
  useEffect(() => {
    if (!show) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [show])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* Backdrop — no click-to-close */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className={cn(
          'relative w-full max-w-sm rounded-2xl border border-white/10',
          'bg-night-card shadow-2xl shadow-black/40 p-6 text-center',
          'animate-[scale-in_0.2s_ease-out]'
        )}
      >
        {/* Icon */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
          <AlertTriangle className="h-7 w-7 text-warning" />
        </div>

        {/* Title */}
        <h2 className="text-lg font-semibold text-white">Session Expiring Soon</h2>

        {/* Message */}
        <p className="mt-2 text-sm text-muted leading-relaxed">
          Your session will expire in{' '}
          <span
            className={cn(
              'font-mono font-bold',
              countdown <= 30 ? 'text-danger' : 'text-gold'
            )}
          >
            {formatTime(countdown)}
          </span>
          .<br />
          You will be logged out automatically.
        </p>

        {/* Progress bar */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-1000 ease-linear',
              countdown <= 30 ? 'bg-danger' : 'bg-gold'
            )}
            style={{ width: `${(countdown / 120) * 100}%` }}
          />
        </div>

        {/* Buttons */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onLogout}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium',
              'border border-white/10 text-muted hover:text-white hover:bg-white/5 transition-colors'
            )}
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </button>
          <button
            onClick={onStayLoggedIn}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium',
              'bg-brand text-white hover:bg-brand-dark transition-colors shadow-lg shadow-brand/25'
            )}
          >
            <LogIn className="h-4 w-4" />
            Stay Logged In
          </button>
        </div>
      </div>
    </div>
  )
}
