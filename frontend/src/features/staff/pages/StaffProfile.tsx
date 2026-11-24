import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Briefcase, Camera, KeyRound, Mail, Phone, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { apiErrorMessage, del, get, post, put } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDate, getInitials, toAssetUrl } from '@/shared/utils'

/** GET /staff/profile (StaffProfileController::present). */
export interface StaffProfileData {
  id: number
  employee_id: string | null
  full_name: string
  email: string | null
  mobile_number: string | null
  address: string | null
  gender: string | null
  date_of_birth: string | null
  profile_picture: string | null
  status: string
  roles: string[]
  date_hired: string | null
  employment_status: string | null
  business: { id: number; name: string; category: string | null; logo: string | null }
  permissions: { key: string; group: string; label: string }[]
}

const CARD = 'rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)] sm:p-6'
const INPUT = 'w-full rounded-xl border border-[#E2E8E3] bg-[#fff] px-3.5 py-2.5 text-sm text-[#17201B] placeholder-[#9CA3AF] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 aria-[invalid=true]:border-[#DC2626]'
const PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50'
const EMPLOYMENT: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', contractual: 'Contractual' }
const PHOTO_TYPES = ['image/jpeg', 'image/png']

/** Laravel's field errors from a 422, if any. */
function fieldErrors(error: unknown): Record<string, string> {
  const errors = (error as { response?: { data?: { errors?: Record<string, string[]> } } })?.response?.data?.errors ?? {}
  return Object.fromEntries(Object.entries(errors).map(([key, list]) => [key, list?.[0] ?? '']))
}

