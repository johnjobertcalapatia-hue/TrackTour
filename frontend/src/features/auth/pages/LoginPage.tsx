import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'
import { resolvePostAuthDestination } from '@/shared/services/pending-action'
import { applyGuestPreferences } from '@/shared/services/preferences'
import { Eye, EyeOff, Lock, Clock } from 'lucide-react'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

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

  return (
    <div className="min-h-screen tourism-bg tourism-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6 text-center">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30 mx-auto" />
        </Link>
        <p className="mt-2 text-xs text-[#6B7280]">Explore. Experience. Remember.</p>
      </div>

      <div className="w-full max-w-md px-6 py-5 tourism-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-[#126B32] mb-6">Sign In</h1>

        {error && <Alert type="error" message={error} onDismiss={() => !isLocked && setError('')} />}

        {isLocked && (
          <div className="mb-4 flex items-center justify-center gap-3 py-4 px-4 bg-red-50/80 backdrop-blur-sm border border-red-200 rounded-xl">
            <div className="flex items-center justify-center w-10 h-10 bg-red-100 rounded-full">
              <Lock className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-red-700">Account Locked</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Clock className="w-3.5 h-3.5 text-red-600/70" />
                <span className="text-xs text-red-600/70">
                  Unlocks in{' '}
                  <span className="font-mono font-semibold text-red-600 text-sm">{formatTime(lockoutSeconds)}</span>
                </span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#17201A] mb-1" htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              {...register('email')}
              disabled={isLocked}
              className={`tourism-input w-full px-4 py-3 disabled:opacity-50 disabled:cursor-not-allowed ${emailError ? '!border-red-300' : ''}`}
              placeholder="you@example.com"
            />
            {emailError && <p className="mt-1.5 text-xs text-red-600">{emailError}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-[#17201A] mb-1" htmlFor="password">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                {...register('password')}
                disabled={isLocked}
                className={`tourism-input w-full px-4 py-3 pr-11 disabled:opacity-50 disabled:cursor-not-allowed ${passwordError ? '!border-red-300' : ''}`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLocked}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#17201A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {passwordError && <p className="mt-1.5 text-xs text-red-600">{passwordError}</p>}
          </div>
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-[#6B7280]">
              <input
                type="checkbox"
                disabled={isLocked}
                className="rounded border-[#D7E8DB] bg-white text-[#16803C] focus:ring-[#16803C]"
              />
              Remember me
            </label>
            <Link to="/forgot-password" className="text-[#16803C] hover:text-[#126B32]">
              Forgot password?
            </Link>
          </div>

          {isLocked ? (
            <div className="w-full py-3 px-4 bg-white/60 border border-white/40 text-[#6B7280] font-medium rounded-xl text-center text-sm cursor-not-allowed">
              Locked - try again in {formatTime(lockoutSeconds)}
            </div>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-tourism w-full py-3 px-4 font-medium disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-[#6B7280]">
          Don&apos;t have an account?{' '}
          <Link to="/role-selection" className="font-medium text-[#16803C] hover:text-[#126B32]">
            Register
          </Link>
        </p>
      </div>

      <p className="mt-6 text-xs text-[#6B7280]/70">
        &copy; {new Date().getFullYear()} Bansud Tourism. All rights reserved.
      </p>
    </div>
  )
}
