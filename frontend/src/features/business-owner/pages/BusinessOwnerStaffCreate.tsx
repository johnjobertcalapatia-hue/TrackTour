import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, post } from '@/shared/services/api'
import { usePersistFormRHF } from '@/shared/hooks/use-persist-form-rhf'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { AlertCircle, ArrowLeft, Camera, KeyRound, MailCheck, Send, UserPlus, X } from 'lucide-react'
import type { Business } from '@/shared/types'
import { CopyActivationLink } from '../components/staff/CopyActivationLink'
import { RolePicker, type RoleOption } from '../components/staff/RolePicker'

const schema = z.object({
  business_id: z.coerce.number().min(1, 'Choose a business'),
  first_name: z.string().min(2, 'First name must be at least 2 characters'),
  middle_name: z.string().optional(),
  last_name: z.string().min(2, 'Last name must be at least 2 characters'),
  suffix: z.string().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional().or(z.literal('')),
  mobile_number: z.string().optional(),
  email: z.string().email('Enter a valid email address'),
  staff_role_ids: z.array(z.coerce.number()).min(1, 'Choose at least one role'),
  date_hired: z.string().optional().or(z.literal('')),
  salary_type: z.string().optional(),
  employment_status: z.string().optional(),
  address: z.string().optional(),
})

/** POST /business-owner/staff response (Staff Management Stage 1). */
interface InviteResult {
  staff: { id: number; name: string; email: string }
  mail_sent: boolean
  activation_url: string | null
}

type FormData = z.infer<typeof schema>

const FIELDS = Object.keys(schema.shape) as (keyof FormData)[]
const PHOTO_TYPES = ['image/jpeg', 'image/png']
const PHOTO_MAX_BYTES = 2 * 1024 * 1024

const input = 'w-full rounded-xl border bg-[#fff] px-3.5 py-2.5 text-sm text-[#17201B] placeholder-[#9CA3AF] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'
const card = 'rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]'

/**
 * Add a staff member (redesign 2026-11-24): four short cards (business and
 * roles, personal details, contact, employment) in the owner portal style.
 * The server's answers land where they belong: a field's error under that
 * field (e.g. an email that already has a TrackTour account), anything else
 * beside the Send invitation button where the owner is looking.
 */
