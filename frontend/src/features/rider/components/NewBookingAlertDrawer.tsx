import { Package, Satellite } from 'lucide-react'

interface Props {
  isVisible: boolean
  onTransitionComplete: () => void
}

export default function NewBookingAlertDrawer({ isVisible, onTransitionComplete }: Props) {
  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-[9990] pointer-events-none flex flex-col justify-end p-4 font-sans select-none">
      {/* Central map radar scanning layer (positioned absolutely behind the drawer) */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 pointer-events-none flex items-center justify-center">
        <div className="absolute w-full h-full rounded-full bg-emerald-500/10 border border-emerald-500/20 animate-double-ping" />
        <div className="absolute w-full h-full rounded-full bg-emerald-500/5 border border-emerald-500/10 animate-double-ping [animation-delay:1.25s]" />
        <div className="relative w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-400 flex items-center justify-center text-emerald-400 animate-tracking-glow">
          <Satellite className="w-6 h-6" />
        </div>
      </div>

      {/* Floating glass alert drawer (slides smoothly into view over the map) */}
      <div className="w-full max-w-md mx-auto pointer-events-auto bg-zinc-950/70 backdrop-blur-2xl rounded-2xl border border-emerald-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-5 flex flex-col gap-4 animate-subtle-float">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-400 rounded-xl flex items-center justify-center text-emerald-400 animate-tracking-glow shrink-0">
            <Package className="w-7 h-7" />
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold tracking-widest uppercase self-start mb-1 animate-pulse">
              Request Incoming
            </span>
            <h3 className="text-base font-black text-white tracking-tight">New Booking Detected!</h3>
            <p className="text-xs text-zinc-400 truncate">Connecting path metrics to your location coordinates...</p>
          </div>
        </div>

        {/* Infinite gradient loader bar track */}
        <div className="space-y-1.5">
          <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden p-[1px] border border-zinc-800">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 animate-gradient-slide" />
          </div>
          <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono tracking-wide px-0.5">
            <span>SECURE SYSTEM BRIDGE ACTIVE</span>
            <span className="text-emerald-400 animate-pulse">ESTABLISHING TELEMETRY...</span>
          </div>
        </div>

        {/* Dev simulator delegate — skip straight to the receipt */}
        <button
          onClick={onTransitionComplete}
          className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 py-1.5 rounded-lg text-[10px] font-mono tracking-widest uppercase text-zinc-400 transition hover:text-white"
        >
          [ Simulate Receipt Pop ]
        </button>
      </div>
    </div>
  )
}