function Section({ title, icon, description, children }: { title: string; icon: ReactNode; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={CARD}>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF] text-[#16803C] [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <div>
          <h2 className="text-base font-bold text-[#17201B]">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-[#5E6B63]">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#647067]">{label}</dt>
      <dd className="mt-1 text-sm text-[#17201B]">{children}</dd>
    </div>
  )
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-[#3F4A43]">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-[#B91C1C]">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[#8A948E]">{hint}</p>
      ) : null}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${tone === 'ok' ? 'border-[#BBE5C8] bg-[#EAF6ED] text-[#16803C]' : 'border-red-200 bg-red-50 text-red-700'}`}>
      {children}
    </p>
  )
}

function PhotoCard({ profile }: { profile: StaffProfileData }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = (data: StaffProfileData) => {
    queryClient.setQueryData(['staff-profile'], data)
    queryClient.invalidateQueries({ queryKey: ['staff-me'] })
  }
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('photo', file)
      return post<StaffProfileData>('/staff/profile/photo', form)
    },
    onSuccess: refresh,
    onError: (e) => setError(fieldErrors(e).photo || apiErrorMessage(e, "Couldn't upload the photo.")),
  })
  const remove = useMutation({ mutationFn: () => del<StaffProfileData>('/staff/profile/photo'), onSuccess: refresh })

  const choose = (file?: File) => {
    setError(null)
    if (!file) return
    if (!PHOTO_TYPES.includes(file.type)) return setError('Use a JPG or PNG photo.')
    if (file.size > 2 * 1024 * 1024) return setError('The photo must be 2 MB or smaller.')
    upload.mutate(file)
  }
  const photo = profile.profile_picture ? toAssetUrl(profile.profile_picture) : ''

  return (
    <div className={`${CARD} flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left`}>
      <div className="relative shrink-0">
        {photo ? (
          <img src={photo} alt="Your profile photo" className="h-24 w-24 rounded-full object-cover ring-4 ring-[#E9F7EF]" />
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#0F4D2B] text-2xl font-bold text-white ring-4 ring-[#E9F7EF]">{getInitials(profile.full_name)}</span>
        )}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
          aria-label={photo ? 'Change photo' : 'Add photo'}
          className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#fff] bg-[#16803C] text-white hover:bg-[#126B32] disabled:opacity-60"
        >
          <Camera className="h-4 w-4" />
        </button>
        <input ref={input} type="file" accept="image/jpeg,image/png" className="hidden" aria-label="Profile photo" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold text-[#17201B]">{profile.full_name}</h2>
        <p className="mt-0.5 text-sm text-[#5E6B63]">{profile.business.name}{profile.employee_id ? ` · ${profile.employee_id}` : ''}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
          {profile.roles.map((role) => (
            <span key={role} className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-xs font-semibold text-[#16803C]">{role}</span>
          ))}
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF6DB] px-2.5 py-1 text-xs font-semibold capitalize text-[#7A5A00]">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> {profile.status}
          </span>
        </div>
        {upload.isPending && <p className="mt-2 text-xs text-[#5E6B63]">Uploading…</p>}
        {error && <p role="alert" className="mt-2 text-xs font-medium text-[#B91C1C]">{error}</p>}
        {photo && (
          <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#B91C1C] hover:underline disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove photo
          </button>
        )}
      </div>
    </div>
  )
}

function ContactForm({ profile }: { profile: StaffProfileData }) {
  const queryClient = useQueryClient()
  const [mobile, setMobile] = useState(profile.mobile_number ?? '')
  const [address, setAddress] = useState(profile.address ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => { setMobile(profile.mobile_number ?? ''); setAddress(profile.address ?? '') }, [profile.mobile_number, profile.address])

  const save = useMutation({
    mutationFn: () => put<StaffProfileData>('/staff/profile', { mobile_number: mobile.trim() || null, address: address.trim() || null }),
    onSuccess: (data) => {
      queryClient.setQueryData(['staff-profile'], data)
      setErrors({})
      setNotice({ tone: 'ok', text: 'Contact details saved.' })
    },
    onError: (e) => {
      const found = fieldErrors(e)
      setErrors(found)
      setNotice(Object.keys(found).length ? null : { tone: 'error', text: apiErrorMessage(e, "Couldn't save your details.") })
    },
  })
  const dirty = mobile !== (profile.mobile_number ?? '') || address !== (profile.address ?? '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setNotice(null)
    if (mobile && !/^[0-9+()\-\s]*$/.test(mobile)) return setErrors({ mobile_number: 'Use digits only, e.g. 09171234567.' })
    save.mutate()
  }

  return (
    <Section title="Contact details" icon={<Phone />} description="How your business reaches you.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="staff-profile-email" label="Email" hint="Ask your business owner to change your email.">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A948E]" aria-hidden="true" />
              <input id="staff-profile-email" type="email" readOnly value={profile.email ?? ''} className={`${INPUT} bg-[#F6F8F4] pl-10 text-[#3F4A43]`} />
            </div>
          </Field>
          <Field id="staff-profile-mobile" label="Mobile number" error={errors.mobile_number}>
            <input
              id="staff-profile-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="09171234567"
              aria-invalid={errors.mobile_number ? true : undefined}
              aria-describedby={errors.mobile_number ? 'staff-profile-mobile-error' : undefined}
              className={INPUT}
            />
          </Field>
        </div>
        <Field id="staff-profile-address" label="Home address" error={errors.address}>
          <textarea
            id="staff-profile-address"
            rows={2}
            maxLength={500}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="House no., street, barangay, town"
            aria-invalid={errors.address ? true : undefined}
            className={`${INPUT} resize-none`}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {notice && <div className="sm:mr-auto"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
          <button type="submit" disabled={!dirty || save.isPending} className={PRIMARY}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Section>
  )
}

function PasswordForm() {
  const empty = { current_password: '', password: '', password_confirmation: '' }
  const [values, setValues] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const change = useMutation({
    mutationFn: () => put('/staff/profile/password', values),
    onSuccess: () => {
      setValues(empty)
      setErrors({})
      setNotice({ tone: 'ok', text: 'Password changed. Other devices were signed out.' })
    },
    onError: (e) => {
      const found = fieldErrors(e)
      setErrors(found)
      setNotice(Object.keys(found).length ? null : { tone: 'error', text: apiErrorMessage(e, "Couldn't change your password.") })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setNotice(null)
    const found: Record<string, string> = {}
    if (!values.current_password) found.current_password = 'Enter your current password.'
    if (values.password.length < 8) found.password = 'Use at least 8 characters.'
    else if (values.password === values.current_password) found.password = 'Choose a password different from your current one.'
    if (values.password_confirmation !== values.password) found.password_confirmation = 'The passwords do not match.'
    setErrors(found)
    if (Object.keys(found).length === 0) change.mutate()
  }

  const input = (name: keyof typeof empty, label: string, autoComplete: string) => {
    const id = `staff-${name.replace(/_/g, '-')}`
    return (
      <Field id={id} label={label} error={errors[name]}>
        <input
          id={id}
          type="password"
          autoComplete={autoComplete}
          value={values[name]}
          onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
          aria-invalid={errors[name] ? true : undefined}
          aria-describedby={errors[name] ? `${id}-error` : undefined}
          className={INPUT}
        />
      </Field>
    )
  }

  return (
    <Section title="Password" icon={<KeyRound />} description="Changing it signs you out on your other devices.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {input('current_password', 'Current password', 'current-password')}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {input('password', 'New password', 'new-password')}
          {input('password_confirmation', 'Confirm new password', 'new-password')}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {notice && <div className="sm:mr-auto"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
          <button type="submit" disabled={change.isPending} className={PRIMARY}>{change.isPending ? 'Changing…' : 'Change password'}</button>
        </div>
      </form>
    </Section>
  )
}

/**
 * Staff profile (2026-11-24): their details, their roles and what those allow,
 * and the few things they change themselves (contact details, photo,
 * password). Name, email, roles, pay and status belong to the business owner.
 */
export default function StaffProfile() {
  const { data: profile, isLoading, isError, error } = useQuery({
    queryKey: ['staff-profile'],
    queryFn: () => get<StaffProfileData>('/staff/profile'),
  })

  if (isLoading) return <DashboardSkeleton />
  if (isError || !profile) {
    return <div className={`${CARD} text-center text-sm text-[#5E6B63]`}>{apiErrorMessage(error, "Couldn't load your profile.")}</div>
  }

  const groups = profile.permissions.reduce<Record<string, string[]>>((acc, p) => {
    (acc[p.group] ??= []).push(p.label)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><UserRound className="h-6 w-6" aria-hidden="true" /></span>
        <div>
          <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">My Profile</h1>
          <p className="mt-1 text-sm text-[#5E6B63]">Your details at {profile.business.name}</p>
        </div>
      </div>

      <PhotoCard profile={profile} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ContactForm profile={profile} />
          <PasswordForm />
        </div>
        <div className="space-y-6">
          <Section title="Employment" icon={<Briefcase />} description="Set by your business owner.">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Detail label="Business">{profile.business.name}</Detail>
              <Detail label="Employee ID">{profile.employee_id ?? '—'}</Detail>
              <Detail label="Role">{profile.roles.join(', ') || '—'}</Detail>
              <Detail label="Employment">{(profile.employment_status && EMPLOYMENT[profile.employment_status]) ?? '—'}</Detail>
              <Detail label="Date hired">{profile.date_hired ? formatDate(profile.date_hired) : '—'}</Detail>
              <Detail label="Status"><span className="capitalize">{profile.status}</span></Detail>
            </dl>
            {(profile.gender || profile.date_of_birth) && (
              <dl className="mt-4 grid grid-cols-1 gap-4 border-t border-[#E2E8E3] pt-4 sm:grid-cols-2">
                {profile.gender && <Detail label="Gender"><span className="capitalize">{profile.gender}</span></Detail>}
                {profile.date_of_birth && <Detail label="Date of birth">{formatDate(profile.date_of_birth)}</Detail>}
              </dl>
            )}
          </Section>

          <Section title="What you can do" icon={<ShieldCheck />} description="Your roles allow these. Your business owner can change them.">
            {Object.keys(groups).length === 0 ? (
              <p className="text-sm text-[#5E6B63]">No permissions yet. Ask your business owner to assign a role.</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(groups).map(([group, labels]) => (
                  <div key={group}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#647067]">{group}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {labels.map((label) => (
                        <li key={label} className="flex items-start gap-2 text-sm text-[#17201B]">
                          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#16803C]" aria-hidden="true" /> {label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