export default function BusinessOwnerStaffCreate() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [profilePic, setProfilePic] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [result, setResult] = useState<InviteResult | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  const { data: businesses, isLoading: loadingBusinesses } = useQuery({
    queryKey: ['bo-businesses'],
    queryFn: () => get<Business[]>('/business-owner/businesses'),
  })

  const form = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: {
      gender: '',
      salary_type: 'monthly',
      employment_status: 'full_time',
    },
  })

  const { register, handleSubmit, setValue, watch, setError: setFieldError, setFocus, formState: { errors } } = form

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'bo-staff-create',
    formId: 'bo-staff-create',
    form,
  })

  const selectedBusinessId = watch('business_id')

  const { data: rolesResponse, isLoading: loadingRoles } = useQuery({
    queryKey: ['bo-staff-roles', selectedBusinessId],
    queryFn: () => get<RoleOption[]>(`/business-owner/staff/roles?business_id=${selectedBusinessId}`),
    enabled: !!selectedBusinessId,
  })

  const roleList = rolesResponse ?? []
  const bizList = businesses ?? []

  // Role options depend on the business: clear the picked roles when the owner
  // switches business, but not when the page first fills it in (a restored
  // draft keeps its roles).
  const previousBusiness = useRef<number | undefined>(undefined)
  useEffect(() => {
    const current = selectedBusinessId ? Number(selectedBusinessId) : undefined
    if (previousBusiness.current !== undefined && current !== previousBusiness.current) {
      setValue('staff_role_ids', [])
    }
    if (current !== undefined) previousBusiness.current = current
  }, [selectedBusinessId, setValue])

  // One business: select it.
  useEffect(() => {
    if (businesses && businesses.length === 1 && businesses[0]) {
      setValue('business_id', businesses[0].id)
    }
  }, [businesses, setValue])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setPhotoError('')
    if (!file) return
    if (!PHOTO_TYPES.includes(file.type)) return setPhotoError('Use a JPG or PNG photo.')
    if (file.size > PHOTO_MAX_BYTES) return setPhotoError('The photo must be 2 MB or smaller.')
    setProfilePic(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const removePhoto = () => {
    setProfilePic(null)
    setPreviewUrl('')
  }

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const formData = new FormData()
      Object.entries(data).forEach(([key, val]) => {
        if (Array.isArray(val)) {
          // staff_role_ids[]: one or more roles (Staff Management section 5)
          val.forEach((v) => formData.append(`${key}[]`, String(v)))
        } else if (val !== undefined && val !== null && val !== '') {
          formData.append(key, val as any)
        }
      })
      if (profilePic) {
        formData.append('profile_picture', profilePic)
      }
      return post<InviteResult>('/business-owner/staff', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: (res) => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ['bo-staff'] })
      queryClient.invalidateQueries({ queryKey: ['bo-staff-overview'] })
      queryClient.invalidateQueries({ queryKey: ['bo-staff-invitations'] })
      setResult(res)
    },
    onError: (err: any) => {
      const data = err?.response?.data
      const serverErrors = (data?.errors ?? {}) as Record<string, string[]>
      let firstField: keyof FormData | null = null
      const leftover: string[] = []
      for (const [key, messages] of Object.entries(serverErrors)) {
        const field = (key.startsWith('staff_role_id') ? 'staff_role_ids' : key) as keyof FormData
        const message = messages?.[0]
        if (!message) continue
        if (key === 'profile_picture') { setPhotoError(message); continue }
        if (FIELDS.includes(field)) {
          setFieldError(field as Path<FormData>, { type: 'server', message })
          firstField ??= field
        } else {
          leftover.push(message)
        }
      }
      if (firstField && firstField !== 'staff_role_ids' && firstField !== 'business_id') {
        setFocus(firstField as Path<FormData>, { shouldSelect: true })
      }
      // Only what no field shows (e.g. a role not offered for this business, a server problem).
      setError(firstField ? leftover.join(' ') : (leftover.join(' ') || data?.message || 'Could not add the staff member. Please try again.'))
    },
  })

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [error])

  // Only the business list holds the page: roles load inside their card, so the
  // form never blinks away when the business is chosen.
  if (loadingBusinesses) return <DashboardSkeleton />

  if (result) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className={`${card} sm:p-8`} role="status">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#EAF6ED] text-[#16803C]">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-[#17201B]">{result.mail_sent ? 'Invitation sent' : 'Staff account created'}</h1>
          {result.mail_sent ? (
            <p className="mt-2 text-sm text-[#4B5563]">
              We emailed <strong>{result.staff.email}</strong> a link to activate their account and choose their own password. The link works once and expires in 72 hours.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-[#4B5563]">
                The invitation email could not be sent. Share this activation link with <strong>{result.staff.name}</strong> yourself. It works once and expires in 72 hours.
              </p>
              {result.activation_url && <CopyActivationLink url={result.activation_url} />}
            </>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => navigate(`/business-owner/staff/${result.staff.id}`)} className="rounded-xl bg-[#16803C] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32]">
              View staff profile
            </button>
            <button type="button" onClick={() => navigate('/business-owner/staff?tab=staff')} className="rounded-xl border border-[#D7E8DB] bg-[#fff] px-5 py-2.5 text-sm font-medium text-[#16803C] transition hover:bg-[#F3F8F4]">
              Back to staff list
            </button>
          </div>
        </div>
      </div>
    )
  }

  const err = (name: keyof FormData) => errors[name]?.message as string | undefined
  const fieldProps = (name: keyof FormData) => ({
    id: `staff-${name}`,
    'aria-invalid': Boolean(err(name)),
    'aria-describedby': err(name) ? `staff-${name}-error` : undefined,
    className: `${input} ${err(name) ? 'border-red-300' : 'border-[#E2E8E3]'}`,
  })

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Link to="/business-owner/staff" className="inline-flex items-center gap-2 text-sm text-[#647067] transition hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Staff
      </Link>

      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EAF6ED] text-[#16803C]"><UserPlus className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">Add staff member</h1>
          <p className="text-sm text-[#5E6B63]">They get an email invitation and choose their own password.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit((data) => { setError(''); mutation.mutate(data) })} noValidate className="space-y-5">
        <Section title="Business and roles" description="What this person can do in your business.">
          {bizList.length > 1 ? (
            <Field label="Business" htmlFor="staff-business_id" error={err('business_id')} errorId="staff-business_id-error">
              <select {...register('business_id')} {...fieldProps('business_id')}>
                <option value="">Select a business</option>
                {bizList.map((biz) => <option key={biz.id} value={biz.id}>{biz.name}</option>)}
              </select>
            </Field>
          ) : bizList[0] ? (
            <p className="text-sm text-[#5E6B63]">For <span className="font-semibold text-[#17201B]">{bizList[0].name}</span></p>
          ) : null}
          {loadingRoles ? <p className="text-sm text-[#647067]">Loading roles…</p> : (
          <RolePicker
            roles={roleList}
            value={watch('staff_role_ids') ?? []}
            onChange={(ids) => setValue('staff_role_ids', ids, { shouldValidate: true, shouldDirty: true })}
            error={err('staff_role_ids')}
          />
          )}
        </Section>

        <Section title="Personal details">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="relative">
                <label htmlFor="staff-photo" className="flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-[#D7E8DB] bg-[#F6F8F4] text-[#647067] transition hover:border-[#16803C]">
                  {previewUrl ? <img src={previewUrl} alt="Profile photo preview" className="h-full w-full object-cover" /> : <Camera className="h-7 w-7" aria-hidden="true" />}
                </label>
                <input id="staff-photo" type="file" accept="image/jpeg,image/png" onChange={handleFileChange} className="sr-only" aria-label="Profile photo (optional)" />
                {previewUrl && (
                  <button type="button" onClick={removePhoto} aria-label="Remove photo" className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#fff] text-[#B42318] shadow ring-1 ring-[#E2E8E3]">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <p className="text-center text-[11px] text-[#647067]">Photo (optional)<br />JPG or PNG, 2 MB</p>
              {photoError && <p role="alert" className="max-w-[9rem] text-center text-xs text-red-600">{photoError}</p>}
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" htmlFor="staff-first_name" error={err('first_name')} errorId="staff-first_name-error">
                  <input {...register('first_name')} {...fieldProps('first_name')} autoComplete="off" placeholder="Maria" />
                </Field>
                <Field label="Last name" htmlFor="staff-last_name" error={err('last_name')} errorId="staff-last_name-error">
                  <input {...register('last_name')} {...fieldProps('last_name')} autoComplete="off" placeholder="Santos" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Middle name" optional htmlFor="staff-middle_name">
                  <input {...register('middle_name')} {...fieldProps('middle_name')} autoComplete="off" />
                </Field>
                <Field label="Suffix" optional htmlFor="staff-suffix">
                  <input {...register('suffix')} {...fieldProps('suffix')} placeholder="Jr., III" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Gender" optional htmlFor="staff-gender">
                  <select {...register('gender')} {...fieldProps('gender')}>
                    <option value="">Not specified</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Date of birth" optional htmlFor="staff-date_of_birth" error={err('date_of_birth')} errorId="staff-date_of_birth-error">
                  <input {...register('date_of_birth')} {...fieldProps('date_of_birth')} type="date" />
                </Field>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email"
              htmlFor="staff-email"
              error={err('email')}
              errorId="staff-email-error"
              hint={<span id="staff-email-hint">The invitation goes here. Use an address that doesn&apos;t already have a TrackTour account.</span>}
            >
              <input {...register('email')} {...fieldProps('email')} type="email" autoComplete="off" placeholder="maria@example.com"
                aria-describedby={err('email') ? 'staff-email-error' : 'staff-email-hint'} />
            </Field>
            <Field label="Mobile number" optional htmlFor="staff-mobile_number" error={err('mobile_number')} errorId="staff-mobile_number-error">
              <input {...register('mobile_number')} {...fieldProps('mobile_number')} type="tel" inputMode="tel" placeholder="09XX XXX XXXX" />
            </Field>
          </div>
          <Field label="Home address" optional htmlFor="staff-address" error={err('address')} errorId="staff-address-error">
            <textarea {...register('address')} {...fieldProps('address')} rows={2} className={`${fieldProps('address').className} resize-none`} placeholder="Street, barangay, municipality" />
          </Field>
        </Section>

        <Section title="Employment" description="For your records; you can change these later.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status" htmlFor="staff-employment_status">
              <select {...register('employment_status')} {...fieldProps('employment_status')}>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contractual">Contractual</option>
              </select>
            </Field>
            <Field label="Pay" htmlFor="staff-salary_type">
              <select {...register('salary_type')} {...fieldProps('salary_type')}>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
                <option value="hourly">Hourly</option>
              </select>
            </Field>
            <Field label="Date hired" optional htmlFor="staff-date_hired" error={err('date_hired')} errorId="staff-date_hired-error">
              <input {...register('date_hired')} {...fieldProps('date_hired')} type="date" />
            </Field>
          </div>
        </Section>

        <div className="flex items-start gap-3 rounded-[20px] border border-[#D7E8DB] bg-[#F3F8F4] p-4 text-sm text-[#3B4A40]">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[#16803C]" aria-hidden="true" />
          <p>We email them a link to activate the account. They choose their own password; you never see or set it. The link works once and expires in 72 hours.</p>
        </div>

        {error && (
          <div ref={errorRef} role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="shrink-0"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="rounded-xl border border-[#D7E8DB] bg-[#fff] px-5 py-2.5 text-sm font-medium text-[#16803C] transition hover:bg-[#F3F8F4]">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 rounded-xl bg-[#16803C] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50">
            <Send className="h-4 w-4" aria-hidden="true" />
            {mutation.isPending ? 'Sending invitation…' : 'Send invitation'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className={card} aria-label={title}>
      <h2 className="text-base font-bold text-[#17201B]">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-[#5E6B63]">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Field({ label, htmlFor, optional = false, error, errorId, hint, children }: {
  label: string
  htmlFor: string
  optional?: boolean
  error?: string
  errorId?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-[#17201B]">
        {label} {optional && <span className="font-normal text-[#7A867F]">(optional)</span>}
      </label>
      {children}
      {error ? <p id={errorId} className="mt-1.5 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-xs text-[#647067]">{hint}</p> : null}
    </div>
  )
}
