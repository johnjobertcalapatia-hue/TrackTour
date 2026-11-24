import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { FieldErrors, UseFormReturn } from 'react-hook-form'
import {
  ArrowLeft, ArrowRight, BarChart3, Calendar, Check, Circle, ClipboardList, Eye, EyeOff, FileText, IdCard, Loader2, Lock, Mail, MapPin, Pencil, Phone, Upload, User, Users, Wallet,
} from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import AuthBrandPanel, { AUTH_FONT } from './AuthBrandPanel'

export type IdFileKind = 'front' | 'back' | 'selfie'

interface Municipality {
  id: number
  name: string
  barangays: { id: number; name: string }[]
}

interface Props {
  // RegisterPage's form (business owner schema); typed loosely because it is shared by every role.
  form: UseFormReturn<any>
  step: number
  onStepChange: (step: number) => void
  municipalities: Municipality[]
  selectedMunicipality?: Municipality
  addressPrefix: string
  nationalities: string[]
  files: Record<IdFileKind, File | null>
  onFile: (kind: IdFileKind, file: File | null) => void
  onSubmit: (data: any) => Promise<void>
  onInvalid: (errors: FieldErrors<any>) => void
  error: string
  onDismissError: () => void
}

const STEPS = [
  { title: 'About you', fields: ['first_name', 'middle_name', 'last_name', 'date_of_birth', 'sex', 'nationality', 'email', 'mobile_number'] },
  { title: 'Address', fields: ['municipality_id', 'barangay', 'house_no_street'] },
  { title: 'ID check', fields: ['government_id_type', 'government_id_number'] },
  { title: 'Password', fields: ['password', 'password_confirmation'] },
  { title: 'Review', fields: [] },
] as const

/** What the owner portal offers (left panel). */
const OWNER_HIGHLIGHTS = [
  { icon: Users, text: 'Reach tourists in Bansud' },
  { icon: ClipboardList, text: 'Take orders and bookings' },
  { icon: Wallet, text: 'Get paid by GCash or cash' },
  { icon: BarChart3, text: 'See your sales and reports' },
]

const ID_TYPES: [string, string][] = [
  ['passport', 'Passport'], ['drivers_license', "Driver's License"], ['national_id', 'National ID'], ['sss_id', 'SSS ID'],
  ['philhealth_id', 'PhilHealth ID'], ['postal_id', 'Postal ID'], ['voters_id', "Voter's ID"],
]

/** What the server accepts for the ID photos (RegisterRequest): JPG, PNG or PDF, up to 5 MB. */
const ID_ACCEPT = 'image/jpeg,image/png,application/pdf'
const ID_TYPES_OK = ['image/jpeg', 'image/png', 'application/pdf']
const ID_MAX_BYTES = 5 * 1024 * 1024

const PASSWORD_RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'A number', test: (v) => /[0-9]/.test(v) },
  { label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
]

/**
 * Business owner sign-up (/register?role=business_owner), same look as the
 * sign-in and tourist sign-up pages: the brand panel, then five short steps
 * with a step indicator. Next checks the current step first (fields and the
 * required ID photos), so mistakes show where they are made. Validation of the
 * whole form and the submission stay RegisterPage's.
 */
