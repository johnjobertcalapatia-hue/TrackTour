import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Bike, Camera, Check, CheckCircle2, Circle, Clock, Coins, Info, Lock, MapPin, Phone, Play, Receipt, UtensilsCrossed,
} from 'lucide-react'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, toAssetUrl } from '@/shared/utils'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { km, orderLabel, peso, type DeliveryOffer } from '@/features/rider/services/delivery-offers'
import type { PickupStop } from '@/features/rider/pickup-stops'
import { stepState, stepTime, stopAction, tripStage, type TripStepState } from '@/features/rider/trip-steps'
import { DeliveryPhotoCapture } from '@/features/rider/components/DeliveryPhotoCapture'

/**
 * Rider trip status page (2026-11-08): after accepting, the rider follows the
 * delivery stage by stage — 1 Order Accepted, 2 Pickup at Restaurants (Confirm
 * Arrival → Confirm Pick Up per restaurant, in route order; no per-delivery
 * cash step — the rider holds the day's cash advance), 3 In Transit,
 * 4 Confirm Delivery (photo at the drop-off). Every action is the existing
 * canonical endpoint via RiderActiveTripContext; the server enforces the gates.
 */
export default function RiderTripStatus() {
  const { deliveryId } = useParams<{ deliveryId: string }>()
  const id = Number(deliveryId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const trip = useRiderActiveTrip()

  const { data: offer, isLoading, isError } = useQuery({
    queryKey: ['rider-trip-status', id],
    queryFn: () => get<DeliveryOffer>(`/rider/deliveries/${id}/offer`),
    enabled: Number.isFinite(id),
    refetchInterval: 10000,
  })

  const isThisTrip = trip.activeDelivery?.id === id
  const status = isThisTrip ? trip.activeDelivery!.status : offer?.status
  const stage = tripStage(status, isThisTrip && trip.tripState === 'ARRIVED_AT_DROP')
  const stopsData = isThisTrip ? trip.pickupStopsData : null
  const stops = useMemo(() => [...(stopsData?.stops ?? [])].sort((a, b) => a.sequence - b.sequence), [stopsData])

  // Refresh the header facts whenever the live status moves on.
  const lastStatus = useRef(status)
  useEffect(() => {
    if (lastStatus.current !== status) void queryClient.invalidateQueries({ queryKey: ['rider-trip-status', id] })
    lastStatus.current = status
  }, [status, id, queryClient])

  if (isLoading) return <DashboardSkeleton />
  if (isError || !offer || offer.availability !== 'mine') {
    return (
      <div className="rounded-2xl border border-[#E5E9E7] bg-white p-8 text-center">
        <p className="font-semibold text-[#17201B]">This delivery isn't assigned to you.</p>
        <Link to="/rider/map" className="mt-4 inline-flex h-11 items-center rounded-full bg-[#16803C] px-6 text-sm font-semibold text-white">Back to map</Link>
      </div>
    )
  }

  const restaurantCount = Math.max(offer.pickups.length, stops.length, 1)
  const firstPickup = stops[0]
  const pickupName = firstPickup?.business_name ?? offer.pickups[0]?.name ?? offer.pickup_names[0] ?? 'Restaurant'
  const pickupAddress = firstPickup?.pickup_address ?? offer.pickups[0]?.address ?? offer.pickup.address
  const stageLabel = stage === 'done' ? 'Delivered' : stage === 'cancelled' ? 'Cancelled' : 'In Progress'
  const error = trip.actionError ?? trip.confirmStopError ?? trip.confirmArrivalError

  const stopImage = (stop: PickupStop) => {
    const food = offer.items.find((i) => i.business_id === stop.business_id && i.image)?.image
    return food ?? offer.pickups.find((p) => p.id === stop.business_id)?.logo ?? null
  }

  return (
    <div className="space-y-4 pb-4">
      <button type="button" onClick={() => navigate('/rider/map')} className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201B]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Map
      </button>

      {/* Order header */}
      <section className="rounded-2xl border border-[#CFE8D6] bg-[#EEF8F1] p-4" aria-label="Order summary">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-[#17201B]">Order {orderLabel(offer)}</h1>
          <span className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
            stage === 'done' ? 'bg-[#DCFCE7] text-[#166534]' : stage === 'cancelled' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#EEF5A8] text-[#3F4A12]',
          )}>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {stageLabel}
          </span>
        </div>
        <p className="mt-1 text-sm text-[#374151]">
          {[
            offer.distance_km != null ? km(offer.distance_km) : null,
            restaurantCount > 1 ? 'Group Order' : null,
            `${restaurantCount} ${restaurantCount === 1 ? 'Restaurant' : 'Restaurants'}`,
            '1 Tourist Destination',
          ].filter(Boolean).join(' • ')}
        </p>
      </section>

      <section className="grid grid-cols-2 divide-x divide-[#E5E7EB] rounded-2xl border border-[#E5E9E7] bg-white p-4">
        <div className="flex gap-2 pr-3">
          <UtensilsCrossed className="mt-0.5 h-5 w-5 shrink-0 text-[#16803C]" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="text-[#6B7280]">Pickup at</p>
            <p className="font-semibold text-[#17201B]">{pickupName}{restaurantCount > 1 ? ` +${restaurantCount - 1}` : ''}</p>
            {pickupAddress && <p className="truncate text-xs text-[#6B7280]">{pickupAddress}</p>}
          </div>
        </div>
        <div className="flex gap-2 pl-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="text-[#6B7280]">Deliver to</p>
            <p className="font-semibold text-[#17201B]">Tourist Location</p>
            {offer.dropoff.address && <p className="truncate text-xs text-[#6B7280]">{offer.dropoff.address}</p>}
          </div>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm font-medium text-[#B3261E]">{error}</p>}

      {/* Stages */}
      <ol className="relative space-y-4" aria-label="Delivery steps">
        <Step n={1} state={stepState(1, stage)} title="Order Accepted" aside={stepTime(offer.assigned_at) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs text-[#374151]">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {stepTime(offer.assigned_at)}
          </span>
        )}>
          <p className="text-sm text-[#374151]">Your delivery order has been accepted.</p>
        </Step>

        <Step n={2} state={stepState(2, stage)} title="Pickup at Restaurants" subtitle="Confirm each restaurant pickup before proceeding to delivery.">
          {stops.length > 0 ? (
            <ul className="divide-y divide-[#EEF1EF]">
              {stops.map((stop) => (
                <StopRow
                  key={stop.id}
                  stop={stop}
                  image={stopImage(stop)}
                  action={stopsData ? stopAction(stop, stopsData) : { kind: 'collected' }}
                  busy={trip.confirmStopBusy || trip.confirmArrivalBusy}
                  onArrive={() => trip.confirmArrivalStop(stop.business_id)}
                  onPickup={() => trip.confirmPickupStop(stop.business_id)}
                />
              ))}
            </ul>
          ) : stepState(2, stage) === 'current' && isThisTrip ? (
            <ActionButton onClick={trip.onMarkPickedUp} disabled={trip.busy} icon={<Check className="h-5 w-5" />}>Confirm Pick Up</ActionButton>
          ) : (
            <ul className="divide-y divide-[#EEF1EF]">
              {offer.pickups.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm text-[#374151]">
                  {stepState(2, stage) === 'done' ? <CheckCircle2 className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> : <Circle className="h-4 w-4 text-[#9CA3AF]" aria-hidden="true" />}
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </Step>

        <Step
          n={3}
          state={stepState(3, stage)}
          title="In Transit"
          subtitle="Deliver the order to the tourist location."
          icon={<Bike className="h-10 w-10 text-[#16803C]" aria-hidden="true" />}
          aside={stepState(3, stage) === 'upcoming' && <Badge tone="blue">Waiting for all pickups…</Badge>}
        >
          {stepState(3, stage) === 'current' && isThisTrip && (
            <ActionButton onClick={trip.onArrivedDrop} disabled={trip.busy} icon={<MapPin className="h-5 w-5" />}>I've Arrived</ActionButton>
          )}
        </Step>

        <Step
          n={4}
          state={stepState(4, stage)}
          title="Confirm Delivery"
          subtitle="Take a delivery photo and confirm the delivery."
          icon={<Camera className="h-10 w-10 text-[#16803C]" aria-hidden="true" />}
          aside={stepState(4, stage) === 'upcoming' && <Badge tone="gray" icon={<Lock className="h-3.5 w-3.5" />}>Available after delivery arrival</Badge>}
        >
          {stepState(4, stage) === 'current' && isThisTrip && (
            <DeliveryProof busy={trip.busy} onConfirm={trip.onConfirmDelivery} isCod={!!offer.is_cod} />
          )}
          {stage === 'done' && <p className="text-sm font-semibold text-[#166534]">Delivered. Thank you!</p>}
        </Step>
      </ol>

      {/* Money */}
      <section className="rounded-2xl border border-[#CFE8D6] bg-[#F4FBF6] p-4" aria-label="Delivery information">
        <h2 className="flex items-center gap-2 font-bold text-[#17201B]">
          <Info className="h-5 w-5 text-[#16803C]" aria-hidden="true" /> Delivery Information
        </h2>
        <dl className="mt-3 grid grid-cols-3 divide-x divide-[#DDE7E0] text-sm">
          <Money icon={<Coins className="h-5 w-5" />} label="Rider Earnings" value={peso(offer.rider_earnings)} />
          <Money icon={<UtensilsCrossed className="h-5 w-5" />} label="Customer Tip" value={peso(offer.rider_tip)} />
          <Money icon={<Receipt className="h-5 w-5" />} label="Delivery Fee" value={peso(offer.delivery_fee)} />
        </dl>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {offer.customer_phone ? (
          <a href={`tel:${offer.customer_phone}`} className="flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[#16803C] bg-white font-semibold text-[#16803C]">
            <Phone className="h-5 w-5" aria-hidden="true" /> Contact Tourist
          </a>
        ) : (
          <span aria-disabled="true" className="flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[#D1D5DB] text-sm font-semibold text-[#9CA3AF]">
            <Phone className="h-5 w-5" aria-hidden="true" /> No phone number
          </span>
        )}
        <button type="button" onClick={() => navigate('/rider/map')} className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#DCF2E3] font-semibold text-[#166534]">
          <MapPin className="h-5 w-5" aria-hidden="true" /> View on Map
        </button>
      </div>
    </div>
  )
}

function Step({ n, state, title, subtitle, aside, icon, children }: {
  n: number
  state: TripStepState
  title: string
  subtitle?: string
  aside?: ReactNode
  icon?: ReactNode
  children?: ReactNode
}) {
  return (
    <li className="relative flex gap-3" aria-current={state === 'current' ? 'step' : undefined} data-step-state={state}>
      <div className="flex flex-col items-center">
        <span className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold',
          state === 'upcoming' ? 'bg-[#6B7280] text-white' : 'bg-[#16803C] text-white',
          state === 'current' && 'ring-4 ring-[#BBF7D0]',
        )}>
          {state === 'done' ? <Check className="h-6 w-6" aria-label="Done" /> : n}
        </span>
        <span className={cn('mt-1 w-0.5 flex-1', state === 'upcoming' ? 'bg-[#D1D5DB]' : 'bg-[#16803C]')} aria-hidden="true" />
      </div>
      <div className={cn(
        'min-w-0 flex-1 overflow-hidden rounded-2xl border',
        state === 'current' ? 'border-2 border-[#16803C] bg-white' : state === 'done' ? 'border-[#CFE8D6] bg-[#F4FBF6]' : 'border-[#DDE3EE] bg-[#F5F7FB]',
      )}>
        <div className={cn('flex items-start justify-between gap-2 p-4', state === 'current' && 'bg-[#EEF8F1]')}>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#17201B]">{n}. {title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-[#374151]">{subtitle}</p>}
          </div>
          {state === 'current' && !aside ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#16803C] px-3 py-1 text-xs font-semibold text-white">
              <Play className="h-3 w-3 fill-current" aria-hidden="true" /> Current Step
            </span>
          ) : aside}
        </div>
        {(children || icon) && (
          <div className="flex items-start gap-3 px-4 pb-4">
            {icon && state !== 'current' && <div className="shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        )}
      </div>
    </li>
  )
}

function StopRow({ stop, image, action, busy, onArrive, onPickup }: {
  stop: PickupStop
  image: string | null
  action: ReturnType<typeof stopAction>
  busy: boolean
  onArrive: () => void
  onPickup: () => void
}) {
  const [failed, setFailed] = useState(false)
  const src = image && !failed ? toAssetUrl(image) : null
  const name = stop.business_name ?? 'Restaurant'

  return (
    <li className="flex items-center gap-3 py-3" aria-label={name}>
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#F0FDF4]">
        {src ? <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
          : <div className="flex h-full w-full items-center justify-center text-[#16803C]"><UtensilsCrossed className="h-6 w-6" aria-hidden="true" /></div>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-[#17201B]">{name}</p>
        {stop.pickup_address && (
          <p className="flex items-center gap-1 truncate text-xs text-[#6B7280]"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{stop.pickup_address}</p>
        )}
        {action.kind === 'collected' ? (
          <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-[#16803C]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Picked Up
            {stepTime(stop.pickup_confirmed_at) && <span className="ml-1 text-xs font-normal">{stepTime(stop.pickup_confirmed_at)}</span>}
          </p>
        ) : (
          <>
            <p className="mt-1 flex items-center gap-1 text-sm text-[#6B7280]">
              <Circle className="h-4 w-4" aria-hidden="true" /> {stop.arrived_at ? (stop.is_ready ? 'Ready for pickup' : 'Arrived — waiting') : 'Pending'}
            </p>
            {action.hint && <p className="mt-0.5 text-xs text-[#92400E]">{action.hint}</p>}
          </>
        )}
      </div>
      {action.kind !== 'collected' && (
        <button
          type="button"
          onClick={action.kind === 'arrive' ? onArrive : onPickup}
          disabled={!action.enabled || busy}
          aria-label={`${action.kind === 'arrive' ? 'Confirm arrival' : 'Confirm pick up'} at ${name}`}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#16803C] px-3 py-2.5 text-sm font-semibold text-white disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          <span className="leading-tight">{action.kind === 'arrive' ? <>Confirm<br />Arrival</> : <>Confirm<br />Pick Up</>}</span>
        </button>
      )}
    </li>
  )
}

function DeliveryProof({ busy, onConfirm, isCod }: { busy: boolean; onConfirm: (photo: File) => void; isCod: boolean }) {
  // The rider takes and submits a photo of the tourist receiving the food;
  // only a submitted photo unlocks "Confirm Delivered".
  const [photo, setPhoto] = useState<File | null>(null)

  return (
    <div className="space-y-3">
      <DeliveryPhotoCapture
        photo={photo}
        onSubmit={setPhoto}
        note={isCod ? 'Confirming means the tourist paid you in cash.' : undefined}
      />
      <ActionButton onClick={() => photo && onConfirm(photo)} disabled={!photo || busy} icon={<Check className="h-5 w-5" />}>
        Confirm Delivered
      </ActionButton>
    </div>
  )
}

function ActionButton({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#16803C] font-semibold text-white disabled:opacity-50"
    >
      {icon}{children}
    </button>
  )
}

function Badge({ tone, icon, children }: { tone: 'blue' | 'gray'; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium',
      tone === 'blue' ? 'bg-[#E3EDFC] text-[#1D4ED8]' : 'bg-[#E9ECF1] text-[#4B5563]',
    )}>
      {icon}{children}
    </span>
  )
}

function Money({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-2 px-2 first:pl-0">
      <span className="mt-0.5 text-[#16803C]" aria-hidden="true">{icon}</span>
      <div>
        <dt className="text-xs text-[#4B5563]">{label}</dt>
        <dd className="font-bold text-[#17201B]">{value}</dd>
      </div>
    </div>
  )
}
