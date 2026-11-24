import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { FieldErrors, UseFormReturn } from 'react-hook-form'
import { ArrowLeft, ArrowRight, Calendar, Check, Circle, Eye, EyeOff, Loader2, Lock, Mail, Phone, User } from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import AuthBrandPanel, { AUTH_FONT } from './AuthBrandPanel'

/** The password rules RegisterPage's zod schema enforces, shown as a live checklist. */
const PASSWORD_RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'A number', test: (v) => /[0-9]/.test(v) },
  { label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
]

interface Props {
  // RegisterPage's form (tourist schema); typed loosely because it is shared by every role.
  form: UseFormReturn<any>
  onSubmit: (data: any) => Promise<void>
  onInvalid: (errors: FieldErrors<any>) => void
  error: string
  onDismissError: () => void
}

/**
 * Tourist sign-up (/register), same look as the sign-in page: the brand panel
 * on the left, the form on the right in three short groups (about you, how to
 * reach you, password) with an error under each field and a live password
 * checklist. Validation and submission are RegisterPage's (unchanged).
 */
export default function TouristSignUp({ form, onSubmit, onInvalid, error, onDismissError }: Props) {
  const [showPassword, setShowPassword] = useState(false)
  const { register, handleSubmit, watch, formState: { errors, isSubmitting, submitCount } } = form
  const password = String(watch('password') ?? '')
  const fieldError = (name: string) => {
    const message = (errors as Record<string, { message?: string } | undefined>)[name]?.message
    return message ? <p id={`${name}-error`} className="mt-1.5 text-xs text-red-600">{message}</p> : null
  }
  const invalid = (name: string) => Boolean((errors as Record<string, unknown>)[name])
  const inputClass = (name: string, withIcon = true) =>
    `w-full rounded-2xl border bg-white py-3 ${withIcon ? 'pl-11' : 'pl-4'} pr-4 text-sm text-[#14351F] placeholder-[#9AA5A0] shadow-sm outline-none transition focus:border-[#2E8B57] focus:ring-4 focus:ring-[#2E8B57]/15 ${
      invalid(name) ? 'border-red-300' : 'border-[#E2E8E3]'
    }`
  const describedBy = (name: string, hint?: string) => [invalid(name) ? `${name}-error` : null, hint].filter(Boolean).join(' ') || undefined
  const label = 'mb-1.5 block text-sm font-semibold text-[#14351F]'
  const icon = 'pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2E8B57]'
  const group = 'text-xs font-bold uppercase tracking-wide text-[#7A867F]'

  return (
    <div className="min-h-screen bg-[#FAFAF5] lg:grid lg:grid-cols-[1.05fr_1fr]" style={AUTH_FONT}>
      <AuthBrandPanel
        eyebrow="Explore. Discover. Enjoy."
        headline="Start exploring"
        highlight="Oriental Mindoro"
        description="Create a free tourist account to order food, book stays and ride around Bansud, all in one place."
      />

      <main className="flex items-center justify-center px-5 py-10 sm:px-10 lg:min-h-screen">
        <div className="w-full max-w-lg">
          <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Join TrackTour
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[#0B5D2E] sm:text-4xl">Create your account</h1>
          <p className="mt-2 text-sm text-[#5B6A60]">It&apos;s free and takes about a minute.</p>

          <div className="mt-8 rounded-3xl bg-white p-6 shadow-[0_18px_44px_rgba(6,40,20,0.10)] ring-1 ring-[#E7E2D6] sm:p-8">
            {error && <Alert type="error" message={error} onDismiss={onDismissError} />}

            <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-6">
              <fieldset className="space-y-4">
                <legend className={group}>About you</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className={label} htmlFor="first_name">First name</label>
                    <div className="relative">
                      <User className={icon} aria-hidden="true" />
                      <input id="first_name" autoComplete="given-name" {...register('first_name')} className={inputClass('first_name')} placeholder="Juan" aria-invalid={invalid('first_name')} aria-describedby={describedBy('first_name')} />
                    </div>
                    {fieldError('first_name')}
                  </div>
                  <div className="min-w-0">
                    <label className={label} htmlFor="middle_name">Middle name <span className="font-normal text-[#7A867F]">(optional)</span></label>
                    <input id="middle_name" autoComplete="additional-name" {...register('middle_name')} className={inputClass('middle_name', false)} placeholder="Santos" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className={label} htmlFor="last_name">Last name</label>
                    <div className="relative">
                      <User className={icon} aria-hidden="true" />
                      <input id="last_name" autoComplete="family-name" {...register('last_name')} className={inputClass('last_name')} placeholder="Dela Cruz" aria-invalid={invalid('last_name')} aria-describedby={describedBy('last_name')} />
                    </div>
                    {fieldError('last_name')}
                  </div>
                  <div className="min-w-0">
                    <label className={label} htmlFor="date_of_birth">Birthdate</label>
                    <div className="relative">
                      <Calendar className={icon} aria-hidden="true" />
                      <input id="date_of_birth" type="date" autoComplete="bday" {...register('date_of_birth')} className={inputClass('date_of_birth')} aria-invalid={invalid('date_of_birth')} aria-describedby={describedBy('date_of_birth')} />
                    </div>
                    {fieldError('date_of_birth')}
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className={group}>How to reach you</legend>
                <div>
                  <label className={label} htmlFor="email">Email</label>
                  <div className="relative">
                    <Mail className={icon} aria-hidden="true" />
                    <input id="email" type="email" autoComplete="email" {...register('email')} className={inputClass('email')} placeholder="you@example.com" aria-invalid={invalid('email')} aria-describedby={describedBy('email', 'email-hint')} />
                  </div>
                  {fieldError('email') ?? <p id="email-hint" className="mt-1.5 text-xs text-[#7A867F]">We&apos;ll send a code to verify it.</p>}
                </div>
                <div>
                  <label className={label} htmlFor="mobile_number">Mobile number</label>
                  <div className="relative">
                    <Phone className={icon} aria-hidden="true" />
                    <input id="mobile_number" type="tel" inputMode="tel" autoComplete="tel" {...register('mobile_number')} className={inputClass('mobile_number')} placeholder="09XX XXX XXXX" aria-invalid={invalid('mobile_number')} aria-describedby={describedBy('mobile_number', 'mobile-hint')} />
                  </div>
                  {fieldError('mobile_number') ?? <p id="mobile-hint" className="mt-1.5 text-xs text-[#7A867F]">For riders and restaurants to reach you about your orders.</p>}
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className={group}>Password</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className={label} htmlFor="password">Password</label>
                    <div className="relative">
                      <Lock className={icon} aria-hidden="true" />
                      <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...register('password')} className={`${inputClass('password')} !pr-12`} placeholder="••••••••" aria-invalid={invalid('password')} aria-describedby={describedBy('password', 'password-rules')} />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#6B7280] transition-colors hover:bg-[#EAF6ED] hover:text-[#0B5D2E]"
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label className={label} htmlFor="password_confirmation">Confirm password</label>
                    <div className="relative">
                      <Lock className={icon} aria-hidden="true" />
                      <input id="password_confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" {...register('password_confirmation')} className={inputClass('password_confirmation')} placeholder="••••••••" aria-invalid={invalid('password_confirmation')} aria-describedby={describedBy('password_confirmation')} />
                    </div>
                    {fieldError('password_confirmation')}
                  </div>
                </div>
                <ul id="password-rules" aria-label="Password requirements" className="grid gap-x-4 gap-y-1.5 rounded-2xl bg-[#F6F8F4] p-3 text-xs sm:grid-cols-2">
                  {PASSWORD_RULES.map((rule) => {
                    const ok = rule.test(password)
                    const missed = !ok && (submitCount > 0 || password.length > 0)
                    return (
                      <li key={rule.label} className={`flex items-center gap-2 ${ok ? 'text-[#0B5D2E]' : missed ? 'text-red-600' : 'text-[#5B6A60]'}`}>
                        {ok ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                        {rule.label}<span className="sr-only">{ok ? ' (done)' : ' (not yet)'}</span>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0B5D2E] px-4 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,93,46,0.30)] transition hover:bg-[#094A25] disabled:opacity-50"
              >
                {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating your account...</> : <>Create account <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[#9AA5A0]">
              <span className="h-px flex-1 bg-[#E7E2D6]" /> Already have an account? <span className="h-px flex-1 bg-[#E7E2D6]" />
            </div>
            <Link
              to="/login"
              className="flex w-full items-center justify-center rounded-full border-2 border-[#0B5D2E] px-4 py-3 text-sm font-bold text-[#0B5D2E] transition hover:bg-[#EAF6ED]"
            >
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
