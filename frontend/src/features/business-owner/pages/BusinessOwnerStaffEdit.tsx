import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, post } from '@/shared/services/api'
import { usePersistFormRHF } from '@/shared/hooks/use-persist-form-rhf'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ArrowLeft, Save, Upload, UserRoundPen } from 'lucide-react'

const schema = z.object({
  first_name: z.string().min(2, 'First name must be at least 2 characters'),
  middle_name: z.string().optional(),
  last_name: z.string().min(2, 'Last name must be at least 2 characters'),
  suffix: z.string().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional().or(z.literal('')),
  mobile_number: z.string().optional(),
  email: z.string().email('Invalid email address'),
  password: z.string().optional().or(z.literal('')),
  staff_role_id: z.coerce.number().min(1, 'Staff role selection is required'),
  date_hired: z.string().optional().or(z.literal('')),
  salary_type: z.string().optional(),
  employment_status: z.string().optional(),
  address: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface StaffMember {
  id: number
  business_id: number
  employee_id: string
  name: string
  email: string
  middle_name: string | null
  suffix: string | null
  gender: string | null
  date_of_birth: string | null
  mobile_number: string | null
  address: string | null
  profile_picture: string | null
  staff_role: { id: number; name: string } | null
  staff_role_id: number
  department: string | null
  is_active: boolean
  status: string
  date_hired: string | null
  salary_type: string | null
  employment_status: string | null
  user?: {
    id: number
    profile?: {
      first_name: string
      last_name: string
      middle_name?: string | null
      suffix?: string | null
    }
  }
}

interface StaffRole {
  id: number
  name: string
}

export default function BusinessOwnerStaffEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [profilePic, setProfilePic] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')

  const { data: staff, isLoading } = useQuery({
    queryKey: ['bo-staff-member', id],
    queryFn: () => get<StaffMember>(`/business-owner/staff/${id}`),
  })

  const businessId = staff?.business_id

  const { data: roles } = useQuery({
    queryKey: ['bo-staff-roles', businessId],
    queryFn: () => get<StaffRole[]>(`/business-owner/staff/roles?business_id=${businessId}`),
    enabled: !!businessId,
  })

  const form = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: {},
  })

  const { register, handleSubmit, reset, formState: { errors } } = form

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'bo-staff-edit',
    formId: 'bo-staff-edit',
    form,
  })

  useEffect(() => {
    if (staff) {
      reset({
        first_name: staff.user?.profile?.first_name ?? '',
        middle_name: staff.middle_name ?? '',
        last_name: staff.user?.profile?.last_name ?? '',
        suffix: staff.suffix ?? '',
        gender: staff.gender ?? 'male',
        date_of_birth: staff.date_of_birth ? staff.date_of_birth.substring(0, 10) : '',
        mobile_number: staff.mobile_number ?? '',
        email: staff.email ?? '',
        password: '',
        staff_role_id: staff.staff_role?.id ?? staff.staff_role_id ?? 0,
        date_hired: staff.date_hired ? staff.date_hired.substring(0, 10) : '',
        salary_type: staff.salary_type ?? 'monthly',
        employment_status: staff.employment_status ?? 'full_time',
        address: staff.address ?? '',
      })
    }
  }, [staff])

  useEffect(() => {
    if (staff?.profile_picture) {
      setPreviewUrl(staff.profile_picture)
    }
  }, [staff])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setProfilePic(file)
      setPreviewUrl(URL.createObjectURL(file))
    }
  }

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const formData = new FormData()
      Object.entries(data).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          formData.append(key, val as any)
        }
      })
      if (profilePic) {
        formData.append('profile_picture', profilePic)
      }
      formData.append('_method', 'PUT')
      return post(`/business-owner/staff/${id}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
    },
    onSuccess: () => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ['bo-staff'] })
      queryClient.invalidateQueries({ queryKey: ['bo-staff-member', id] })
      setSuccess('Staff member updated successfully.')
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Failed to update staff member.')
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!staff) return <div className="text-center py-20 text-[#647067]">Staff member not found.</div>

  const roleList = roles ?? []

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/business-owner/staff" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Staff
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] flex items-center justify-center text-[#16803C]">
          <UserRoundPen className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Edit Staff Member</h1>
          <p className="text-sm text-[#647067]">Modify profile details or role assignments for {staff.name}</p>
        </div>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="mt-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar options */}
          <div className="space-y-6">
            {/* Avatar upload card */}
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 flex flex-col items-center">
              <label className="block text-sm font-semibold text-[#4B5563] mb-4 text-center">Profile Picture</label>
              <div className="relative group w-32 h-32 rounded-2xl bg-[#F3F8F4] border border-[#E2E8E3] overflow-hidden flex items-center justify-center mb-4">
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <Upload className="w-8 h-8 text-[#647067] group-hover:text-[#647067] transition" />
                )}
                <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
              <p className="text-[11px] text-[#647067] text-center">Click image area to change. Max 2MB.</p>
            </div>

            {/* Employment Status card */}
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 space-y-4">
              <h3 className="text-sm font-semibold text-[#17201A] border-b border-[#E2E8E3] pb-2">Employment Settings</h3>
              
              <div>
                <label className="block text-xs font-medium text-[#647067] mb-1">Employment Status</label>
                <select {...register('employment_status')} className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                  <option value="full_time">Full-Time</option>
                  <option value="part_time">Part-Time</option>
                  <option value="contractual">Contractual</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#647067] mb-1">Salary Type</label>
                <select {...register('salary_type')} className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                  <option value="monthly">Monthly</option>
                  <option value="daily">Daily</option>
                  <option value="hourly">Hourly</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#647067] mb-1">Date Hired</label>
                <input {...register('date_hired')} type="date" className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-xs text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
              </div>
            </div>
          </div>

          {/* Main details card */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8 space-y-6">
              <h2 className="text-lg font-semibold text-[#17201A] border-b border-[#E2E8E3] pb-3">Staff Profile Information</h2>

              {/* Name split grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">First Name</label>
                  <input {...register('first_name')} placeholder="First name" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  {errors.first_name && <p className="text-[#B91C1C] text-xs mt-1">{errors.first_name.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Middle Name</label>
                  <input {...register('middle_name')} placeholder="Middle name (optional)" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Last Name</label>
                  <input {...register('last_name')} placeholder="Last name" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  {errors.last_name && <p className="text-[#B91C1C] text-xs mt-1">{errors.last_name.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Suffix</label>
                  <input {...register('suffix')} placeholder="e.g. Jr, III (optional)" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Gender</label>
                  <select {...register('gender')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Date of Birth</label>
                  <input {...register('date_of_birth')} type="date" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Staff Role (System Access)</label>
                <select {...register('staff_role_id')} className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                  <option value="">Select staff role</option>
                  {roleList.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                {errors.staff_role_id && <p className="text-[#B91C1C] text-xs mt-1">{errors.staff_role_id.message}</p>}
              </div>

              {/* Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Mobile Number</label>
                  <input {...register('mobile_number')} placeholder="e.g. 09171234567" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Email Address</label>
                  <input {...register('email')} type="email" placeholder="staff@example.com" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  {errors.email && <p className="text-[#B91C1C] text-xs mt-1">{errors.email.message}</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Home Address</label>
                <textarea {...register('address')} rows={2} placeholder="Complete home address" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
              </div>

              {/* Security/Password */}
              <h3 className="text-base font-semibold text-[#17201A] border-b border-[#E2E8E3] pt-4 pb-2">Change Password</h3>
              <p className="text-xs text-[#647067] mb-4">Leave password blank if you do not want to change it.</p>
              <div>
                <label className="block text-sm font-medium text-[#4B5563] mb-1.5">New Password</label>
                <input {...register('password')} type="password" placeholder="Minimum 8 characters" className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                {errors.password && <p className="text-[#B91C1C] text-xs mt-1">{errors.password.message}</p>}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
                Cancel
              </button>
              <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
                <Save className="w-4 h-4" />
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
