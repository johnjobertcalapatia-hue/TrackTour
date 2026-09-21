import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { ArrowLeft, Mail, Phone, Shield, Briefcase, CalendarDays } from 'lucide-react'

interface StaffMember {
  id: number
  name: string
  email: string
  role: string
  status: string
  phone: string | null
  staff_role: { id: number; name: string } | null
  permissions: string[]
  employment_details: {
    position: string
    hire_date: string
    employment_type: string
  } | null
  created_at: string
  updated_at: string
}

export default function BusinessOwnerStaffShow() {
  const { id } = useParams<{ id: string }>()

  const { data: staff, isLoading } = useQuery({
    queryKey: ['bo-staff-member', id],
    queryFn: () => get<StaffMember>(`/business-owner/staff/${id}`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!staff) return <div className="text-center py-20 text-[#647067]">Staff member not found.</div>

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/business-owner/staff" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Staff
      </Link>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 bg-[#EAF6ED] rounded-2xl flex items-center justify-center text-[#16803C] text-2xl font-bold">
          {staff.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">{staff.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-[#647067] capitalize">{staff.role}</span>
            <StatusBadge status={staff.status} />
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
          <h2 className="text-lg font-semibold text-[#17201A] mb-5">Contact Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#EAF6ED] rounded-xl">
                <Mail className="w-4 h-4 text-[#647067]" />
              </div>
              <div>
                <p className="text-xs text-[#647067] mb-0.5">Email</p>
                <p className="text-sm text-[#17201A]">{staff.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#EAF6ED] rounded-xl">
                <Phone className="w-4 h-4 text-[#647067]" />
              </div>
              <div>
                <p className="text-xs text-[#647067] mb-0.5">Phone</p>
                <p className="text-sm text-[#17201A]">{staff.phone ?? 'Not provided'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
          <h2 className="text-lg font-semibold text-[#17201A] mb-5">Role & Permissions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#EAF6ED] rounded-xl">
                <Shield className="w-4 h-4 text-[#647067]" />
              </div>
              <div>
                <p className="text-xs text-[#647067] mb-0.5">System Role</p>
                <p className="text-sm text-[#17201A] capitalize">{staff.role}</p>
              </div>
            </div>
            {staff.staff_role && (
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#EAF6ED] rounded-xl">
                  <Briefcase className="w-4 h-4 text-[#647067]" />
                </div>
                <div>
                  <p className="text-xs text-[#647067] mb-0.5">Staff Role</p>
                  <p className="text-sm text-[#17201A]">{staff.staff_role.name}</p>
                </div>
              </div>
            )}
          </div>

          {staff.permissions && staff.permissions.length > 0 && (
            <div>
              <p className="text-xs text-[#647067] mb-2">Permissions</p>
              <div className="flex flex-wrap gap-2">
                {staff.permissions.map((perm) => (
                  <span key={perm} className="px-2.5 py-1 bg-[#EAF6ED] border border-[#D7E8DB] rounded-lg text-xs text-[#4B5563]">
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {staff.employment_details && (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
            <h2 className="text-lg font-semibold text-[#17201A] mb-5">Employment Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[#647067] mb-1">Position</p>
                <p className="text-sm text-[#17201A]">{staff.employment_details.position}</p>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[#647067]" />
                <div>
                  <p className="text-xs text-[#647067] mb-0.5">Hire Date</p>
                  <p className="text-sm text-[#17201A]">{formatDateTime(staff.employment_details.hire_date)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-[#647067] mb-1">Employment Type</p>
                <p className="text-sm text-[#17201A] capitalize">{staff.employment_details.employment_type}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
          <h2 className="text-lg font-semibold text-[#17201A] mb-5">Account Info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-[#647067] mb-1">Created</p>
              <p className="text-[#17201A]">{formatDateTime(staff.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-[#647067] mb-1">Last Updated</p>
              <p className="text-[#17201A]">{formatDateTime(staff.updated_at)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
