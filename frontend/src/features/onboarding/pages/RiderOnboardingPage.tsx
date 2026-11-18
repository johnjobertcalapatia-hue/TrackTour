import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bell, ClipboardCheck, Bike, CalendarCheck, CalendarClock, CalendarX, Car, Check, ChevronLeft, ChevronRight, Clock, FileUp, Landmark, Loader2, LogOut, MapPin,
  UtensilsCrossed,
} from 'lucide-react'
import { apiErrorMessage, del, get, post } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { cn } from '@/shared/utils'
import { OnboardingTracker } from '@/features/onboarding/components/OnboardingTracker'
import {
  SERVICE_LABELS, VEHICLE_LABELS, canRideHail, manilaDate, type OnboardingSlot, type RegistrationOffice, type RiderOnboardingState,
} from '@/features/onboarding/types'

const POPPINS = { fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }
const card = 'rounded-3xl bg-white p-6 shadow-[0_14px_34px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6] sm:p-8'
const input =
  'w-full rounded-2xl border border-[#E2E8E3] bg-white px-4 py-3 text-sm text-[#14351F] outline-none transition focus:border-[#2E8B57] focus:ring-4 focus:ring-[#2E8B57]/15'

/** The applicant's onboarding: application (steps 2–3), booking (step 4), tracker. */
export default function RiderOnboardingPage() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [rebooking, setRebooking] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['rider-onboarding'],
    queryFn: () => get<RiderOnboardingState>('/rider/onboarding'),
  })

  if ((user?.account_status as string | undefined) === 'approved' || data?.account_status === 'approved') {
    return <Navigate to="/rider/map" replace />
  }

  // Scheduling is automatic; the booking picker appears only when the rider
  // chooses to reschedule or has no appointment and is not waiting for one.
  const waiting = data?.application_status === 'pending_schedule'
  // Phase 2 (training) opens only after the office verifies the requirements.
  const verified = data?.requirements?.verified ?? true
  const needsBooking = !!data && data.application.submitted && verified && (rebooking || (!data.appointment && !waiting))
  const stepNumber = !data ? 1 : !data.application.submitted || editing ? 2 : needsBooking ? 4 : null

  return (
    <div className="min-h-screen bg-[#FAFAF5] text-[#14351F]" style={POPPINS}>
      <header className="bg-gradient-to-br from-[#062814] via-[#0B5D2E] to-[#1F7A45] text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <Link to="/" className="flex items-center gap-2" aria-label="TrackTour home">
            <img src="/assets/logo/tracktour.png" alt="TrackTour Logo" className="h-11 w-11 rounded-2xl bg-white object-contain p-1" />
            <span className="text-xl font-extrabold">Track<span className="text-[#FFD000]">Tour</span></span>
          </Link>
          <span className="ml-2 hidden rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20 sm:inline">Rider application</span>
          <button
            type="button"
            onClick={async () => {
              await logout()
              navigate('/login', { replace: true })
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/25 hover:bg-white/20"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
        <div className="mx-auto max-w-5xl px-5 pb-10 pt-4">
          {stepNumber && <p className="text-sm font-bold uppercase tracking-wide text-[#FFD000]">Step {stepNumber} of 4</p>}
          <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">
            {stepNumber === 2 ? 'Your vehicle and documents' : stepNumber === 4 ? 'Book your onboarding' : 'My application'}
          </h1>
          <p className="mt-2 max-w-2xl text-white/85">
            {stepNumber === 2
              ? 'Choose your rider service and upload your requirements.'
              : stepNumber === 4
                ? (data?.appointment ? 'Choose another available Tourism Office appointment.' : 'We picked the earliest available time for you. Confirm it or choose another.')
                : 'Track your onboarding with the Tourism Office.'}
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-6 max-w-5xl px-5 pb-16">
        {isLoading ? (
          <div className={`${card} flex justify-center`}><Loader2 className="h-6 w-6 animate-spin text-[#0B5D2E]" /></div>
        ) : error || !data ? (
          <div className={card}><p className="text-red-600">{apiErrorMessage(error, 'Could not load your application.')}</p></div>
        ) : data.account_status === 'rejected' ? (
          <Rejected data={data} />
        ) : !data.application.submitted || editing ? (
          <ApplicationForm data={data} onDone={() => setEditing(false)} onCancel={data.application.submitted ? () => setEditing(false) : undefined} />
        ) : needsBooking ? (
          <Booking office={data.office} current={data.appointment?.slot ?? null} onDone={() => setRebooking(false)} onCancel={data.appointment ? () => setRebooking(false) : undefined} />
        ) : (
          <Tracker data={data} onReschedule={() => setRebooking(true)} onEdit={() => setEditing(true)} />
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 – 3: application
// ---------------------------------------------------------------------------

function ApplicationForm({ data, onDone, onCancel }: { data: RiderOnboardingState; onDone: () => void; onCancel?: () => void }) {
  const queryClient = useQueryClient()
  const app = data.application
  const [part, setPart] = useState<'vehicle' | 'documents'>('vehicle')
  const [services, setServices] = useState<string[]>(app.requested_services.length ? app.requested_services : ['food'])
  const [form, setForm] = useState({
    vehicle_type: app.vehicle_type ?? 'motorcycle',
    vehicle_make: app.vehicle_make ?? '',
    vehicle_model: app.vehicle_model ?? '',
    vehicle_plate_number: app.vehicle_plate_number ?? '',
    vehicle_year: app.vehicle_year ? String(app.vehicle_year) : '',
    license_number: app.license_number ?? '',
    license_expiry: app.license_expiry ?? '',
  })
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  const submit = useMutation({
    mutationFn: () => {
      const body = new FormData()
      services.forEach((s) => body.append('requested_services[]', s))
      Object.entries(form).forEach(([k, v]) => v && body.append(k, v))
      Object.entries(files).forEach(([k, f]) => f && body.append(k, f))
      return post('/rider/onboarding/application', body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-onboarding'] })
      onDone()
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 422) {
        const errs = (e.response.data as { errors?: Record<string, string[]> }).errors ?? {}
        setErrors(errs)
        const vehicleFields = ['requested_services', 'vehicle_type', 'vehicle_plate_number', 'vehicle_year', 'license_number', 'license_expiry']
        if (Object.keys(errs).some((k) => vehicleFields.includes(k.split('.')[0]!))) setPart('vehicle')
      }
    },
  })

  const bicycle = form.vehicle_type === 'bicycle'
  const toggleService = (s: string) => {
    if (s === 'transport' && !canRideHail(form.vehicle_type)) return
    setServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  }
  const chooseVehicle = (key: string) => {
    setForm((f) => ({ ...f, vehicle_type: key }))
    // A bicycle cannot carry passengers: drop ride-hailing if it was chosen.
    if (!canRideHail(key)) setServices((cur) => cur.filter((x) => x !== 'transport'))
  }

  const field = (key: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`app-${key}`} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <input id={`app-${key}`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={input} {...props} />
      {errors[key]?.[0] && <p className="mt-1 text-xs text-red-600">{errors[key]?.[0]}</p>}
    </div>
  )

  const goNext = (e: FormEvent) => {
    e.preventDefault()
    if (services.length === 0) {
      setErrors({ requested_services: ['Choose at least one rider service.'] })
      return
    }
    setErrors({})
    setPart('documents')
  }

  return (
    <div className={card}>
      <div className="mb-6 flex gap-2" aria-label="Application parts">
        {(['vehicle', 'documents'] as const).map((p, i) => (
          <span key={p} className={cn('h-1.5 flex-1 rounded-full', part === p || (p === 'vehicle' && part === 'documents') ? 'bg-[#2E8B57]' : 'bg-[#E2E8E3]')} aria-label={i === 0 ? 'Vehicle and service' : 'Documents'} />
        ))}
      </div>

      {part === 'vehicle' ? (
        <form onSubmit={goNext} className="space-y-6">
          <fieldset>
            <legend className="text-lg font-bold">Choose your rider service</legend>
            <p className="text-sm text-[#5B6A60]">Select one or both, subject to eligibility.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { key: 'food', icon: UtensilsCrossed, text: 'Pick up from restaurants and deliver to tourists.' },
                { key: 'transport', icon: Car, text: 'Drive passengers around Bansud and nearby towns.' },
              ].map((s) => {
                const on = services.includes(s.key)
                const blocked = s.key === 'transport' && !canRideHail(form.vehicle_type)
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-disabled={blocked}
                    disabled={blocked}
                    onClick={() => toggleService(s.key)}
                    className={cn('flex items-start gap-3 rounded-2xl p-4 text-left ring-2 transition disabled:cursor-not-allowed disabled:opacity-50', on ? 'bg-[#E6F2EB] ring-[#2E8B57]' : 'bg-white ring-[#E2E8E3] hover:ring-[#CFE5D7]')}
                  >
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-[#0B5D2E] text-[#FFD000]' : 'bg-[#F4F6F4] text-[#0B5D2E]')}>
                      <s.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{SERVICE_LABELS[s.key]}</span>
                      <span className="block text-sm text-[#5B6A60]">{blocked ? 'Needs a motorcycle, tricycle, car or van — a bicycle is for food delivery only.' : s.text}</span>
                    </span>
                    {on && <Check className="h-5 w-5 shrink-0 text-[#0B5D2E]" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
            {errors.requested_services?.[0] && <p className="mt-2 text-xs text-red-600">{errors.requested_services[0]}</p>}
          </fieldset>

          <fieldset>
            <legend className="text-lg font-bold">Vehicle information</legend>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Vehicle type">
              {Object.entries(VEHICLE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={form.vehicle_type === key}
                  onClick={() => chooseVehicle(key)}
                  className={cn('rounded-full px-4 py-2 text-sm font-semibold ring-2', form.vehicle_type === key ? 'bg-[#0B5D2E] text-white ring-[#0B5D2E]' : 'bg-white ring-[#E2E8E3] hover:ring-[#CFE5D7]')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field('vehicle_plate_number', bicycle ? 'Plate number (not needed for a bicycle)' : 'Plate number', { required: !bicycle, maxLength: 20, placeholder: 'ABC 1234' })}
              {field('vehicle_year', 'Year (optional)', { type: 'number', min: 1980, max: new Date().getFullYear() + 1 })}
              {field('vehicle_make', 'Make (optional)', { maxLength: 50, placeholder: 'Honda' })}
              {field('vehicle_model', 'Model (optional)', { maxLength: 50, placeholder: 'Click 125' })}
              {field('license_number', bicycle ? "Driver's license number (optional)" : "Driver's license number", { required: !bicycle, maxLength: 30 })}
              {field('license_expiry', bicycle ? 'License expiry (optional)' : 'License expiry', { required: !bicycle, type: 'date' })}
            </div>
          </fieldset>

          <div className="flex flex-wrap justify-end gap-3">
            {onCancel && <button type="button" onClick={onCancel} className="rounded-full px-5 py-3 text-sm font-semibold ring-1 ring-[#E2E8E3] hover:bg-[#F4F6F4]">Cancel</button>}
            <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-[#0B5D2E] px-6 py-3 text-sm font-bold text-white hover:bg-[#094A25]">
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit.mutate()
          }}
          className="space-y-6"
        >
          <div>
            <h2 className="text-lg font-bold">Upload identification and requirements</h2>
            <p className="text-sm text-[#5B6A60]">Clear photos or PDFs, up to 8 MB each. Bring the originals to your appointment.</p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {app.documents.map((doc) => {
              const picked = files[doc.key]
              const done = Boolean(picked) || doc.uploaded
              return (
                <li key={doc.key}>
                  <label className={cn('flex cursor-pointer items-center gap-3 rounded-2xl p-4 ring-2 transition', done ? 'bg-[#E6F2EB] ring-[#2E8B57]' : 'bg-white ring-[#E2E8E3] hover:ring-[#CFE5D7]')}>
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', done ? 'bg-[#0B5D2E] text-white' : 'bg-[#F4F6F4] text-[#0B5D2E]')}>
                      {done ? <Check className="h-5 w-5" /> : <FileUp className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">
                        {doc.name} {doc.key !== 'nbi_clearance' && !bicycle ? <span className="text-red-600">*</span> : <span className="font-normal text-[#7A867F]">(optional)</span>}
                      </span>
                      <span className="block truncate text-xs text-[#5B6A60]">{picked ? picked.name : doc.uploaded ? 'Uploaded — choose a file to replace' : 'Choose a file'}</span>
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="sr-only"
                      aria-label={doc.name}
                      onChange={(e) => setFiles((f) => ({ ...f, [doc.key]: e.target.files?.[0] ?? null }))}
                    />
                  </label>
                  {errors[doc.key]?.[0] && <p className="mt-1 text-xs text-red-600">{errors[doc.key]?.[0]}</p>}
                </li>
              )
            })}
          </ul>
          {submit.isError && Object.keys(errors).length === 0 && <p className="text-sm text-red-600">{apiErrorMessage(submit.error)}</p>}
          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" onClick={() => setPart('vehicle')} className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold ring-1 ring-[#E2E8E3] hover:bg-[#F4F6F4]">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button type="submit" disabled={submit.isPending} className="inline-flex items-center gap-2 rounded-full bg-[#0B5D2E] px-6 py-3 text-sm font-bold text-white hover:bg-[#094A25] disabled:opacity-50">
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Submit application
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4: booking
// ---------------------------------------------------------------------------

function Booking({ office, current, onDone, onCancel }: { office: RegistrationOffice | null; current: OnboardingSlot | null; onDone: () => void; onCancel?: () => void }) {
  const queryClient = useQueryClient()
  const strip = useRef<HTMLDivElement>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['rider-onboarding-slots'],
    queryFn: () => get<{ office: RegistrationOffice; slots: OnboardingSlot[] }>('/rider/onboarding/slots'),
  })
  const slots = useMemo(() => (data?.slots ?? []).filter((s) => s.id !== current?.id), [data, current])
  const dates = useMemo(() => [...new Set(slots.map((s) => s.date))], [slots])
  // Scheduling is automatic: the earliest open seat is preselected.
  const earliest = slots.find((s) => s.remaining > 0) ?? null
  const [date, setDate] = useState<string | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const selected = slots.find((s) => s.id === chosen) ?? (chosen === null ? earliest : null)
  const activeDate = date ?? selected?.date ?? dates[0] ?? null
  const daySlots = slots.filter((s) => s.date === activeDate)
  const place = data?.office ?? office
  const openOn = (d: string) => slots.filter((s) => s.date === d).reduce((n, s) => n + Math.max(0, s.remaining), 0)

  const book = useMutation({
    mutationFn: (id: number) => post('/rider/onboarding/appointment', { schedule_id: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-onboarding'] })
      queryClient.invalidateQueries({ queryKey: ['rider-onboarding-slots'] })
      onDone()
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['rider-onboarding-slots'] }),
  })

  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * 280, behavior: 'smooth' })

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className={`${card} min-w-0`}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#7A867F]">Location</h2>
        <div className="mt-2 flex items-center gap-3 rounded-2xl bg-[#E6F2EB] p-4 ring-1 ring-[#CFE5D7]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0B5D2E] text-[#FFD000]"><Landmark className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="font-bold">{place?.name ?? 'Your Tourism Office'}</p>
            <p className="truncate text-sm text-[#4B5A50]">{place?.address}</p>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#7A867F]">Appointment date</h2>
          {dates.length > 4 && (
            <div className="flex gap-1.5">
              <button type="button" onClick={() => scroll(-1)} aria-label="Earlier dates" className="flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-[#E2E8E3] hover:bg-[#F4F6F4]"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => scroll(1)} aria-label="Later dates" className="flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-[#E2E8E3] hover:bg-[#F4F6F4]"><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </div>
        {isLoading ? (
          <Loader2 className="mt-4 h-5 w-5 animate-spin text-[#0B5D2E]" />
        ) : dates.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-[#CFE5D7] p-8 text-center text-sm text-[#5B6A60]">
            <CalendarX className="mx-auto mb-2 h-8 w-8 text-[#9CB8A5]" aria-hidden="true" />
            No onboarding times are open right now. We&apos;ll schedule you automatically when one opens.
          </div>
        ) : (
          <>
            <div ref={strip} className="no-scrollbar mt-3 flex snap-x gap-2.5 overflow-x-auto scroll-smooth p-1" role="tablist" aria-label="Appointment dates">
              {dates.map((d) => {
                const iso = slots.find((s) => s.date === d)!.starts_at
                const on = d === activeDate
                const open = openOn(d)
                return (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      setDate(d)
                      setChosen(slots.find((s) => s.date === d && s.remaining > 0)?.id ?? -1)
                    }}
                    className={cn(
                      'flex w-[76px] shrink-0 snap-start flex-col items-center rounded-2xl px-2 py-3 transition',
                      on ? 'bg-[#0B5D2E] text-white shadow-[0_8px_18px_rgba(11,93,46,0.28)]' : 'bg-white ring-1 ring-[#E2E8E3] hover:ring-[#2E8B57]'
                    )}
                  >
                    <span className={cn('text-[11px] font-semibold uppercase', on ? 'text-[#FFD000]' : 'text-[#7A867F]')}>{manilaDate(iso, { weekday: 'short' })}</span>
                    <span className="text-2xl font-extrabold leading-tight">{manilaDate(iso, { day: 'numeric' })}</span>
                    <span className={cn('text-[11px]', on ? 'text-white/80' : 'text-[#5B6A60]')}>{manilaDate(iso, { month: 'short' })}</span>
                    <span className={cn('mt-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold', open === 0 ? 'bg-red-50 text-red-600' : on ? 'bg-white/15 text-white' : 'bg-[#E6F2EB] text-[#0B5D2E]')}>
                      {open === 0 ? 'Full' : `${open} open`}
                    </span>
                  </button>
                )
              })}
            </div>

            <h2 className="mt-7 text-xs font-bold uppercase tracking-wider text-[#7A867F]">
              Available times{activeDate ? ` · ${manilaDate(slots.find((s) => s.date === activeDate)!.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })}` : ''}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3" role="radiogroup" aria-label="Available slots">
              {daySlots.map((s) => {
                const full = s.remaining <= 0
                const on = selected?.id === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={full}
                    onClick={() => setChosen(s.id)}
                    className={cn(
                      'relative rounded-2xl px-4 py-3.5 text-left transition disabled:cursor-not-allowed',
                      on ? 'bg-[#E6F2EB] ring-2 ring-[#2E8B57]' : full ? 'bg-[#F4F6F4] text-[#9AA5A0] ring-1 ring-[#E2E8E3]' : 'bg-white ring-1 ring-[#E2E8E3] hover:ring-[#2E8B57]'
                    )}
                  >
                    <span className="flex items-center gap-2 text-base font-bold">
                      <Clock className={cn('h-4 w-4', full ? 'text-[#B8C2BC]' : 'text-[#2E8B57]')} aria-hidden="true" /> {s.time}
                    </span>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[#E2E8E3]" aria-hidden="true">
                      <span className={cn('block h-full rounded-full', full ? 'bg-red-400' : s.remaining <= 2 ? 'bg-[#E0A800]' : 'bg-[#2E8B57]')} style={{ width: `${Math.min(100, (s.booked / Math.max(1, s.capacity)) * 100)}%` }} />
                    </span>
                    <span className={cn('mt-1.5 block text-xs font-semibold', full ? 'text-red-600' : s.remaining <= 2 ? 'text-[#B8860B]' : 'text-[#2E8B57]')}>
                      {full ? 'Full' : `${s.remaining} ${s.remaining === 1 ? 'slot' : 'slots'} left`}
                    </span>
                    {on && <Check className="absolute right-3 top-3 h-4 w-4 text-[#0B5D2E]" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      <aside className={`${card} lg:sticky lg:top-6`} aria-label="Appointment summary">
        <h2 className="text-lg font-bold">Appointment summary</h2>
        {current && (
          <p className="mt-2 rounded-xl bg-[#FFF6CC] px-3 py-2 text-xs text-[#5C4A00]">
            Current: {manilaDate(current.starts_at, { month: 'short', day: 'numeric' })} · {current.time}
          </p>
        )}
        {selected && selected.id === earliest?.id && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#E6F2EB] px-3 py-1 text-xs font-bold text-[#0B5D2E]">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Earliest available
          </p>
        )}
        <dl className="mt-4 space-y-3 text-sm">
          <Row label="Date" value={selected ? manilaDate(selected.starts_at) : '—'} />
          <Row label="Time" value={selected?.time ?? '—'} />
          <Row label="Location" value={place?.name ?? '—'} />
        </dl>
        {book.isError && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{apiErrorMessage(book.error)}</p>}
        <button
          type="button"
          disabled={!selected || book.isPending}
          onClick={() => selected && book.mutate(selected.id)}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#0B5D2E] px-4 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,93,46,0.3)] hover:bg-[#094A25] disabled:opacity-40 disabled:shadow-none"
        >
          {book.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Confirm Appointment
        </button>
        <p className="mt-3 text-center text-xs text-[#7A867F]">Bring your original documents on the day.</p>
        {onCancel && (
          <button type="button" onClick={onCancel} className="mt-3 w-full rounded-full px-4 py-3 text-sm font-semibold ring-1 ring-[#E2E8E3] hover:bg-[#F4F6F4]">
            Keep current appointment
          </button>
        )}
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

function Tracker({ data, onReschedule, onEdit }: { data: RiderOnboardingState; onReschedule: () => void; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const appointment = data.appointment
  const slot = appointment?.slot ?? null
  const cancel = useMutation({
    mutationFn: () => del('/rider/onboarding/appointment'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rider-onboarding'] }),
  })
  const booked = appointment?.status === 'booked'
  const waiting = data.application_status === 'pending_schedule'
  const verified = data.requirements?.verified ?? true
  const reviewing = data.application_status === 'requirements_review'
  const returned = data.application_status === 'requirements_returned'
  const chip = data.application_status_label ?? (appointment?.status === 'checked_in' ? 'At the Tourism Office' : 'Appointment booked')

  return (
    <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className={card} aria-label="Onboarding progress">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Your progress</h2>
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold',
              data.application_status === 'needs_retraining' ? 'bg-red-50 text-red-700' : waiting ? 'bg-[#FFF6CC] text-[#5C4A00]' : 'bg-[#E6F2EB] text-[#0B5D2E]'
            )}
          >
            {chip}
          </span>
        </div>
        {reviewing && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-[#E6F2EB] p-4 text-sm text-[#0B5D2E]" role="status">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Requirements under review</p>
              <p>The Tourism Office is verifying your requirements. Once they are verified, your interview and training will be scheduled automatically.</p>
            </div>
          </div>
        )}
        {returned && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-bold">Your requirements need correction</p>
              {data.requirements?.remarks && <p>{data.requirements.remarks}</p>}
              <button type="button" onClick={onEdit} className="mt-2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700">Update and resubmit</button>
            </div>
          </div>
        )}
        {waiting && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-[#FFF6CC] p-4 text-sm text-[#5C4A00]" role="status">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Waiting for an available schedule</p>
              <p>All onboarding sessions are full or unavailable right now. We&apos;ll schedule you automatically and notify you as soon as a time opens.</p>
            </div>
          </div>
        )}
        {appointment?.needs_reschedule && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Your appointment date is no longer available</p>
              <p>The Tourism Office will move you to a new time and notify you. You can also choose another time yourself.</p>
            </div>
          </div>
        )}
        {data.application_status === 'needs_retraining' && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-800" role="status">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>The Tourism Office returned your application for further evaluation. Check the notices below and follow their instructions.</p>
          </div>
        )}
        <OnboardingTracker stages={data.stages} />
        {!!data.notices?.length && (
          <div className="mt-8 border-t border-[#EEF2EF] pt-6" aria-label="Notices">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#7A867F]"><Bell className="h-4 w-4" /> Notices</h3>
            <ul className="space-y-3">
              {data.notices.map((n) => (
                <li key={n.id} className="rounded-2xl bg-[#FAFAF5] p-3 ring-1 ring-[#EEF2EF]">
                  <p className="text-sm font-bold">{n.title}</p>
                  <p className="text-sm text-[#4B5A50]">{n.message}</p>
                  <p className="mt-1 text-xs text-[#7A867F]">{manilaDate(n.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="space-y-6">
        <section className={card} aria-label="Application reference">
          <p className="text-xs font-bold uppercase tracking-wide text-[#7A867F]">Application reference</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-[#0B5D2E]">{data.reference}</p>
          <p className="mt-1 text-xs text-[#5B6A60]">Keep this reference for your appointment.</p>
        </section>

        {slot && (
          <section className={card} aria-label="Appointment">
            <p className="text-xs font-bold uppercase tracking-wide text-[#7A867F]">Your appointment</p>
            <p className="mt-2 text-lg font-bold">{manilaDate(slot.starts_at)}</p>
            <p className="text-[#0B5D2E] font-semibold">{slot.time}</p>
            {appointment?.scheduled_by === 'system' && <p className="mt-1 text-xs text-[#5B6A60]">Scheduled automatically at the earliest available time.</p>}
            {appointment?.scheduled_by === 'office' && <p className="mt-1 text-xs text-[#5B6A60]">Scheduled by the Tourism Office.</p>}
            <p className="mt-3 flex items-start gap-2 text-sm text-[#4B5A50]"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B57]" />{slot.location_name}{slot.location_address ? ` · ${slot.location_address}` : ''}</p>
            <div className="mt-4 rounded-2xl bg-[#FFF6CC] p-3 text-xs text-[#5C4A00]">
              <p className="font-bold">Bring your originals</p>
              <p>Driver&apos;s license, vehicle OR/CR, NBI or police clearance, and this reference.</p>
            </div>
            {booked && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {/* Riders may pick another open time; auto-scheduling already chose the earliest. */}
                <button type="button" onClick={onReschedule} className="rounded-full px-3 py-2.5 text-sm font-semibold ring-1 ring-[#CFE5D7] text-[#0B5D2E] hover:bg-[#E6F2EB]">Reschedule</button>
                <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-full px-3 py-2.5 text-sm font-semibold ring-1 ring-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">Cancel</button>
              </div>
            )}
            {cancel.isError && <p className="mt-2 text-xs text-red-600">{apiErrorMessage(cancel.error)}</p>}
          </section>
        )}

        <section className={card} aria-label="Application details">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-[#7A867F]">Application</p>
            {!verified && <button type="button" onClick={onEdit} className="text-xs font-semibold text-[#0B5D2E] hover:underline">Edit</button>}
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Services" value={data.application.requested_services.map((s) => SERVICE_LABELS[s] ?? s).join(', ')} />
            <Row label="Vehicle" value={[data.application.vehicle_type && VEHICLE_LABELS[data.application.vehicle_type], data.application.vehicle_plate_number].filter(Boolean).join(' · ')} />
          </dl>
        </section>
      </div>
    </div>
  )
}

function Rejected({ data }: { data: RiderOnboardingState }) {
  return (
    <div className={card}>
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600"><AlertTriangle className="h-6 w-6" /></span>
        <div>
          <h2 className="text-xl font-bold">Your application was not approved</h2>
          {data.rejection_remarks && <p className="mt-2 text-[#3F4B43]">Reason: {data.rejection_remarks}</p>}
          <p className="mt-2 text-sm text-[#5B6A60]">Visit or contact {data.office?.name ?? 'your Tourism Office'} if you would like to apply again.</p>
          {data.office && (
            <p className="mt-3 flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 text-[#2E8B57]" />{data.office.address}</p>
          )}
          <Link to="/become-a-rider/offices" className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#FFD000] px-5 py-3 text-sm font-bold text-[#14351F]">
            <Bike className="h-4 w-4" /> Find a registration office
          </Link>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[#7A867F]">{label}</dt>
      <dd className="text-right font-semibold">{value || '—'}</dd>
    </div>
  )
}
