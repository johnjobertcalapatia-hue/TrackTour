import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Car } from 'lucide-react'
import BookRideSheet from '@/features/tourist/components/BookRideSheet'
import CancellationFeeBanner from '@/features/tourist/components/ride/CancellationFeeBanner'
import { ACTIVE_RIDE_KEY, fetchActiveRide } from '@/features/tourist/services/active-ride'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { useBackOr } from '@/shared/hooks/use-back-or'

/** Where the Book a Ride page starts, handed over in the link's router state. */
export interface BookRideSeed {
  destination?: string
  destinationAddress?: string
  destinationCoords?: { lat: number; lng: number }
  initialQuery?: string
  initialVehicle?: string
  pickupPoint?: { name: string; lat: number; lng: number }
  /** Session-storage key of the Ride Hailing page's draft: marked booked once the ride is booked. */
  draftKey?: string
}

export const BOOK_RIDE_PATH = '/tourist/transport/book'

/**
 * Book a Ride, as a page (2026-11-17; it was a pop-up panel). Destination →
 * pickup → trip summary (vehicle, payment, Book Ride Now). Opened from the
 * Ride Hailing page (points already set) or a destination's "Book a Ride";
 * booking replaces this page with the ride's tracking page.
 */
export default function TouristBookRide() {
  const seed = (useLocation().state ?? {}) as BookRideSeed
  const leave = useBackOr('/tourist/transport')
  // One ride at a time: no booking while an earlier ride is still searching,
  // on the way or in progress (the server refuses it too).
  const { data: activeRide, isLoading } = useQuery({ queryKey: ACTIVE_RIDE_KEY, queryFn: fetchActiveRide })

  if (isLoading) return <DashboardSkeleton />

  if (activeRide) {
    return (
      <div data-testid="book-ride-page" className="mx-auto lg:mx-0 w-full max-w-3xl">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={leave}
            aria-label="Close"
            className="shrink-0 rounded-full border border-[#E5E9E7] bg-white p-2.5 text-[#17201B] transition hover:border-[#087F3F]/40 hover:text-[#087F3F]"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Book a Ride</h1>
        </div>
        <section role="alert" aria-label="Ride in progress" className="rounded-2xl border border-[#E5E9E7] bg-white p-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#E9F7EF] text-[#087F3F]">
            <Car className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-[#17201B]">You already have a ride in progress</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#56615B]">
            You can book another ride once this one is completed or cancelled.
          </p>
          <p className="mt-2 text-xs text-[#68736D]">
            {activeRide.delivery_address || 'Booked ride'} · {activeRide.order_number}
          </p>
          <Link
            to={activeRide.redirect}
            replace
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[#087F3F] px-6 text-sm font-semibold text-white hover:bg-[#056B35]"
          >
            View your ride <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      </div>
    )
  }

  const markDraftBooked = () => {
    if (!seed.draftKey) return
    try {
      const draft = JSON.parse(sessionStorage.getItem(seed.draftKey) || 'null')
      if (draft && typeof draft === 'object') {
        sessionStorage.setItem(seed.draftKey, JSON.stringify({ ...draft, booked: true, bookedAt: Date.now() }))
      }
    } catch { /* the Ride Hailing page starts fresh */ }
  }

  return (
    <>
      {/* Stage C (2026-11-18): an owed or under-review ₱50 cancellation fee. */}
      <div className="mx-auto lg:mx-0 w-full max-w-3xl"><CancellationFeeBanner /></div>
      <BookRideSheet
      onClose={leave}
      destination={seed.destination}
      destinationAddress={seed.destinationAddress}
      destinationCoords={seed.destinationCoords}
      initialQuery={seed.initialQuery}
      initialVehicle={seed.initialVehicle}
      pickupPoint={seed.pickupPoint}
      onBooked={markDraftBooked}
    />
    </>
  )
}