export default function BusinessOwnerSignUp(props: Props) {
  const { form, step, onStepChange, municipalities, selectedMunicipality, addressPrefix, nationalities, files, onFile, onSubmit, onInvalid, error, onDismissError } = props
  const { register, handleSubmit, watch, trigger, formState: { errors, isSubmitting } } = form
  const [showPassword, setShowPassword] = useState(false)
  const [fileErrors, setFileErrors] = useState<Partial<Record<IdFileKind, string>>>({})
  const last = STEPS.length
  const password = String(watch('password') ?? '')

  const err = (name: string) => (errors as Record<string, { message?: string } | undefined>)[name]?.message
  const fieldError = (name: string) => (err(name) ? <p id={`${name}-error`} className="mt-1.5 text-xs text-red-600">{err(name)}</p> : null)
  const a11y = (name: string, hint?: string) => ({
    'aria-invalid': Boolean(err(name)),
    'aria-describedby': [err(name) ? `${name}-error` : null, hint].filter(Boolean).join(' ') || undefined,
  })
  const inputClass = (name: string, withIcon = true) =>
    `w-full rounded-2xl border bg-white py-3 ${withIcon ? 'pl-11' : 'pl-4'} pr-4 text-sm text-[#14351F] placeholder-[#9AA5A0] shadow-sm outline-none transition focus:border-[#2E8B57] focus:ring-4 focus:ring-[#2E8B57]/15 disabled:cursor-not-allowed disabled:bg-[#F4F6F4] ${
      err(name) ? 'border-red-300' : 'border-[#E2E8E3]'
    }`
  const icon = 'pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2E8B57]'

  const pickFile = (kind: IdFileKind, file: File | null) => {
    if (file && !ID_TYPES_OK.includes(file.type)) {
      setFileErrors((e) => ({ ...e, [kind]: 'Use a JPG, PNG or PDF file.' }))
      return
    }
    if (file && file.size > ID_MAX_BYTES) {
      setFileErrors((e) => ({ ...e, [kind]: 'The file must be 5 MB or smaller.' }))
      return
    }
    setFileErrors((e) => ({ ...e, [kind]: undefined }))
    onFile(kind, file)
  }

  const next = async () => {
    onDismissError()
    const ok = await trigger([...STEPS[step - 1]!.fields])
    let filesOk = true
    if (step === 3) {
      const missing: Partial<Record<IdFileKind, string>> = {}
      if (!files.front) missing.front = 'Upload the front of your ID.'
      if (!files.selfie) missing.selfie = 'Upload a selfie holding your ID.'
      filesOk = Object.keys(missing).length === 0
      if (!filesOk) setFileErrors((e) => ({ ...e, ...missing }))
    }
    if (ok && filesOk) onStepChange(Math.min(last, step + 1))
  }

  // A draft restored on the last step has lost its photos (files are not saved
  // with the draft): send the owner back to the ID step instead of a server error.
  const submit = async (data: unknown) => {
    const missing: Partial<Record<IdFileKind, string>> = {}
    if (!files.front) missing.front = 'Upload the front of your ID.'
    if (!files.selfie) missing.selfie = 'Upload a selfie holding your ID.'
    if (Object.keys(missing).length > 0) {
      setFileErrors((e) => ({ ...e, ...missing }))
      onStepChange(3)
      return
    }
    await onSubmit(data)
  }

  const muni = municipalities.find((m) => m.id === Number(watch('municipality_id')))
  const idType = ID_TYPES.find(([v]) => v === watch('government_id_type'))?.[1]

  return (
    <div className="min-h-screen bg-[#FAFAF5] lg:grid lg:grid-cols-[1.05fr_1fr]" style={AUTH_FONT}>
      <AuthBrandPanel
        eyebrow="For business owners"
        headline="Grow your business in"
        highlight="Oriental Mindoro"
        description="Register as a business owner, get approved by the Tourism Office, then list your restaurant, resort or attraction on TrackTour."
        highlights={OWNER_HIGHLIGHTS}
      />

      <main className="flex items-center justify-center px-5 py-10 sm:px-10 lg:min-h-screen">
        <div className="w-full max-w-lg">
          <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Business owner
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[#0B5D2E] sm:text-4xl">Register your business account</h1>
          <p className="mt-2 text-sm text-[#5B6A60]">Step {step} of {last}: {STEPS[step - 1]!.title}</p>

          {/* Step indicator */}
          <ol className="mt-6 flex items-center gap-1.5" aria-label="Registration steps">
            {STEPS.map((s, i) => {
              const n = i + 1
              const done = n < step
              const current = n === step
              return (
                <li key={s.title} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={current ? 'step' : undefined}>
                  <span className={`h-1.5 rounded-full ${done || current ? 'bg-[#0B5D2E]' : 'bg-[#E2E8E3]'}`} aria-hidden="true" />
                  <span className={`hidden truncate text-[11px] font-semibold sm:block ${current ? 'text-[#0B5D2E]' : done ? 'text-[#2E8B57]' : 'text-[#9AA5A0]'}`}>
                    {done && <Check className="mr-0.5 inline h-3 w-3" aria-hidden="true" />}{s.title}
                    <span className="sr-only">{done ? ' (done)' : current ? ' (current step)' : ''}</span>
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="mt-6 rounded-3xl bg-white p-6 shadow-[0_18px_44px_rgba(6,40,20,0.10)] ring-1 ring-[#E7E2D6] sm:p-8">
            {error && <Alert type="error" message={error} onDismiss={onDismissError} />}

            <form onSubmit={handleSubmit(submit, onInvalid)} noValidate className="space-y-6">
              {step === 1 && (
                <fieldset className="space-y-4">
                  <legend className="sr-only">About you</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" htmlFor="first_name" error={fieldError('first_name')}>
                      <div className="relative"><User className={icon} aria-hidden="true" />
                        <input id="first_name" autoComplete="given-name" {...register('first_name')} className={inputClass('first_name')} placeholder="Juan" {...a11y('first_name')} /></div>
                    </Field>
                    <Field label={<>Middle name <span className="font-normal text-[#7A867F]">(optional)</span></>} htmlFor="middle_name">
                      <input id="middle_name" autoComplete="additional-name" {...register('middle_name')} className={inputClass('middle_name', false)} placeholder="Santos" />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Last name" htmlFor="last_name" error={fieldError('last_name')}>
                      <div className="relative"><User className={icon} aria-hidden="true" />
                        <input id="last_name" autoComplete="family-name" {...register('last_name')} className={inputClass('last_name')} placeholder="Dela Cruz" {...a11y('last_name')} /></div>
                    </Field>
                    <Field label="Birthdate" htmlFor="date_of_birth" error={fieldError('date_of_birth')}>
                      <div className="relative"><Calendar className={icon} aria-hidden="true" />
                        <input id="date_of_birth" type="date" autoComplete="bday" {...register('date_of_birth')} className={inputClass('date_of_birth')} {...a11y('date_of_birth')} /></div>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Sex" htmlFor="sex" error={fieldError('sex')}>
                      <select id="sex" {...register('sex')} className={inputClass('sex', false)} {...a11y('sex')}>
                        <option value="">Select</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </Field>
                    <Field label="Nationality" htmlFor="nationality" error={fieldError('nationality')}>
                      <select id="nationality" {...register('nationality')} className={inputClass('nationality', false)} {...a11y('nationality')}>
                        <option value="">Select</option>
                        {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Email" htmlFor="email" error={fieldError('email') ?? <p id="email-hint" className="mt-1.5 text-xs text-[#7A867F]">We&apos;ll send a code to verify it, and email you when you&apos;re approved.</p>}>
                    <div className="relative"><Mail className={icon} aria-hidden="true" />
                      <input id="email" type="email" autoComplete="email" {...register('email')} className={inputClass('email')} placeholder="you@example.com" {...a11y('email', 'email-hint')} /></div>
                  </Field>
                  <Field label="Mobile number" htmlFor="mobile_number" error={fieldError('mobile_number')}>
                    <div className="relative"><Phone className={icon} aria-hidden="true" />
                      <input id="mobile_number" type="tel" inputMode="tel" autoComplete="tel" {...register('mobile_number')} className={inputClass('mobile_number')} placeholder="09XX XXX XXXX" {...a11y('mobile_number')} /></div>
                  </Field>
                </fieldset>
              )}

              {step === 2 && (
                <fieldset className="space-y-4">
                  <legend className="sr-only">Address</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Municipality" htmlFor="municipality_id" error={fieldError('municipality_id')}>
                      <select id="municipality_id" {...register('municipality_id')} className={inputClass('municipality_id', false)} {...a11y('municipality_id')}>
                        <option value="">Select</option>
                        {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Barangay" htmlFor="barangay" error={fieldError('barangay')}>
                      <select id="barangay" {...register('barangay')} disabled={!selectedMunicipality} className={inputClass('barangay', false)} {...a11y('barangay')}>
                        <option value="">{selectedMunicipality ? 'Select' : 'Choose a municipality first'}</option>
                        {selectedMunicipality?.barangays.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Complete address" htmlFor="house_no_street" error={fieldError('house_no_street') ?? (addressPrefix ? <p id="address-hint" className="mt-1.5 text-xs text-[#5B6A60]">Starts with <span className="font-semibold text-[#0B5D2E]">{addressPrefix}</span>add your street, sitio or house number.</p> : null)}>
                    <div className="relative"><MapPin className={icon} aria-hidden="true" />
                      <input id="house_no_street" autoComplete="street-address" {...register('house_no_street')} className={inputClass('house_no_street')} placeholder="Street, sitio, house number" {...a11y('house_no_street', addressPrefix ? 'address-hint' : undefined)} /></div>
                  </Field>
                </fieldset>
              )}

              {step === 3 && (
                <fieldset className="space-y-4">
                  <legend className="sr-only">ID check</legend>
                  <p className="rounded-2xl bg-[#F6F8F4] p-3 text-xs text-[#5B6A60]">The Tourism Office checks your ID before approving your account. Photos or scans: JPG, PNG or PDF, up to 5 MB each.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="ID type" htmlFor="government_id_type" error={fieldError('government_id_type')}>
                      <select id="government_id_type" {...register('government_id_type')} className={inputClass('government_id_type', false)} {...a11y('government_id_type')}>
                        <option value="">Select</option>
                        {ID_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="ID number" htmlFor="government_id_number" error={fieldError('government_id_number')}>
                      <div className="relative"><IdCard className={icon} aria-hidden="true" />
                        <input id="government_id_number" {...register('government_id_number')} className={inputClass('government_id_number')} placeholder="As printed on the ID" {...a11y('government_id_number')} /></div>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <IdFileField kind="front" title="Front of ID" required file={files.front} error={fileErrors.front} onPick={pickFile} />
                    <IdFileField kind="back" title="Back of ID" file={files.back} error={fileErrors.back} onPick={pickFile} />
                  </div>
                  <IdFileField kind="selfie" title="Selfie holding your ID" required file={files.selfie} error={fileErrors.selfie} onPick={pickFile} />
                </fieldset>
              )}

              {step === 4 && (
                <fieldset className="space-y-4">
                  <legend className="sr-only">Password</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Password" htmlFor="password">
                      <div className="relative"><Lock className={icon} aria-hidden="true" />
                        <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...register('password')} className={`${inputClass('password')} !pr-12`} placeholder="••••••••" {...a11y('password', 'password-rules')} />
                        <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#6B7280] transition-colors hover:bg-[#EAF6ED] hover:text-[#0B5D2E]">
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </Field>
                    <Field label="Confirm password" htmlFor="password_confirmation" error={fieldError('password_confirmation')}>
                      <div className="relative"><Lock className={icon} aria-hidden="true" />
                        <input id="password_confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...register('password_confirmation')} className={inputClass('password_confirmation')} placeholder="••••••••" {...a11y('password_confirmation')} /></div>
                    </Field>
                  </div>
                  <ul id="password-rules" aria-label="Password requirements" className="grid gap-x-4 gap-y-1.5 rounded-2xl bg-[#F6F8F4] p-3 text-xs sm:grid-cols-2">
                    {PASSWORD_RULES.map((rule) => {
                      const ok = rule.test(password)
                      const missed = !ok && (Boolean(err('password')) || password.length > 0)
                      return (
                        <li key={rule.label} className={`flex items-center gap-2 ${ok ? 'text-[#0B5D2E]' : missed ? 'text-red-600' : 'text-[#5B6A60]'}`}>
                          {ok ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                          {rule.label}<span className="sr-only">{ok ? ' (done)' : ' (not yet)'}</span>
                        </li>
                      )
                    })}
                  </ul>
                </fieldset>
              )}

              {step === 5 && (
                <div className="space-y-4">
                  <ReviewGroup title="About you" onEdit={() => onStepChange(1)}
                    rows={[
                      ['Name', [watch('first_name'), watch('middle_name'), watch('last_name')].filter(Boolean).join(' ')],
                      ['Birthdate', watch('date_of_birth')],
                      ['Sex', watch('sex') ? String(watch('sex')).replace(/^./, (c) => c.toUpperCase()) : ''],
                      ['Nationality', watch('nationality')],
                      ['Email', watch('email')],
                      ['Mobile', watch('mobile_number')],
                    ]} />
                  <ReviewGroup title="Address" onEdit={() => onStepChange(2)}
                    rows={[['Municipality', muni?.name ?? ''], ['Barangay', watch('barangay')], ['Address', watch('house_no_street')]]} />
                  <ReviewGroup title="ID check" onEdit={() => onStepChange(3)}
                    rows={[
                      ['ID', [idType, watch('government_id_number')].filter(Boolean).join(' · ')],
                      ['Front of ID', files.front?.name ?? 'Not uploaded'],
                      ['Back of ID', files.back?.name ?? 'Not uploaded (optional)'],
                      ['Selfie', files.selfie?.name ?? 'Not uploaded'],
                    ]} />
                  <div className="rounded-2xl border border-[#CFE5D7] bg-[#EEF7F0] p-4 text-sm">
                    <p className="font-semibold text-[#0B5D2E]">What happens next</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[#3B4A40]">
                      <li>You verify your email with the code we send.</li>
                      <li>The Tourism Office reviews your account and ID.</li>
                      <li>Once approved, you add your business from your dashboard.</li>
                    </ol>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                {step > 1 && (
                  <button type="button" onClick={() => { onDismissError(); onStepChange(step - 1) }}
                    className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#E2E8E3] px-5 py-3 text-sm font-bold text-[#14351F] transition hover:border-[#0B5D2E] hover:text-[#0B5D2E]">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                )}
                {step < last ? (
                  <button type="button" onClick={() => void next()}
                    className="ml-auto flex flex-1 items-center justify-center gap-2 rounded-full bg-[#0B5D2E] px-4 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,93,46,0.30)] transition hover:bg-[#094A25]">
                    Next: {STEPS[step]!.title} <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button type="submit" disabled={isSubmitting}
                    className="ml-auto flex flex-1 items-center justify-center gap-2 rounded-full bg-[#0B5D2E] px-4 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,93,46,0.30)] transition hover:bg-[#094A25] disabled:opacity-50">
                    {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</> : <>Submit for review <ArrowRight className="h-4 w-4" /></>}
                  </button>
                )}
              </div>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[#9AA5A0]">
              <span className="h-px flex-1 bg-[#E7E2D6]" /> Already have an account? <span className="h-px flex-1 bg-[#E7E2D6]" />
            </div>
            <Link to="/login" className="flex w-full items-center justify-center rounded-full border-2 border-[#0B5D2E] px-4 py-3 text-sm font-bold text-[#0B5D2E] transition hover:bg-[#EAF6ED]">
              Sign in
            </Link>
          </div>

          <div className="mt-6 flex items-center justify-between text-xs text-[#7A867F]">
            <Link to="/" className="inline-flex items-center gap-1 font-semibold text-[#0B5D2E] hover:text-[#E0A800] sm:hidden">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to home
            </Link>
            <span className="ml-auto">&copy; {new Date().getFullYear()} TrackTour — Bansud Tourism Office</span>
          </div>
        </div>
      </main>
    </div>
  )
}

function Field({ label, htmlFor, error, children }: { label: ReactNode; htmlFor: string; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-sm font-semibold text-[#14351F]" htmlFor={htmlFor}>{label}</label>
      {children}
      {error}
    </div>
  )
}

/** One ID photo: a drop zone that shows the picked image (or the PDF's name). */
function IdFileField({ kind, title, required = false, file, error, onPick }: {
  kind: IdFileKind
  title: string
  required?: boolean
  file: File | null
  error?: string
  onPick: (kind: IdFileKind, file: File | null) => void
}) {
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const id = `id-file-${kind}`

  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm font-semibold text-[#14351F]">{title} {!required && <span className="font-normal text-[#7A867F]">(optional)</span>}</p>
      <label htmlFor={id} className={`flex h-36 w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed transition ${error ? 'border-red-300 bg-red-50/40' : file ? 'border-[#2E8B57] bg-[#F6F8F4]' : 'border-[#D7E8DB] hover:border-[#2E8B57] hover:bg-[#F6F8F4]'}`}>
        <input
          id={id}
          type="file"
          accept={ID_ACCEPT}
          className="sr-only"
          aria-label={`${title}${required ? '' : ' (optional)'}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => { onPick(kind, e.target.files?.[0] ?? null); e.target.value = '' }}
        />
        {preview ? (
          <img src={preview} alt={`${title} preview`} className="h-full w-full object-cover" />
        ) : file ? (
          <span className="flex flex-col items-center gap-1 px-3 text-center">
            <FileText className="h-7 w-7 text-[#2E8B57]" aria-hidden="true" />
            <span className="max-w-full truncate text-xs font-semibold text-[#0B5D2E]">{file.name}</span>
            <span className="text-[11px] text-[#7A867F]">Click to change</span>
          </span>
        ) : (
          <span className="flex flex-col items-center gap-1 text-center">
            <Upload className="h-6 w-6 text-[#2E8B57]" aria-hidden="true" />
            <span className="text-sm font-semibold text-[#14351F]">Click to upload</span>
            <span className="text-[11px] text-[#7A867F]">JPG, PNG or PDF · max 5 MB</span>
          </span>
        )}
      </label>
      {error && <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function ReviewGroup({ title, rows, onEdit }: { title: string; rows: [string, unknown][]; onEdit: () => void }) {
  return (
    <section className="rounded-2xl border border-[#E7E2D6] p-4" aria-label={title}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#7A867F]">{title}</h2>
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B5D2E] hover:text-[#E0A800]" aria-label={`Edit ${title.toLowerCase()}`}>
          <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
        </button>
      </div>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="shrink-0 text-[#7A867F]">{k}</dt>
            <dd className="min-w-0 break-words text-right font-medium text-[#14351F]">{String(v || '—')}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
