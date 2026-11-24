import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft, ArrowRight, Bike, Calendar, Check, CheckCircle2, Circle, ClipboardList, Eye, EyeOff, FileText, GraduationCap, KeyRound,
  Loader2, Lock, Mail, Phone, Send, Ticket, TriangleAlert, User,
} from 'lucide-react'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { Alert } from '@/shared/components/Alert'
import { getRoleDashboardPath } from '@/shared/utils'
import { get, post } from '@/shared/services/api'
import AuthBrandPanel, { AUTH_FONT, type AuthHighlight } from '@/features/auth/components/AuthBrandPanel'
import { Field, PASSWORD_RULES, ReviewGroup } from '@/features/auth/components/BusinessOwnerSignUp'

const SUFFIX_OPTIONS = ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V']

function normalizeMobileNumber(value: string): string {
  const mobile = value.replace(/[\s-]/g, '')
  return /^9\d{9}$/.test(mobile) ? `0${mobile}` : mobile
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}:${remaining.toString().padStart(2, '0')}`
}

function ageFromDateOfBirth(value: string): number {
  const dob = new Date(value)
  if (Number.isNaN(dob.getTime())) return 0
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDelta = now.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age--
  return age
}

function todayISO(): string {
  const now = new Date()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Must include a lowercase letter')
  .regex(/[A-Z]/, 'Must include an uppercase letter')
  .regex(/[0-9]/, 'Must include a number')
  .regex(/[^A-Za-z0-9]/, 'Must include a symbol')

const riderSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(50, 'First name must be 50 characters or less').regex(/^[A-Za-z\s]+$/, 'First name must contain letters only'),
  middle_name: z.string().optional().refine((val) => !val || /^[A-Za-z\s]+$/.test(val), 'Middle name must contain letters only'),
  last_name: z.string().min(1, 'Last name is required').regex(/^[A-Za-z\s]+$/, 'Last name must contain letters only'),
  suffix: z.string().optional(),
  date_of_birth: z
    .string()
    .min(1, 'Date of birth is required')
    .refine((val) => !Number.isNaN(new Date(val).getTime()), 'Enter a valid date of birth')
    .refine((val) => new Date(val) <= new Date(), 'Date of birth cannot be in the future')
    .refine((val) => ageFromDateOfBirth(val) >= 18, 'You must be at least 18 years old'),
  email: z.string().email('Please enter a valid email address'),
  mobile_number: z.string().min(9, 'Mobile number is required').regex(/^((\+63|0)9\d{9}|9\d{9})$/, 'Please enter a valid Philippine mobile number'),
  otp_code: z.string().min(6, 'The code must be 6 digits').max(6, 'The code must be 6 digits'),
  // Decides which Tourism Office trains, interviews and manages the rider
  // (and issues their COD cash). Set here once: not editable afterwards.
  municipality_id: z.string().refine((v) => Number(v) >= 1, 'Municipality is required'),
  barangay_id: z.string().refine((v) => Number(v) >= 1, 'Barangay is required'),
  password: passwordRule,
  password_confirmation: z.string(),
  referral_code: z.string().optional(),
  confirm_age: z.boolean().refine((val) => val === true, 'You must confirm you are at least 18 years old'),
  agree_terms: z.boolean().refine((val) => val === true, 'You must agree to the Terms and Conditions'),
  agree_privacy: z.boolean().refine((val) => val === true, 'You must agree to the Privacy Policy'),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
})

type RiderForm = z.infer<typeof riderSchema>
type RiderField = keyof RiderForm

/** The account part of the rider application, in four short steps. */
const STEPS: { title: string; fields: RiderField[] }[] = [
  { title: 'About you', fields: ['first_name', 'middle_name', 'last_name', 'suffix', 'date_of_birth', 'municipality_id', 'barangay_id'] },
  { title: 'Contact', fields: ['email', 'mobile_number'] },
  { title: 'Password', fields: ['password', 'password_confirmation', 'referral_code'] },
  { title: 'Review', fields: ['confirm_age', 'agree_terms', 'agree_privacy'] },
]

/** Which step shows a field, so an error found later sends the rider back to it. */
const FIELD_STEP: Record<string, number> = Object.fromEntries([
  ...STEPS.flatMap((s, i) => s.fields.map((f) => [f, i + 1] as const)),
  ['otp_code', 2],
])

/** The whole rider application (left panel): this page is the first of four steps. */
const APPLICATION_STEPS: AuthHighlight[] = [
  { icon: ClipboardList, text: '1. Create your account' },
  { icon: Bike, text: '2. Add your vehicle' },
  { icon: FileText, text: '3. Upload your requirements' },
  { icon: GraduationCap, text: '4. Interview and training' },
]

/**
 * Rider sign-up (/register/rider): step 1 of the rider application, in the
 * same look as the other sign-up pages (brand panel, step indicator, short
 * steps). Next checks the current step first; the email must be verified with
 * the emailed code before the rider can go past Contact.
 */
export default function RiderRegisterPage() {
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [municipalities, setMunicipalities] = useState<{ id: number; name: string; barangays?: { id: number; name: string }[] }[]>([])
  const [showPassword, setShowPassword] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [otpNeeded, setOtpNeeded] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [lockoutSeconds, setLockoutSeconds] = useState(0)
  const [emailChecking, setEmailChecking] = useState(false)
  const [emailExists, setEmailExists] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lockoutRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const emailCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emailCheckSeq = useRef(0)
  const { register: registerUser } = useAuthStore()
  const navigate = useNavigate()
  const last = STEPS.length

  const form = useForm<RiderForm>({
    resolver: zodResolver(riderSchema),
    defaultValues: {
      first_name: '',
      middle_name: '',
      last_name: '',
      suffix: '',
      date_of_birth: '',
      email: '',
      mobile_number: '',
      otp_code: '',
      municipality_id: '',
      barangay_id: '',
      password: '',
      password_confirmation: '',
      referral_code: '',
      confirm_age: false,
      agree_terms: false,
      agree_privacy: false,
    },
  })
  const { register, watch, trigger, formState: { errors, isSubmitting } } = form

  const selectedMunicipalityId = Number(watch('municipality_id')) || 0
  const selectedMunicipality = municipalities.find((m) => m.id === selectedMunicipalityId)
  const riderBarangays = selectedMunicipality?.barangays ?? []

  useEffect(() => {
    get<{ id: number; name: string; barangays?: { id: number; name: string }[] }[]>('/municipalities')
      .then((list) => setMunicipalities(Array.isArray(list) ? list : []))
      .catch(() => {})
  }, [])

  const watchedPassword = watch('password') || ''
  const watchedEmail = watch('email')
  const watchedDateOfBirth = watch('date_of_birth')
  const age = watchedDateOfBirth ? ageFromDateOfBirth(watchedDateOfBirth) : 0

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (lockoutRef.current) clearInterval(lockoutRef.current)
      if (emailCheckRef.current) clearTimeout(emailCheckRef.current)
    }
  }, [])

  // On-type email availability probe. Debounced, and guarded against stale
  // responses so a slow reply for an old value cannot overwrite a newer one.
  useEffect(() => {
    const email = (watchedEmail || '').trim().toLowerCase()

    if (otpVerified || !EMAIL_RE.test(email)) {
      setEmailExists(false)
      setEmailChecking(false)
      if (emailCheckRef.current) clearTimeout(emailCheckRef.current)
      return
    }

    setEmailExists(false)
    setEmailChecking(true)
    form.clearErrors('email')
    if (emailCheckRef.current) clearTimeout(emailCheckRef.current)
    emailCheckRef.current = setTimeout(async () => {
      const seq = ++emailCheckSeq.current
      try {
        const result = await post<{ available: boolean }>('/auth/check-email', { email })
        if (seq !== emailCheckSeq.current) return
        if (result.available === false) {
          setEmailExists(true)
          form.setError('email', { type: 'manual', message: 'This email is already registered.' })
        } else {
          setEmailExists(false)
          form.clearErrors('email')
        }
      } catch {
        if (seq !== emailCheckSeq.current) return
        // A failed probe must never block a legitimate submission; the
        // authoritative unique check still runs on register.
        setEmailExists(false)
      } finally {
        if (seq === emailCheckSeq.current) setEmailChecking(false)
      }
    }, 500)

    return () => {
      if (emailCheckRef.current) clearTimeout(emailCheckRef.current)
    }
  }, [watchedEmail, otpVerified, form])

  const startCountdown = useCallback(() => {
    setCountdown(60)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  const startLockout = useCallback((seconds: number) => {
    if (seconds <= 0) return
    setLockoutSeconds(seconds)
    if (lockoutRef.current) clearInterval(lockoutRef.current)
    lockoutRef.current = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          if (lockoutRef.current) clearInterval(lockoutRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  const handleOtpError = useCallback(
    (err: unknown, fallback: string) => {
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string; retry_after?: number } }
      }
      const data = axiosErr.response?.data
      if (axiosErr.response?.status === 429 && data?.retry_after) {
        startLockout(data.retry_after)
      }
      setError(data?.message || fallback)
    },
    [startLockout]
  )

  const handleSendOtp = async () => {
    const mobile = normalizeMobileNumber(form.getValues('mobile_number'))
    const email = form.getValues('email')
    let ok = true
    if (!email || !EMAIL_RE.test(email)) {
      form.setError('email', { message: 'Enter a valid email address first' })
      ok = false
    } else if (emailExists) {
      form.setError('email', { type: 'manual', message: 'This email is already registered.' })
      ok = false
    }
    if (!/^09\d{9}$/.test(mobile)) {
      form.setError('mobile_number', { message: 'Enter a valid mobile number first' })
      ok = false
    }
    if (!ok) return

    setOtpSending(true)
    setOtpNeeded(false)
    setError('')
    try {
      await post('/auth/send-otp', { mobile_number: mobile, email, type: 'registration' })
      setOtpSent(true)
      setOtpVerified(false)
      form.setValue('otp_code', '')
      startCountdown()
    } catch (err: unknown) {
      handleOtpError(err, 'Failed to send the code')
    } finally {
      setOtpSending(false)
    }
  }

  const handleVerifyOtp = async () => {
    const otp = form.getValues('otp_code')
    const mobile = normalizeMobileNumber(form.getValues('mobile_number'))
    if (!otp || otp.length < 6) {
      form.setError('otp_code', { message: 'Enter the 6-digit code' })
      return
    }

    setOtpVerifying(true)
    setError('')
    try {
      await post('/auth/verify-otp', { mobile_number: mobile, otp_code: otp, type: 'registration' })
      form.clearErrors('otp_code')
      setOtpVerified(true)
      setOtpNeeded(false)
    } catch (err: unknown) {
      handleOtpError(err, 'Invalid or expired code')
      setOtpVerified(false)
    } finally {
      setOtpVerifying(false)
    }
  }

  /** Unlock the email and number to use different ones (needs a new code). */
  const changeContact = () => {
    setOtpVerified(false)
    setOtpSent(false)
    form.setValue('otp_code', '')
  }

  const goTo = (n: number) => {
    setError('')
    setStep(n)
  }

  const next = async () => {
    setError('')
    const ok = await trigger(STEPS[step - 1]!.fields)
    if (step === 2) {
      if (emailExists) {
        form.setError('email', { type: 'manual', message: 'This email is already registered.' })
        return
      }
      if (ok && !otpVerified) {
        setOtpNeeded(true)
        return
      }
    }
    if (ok) setStep(Math.min(last, step + 1))
  }

  // Errors found on submit (or by the server) send the rider back to their step.
  const goToFirstError = (fields: string[]) => {
    const target = fields.map((f) => FIELD_STEP[f]).filter((n): n is number => !!n).sort((a, b) => a - b)[0]
    if (target && target !== step) setStep(target)
  }

  const onInvalid = (formErrors: FieldErrors<RiderForm>) => goToFirstError(Object.keys(formErrors))

  const onSubmit = async (data: RiderForm) => {
    if (!otpVerified) {
      setOtpNeeded(true)
      setStep(2)
      return
    }

    if (emailExists) {
      form.setError('email', { type: 'manual', message: 'This email is already registered.' })
      setStep(2)
      return
    }

    setError('')
    try {
      const fd = new FormData()
      fd.append('role', 'rider')
      fd.append('first_name', data.first_name)
      if (data.middle_name) fd.append('middle_name', data.middle_name)
      fd.append('last_name', data.last_name)
      if (data.suffix) fd.append('suffix', data.suffix)
      fd.append('date_of_birth', data.date_of_birth)
      fd.append('email', data.email)
      fd.append('mobile_number', normalizeMobileNumber(data.mobile_number))
      fd.append('municipality_id', data.municipality_id)
      fd.append('barangay_id', data.barangay_id)
      fd.append('password', data.password)
      fd.append('password_confirmation', data.password_confirmation)
      fd.append('otp_code', data.otp_code)
      fd.append('confirm_age', data.confirm_age ? '1' : '0')
      fd.append('agree_terms', data.agree_terms ? '1' : '0')
      fd.append('agree_privacy', data.agree_privacy ? '1' : '0')
      if (data.referral_code) fd.append('referral_code', data.referral_code)

      const user = await registerUser(fd as unknown as Record<string, unknown>)
      // The registration code was emailed, so the email is already verified:
      // go straight to the rider application (step 2 of 4).
      if (user.email_verified_at) {
        navigate('/rider/onboarding', { replace: true })
      } else {
        navigate('/verify-email', {
          state: { email: user.email, returnTo: getRoleDashboardPath(user.role) },
        })
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      const fieldErrors = axiosErr.response?.data?.errors
      if (fieldErrors) {
        if (fieldErrors.email) setEmailExists(true)
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (field in FIELD_STEP && messages[0]) form.setError(field as RiderField, { type: 'server', message: messages[0] })
        }
        goToFirstError(Object.keys(fieldErrors))
        const firstError = Object.values(fieldErrors)[0]
        setError(firstError?.[0] || 'Registration failed')
      } else {
        setError(axiosErr.response?.data?.message || 'Registration failed')
      }
    }
  }

  // Shared look with the other sign-up pages.
  const err = (name: RiderField) => errors[name]?.message
  const fieldError = (name: RiderField) => (err(name) ? <p id={`${name}-error`} className="mt-1.5 text-xs text-red-600">{err(name)}</p> : null)
  const a11y = (name: RiderField, hint?: string) => ({
    'aria-invalid': Boolean(err(name)),
    'aria-describedby': [err(name) ? `${name}-error` : null, hint].filter(Boolean).join(' ') || undefined,
  })
  const inputClass = (name: RiderField, withIcon = true) =>
    `w-full rounded-2xl border bg-white py-3 ${withIcon ? 'pl-11' : 'pl-4'} pr-4 text-sm text-[#14351F] placeholder-[#9AA5A0] shadow-sm outline-none transition focus:border-[#2E8B57] focus:ring-4 focus:ring-[#2E8B57]/15 disabled:cursor-not-allowed disabled:bg-[#F4F6F4] ${
      err(name) ? 'border-red-300' : 'border-[#E2E8E3]'
    }`
  const icon = 'pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2E8B57]'
  const smallButton =
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#0B5D2E] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#094A25] disabled:cursor-not-allowed disabled:opacity-50'
  const checkbox = 'mt-0.5 h-4 w-4 shrink-0 rounded border-[#D7E8DB] text-[#0B5D2E] focus:ring-[#2E8B57]'

  const fullName = [watch('first_name'), watch('middle_name'), watch('last_name'), watch('suffix')].filter(Boolean).join(' ')
  const barangayName = riderBarangays.find((b) => b.id === Number(watch('barangay_id')))?.name ?? ''

  return (
    <div className="min-h-screen bg-[#FAFAF5] lg:grid lg:grid-cols-[1.05fr_1fr]" style={AUTH_FONT}>
      <AuthBrandPanel
        eyebrow="For riders"
        headline="Ride and deliver around"
        highlight="Bansud"
        description="Sign up online, then train with your municipality's Tourism Office. Once approved, you take trips and food deliveries on TrackTour."
        highlights={APPLICATION_STEPS}
      />

      <main className="flex items-center justify-center px-5 py-10 sm:px-10 lg:min-h-screen">
        <div className="w-full max-w-lg">
          <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Rider application · Step 1 of 4
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[#0B5D2E] sm:text-4xl">Create your rider account</h1>
          <p className="mt-2 text-sm text-[#5B6A60]">Next you&apos;ll add your vehicle, upload your requirements and book your onboarding.</p>

          {/* Step indicator */}
          <ol className="mt-6 flex items-center gap-1.5" aria-label="Account steps">
            {STEPS.map((s, i) => {
              const n = i + 1
              const done = n < step
              const current = n === step
              return (
                <li key={s.title} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={current ? 'step' : undefined}>
                  <span className={`h-1.5 rounded-full ${done || current ? 'bg-[#0B5D2E]' : 'bg-[#E2E8E3]'}`} aria-hidden="true" />
                  <span className={`truncate text-[11px] font-semibold ${current ? 'text-[#0B5D2E]' : done ? 'text-[#2E8B57]' : 'text-[#9AA5A0]'}`}>
                    {done && <Check className="mr-0.5 inline h-3 w-3" aria-hidden="true" />}{s.title}
                    <span className="sr-only">{done ? ' (done)' : current ? ' (current step)' : ''}</span>
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="mt-6 rounded-3xl bg-white p-6 shadow-[0_18px_44px_rgba(6,40,20,0.10)] ring-1 ring-[#E7E2D6] sm:p-8">
            {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

            <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-6">
              {step === 1 && (
                <fieldset className="space-y-4">
                  <legend className="sr-only">About you</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" htmlFor="first_name" error={fieldError('first_name')}>
                      <div className="relative"><User className={icon} aria-hidden="true" />
                        <input id="first_name" autoComplete="given-name" {...register('first_name')} className={inputClass('first_name')} placeholder="Juan" {...a11y('first_name')} /></div>
                    </Field>
                    <Field label={<>Middle name <span className="font-normal text-[#7A867F]">(optional)</span></>} htmlFor="middle_name" error={fieldError('middle_name')}>
                      <input id="middle_name" autoComplete="additional-name" {...register('middle_name')} className={inputClass('middle_name', false)} placeholder="Santos" {...a11y('middle_name')} />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                    <Field label="Last name" htmlFor="last_name" error={fieldError('last_name')}>
                      <div className="relative"><User className={icon} aria-hidden="true" />
                        <input id="last_name" autoComplete="family-name" {...register('last_name')} className={inputClass('last_name')} placeholder="Dela Cruz" {...a11y('last_name')} /></div>
                    </Field>
                    <Field label={<>Suffix <span className="font-normal text-[#7A867F]">(optional)</span></>} htmlFor="suffix">
                      <select id="suffix" autoComplete="honorific-suffix" {...register('suffix')} className={inputClass('suffix', false)}>
                        <option value="">None</option>
                        {SUFFIX_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field
                    label="Birthdate"
                    htmlFor="date_of_birth"
                    error={fieldError('date_of_birth') ?? <p id="dob-hint" className="mt-1.5 text-xs text-[#7A867F]">{age > 0 ? `${age} years old. ` : ''}Riders must be 18 or older.</p>}
                  >
                    <div className="relative"><Calendar className={icon} aria-hidden="true" />
                      <input id="date_of_birth" type="date" max={todayISO()} autoComplete="bday" {...register('date_of_birth')} className={inputClass('date_of_birth')} {...a11y('date_of_birth', 'dob-hint')} /></div>
                  </Field>

                  <div className="space-y-4 rounded-2xl border border-[#E7E2D6] p-4">
                    <div>
                      <p className="text-sm font-semibold text-[#14351F]">Where you live</p>
                      <p id="rider-municipality-hint" className="mt-0.5 text-xs text-[#5B6A60]">Its Tourism Office trains, interviews and manages you, and issues your COD cash.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Municipality" htmlFor="rider-municipality" error={fieldError('municipality_id')}>
                        <select
                          id="rider-municipality"
                          {...register('municipality_id', { onChange: () => form.setValue('barangay_id', '') })}
                          className={inputClass('municipality_id', false)}
                          {...a11y('municipality_id', 'rider-municipality-hint')}
                        >
                          <option value="">Select</option>
                          {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Barangay" htmlFor="rider-barangay" error={fieldError('barangay_id')}>
                        <select
                          id="rider-barangay"
                          {...register('barangay_id')}
                          disabled={!riderBarangays.length}
                          className={inputClass('barangay_id', false)}
                          {...a11y('barangay_id')}
                        >
                          <option value="">{selectedMunicipalityId ? 'Select' : 'Choose a municipality first'}</option>
                          {riderBarangays.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </Field>
                    </div>
                    <p className="flex items-start gap-2 rounded-xl bg-[#FFF6CC] px-3 py-2 text-xs font-medium text-[#7A5A00]">
                      <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Your municipality and barangay cannot be changed after you register.
                    </p>
                  </div>
                </fieldset>
              )}

              {step === 2 && (
                <fieldset className="space-y-4">
                  <legend className="sr-only">Contact</legend>
                  <Field
                    label="Email"
                    htmlFor="email"
                    error={
                      fieldError('email') ??
                      (emailChecking ? (
                        <p className="mt-1.5 flex items-center gap-1 text-xs text-[#7A867F]"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking availability...</p>
                      ) : (
                        <p id="email-hint" className="mt-1.5 text-xs text-[#7A867F]">We&apos;ll email you a code to confirm it&apos;s yours.</p>
                      ))
                    }
                  >
                    <div className="relative"><Mail className={icon} aria-hidden="true" />
                      <input id="email" type="email" autoComplete="email" {...register('email')} disabled={otpVerified} className={inputClass('email')} placeholder="you@example.com" {...a11y('email', 'email-hint')} /></div>
                  </Field>
                  <Field label="Mobile number" htmlFor="mobile_number" error={fieldError('mobile_number')}>
                    <div className="relative"><Phone className={icon} aria-hidden="true" />
                      <input id="mobile_number" type="tel" inputMode="tel" autoComplete="tel" {...register('mobile_number')} disabled={otpVerified} className={inputClass('mobile_number')} placeholder="09XX XXX XXXX" {...a11y('mobile_number')} /></div>
                  </Field>

                  {otpVerified ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-[#CFE5D7] bg-[#EEF7F0] p-4 text-sm" role="status">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-[#0B5D2E]" aria-hidden="true" />
                      <p className="flex-1 font-semibold text-[#0B5D2E]">Email verified</p>
                      <button type="button" onClick={changeContact} className="text-xs font-semibold text-[#0B5D2E] underline-offset-2 hover:text-[#E0A800] hover:underline">
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className={`space-y-3 rounded-2xl p-4 ${otpNeeded ? 'bg-red-50 ring-1 ring-red-200' : 'bg-[#F6F8F4]'}`}>
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#0B5D2E] ring-1 ring-[#E2E8E3]">
                          <KeyRound className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <p className="flex-1 text-xs text-[#3B4A40]">
                          {otpSent
                            ? <>We sent a 6-digit code to <span className="font-semibold text-[#0B5D2E]">{watchedEmail}</span>.</>
                            : 'Verify your email to continue.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleSendOtp()}
                          disabled={otpSending || countdown > 0 || lockoutSeconds > 0}
                          className={smallButton}
                        >
                          {otpSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                          {countdown > 0 ? `Resend in ${countdown}s` : otpSent ? 'Resend' : 'Send code'}
                        </button>
                      </div>

                      {otpSent && (
                        <Field label="Verification code" htmlFor="otp_code" error={fieldError('otp_code')}>
                          <div className="flex gap-2">
                            <input
                              id="otp_code"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              {...register('otp_code')}
                              disabled={lockoutSeconds > 0}
                              className={`${inputClass('otp_code', false)} text-center font-semibold tracking-[0.4em]`}
                              placeholder="••••••"
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleVerifyOtp() } }}
                              {...a11y('otp_code')}
                            />
                            <button type="button" onClick={() => void handleVerifyOtp()} disabled={otpVerifying || lockoutSeconds > 0} className={smallButton}>
                              {otpVerifying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Verify
                            </button>
                          </div>
                        </Field>
                      )}

                      {lockoutSeconds > 0 && (
                        <p className="text-xs text-red-600">Too many failed attempts. Try again in {formatCountdown(lockoutSeconds)}.</p>
                      )}
                      {otpNeeded && <p className="text-xs font-medium text-red-600" role="alert">Verify your email with the code before you continue.</p>}
                    </div>
                  )}
                </fieldset>
              )}

              {step === 3 && (
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
                      const ok = rule.test(watchedPassword)
                      const missed = !ok && (Boolean(err('password')) || watchedPassword.length > 0)
                      return (
                        <li key={rule.label} className={`flex items-center gap-2 ${ok ? 'text-[#0B5D2E]' : missed ? 'text-red-600' : 'text-[#5B6A60]'}`}>
                          {ok ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                          {rule.label}<span className="sr-only">{ok ? ' (done)' : ' (not yet)'}</span>
                        </li>
                      )
                    })}
                  </ul>
                  <Field label={<>Referral code <span className="font-normal text-[#7A867F]">(optional)</span></>} htmlFor="referral_code">
                    <div className="relative"><Ticket className={icon} aria-hidden="true" />
                      <input id="referral_code" autoComplete="off" {...register('referral_code')} className={inputClass('referral_code')} placeholder="From a rider who invited you" /></div>
                  </Field>
                </fieldset>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <ReviewGroup title="About you" onEdit={() => goTo(1)}
                    rows={[
                      ['Name', fullName],
                      ['Birthdate', age > 0 ? `${watchedDateOfBirth} (${age} years old)` : watchedDateOfBirth],
                      ['Municipality', selectedMunicipality?.name ?? ''],
                      ['Barangay', barangayName],
                    ]} />
                  <ReviewGroup title="Contact" onEdit={() => goTo(2)}
                    rows={[
                      ['Email', watchedEmail],
                      ['Mobile', watch('mobile_number')],
                      ['Referral code', watch('referral_code') || 'None'],
                    ]} />

                  <fieldset className="space-y-3">
                    <legend className="sr-only">Agreements</legend>
                    <Agreement id="confirm_age" error={fieldError('confirm_age')}>
                      <input id="confirm_age" type="checkbox" {...register('confirm_age')} className={checkbox} {...a11y('confirm_age')} />
                      I confirm that I am at least 18 years old.
                    </Agreement>
                    <Agreement id="agree_terms" error={fieldError('agree_terms')}>
                      <input id="agree_terms" type="checkbox" {...register('agree_terms')} className={checkbox} {...a11y('agree_terms')} />
                      <span>I agree to the <Link to="/terms" target="_blank" className="font-semibold text-[#0B5D2E] hover:underline">Terms and Conditions</Link>.</span>
                    </Agreement>
                    <Agreement id="agree_privacy" error={fieldError('agree_privacy')}>
                      <input id="agree_privacy" type="checkbox" {...register('agree_privacy')} className={checkbox} {...a11y('agree_privacy')} />
                      <span>I agree to the <Link to="/privacy" target="_blank" className="font-semibold text-[#0B5D2E] hover:underline">Privacy Policy</Link>.</span>
                    </Agreement>
                  </fieldset>

                  <div className="rounded-2xl border border-[#CFE5D7] bg-[#EEF7F0] p-4 text-sm">
                    <p className="font-semibold text-[#0B5D2E]">What happens next</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[#3B4A40]">
                      <li>Add your vehicle and upload your license and OR/CR.</li>
                      <li>Your Tourism Office verifies them and schedules your interview and training.</li>
                      <li>Attend with your original documents, pass, and start earning.</li>
                    </ol>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                {step > 1 && (
                  <button type="button" onClick={() => goTo(step - 1)}
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
                    {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating account...</> : <>Create rider account <ArrowRight className="h-4 w-4" /></>}
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

          <div className="mt-6 flex items-center justify-between gap-4 text-xs text-[#7A867F]">
            <Link to="/become-a-rider" className="inline-flex items-center gap-1 font-semibold text-[#0B5D2E] hover:text-[#E0A800]">
              <ArrowLeft className="h-3.5 w-3.5" /> About the rider program
            </Link>
            <span>&copy; {new Date().getFullYear()} TrackTour — Bansud Tourism Office</span>
          </div>
        </div>
      </main>
    </div>
  )
}

/** One agreement checkbox: the whole row is the label. */
function Agreement({ id, error, children }: { id: string; error?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#E7E2D6] p-3 text-sm text-[#14351F] transition hover:border-[#2E8B57]">
        {children}
      </label>
      {error}
    </div>
  )
}
