import { useState } from 'react'
import axios from 'axios'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bike, Car, CheckCircle2, Loader2, Pencil, UtensilsCrossed } from 'lucide-react'
import { apiErrorMessage, put } from '@/shared/services/api'

export interface RiderVehicle {
  vehicle_type: string | null
  vehicle_plate: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  vehicle_year?: number | null
  can_ride_hail?: boolean
}

const VEHICLES: Record<string, string> = { motorcycle: 'Motorcycle', tricycle: 'Tricycle', car: 'Car', van: 'Van', bicycle: 'Bicycle' }
const RIDE_HAILING = ['motorcycle', 'tricycle', 'car', 'van']
const input = 'w-full rounded-xl border border-[#E2E8E3] px-3 py-2 text-sm outline-none focus:border-[#16803C] focus:ring-2 focus:ring-[#16803C]/20'

/**
 * The rider's registered vehicle, verified and recorded by the Tourism Office.
 * It decides ride-hailing: only motor vehicles can carry passengers, and a
 * tourist can book a vehicle type only while a registered rider has it.
 */
export function RiderVehicleCard({ riderId, vehicle }: { riderId: string | number; vehicle: RiderVehicle }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [form, setForm] = useState({
    vehicle_type: vehicle.vehicle_type ?? 'motorcycle',
    vehicle_plate_number: vehicle.vehicle_plate ?? '',
    vehicle_make: vehicle.vehicle_make ?? '',
    vehicle_model: vehicle.vehicle_model ?? '',
  })
  const bicycle = form.vehicle_type === 'bicycle'
  const rideCapable = vehicle.can_ride_hail ?? RIDE_HAILING.includes(vehicle.vehicle_type ?? '')

  const save = useMutation({
    mutationFn: () => put<unknown>(`/admin/riders/${riderId}/vehicle`, {
      vehicle_type: form.vehicle_type,
      vehicle_plate_number: form.vehicle_plate_number || null,
      vehicle_make: form.vehicle_make || null,
      vehicle_model: form.vehicle_model || null,
    }),
    onSuccess: () => {
      setEditing(false)
      setErrors({})
      setNotice(bicycle ? 'Vehicle saved. A bicycle is food delivery only.' : 'Vehicle saved.')
      queryClient.invalidateQueries({ queryKey: ['admin-rider', String(riderId)] })
      queryClient.invalidateQueries({ queryKey: ['admin-riders'] })
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 422 && (e.response.data as { errors?: Record<string, string[]> }).errors) {
        setErrors((e.response.data as { errors: Record<string, string[]> }).errors)
      } else {
        setNotice(apiErrorMessage(e, 'Could not save the vehicle.'))
      }
    },
  })

  return (
    <section className="rounded-2xl border border-[#E2E8E3] bg-white p-5" aria-label="Registered vehicle">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[#17201A]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF6ED]"><Bike className="h-4 w-4 text-[#16803C]" /></span>
          Registered vehicle
        </h3>
        {!editing && (
          <button type="button" onClick={() => { setEditing(true); setNotice(null) }} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E3] px-3 py-1.5 text-sm font-medium text-[#17201A] hover:bg-[#F6F8F4]">
            <Pencil className="h-3.5 w-3.5" /> {vehicle.vehicle_type ? 'Edit' : 'Register vehicle'}
          </button>
        )}
      </div>

      {!editing ? (
        <>
          <dl className="grid grid-cols-1 gap-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-[#6B7280]">Vehicle type</dt>
              <dd className="mt-1 text-[#17201A]">{vehicle.vehicle_type ? VEHICLES[vehicle.vehicle_type] ?? vehicle.vehicle_type : <span className="text-[#B45309]">Not registered</span>}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[#6B7280]">Plate number</dt>
              <dd className="mt-1 font-mono text-[#17201A]">{vehicle.vehicle_plate || '—'}</dd>
            </div>
            {(vehicle.vehicle_make || vehicle.vehicle_model) && (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-[#6B7280]">Make & model</dt>
                <dd className="mt-1 text-[#17201A]">{[vehicle.vehicle_make, vehicle.vehicle_model].filter(Boolean).join(' ')}</dd>
              </div>
            )}
          </dl>
          <p className={`mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${rideCapable ? 'bg-[#EAF6ED] text-[#166534]' : 'bg-[#FFF8E6] text-[#7C4A03]'}`} role="status">
            {rideCapable ? <Car className="h-4 w-4" aria-hidden="true" /> : <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />}
            {rideCapable
              ? 'Can do ride-hailing and food delivery. Tourists can book this vehicle type.'
              : vehicle.vehicle_type
                ? 'Food delivery only — a bicycle cannot carry passengers.'
                : 'No vehicle registered: this rider cannot do ride-hailing until one is recorded.'}
          </p>
          {notice && <p className="mt-2 flex items-center gap-1.5 text-sm text-[#16803C]" role="status"><CheckCircle2 className="h-4 w-4" />{notice}</p>}
        </>
      ) : (
        <form
          className="grid grid-cols-1 gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">Vehicle type</span>
            <select aria-label="Vehicle type" value={form.vehicle_type} onChange={(e) => setForm((f) => ({ ...f, vehicle_type: e.target.value }))} className={input}>
              {Object.entries(VEHICLES).map(([k, l]) => <option key={k} value={k}>{l}{k === 'bicycle' ? ' (food delivery only)' : ''}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Plate number{bicycle ? ' (not needed)' : ''}</span>
            <input aria-label="Plate number" required={!bicycle} maxLength={20} value={form.vehicle_plate_number} onChange={(e) => setForm((f) => ({ ...f, vehicle_plate_number: e.target.value }))} className={input} placeholder="ABC 1234" />
            {errors.vehicle_plate_number?.[0] && <span className="mt-1 block text-xs text-red-600">{errors.vehicle_plate_number[0]}</span>}
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Make (optional)</span>
            <input aria-label="Make" maxLength={50} value={form.vehicle_make} onChange={(e) => setForm((f) => ({ ...f, vehicle_make: e.target.value }))} className={input} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Model (optional)</span>
            <input aria-label="Model" maxLength={50} value={form.vehicle_model} onChange={(e) => setForm((f) => ({ ...f, vehicle_model: e.target.value }))} className={input} />
          </label>
          {bicycle && <p className="text-xs text-[#7C4A03]">A bicycle is food delivery only. If this rider is on ride-hailing, they will be moved to food delivery.</p>}
          {notice && <p className="text-sm text-red-600">{notice}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-2 rounded-xl bg-[#16803C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save vehicle
            </button>
            <button type="button" onClick={() => { setEditing(false); setErrors({}); setNotice(null) }} className="rounded-xl border border-[#E2E8E3] px-4 py-2 text-sm font-medium hover:bg-[#F6F8F4]">Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}
