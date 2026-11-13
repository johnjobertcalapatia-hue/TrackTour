import { useEffect, useState, type ReactNode } from 'react'
import { Car, CheckCircle2, MessageCircle, Phone, Share2, ShieldAlert, Star, X } from 'lucide-react'
import { cn, formatCurrency, toAssetUrl } from '@/shared/utils'

/**
 * Ride-hailing screens after booking (2026-11-10 redesign, "5 seamless
 * phases" mockup): 2 finding your driver, 3 driver on the way, 4 in-trip,
 * 5 completed + review. Presentational only; TouristTransportTracking owns the
 * data, polling and actions.
 */

export interface RideDriver {
  name: string
  rating: number | null
  photo: string | null
  vehicle_type: string
  vehicle_make: string | null
  vehicle_model: string | null
  plate_number: string | null
  contact_number: string | null
}

/** "1:05" style elapsed time since `since`. */
function useElapsed(since: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const start = since ? new Date(since).getTime() : now
  const seconds = Math.max(0, Math.floor((now - (Number.isFinite(start) ? start : now)) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

const VEHICLE_LABEL: Record<string, string> = {
  motorcycle: 'Motorcycle',
  tricycle: 'Tricycle',
  car: 'Car',
  van: 'Van',
}
export const vehicleLabel = (type: string | null | undefined) => VEHICLE_LABEL[String(type ?? '')] ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Ride')

/* ── Phase 2: finding your driver ─────────────────────────────────────── */

export function SearchingScreen({ since, vehicleType, onCancel, cancelling, onBack }: {
  since: string | null | undefined
  vehicleType: string
  onCancel: () => void
  cancelling: boolean
  onBack: () => void
}) {
  const elapsed = useElapsed(since)
  return (
    <section
      aria-label="Finding your driver"
      // .tourist-map-page: exactly the space between the header and the bottom bar, edge to edge.
      className="tourist-map-page -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 relative flex flex-col items-center justify-between overflow-hidden bg-gradient-to-b from-[#0B4D2A] via-[#0A5A31] to-[#06391F] px-6 pb-10 pt-6 text-white"
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="self-start rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="flex flex-col items-center">
        <div className="relative flex h-64 w-64 items-center justify-center" aria-hidden="true">
          <span className="ride-radar-ring absolute inset-0 rounded-full border border-white/15" />
          <span className="ride-radar-ring absolute inset-6 rounded-full border border-white/20 [animation-delay:0.6s]" />
          <span className="ride-radar-ring absolute inset-12 rounded-full border border-white/25 [animation-delay:1.2s]" />
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#16803C] shadow-[0_0_40px_rgba(52,211,153,0.35)] ring-4 ring-white/15">
            <Car className="h-11 w-11 text-white" />
          </span>
        </div>
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-white!">Finding your driver…</h1>
        <p className="mt-1 text-sm text-white/75">Looking for a nearby {vehicleLabel(vehicleType).toLowerCase()} driver</p>
        <p className="mt-6 flex items-center gap-2 text-3xl font-bold tabular-nums" aria-label={`Searching for ${elapsed}`}>
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[#4ADE80]" aria-hidden="true" />
          {elapsed}
        </p>
      </div>

      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="h-12 w-full max-w-sm rounded-full border border-white/30 bg-white/10 text-base font-semibold text-white hover:bg-white/20 disabled:opacity-60"
      >
        {cancelling ? 'Cancelling…' : 'Cancel Request'}
      </button>
    </section>
  )
}

/* ── Top card over the map (phases 3–4) ───────────────────────────────── */

export function EtaBanner({ status, minutes }: { status: 'arriving' | 'driver_arrived' | 'in_progress'; minutes: number | null }) {
  const title = status === 'driver_arrived'
    ? 'Your driver has arrived'
    : status === 'in_progress'
      ? 'Heading to your destination'
      : minutes != null ? `Arriving in ${minutes} min` : 'Driver on the way'
  const sub = status === 'driver_arrived' ? 'Meet your driver at the pickup point' : status === 'in_progress' ? (minutes != null ? `About ${minutes} min left` : 'Enjoy your ride') : 'Your driver is on the way'
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-[#fff] px-4 py-3 shadow-xl" data-testid="ride-eta-banner">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF] text-[#087F3F]">
        <Car className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-extrabold text-[#17201B]">{title}</p>
        <p className="truncate text-xs text-[#56615B]">{sub}</p>
      </div>
    </div>
  )
}

/* ── Driver card (phases 3–4) ─────────────────────────────────────────── */

export function DriverCard({ driver, onChat, unread = 0 }: { driver: RideDriver; onChat?: () => void; unread?: number }) {
  const [failed, setFailed] = useState(false)
  const initials = driver.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const vehicle = [driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(' ') || vehicleLabel(driver.vehicle_type)
  return (
    <div className="flex items-center gap-3" data-testid="ride-driver-card">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-[#E9F7EF] ring-2 ring-[#087F3F]/20">
        {driver.photo && !failed ? (
          <img src={toAssetUrl(driver.photo)} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-lg font-bold text-[#087F3F]">{initials || '?'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-[#17201B]">{driver.name}</p>
        <p className="flex items-center gap-1 text-xs text-[#56615B]">
          <Star className="h-3.5 w-3.5 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" />
          {driver.rating != null && Number(driver.rating) > 0 ? Number(driver.rating).toFixed(1) : 'New driver'}
        </p>
        <p className="truncate text-xs text-[#17201B]">{vehicle}</p>
        {driver.plate_number && <p className="text-xs font-bold tracking-wide text-[#17201B]">{driver.plate_number}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {driver.contact_number ? (
          <a
            href={`tel:${driver.contact_number}`}
            aria-label={`Call ${driver.name}`}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#087F3F] text-white shadow hover:bg-[#056B35]"
          >
            <Phone className="h-5 w-5" aria-hidden="true" />
          </a>
        ) : null}
        {onChat && (
          <button
            type="button"
            onClick={onChat}
            aria-label={`Chat with ${driver.name}`}
            className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#087F3F] text-white shadow hover:bg-[#056B35]"
          >
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Progress (phases 3–4) ────────────────────────────────────────────── */

const PROGRESS = [
  { key: 'arriving', label: 'Driver on the way' },
  { key: 'driver_arrived', label: 'At pickup' },
  { key: 'in_progress', label: 'On trip' },
] as const

export function RideProgress({ status }: { status: string }) {
  const at = Math.max(0, PROGRESS.findIndex((p) => p.key === status))
  return (
    <ol className="flex items-start" aria-label="Ride progress">
      {PROGRESS.map((p, i) => (
        <li key={p.key} className="flex flex-1 flex-col items-center" aria-current={i === at ? 'step' : undefined}>
          <div className="flex w-full items-center">
            <span className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : i <= at ? 'bg-[#087F3F]' : 'bg-[#D7DED9]')} />
            <span className={cn('h-3 w-3 rounded-full', i <= at ? 'bg-[#087F3F]' : 'bg-[#D7DED9]', i === at && 'ring-4 ring-[#087F3F]/20')} />
            <span className={cn('h-0.5 flex-1', i === PROGRESS.length - 1 ? 'bg-transparent' : i < at ? 'bg-[#087F3F]' : 'bg-[#D7DED9]')} />
          </div>
          <span className={cn('mt-1 text-center text-[11px]', i <= at ? 'font-semibold text-[#087F3F]' : 'text-[#8A948F]')}>{p.label}</span>
        </li>
      ))}
    </ol>
  )
}

/* ── Phase 4: in-trip panel ───────────────────────────────────────────── */

export function InTripStats({ minutes, km }: { minutes: number | null; km: number | null }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-[#E5E9E7] rounded-2xl border border-[#E5E9E7] py-3 text-center" data-testid="ride-trip-stats">
      <div>
        <dt className="text-xs text-[#56615B]">ETA</dt>
        <dd className="text-2xl font-extrabold text-[#17201B]">{minutes != null ? `${minutes} min` : '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-[#56615B]">Distance</dt>
        <dd className="text-2xl font-extrabold text-[#17201B]">{km != null ? `${km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km'}` : '—'}</dd>
      </div>
    </dl>
  )
}

export function SafetyActions({ onSos, onShare, showSos }: { onSos: () => void; onShare: () => void; showSos: boolean }) {
  return (
    <div className={cn('grid gap-3', showSos ? 'grid-cols-2' : 'grid-cols-1')}>
      {showSos && (
        <button
          type="button"
          onClick={onSos}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#DC2626] text-base font-bold text-white shadow hover:bg-[#B91C1C]"
        >
          <ShieldAlert className="h-5 w-5" aria-hidden="true" /> SOS
        </button>
      )}
      <button
        type="button"
        onClick={onShare}
        className="flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[#087F3F] bg-[#fff] text-base font-semibold text-[#087F3F] hover:bg-[#F3FAF6]"
      >
        <Share2 className="h-5 w-5" aria-hidden="true" /> Share trip
      </button>
    </div>
  )
}

/* ── Phase 5: completed + review ──────────────────────────────────────── */

export function CompletedScreen({
  fare, paymentLabel, paid, onPay, paying, driverName, alreadyRated, rating, allowedTags, onSubmitReview, submitting, receipt, tip,
}: {
  fare: number
  paymentLabel: string
  paid: boolean
  onPay?: () => void
  paying?: boolean
  driverName: string | null
  alreadyRated: boolean
  rating: number | null
  allowedTags: string[]
  onSubmitReview: (payload: { rating: number; review?: string; tags: string[] }) => void
  submitting: boolean
  receipt?: ReactNode
  /** Optional tip block (rendered between the stars and the feedback). */
  tip?: ReactNode
}) {
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [showReceipt, setShowReceipt] = useState(false)

  return (
    <section aria-label="Ride completed" className="mx-auto flex w-full max-w-md flex-col items-center px-5 pb-8 pt-8 text-center">
      <span className="ride-pop flex h-20 w-20 items-center justify-center rounded-full bg-[#16803C] text-white shadow-lg">
        <CheckCircle2 className="h-11 w-11" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-2xl font-extrabold text-[#17201B]">Ride Completed!</h1>
      <p className="mt-1 text-4xl font-extrabold text-[#17201B]">{formatCurrency(fare)}</p>
      <p className={cn('mt-1 text-sm font-medium', paid ? 'text-[#087F3F]' : 'text-[#B45309]')}>{paymentLabel}</p>
      {!paid && onPay && (
        <button
          type="button"
          onClick={onPay}
          disabled={paying}
          className="mt-3 h-11 rounded-full bg-[#087F3F] px-6 text-sm font-bold text-white hover:bg-[#056B35] disabled:opacity-60"
        >
          {paying ? 'Opening payment…' : 'Pay now'}
        </button>
      )}
      {receipt && (
        <button type="button" onClick={() => setShowReceipt((v) => !v)} className="mt-2 text-xs font-semibold text-[#087F3F] underline-offset-2 hover:underline">
          {showReceipt ? 'Hide receipt' : 'View receipt'}
        </button>
      )}
      {showReceipt && receipt && <div className="mt-3 w-full text-left">{receipt}</div>}

      {alreadyRated ? (
        <div className="mt-6 w-full rounded-2xl border border-[#CFE8D6] bg-[#F4FBF6] p-4">
          <p className="text-sm font-semibold text-[#17201B]">Thanks for your review!</p>
          <p className="mt-1 flex justify-center gap-1" aria-label={`You rated ${rating ?? 0} out of 5`}>
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} className={cn('h-6 w-6', i < (rating ?? 0) ? 'fill-[#F4B400] text-[#F4B400]' : 'text-[#D7DED9]')} aria-hidden="true" />
            ))}
          </p>
          {tip && <div className="mt-4 text-left">{tip}</div>}
        </div>
      ) : (
        <form
          className="mt-6 w-full space-y-4 text-left"
          onSubmit={(e) => {
            e.preventDefault()
            if (stars > 0) onSubmitReview({ rating: stars, review: review.trim() || undefined, tags })
          }}
        >
          <div className="rounded-2xl border border-[#E5E9E7] p-4 text-center">
            <p className="text-sm font-semibold text-[#17201B]">Rate {driverName ? driverName.split(' ')[0] : 'your driver'}</p>
            <div className="mt-2 flex justify-center gap-2" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  onClick={() => setStars(n)}
                  className="rounded-full p-0.5"
                >
                  <Star className={cn('h-9 w-9 transition', n <= stars ? 'fill-[#F4B400] text-[#F4B400]' : 'text-[#D7DED9]')} aria-hidden="true" />
                </button>
              ))}
            </div>
            {stars > 0 && allowedTags.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {allowedTags.map((t) => {
                  const on = tags.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTags((cur) => (on ? cur.filter((x) => x !== t) : cur.length < 5 ? [...cur, t] : cur))}
                      className={cn('rounded-full border px-3 py-1 text-xs font-medium', on ? 'border-[#087F3F] bg-[#E9F7EF] text-[#087F3F]' : 'border-[#E5E9E7] text-[#56615B]')}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {tip}

          <label className="block">
            <span className="sr-only">Feedback</span>
            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Leave a feedback… (optional)"
              className="w-full resize-none rounded-2xl! border! border-[#E5E9E7]! bg-[#fff]! px-4 py-3 text-sm text-[#17201B] shadow-none! focus:border-[#087F3F]! focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={stars === 0 || submitting}
            className="h-12 w-full rounded-full bg-[#087F3F] text-base font-bold text-white hover:bg-[#056B35] disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Review'}
          </button>
        </form>
      )}
    </section>
  )
}
