import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'

const schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string(),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
})

type ActivateForm = z.infer<typeof schema>

interface InvitationInfo {
  state: 'pending' | 'accepted' | 'expired' | 'revoked'
  email: string
  name: string | null
  business: string | null
  role: string | null
}

const STATE_MESSAGES: Record<Exclude<InvitationInfo['state'], 'pending'>, string> = {
  accepted: 'This invitation has already been used. Sign in with your email and password.',
  expired: 'This invitation has expired. Ask the business owner to send you a new one.',
  revoked: 'This invitation was cancelled. Ask the business owner for a new one.',
}

/**
 * Public staff activation (Staff Management Stage 1): the invited staff
 * member sets their own password. The link works once and expires in 72 h.
 */
export default function StaffActivatePage() {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const { data: invitation, isLoading, isError } = useQuery({
    queryKey: ['staff-invitation', token],
    queryFn: () => get<InvitationInfo>(`/staff-invitations/${token}`),
    retry: false,
  })

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ActivateForm>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', password_confirmation: '' },
  })

  const onSubmit = async (data: ActivateForm) => {
    setError('')
    try {
      await post(`/staff-invitations/${token}/accept`, data)
      navigate('/login', { state: { message: 'Your staff account is active. Sign in with your email and new password.' } })
    } catch (err) {
      const axiosErr = err as { response?: { data?: { errors?: Record<string, string[]> } } }
      const first = axiosErr.response?.data?.errors ? Object.values(axiosErr.response.data.errors)[0]?.[0] : null
      setError(first ?? apiErrorMessage(err, 'Activation failed. Please try again.'))
    }
  }

  return (
    <div className="min-h-screen glass-bg glass-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/"><ApplicationLogo className="w-30 h-30" /></Link>
      </div>

      <div className="w-full max-w-md px-6 py-5 glass-card rounded-2xl">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-ink-soft">Checking your invitation…</p>
        ) : isError || !invitation ? (
          <Alert type="error" message="This invitation link is not valid. Check the link in your email or ask the business owner for a new one." />
        ) : invitation.state !== 'pending' ? (
          <>
            <Alert type={invitation.state === 'accepted' ? 'info' : 'error'} message={STATE_MESSAGES[invitation.state]} />
            <p className="mt-4 text-center text-sm">
              <Link to="/login" className="font-medium text-primary hover:text-primary-dark">Go to Sign In</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-center text-2xl font-bold text-ink">Activate your staff account</h1>
            <p className="mb-6 text-center text-sm text-ink-soft">
              {invitation.business ?? 'A business'} added you{invitation.role ? ` as ${invitation.role}` : ''}. Choose your own password to finish.
            </p>

            {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="staff-email" className="mb-1 block text-sm font-medium text-ink">Email</label>
                <input id="staff-email" type="email" value={invitation.email} readOnly className="glass-input w-full px-4 py-3 opacity-80" />
              </div>
              <div>
                <label htmlFor="staff-password" className="mb-1 block text-sm font-medium text-ink">New password</label>
                <input id="staff-password" type="password" autoComplete="new-password" {...register('password')} className="glass-input w-full px-4 py-3" placeholder="At least 8 characters" />
                {errors.password && <p className="mt-1 text-xs text-[#B91C1C]">{errors.password.message}</p>}
              </div>
              <div>
                <label htmlFor="staff-password-confirm" className="mb-1 block text-sm font-medium text-ink">Confirm password</label>
                <input id="staff-password-confirm" type="password" autoComplete="new-password" {...register('password_confirmation')} className="glass-input w-full px-4 py-3" placeholder="••••••••" />
                {errors.password_confirmation && <p className="mt-1 text-xs text-[#B91C1C]">{errors.password_confirmation.message}</p>}
              </div>
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 px-4 font-medium disabled:opacity-50">
                {isSubmitting ? 'Activating…' : 'Activate account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
