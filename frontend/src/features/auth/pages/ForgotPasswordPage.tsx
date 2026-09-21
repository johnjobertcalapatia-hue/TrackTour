import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { post } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'
import { Clock, Mail } from 'lucide-react'

const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>

const COOLDOWN_SECONDS = 300 // 5 minutes

export default function ForgotPasswordPage() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [cooldown, setCooldown] = useState(0)

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const onSubmit = useCallback(async (data: ForgotPasswordForm) => {
    setError('')
    setSuccess('')
    try {
      await post('/forgot-password', data)
      setSuccess('If an account exists with that email, a password reset link has been sent.')
      setCooldown(COOLDOWN_SECONDS)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } }
      const msg = axiosErr.response?.data?.message || 'Something went wrong. Please try again.'
      if (msg.includes('Too many')) {
        setCooldown(COOLDOWN_SECONDS)
        setError('Too many requests. Please wait before trying again.')
      } else {
        setError(msg)
      }
    }
  }, [])

  return (
    <div className="min-h-screen glass-bg glass-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30" />
        </Link>
      </div>

      <div className="w-full max-w-md px-6 py-5 glass-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-ink mb-2">Forgot Password?</h1>
        <p className="text-center text-sm text-ink-soft mb-6">
          Enter your email and we&apos;ll send you a link to reset your password.
        </p>

        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
        {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Email</label>
            <div className="relative">
              <input
                type="email"
                {...register('email')}
                disabled={cooldown > 0}
                className="glass-input w-full px-4 py-3 pl-11 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="you@example.com"
              />
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-soft" />
            </div>
          </div>

          {cooldown > 0 ? (
            <div className="flex items-center justify-center gap-2 py-3 px-4 bg-white/60 border border-white/40 rounded-xl">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-sm text-ink">
                You can request again in <span className="font-mono font-semibold text-primary">{formatTime(cooldown)}</span>
              </span>
            </div>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full py-3 px-4 font-medium disabled:opacity-50"
            >
              {isSubmitting ? 'Sending...' : 'Send Reset Link'}
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-ink-soft">
          <Link to="/login" className="font-medium text-primary hover:text-primary-dark">
            Back to Sign In
          </Link>
        </p>
      </div>

      <p className="mt-6 text-xs text-ink-soft/70">
        &copy; {new Date().getFullYear()} Bansud Tourism. All rights reserved.
      </p>
    </div>
  )
}
