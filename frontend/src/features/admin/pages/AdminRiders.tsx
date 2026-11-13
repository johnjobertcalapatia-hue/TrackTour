import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put, apiErrorMessage } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import type { User, PaginatedResponse } from '@/shared/types'
import { Search, ChevronLeft, ChevronRight, Bike, Banknote, Save, Loader2, Car, Motorbike, Van, type LucideIcon } from 'lucide-react'
import { TricycleIcon } from '@/features/admin/components/TricycleIcon'
import { RiderCashAdvanceCard } from '@/features/admin/components/RiderCashAdvanceCard'

interface DeliveryFareSettings {
  base_fare: number
  included_kilometers: number
  per_kilometer: number
  minimum_fee: number
  service_adjustment: number
  surge_multiplier: number
}

interface FareField {
  key: keyof DeliveryFareSettings
  label: string
  hint: string
  step: number
  prefix?: string
  suffix?: string
}

const FARE_FIELDS: FareField[] = [
  { key: 'base_fare', label: 'Base Fare', hint: 'Charged on every delivery', step: 0.01, prefix: '₱' },
  { key: 'included_kilometers', label: 'Included Kilometers', hint: 'Covered by the base fare', step: 0.1, suffix: 'km' },
  { key: 'per_kilometer', label: 'Per-Kilometer Rate', hint: 'Extra charge beyond the included distance', step: 0.01, prefix: '₱' },
  { key: 'minimum_fee', label: 'Minimum Fee', hint: 'Floor for the final delivery fee', step: 0.01, prefix: '₱' },
  { key: 'service_adjustment', label: 'Service Adjustment', hint: 'Additional flat fee per order', step: 0.01, prefix: '₱' },
  { key: 'surge_multiplier', label: 'Surge Multiplier', hint: 'Multiplier applied to the calculated fare', step: 0.05, suffix: '×' },
]

const DEFAULT_FARES: DeliveryFareSettings = {
  base_fare: 40,
  included_kilometers: 2,
  per_kilometer: 15,
  minimum_fee: 40,
  service_adjustment: 0,
  surge_multiplier: 1,
}

// Ride hailing fares: one base fare + per-km rate per vehicle, set apart
// from the food delivery fee above. Fare = base fare + distance × per-km rate.
type RideVehicle = 'motorcycle' | 'tricycle' | 'car' | 'van'
type RideFareSettings = Record<RideVehicle, { base_fare: number; per_km: number }>

const RIDE_VEHICLES: { key: RideVehicle; label: string; icon: LucideIcon | typeof TricycleIcon }[] = [
  { key: 'motorcycle', label: 'Motorcycle', icon: Motorbike },
  { key: 'tricycle', label: 'Tricycle', icon: TricycleIcon },
  { key: 'car', label: 'Car', icon: Car },
  { key: 'van', label: 'Van', icon: Van },
]

const DEFAULT_RIDE_FARES: RideFareSettings = {
  motorcycle: { base_fare: 50, per_km: 15 },
  tricycle: { base_fare: 60, per_km: 20 },
  car: { base_fare: 100, per_km: 25 },
  van: { base_fare: 150, per_km: 30 },
}

const fareInputClass =
  'w-full bg-[#F6F8F4] border border-[#D7E8DB] rounded-lg text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C] py-1.5'

