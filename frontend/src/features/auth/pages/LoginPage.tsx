import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { Alert } from '@/shared/components/Alert'
import { get } from '@/shared/services/api'
import { resolvePostAuthDestination } from '@/shared/services/pending-action'
import { applyGuestPreferences } from '@/shared/services/preferences'
import { toAssetUrl } from '@/shared/utils'
import {
  ArrowLeft, ArrowRight, BedDouble, Car, Clock, Eye, EyeOff, Loader2, Lock, Mail, MapPin, UtensilsCrossed,
} from 'lucide-react'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

const POPPINS = { fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }
const SCRIPT = { fontFamily: "'Kaushan Script', 'Brush Script MT', cursive" }

const HIGHLIGHTS = [
  { icon: UtensilsCrossed, text: 'Order food from local restaurants' },
  { icon: BedDouble, text: 'Book resorts and stays' },
  { icon: Car, text: 'Ride safely around Bansud' },
  { icon: MapPin, text: 'Track your delivery live' },
]

function parseLockoutMinutes(msg: string): number | null {
  const match = msg.match(/locked.*?(\d+)\s*minute/i)
  return match?.[1] ? parseInt(match[1], 10) : null
}

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function LoginPage() {
  const [error, setError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [lockoutSeconds, setLockoutSeconds] = useState(0)
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  // Same background video as the landing hero (admin Landing Content).
  const { data: landing } = useQuery({
    queryKey: ['landing-content'],
    queryFn: () => get<{ hero_video?: string }>('/landing-content'),
    staleTime: 5 * 60 * 1000,
  })
  const video = landing?.hero_video || '/assets/tracktour-web.mp4'
  const videoSrc = video.startsWith('/storage/') ? toAssetUrl(video) : video

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  useEffect(() => {
    if (lockoutSeconds <= 0) return
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          setError('')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [lockoutSeconds])

  const onSubmit = useCallback(async (data: LoginForm) => {
    if (lockoutSeconds > 0) return
    setError('')
    setEmailError('')
    setPasswordError('')
    try {
      const user = await login(data.email, data.password)
      if (user.role === 'tourist') {
        await applyGuestPreferences()
      }
      navigate(resolvePostAuthDestination(user.role, from))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      const errors = axiosErr.response?.data?.errors
      if (errors?.email?.[0]) {
        setEmailError(errors.email[0])
      }
      if (errors?.password?.[0]) {
        setPasswordError(errors.password[0])
      }
      const msg = axiosErr.response?.data?.message || 'Invalid credentials'
      const lockMinutes = parseLockoutMinutes(msg)
      if (lockMinutes) {
        setLockoutSeconds(lockMinutes * 60)
      }
      if (!errors) {
        setError(msg)
      }
    }
  }, [login, navigate, lockoutSeconds, from])

  const isLocked = lockoutSeconds > 0
  const inputClass = (invalid: boolean) =>
    `w-full rounded-2xl border bg-white py-3.5 pl-11 pr-4 text-sm text-[#14351F] placeholder-[#9AA5A0] shadow-sm outline-none transition focus:border-[#2E8B57] focus:ring-4 focus:ring-[#2E8B57]/15 disabled:cursor-not-allowed disabled:opacity-50 ${
      invalid ? 'border-red-300' : 'border-[#E2E8E3]'
    }`

  return (
    <div className="min-h-screen bg-[#FAFAF5] lg:grid lg:grid-cols-[1.05fr_1fr]" style={POPPINS}>
      {/* Brand panel: landing video under a forest-green overlay */}
      <aside className="relative overflow-hidden bg-[#062814] text-white">
        <video
          key={videoSrc}
          data-testid="login-background-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-br from-[#062814]/85 via-[#0B5D2E]/50 to-[#062814]/80" />
        <svg className="absolute -bottom-24 -left-24 h-80 w-80 text-[#FFD000]/15" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="16" />
        </svg>

        <div className="relative flex h-full flex-col px-6 py-6 sm:px-10 lg:min-h-screen lg:px-14 lg:py-10">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2" aria-label="TrackTour home">
              <img src="/assets/logo/tracktour.png" alt="TrackTour Logo" className="h-12 w-12 rounded-2xl bg-white object-contain p-1 shadow-lg lg:h-14 lg:w-14" />
              <span className="leading-tight">
                <span className="block text-xl font-extrabold tracking-tight lg:text-2xl">
                  Track<span className="text-[#FFD000]">Tour</span>
                </span>
                <span className="block text-[11px] text-white/85 sm:text-xs">Bansud, Oriental Mindoro</span>
              </span>
            </Link>
            <Link to="/" className="hidden items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/25 backdrop-blur hover:bg-white/20 sm:inline-flex">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>
          </div>

          <div className="mt-8 lg:my-auto">
            <p className="hidden items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#FFD000] sm:flex">
              <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Explore. Discover. Enjoy.
            </p>
            <p className="mt-3 text-2xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">
              Welcome back to{' '}
              <span className="relative inline-block italic text-[#FFD000]">
                Oriental Mindoro
                <svg className="absolute -bottom-2 left-0 h-3 w-full" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M4 14 C 80 4, 200 2, 296 10" stroke="#FFD000" strokeWidth="5" fill="none" strokeLinecap="round" />
                </svg>
              </span>
            </p>
            <p className="mt-5 hidden max-w-md text-base text-white/90 sm:block">
              Your all-in-one travel and delivery platform in Bansud. Sign in to pick up where you left off.
            </p>
            <ul className="mt-8 hidden max-w-md grid-cols-2 gap-3 lg:grid">
              {HIGHLIGHTS.map((h) => (
                <li key={h.text} className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 text-sm font-medium ring-1 ring-white/20 backdrop-blur">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFD000] text-[#14351F]">
                    <h.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {h.text}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-6 hidden -rotate-3 text-3xl text-white/95 lg:block" style={SCRIPT} aria-hidden="true">
            Let&apos;s Explore Bansud Together!
          </p>
        </div>
      </aside>

      {/* Sign-in form */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-10 lg:min-h-screen">
        <div className="w-full max-w-md">
          <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
            <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Welcome back
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[#0B5D2E] sm:text-4xl">Sign in to TrackTour</h1>
          <p className="mt-2 text-sm text-[#5B6A60]">Tourists, business owners, riders and tourism offices all sign in here.</p>

          <div className="mt-8 rounded-3xl bg-white p-6 shadow-[0_18px_44px_rgba(6,40,20,0.10)] ring-1 ring-[#E7E2D6] sm:p-8">
            {error && <Alert type="error" message={error} onDismiss={() => !isLocked && setError('')} />}

            {isLocked && (
              <div className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4" role="status">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                  <Lock className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-red-700">Account Locked</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-red-600/70" />
                    <span className="text-xs text-red-600/80">
                      Unlocks in{' '}
                      <span className="font-mono text-sm font-semibold text-red-600">{formatTime(lockoutSeconds)}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#14351F]" htmlFor="email">Email</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2E8B57]" aria-hidden="true" />
                  <input
                    type="email"
                    id="email"
                    autoComplete="email"
                    {...register('email')}
                    disabled={isLocked}
                    className={inputClass(!!emailError)}
                    placeholder="you@example.com"
                  />
                </div>
                {emailError && <p className="mt-1.5 text-xs text-red-600">{emailError}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#14351F]" htmlFor="password">Password</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2E8B57]" aria-hidden="true" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    autoComplete="current-password"
                    {...register('password')}
                    disabled={isLocked}
                    className={`${inputClass(!!passwordError)} !pr-12`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLocked}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#6B7280] transition-colors hover:bg-[#EAF6ED] hover:text-[#0B5D2E] disabled:cursor-not-allowed disabled:opacity-50"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {passwordError && <p className="mt-1.5 text-xs text-red-600">{passwordError}</p>}
              </div>
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-[#5B6A60]">
                  <input
                    type="checkbox"
                    disabled={isLocked}
                    className="h-4 w-4 rounded border-[#CFE5D7] bg-white text-[#0B5D2E] focus:ring-[#2E8B57]"
                  />
                  Remember me
                </label>
                <Link to="/forgot-password" className="font-semibold text-[#0B5D2E] hover:text-[#E0A800]">
                  Forgot password?
                </Link>
              </div>

              {isLocked ? (
                <div className="w-full cursor-not-allowed rounded-full border border-[#E2E8E3] bg-[#F4F6F4] px-4 py-3.5 text-center text-sm font-semibold text-[#6B7280]">
                  Locked - try again in {formatTime(lockoutSeconds)}
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0B5D2E] px-4 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,93,46,0.30)] transition hover:bg-[#094A25] disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Signing in...
                    </>
                  ) : (
                    <>
                      Sign In <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              )}
            </form>

            <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[#9AA5A0]">
              <span className="h-px flex-1 bg-[#E7E2D6]" /> New to TrackTour? <span className="h-px flex-1 bg-[#E7E2D6]" />
            </div>
            <Link
              to="/register?role=tourist"
              className="flex w-full items-center justify-center rounded-full bg-[#FFD000] px-4 py-3.5 text-sm font-bold text-[#14351F] shadow-[0_10px_24px_rgba(224,168,0,0.30)] transition hover:bg-[#FFDD33]"
            >
              Create an account
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
