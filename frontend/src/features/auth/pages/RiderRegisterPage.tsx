import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'
import { getRoleDashboardPath } from '@/shared/utils'
import { post } from '@/shared/services/api'
import { Eye, EyeOff, Send, CheckCircle, Loader2 } from 'lucide-react'

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
  otp_code: z.string().min(6, 'OTP must be 6 digits').max(6, 'OTP must be 6 digits'),
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

function getPasswordStrength(password: string): { level: 'weak' | 'medium' | 'strong'; percent: number; color: string } {
  let score = 0
  if (password.length >= 8) score++
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  if (password.length >= 12) score++

  if (score <= 3) return { level: 'weak', percent: 33, color: 'bg-red-500' }
  if (score <= 5) return { level: 'medium', percent: 66, color: 'bg-amber-500' }
  return { level: 'strong', percent: 100, color: 'bg-[#16803C]' }
}

export default function RiderRegisterPage() {
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
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
      password: '',
      password_confirmation: '',
      referral_code: '',
      confirm_age: false,
      agree_terms: false,
      agree_privacy: false,
    },
  })

  const watchedPassword = form.watch('password')
  const watchedMobile = form.watch('mobile_number')
  const watchedEmail = form.watch('email')
  const watchedDateOfBirth = form.watch('date_of_birth')
  const passwordStrength = getPasswordStrength(watchedPassword || '')

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

    if (otpVerified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
    if (!/^09\d{9}$/.test(mobile)) {
      form.setError('mobile_number', { message: 'Please enter a valid mobile number first' })
      return
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      form.setError('email', { message: 'Enter a valid email address before requesting OTP' })
      return
    }

    setOtpSending(true)
    setError('')
    try {
      await post('/auth/send-otp', { mobile_number: mobile, email, type: 'registration' })
      setOtpSent(true)
      setOtpVerified(false)
      form.setValue('otp_code', '')
      startCountdown()
    } catch (err: unknown) {
      handleOtpError(err, 'Failed to send OTP')
    } finally {
      setOtpSending(false)
    }
  }

  const handleVerifyOtp = async () => {
    const otp = form.getValues('otp_code')
    const mobile = normalizeMobileNumber(form.getValues('mobile_number'))
    if (!otp || otp.length < 6) {
      form.setError('otp_code', { message: 'Please enter the 6-digit OTP' })
      return
    }

    setOtpVerifying(true)
    setError('')
    try {
      await post('/auth/verify-otp', { mobile_number: mobile, otp_code: otp, type: 'registration' })
      setOtpVerified(true)
    } catch (err: unknown) {
      handleOtpError(err, 'Invalid or expired OTP')
      setOtpVerified(false)
    } finally {
      setOtpVerifying(false)
    }
  }

  const onSubmit = async (data: RiderForm) => {
    if (!otpVerified) {
      setError('Please verify your mobile number first')
      return
    }

    if (emailExists) {
      form.setError('email', { type: 'manual', message: 'This email is already registered.' })
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
      fd.append('password', data.password)
      fd.append('password_confirmation', data.password_confirmation)
      fd.append('otp_code', data.otp_code)
      fd.append('confirm_age', data.confirm_age ? '1' : '0')
      fd.append('agree_terms', data.agree_terms ? '1' : '0')
      fd.append('agree_privacy', data.agree_privacy ? '1' : '0')
      if (data.referral_code) fd.append('referral_code', data.referral_code)

      const user = await registerUser(fd as unknown as Record<string, unknown>)
      navigate(getRoleDashboardPath(user.role))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      const fieldErrors = axiosErr.response?.data?.errors
      if (fieldErrors?.email) {
        setEmailExists(true)
        form.setError('email', { type: 'manual', message: fieldErrors.email[0] })
      }
      if (fieldErrors?.last_name) {
        form.setError('last_name', { type: 'manual', message: fieldErrors.last_name[0] })
      }
      if (fieldErrors?.date_of_birth) {
        form.setError('date_of_birth', { type: 'manual', message: fieldErrors.date_of_birth[0] })
      }
      if (fieldErrors) {
        const firstError = Object.values(fieldErrors)[0]
        setError(firstError?.[0] || 'Registration failed')
      } else {
        setError(axiosErr.response?.data?.message || 'Registration failed')
      }
    }
  }

  const inputClasses = 'tourism-input w-full px-4 py-3 text-sm'
  const labelClasses = 'block text-sm font-medium text-[#17201A] mb-1'
  const errorClasses = 'text-red-500 text-xs mt-1'

  return (
    <div className="min-h-screen tourism-bg tourism-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30" />
        </Link>
      </div>

      <div className="w-full max-w-md px-6 py-8 tourism-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-[#126B32] mb-1">
          Become a TrackTour Rider
        </h1>
        <p className="text-center text-sm text-[#6B7280] mb-6">
          Create your rider account to start your registration
        </p>

        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {/* Name Section */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClasses}>First Name <span className="text-red-500">*</span></label>
                <input {...form.register('first_name')} className={inputClasses} placeholder="Juan" />
                {form.formState.errors.first_name && (
                  <p className={errorClasses}>{form.formState.errors.first_name.message}</p>
                )}
              </div>
              <div>
                <label className={labelClasses}>Middle Name</label>
                <input {...form.register('middle_name')} className={inputClasses} placeholder="Optional" />
                {form.formState.errors.middle_name && (
                  <p className={errorClasses}>{form.formState.errors.middle_name.message}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className={labelClasses}>Last Name <span className="text-red-500">*</span></label>
                <input {...form.register('last_name')} className={inputClasses} placeholder="Dela Cruz" />
                {form.formState.errors.last_name && (
                  <p className={errorClasses}>{form.formState.errors.last_name.message}</p>
                )}
              </div>
              <div>
                <label className={labelClasses}>Suffix</label>
                <select {...form.register('suffix')} className={inputClasses}>
                  <option value="">Select</option>
                  {SUFFIX_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClasses}>Date of Birth <span className="text-red-500">*</span></label>
              <div className="flex items-center gap-3">
                <input
                  {...form.register('date_of_birth')}
                  type="date"
                  className={inputClasses}
                  max={todayISO()}
                />
                {watchedDateOfBirth && ageFromDateOfBirth(watchedDateOfBirth) > 0 && (
                  <span className="text-xs text-[#6B7280] whitespace-nowrap">
                    {ageFromDateOfBirth(watchedDateOfBirth)} yrs old
                  </span>
                )}
              </div>
              {form.formState.errors.date_of_birth && (
                <p className={errorClasses}>{form.formState.errors.date_of_birth.message}</p>
              )}
            </div>
          </div>

          {/* Contact Section */}
          <div className="space-y-4">
            <div>
              <label className={labelClasses}>Email Address <span className="text-red-500">*</span></label>
              <input {...form.register('email')} type="email" className={inputClasses} placeholder="you@example.com" disabled={otpVerified} />
              {emailChecking && !form.formState.errors.email && (
                <p className="text-xs text-[#6B7280] mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking availability...
                </p>
              )}
              {form.formState.errors.email && (
                <p className={errorClasses}>{form.formState.errors.email.message}</p>
              )}
            </div>
            <div>
              <label className={labelClasses}>Mobile Number <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">+63</span>
                  <input
                    {...form.register('mobile_number')}
                    className={`${inputClasses} pl-12`}
                    placeholder="9XXXXXXXXX"
                    disabled={otpVerified}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={otpSending || countdown > 0 || otpVerified || lockoutSeconds > 0 || !/^((\+63|0)?9\d{9})$/.test(watchedMobile.replace(/[\s-]/g, ''))}
                  className="px-4 py-2 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                >
                  {otpSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {countdown > 0 ? `Resend in ${countdown}s` : otpSent ? 'Resend OTP' : 'Send OTP'}
                </button>
              </div>
              {form.formState.errors.mobile_number && (
                <p className={errorClasses}>{form.formState.errors.mobile_number.message}</p>
              )}
              {otpVerified && (
                <p className="text-xs text-[#16803C] mt-1 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Mobile number verified successfully
                </p>
              )}
            </div>

            {otpSent && !otpVerified && (
              <div>
                <label className={labelClasses}>OTP Verification <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input
                    {...form.register('otp_code')}
                    className={`${inputClasses} flex-1`}
                    placeholder="Enter 6-digit OTP"
                    maxLength={6}
                    disabled={lockoutSeconds > 0}
                  />
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={otpVerifying || lockoutSeconds > 0}
                    className="px-4 py-2 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {otpVerifying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : null}
                    Verify
                  </button>
                </div>
                {lockoutSeconds > 0 && (
                  <p className="text-xs text-red-500 mt-1">
                    Too many failed attempts. Try again in {formatCountdown(lockoutSeconds)}.
                  </p>
                )}
                {form.formState.errors.otp_code && (
                  <p className={errorClasses}>{form.formState.errors.otp_code.message}</p>
                )}
              </div>
            )}
          </div>

          {/* Password Section */}
          <div className="space-y-4">
            <div>
              <label className={labelClasses}>Password <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  {...form.register('password')}
                  type={showPassword ? 'text' : 'password'}
                  className={inputClasses}
                  placeholder="Min 8 characters"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280]">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {watchedPassword && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[#6B7280]">Password Strength</span>
                    <span className={`font-medium ${passwordStrength.level === 'strong' ? 'text-[#16803C]' : passwordStrength.level === 'medium' ? 'text-amber-500' : 'text-red-500'}`}>
                      {passwordStrength.level.charAt(0).toUpperCase() + passwordStrength.level.slice(1)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full ${passwordStrength.color} transition-all duration-300`} style={{ width: `${passwordStrength.percent}%` }} />
                  </div>
                </div>
              )}
              {form.formState.errors.password && (
                <p className={errorClasses}>{form.formState.errors.password.message}</p>
              )}
            </div>
            <div>
              <label className={labelClasses}>Confirm Password <span className="text-red-500">*</span></label>
              <input
                {...form.register('password_confirmation')}
                type={showPassword ? 'text' : 'password'}
                className={inputClasses}
                placeholder="••••••••"
              />
              {form.formState.errors.password_confirmation && (
                <p className={errorClasses}>{form.formState.errors.password_confirmation.message}</p>
              )}
            </div>
          </div>

          {/* Referral Section */}
          <div>
            <label className={labelClasses}>Referral Code</label>
            <input {...form.register('referral_code')} className={inputClasses} placeholder="Optional" />
          </div>

          {/* Agreements */}
          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                {...form.register('confirm_age')}
                className="mt-1 h-4 w-4 rounded border-[#D7E8DB] text-[#16803C] focus:ring-[#16803C]"
              />
              <span className="text-sm text-[#17201A]">I confirm that I am at least 18 years old.</span>
            </label>
            {form.formState.errors.confirm_age && (
              <p className={errorClasses}>{form.formState.errors.confirm_age.message}</p>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                {...form.register('agree_terms')}
                className="mt-1 h-4 w-4 rounded border-[#D7E8DB] text-[#16803C] focus:ring-[#16803C]"
              />
              <span className="text-sm text-[#17201A]">I agree to the <Link to="/terms" className="text-[#16803C] hover:underline" target="_blank">Terms and Conditions</Link>.</span>
            </label>
            {form.formState.errors.agree_terms && (
              <p className={errorClasses}>{form.formState.errors.agree_terms.message}</p>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                {...form.register('agree_privacy')}
                className="mt-1 h-4 w-4 rounded border-[#D7E8DB] text-[#16803C] focus:ring-[#16803C]"
              />
              <span className="text-sm text-[#17201A]">I agree to the <Link to="/privacy" className="text-[#16803C] hover:underline" target="_blank">Privacy Policy</Link>.</span>
            </label>
            {form.formState.errors.agree_privacy && (
              <p className={errorClasses}>{form.formState.errors.agree_privacy.message}</p>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={form.formState.isSubmitting || !otpVerified}
            className="btn-tourism w-full py-3 px-4 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {form.formState.isSubmitting ? 'Creating Account...' : 'Create Rider Account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-center text-[#6B7280]">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-[#16803C] hover:text-[#126B32]">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  )
}