function RideFareCard({
  form,
  onChange,
}: {
  form: RideFareSettings
  onChange: (vehicle: RideVehicle, field: 'base_fare' | 'per_km', value: string) => void
}) {
  return (
    <section aria-label="Ride Hailing Fares" className="flex flex-col bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
      <div className="px-4 py-3 border-b border-[#E2E8E3] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 shrink-0 bg-[#EAF6ED] rounded-lg flex items-center justify-center">
            <Car className="w-4 h-4 text-[#16803C]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#17201A]">Ride Hailing Fares</h2>
            <p className="text-xs text-[#6B7280] truncate">Base fare and per-km rate per vehicle</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[#6B7280]">
              <th className="pb-1.5 pl-2 font-medium">Vehicle</th>
              <th className="pb-1.5 pl-2 font-medium">Base Fare</th>
              <th className="pb-1.5 pl-2 font-medium">Per km</th>
            </tr>
          </thead>
          <tbody>
            {RIDE_VEHICLES.map((vehicle) => (
              <tr key={vehicle.key}>
                <th scope="row" title={vehicle.label} className="py-1 pl-2 pr-1 text-left font-medium text-[#17201A]">
                  <span className="flex items-center gap-2">
                    <span
                      data-testid={`ride-vehicle-icon-${vehicle.key}`}
                      className="w-7 h-7 shrink-0 rounded-lg bg-[#EAF6ED] flex items-center justify-center"
                    >
                      <vehicle.icon aria-hidden="true" className="w-4 h-4 text-[#16803C]" />
                    </span>
                    <span className="hidden sm:inline">{vehicle.label}</span>
                  </span>
                </th>
                {(['base_fare', 'per_km'] as const).map((field) => {
                  const label = field === 'base_fare' ? 'Base Fare' : 'Per-Kilometer Rate'
                  return (
                    <td key={field} className="py-1 pl-2">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">₱</span>
                        <input
                          aria-label={`${vehicle.label} ${label}`}
                          type="number"
                          min={0}
                          step={0.01}
                          value={form[vehicle.key][field]}
                          onChange={(e) => onChange(vehicle.key, field, e.target.value)}
                          className={`${fareInputClass} pl-6 pr-2`}
                        />
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-auto pt-3 text-xs text-[#6B7280]">
          Fare = base fare + distance × per-km rate. Applies to new bookings; booked rides keep their fare.
        </p>
      </div>
    </section>
  )
}

export default function AdminRiders() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
    const timeout = setTimeout(() => setDebouncedSearch(value), 400)
    return () => clearTimeout(timeout)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin-riders', debouncedSearch, page],
    queryFn: () =>
      get<PaginatedResponse<User>>(API_ENDPOINTS.ADMIN.RIDERS, {
        params: { search: debouncedSearch || undefined, page },
      }),
  })

  const { data: fares } = useQuery({
    queryKey: ['admin-riders-fares'],
    queryFn: () => get<DeliveryFareSettings>(API_ENDPOINTS.ADMIN.RIDERS_FARES),
  })

  const [form, setForm] = useState<DeliveryFareSettings>(DEFAULT_FARES)
  const [formLoaded, setFormLoaded] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (fares && !formLoaded) {
      setForm(fares)
      setFormLoaded(true)
    }
  }, [fares, formLoaded])

  const { data: rideFares } = useQuery({
    queryKey: ['admin-riders-ride-fares'],
    queryFn: () => get<RideFareSettings>(API_ENDPOINTS.ADMIN.RIDERS_RIDE_FARES),
  })
  const [rideForm, setRideForm] = useState<RideFareSettings>(DEFAULT_RIDE_FARES)
  const [rideFormLoaded, setRideFormLoaded] = useState(false)

  useEffect(() => {
    if (rideFares && !rideFormLoaded) {
      setRideForm(rideFares)
      setRideFormLoaded(true)
    }
  }, [rideFares, rideFormLoaded])

  // One Save for both cards: food delivery fee and ride hailing fares.
  const saveMutation = useMutation({
    mutationFn: async (payload: { food: DeliveryFareSettings; ride: RideFareSettings }) => {
      const [food, ride] = await Promise.all([
        put<DeliveryFareSettings>(API_ENDPOINTS.ADMIN.RIDERS_FARES, payload.food),
        put<RideFareSettings>(API_ENDPOINTS.ADMIN.RIDERS_RIDE_FARES, payload.ride),
      ])
      return { food, ride }
    },
    onSuccess: ({ food, ride }) => {
      setForm(food)
      setRideForm(ride)
      setNotice({ type: 'success', message: 'Fares saved. New fees apply to new delivery quotes and ride bookings.' })
    },
    onError: (error) => {
      setNotice({ type: 'error', message: apiErrorMessage(error, 'Failed to save fares. Please try again.') })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-riders-fares'] })
      queryClient.invalidateQueries({ queryKey: ['admin-riders-ride-fares'] })
    },
  })

  const setRideField = (vehicle: RideVehicle, field: 'base_fare' | 'per_km', value: string) => {
    setNotice(null)
    setRideForm((prev) => ({ ...prev, [vehicle]: { ...prev[vehicle], [field]: value === '' ? 0 : Number(value) } }))
  }

  const setFareField = (key: keyof DeliveryFareSettings, value: string) => {
    setNotice(null)
    setForm((prev) => ({ ...prev, [key]: value === '' ? 0 : Number(value) }))
  }

  const handleSaveFares = () => {
    saveMutation.mutate({ food: { ...form }, ride: { ...rideForm } })
  }

  // Anything typed but not yet saved on either fare card.
  const hasUnsavedFares =
    (fares !== undefined && JSON.stringify(form) !== JSON.stringify(fares)) ||
    (rideFares !== undefined && JSON.stringify(rideForm) !== JSON.stringify(rideFares))

  const riders = data?.data ?? []
  const meta = data?.meta

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Riders</h1>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage rider accounts, fares and COD cash advances</p>
      </div>

      {/* Fares: food delivery fee and ride hailing fares, one Save.
          The Save bar stays on screen while scrolling through the fare cards. */}
      <div>
      <div
        data-testid="fares-save-bar"
        className="sticky top-0 z-20 -mx-2 mb-3 rounded-xl bg-[#F4F7F2]/95 px-2 py-2 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#17201A]">Fares</h2>
          <div className="flex items-center gap-3">
            {hasUnsavedFares && !saveMutation.isPending && (
              <span className="text-xs font-medium text-[#B45309]">Unsaved changes</span>
            )}
            <button
              onClick={handleSaveFares}
              disabled={saveMutation.isPending}
              className={`inline-flex items-center gap-1.5 px-4 py-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition ${
                hasUnsavedFares ? 'ring-2 ring-[#16803C]/30 ring-offset-1' : ''
              }`}
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Fares
            </button>
          </div>
        </div>
        {notice && (
          <div className="mt-2">
            <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
      <section aria-label="Food Delivery Fee" className="flex flex-col bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="px-4 py-3 border-b border-[#E2E8E3] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 shrink-0 bg-[#EAF6ED] rounded-lg flex items-center justify-center">
              <Banknote className="w-4 h-4 text-[#16803C]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#17201A]">Food Delivery Fee</h2>
              <p className="text-xs text-[#6B7280] truncate">Base fare and fees for food orders</p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col p-4">

          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {FARE_FIELDS.map((field) => (
              <div key={field.key} title={field.hint}>
                <label className="block text-xs font-medium text-[#17201A] mb-1">{field.label}</label>
                <div className="relative">
                  {field.prefix && (
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">{field.prefix}</span>
                  )}
                  <input
                    type="number"
                    min={0}
                    step={field.step}
                    value={form[field.key]}
                    onChange={(e) => setFareField(field.key, e.target.value)}
                    aria-label={field.label}
                    className={`${fareInputClass} ${field.prefix ? 'pl-6' : 'pl-2.5'} ${field.suffix ? 'pr-9' : 'pr-2'}`}
                  />
                  {field.suffix && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">{field.suffix}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-auto pt-3 text-xs text-[#6B7280]">
            Fee = (base fare + (distance − included km) × per-km rate + adjustment) × surge, at least the minimum
            fee. Applies to new quotes; existing orders keep their fee.
          </p>
        </div>
      </section>

      <RideFareCard form={rideForm} onChange={setRideField} />
      </div>
      </div>

      <RiderCashAdvanceCard />

      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
          <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
              <input
                type="text"
                placeholder="Search riders..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-[#F6F8F4] border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Rider</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Phone</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Verified</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {riders.map((rider) => (
                  <tr
                    key={rider.id}
                    data-testid="rider-row"
                    onClick={() => navigate(`/admin/riders/${rider.id}`)}
                    className="cursor-pointer hover:bg-[#F6F8F4] transition-colors"
                  >
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#FFF7D6] border border-[#E2E8E3] flex items-center justify-center overflow-hidden">
                          {rider.profile_photo ? (
                            <img src={rider.profile_photo} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Bike className="w-4 h-4 text-[#126B32]" />
                          )}
                        </div>
                        <div>
                          <Link
                            to={`/admin/riders/${rider.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-[#17201A] hover:text-[#16803C] hover:underline"
                          >
                            {rider.name}
                          </Link>
                          <div className="text-xs text-[#6B7280]">{rider.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{rider.phone || '—'}</td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <StatusBadge status={rider.account_status} />
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      {rider.email_verified_at ? (
                        <span className="text-[#16803C] text-xs font-medium">Verified</span>
                      ) : (
                        <span className="text-[#6B7280] text-xs font-medium">Unverified</span>
                      )}
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                      {formatDate(rider.created_at)}
                    </td>
                  </tr>
                ))}
                {riders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No riders found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {meta && meta.last_page > 1 && (
            <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
              <p className="text-sm text-[#6B7280]">
                Showing {((meta.current_page - 1) * meta.per_page) + 1} to{' '}
                {Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total} riders
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#6B7280] px-3">
                  Page {meta.current_page} of {meta.last_page}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                  disabled={page === meta.last_page}
                  className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}