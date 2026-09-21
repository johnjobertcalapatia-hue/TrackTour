import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { post } from '@/shared/services/api'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { API_ENDPOINTS } from '@/shared/constants'

interface AdminUserForm {
  first_name: string
  last_name: string
  email: string
  password: string
  password_confirmation: string
  role: string
  account_status: string
}

const ROLES: string[] = [
  'tourist', 'business_owner', 'staff', 'rider', 'bansud_tourism_office', 'tourism_office'
]

const defaultForm: AdminUserForm = { first_name: '', last_name: '', email: '', password: '', password_confirmation: '', role: 'tourist', account_status: 'pending_review' }

export default function AdminUsersCreate() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  const { fields, updateField, clear } = useFormDraft({
    draftKey: 'admin-users-create',
    formId: 'admin-users-create',
    initialFields: defaultForm,
  })

  const form = fields as unknown as AdminUserForm

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    updateField(name, value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      await post(`${API_ENDPOINTS.ADMIN.USERS}`, fields)
      clear()
      navigate('/admin/users')
    } catch (err: any) {
      if (err?.response?.data?.errors) setErrors(err.response.data.errors)
      else console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="relative rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 mb-6 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="header-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1.5" fill="#16803C" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#header-pattern)" />
          </svg>
        </div>
        <div className="relative">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Create User</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Add a new user account</p>
        </div>
      </div>

      {/* Form Card */}
      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#17201A] mb-1">First Name</label>
              <input name="first_name" value={form.first_name} onChange={handleChange} required className="w-full rounded-xl border border-[#E2E8E3] bg-white text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 outline-none transition-all" />
              {errors.first_name && <p className="text-xs text-red-500 mt-1">{errors.first_name[0]}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#17201A] mb-1">Last Name</label>
              <input name="last_name" value={form.last_name} onChange={handleChange} required className="w-full rounded-xl border border-[#E2E8E3] bg-white text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 outline-none transition-all" />
              {errors.last_name && <p className="text-xs text-red-500 mt-1">{errors.last_name[0]}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#17201A] mb-1">Email</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} required className="w-full rounded-xl border border-[#E2E8E3] bg-white text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 outline-none transition-all" />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email[0]}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#17201A] mb-1">Password</label>
              <input name="password" type="password" value={form.password} onChange={handleChange} required className="w-full rounded-xl border border-[#E2E8E3] bg-white text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 outline-none transition-all" />
              {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password[0]}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#17201A] mb-1">Confirm Password</label>
              <input name="password_confirmation" type="password" value={form.password_confirmation} onChange={handleChange} required className="w-full rounded-xl border border-[#E2E8E3] bg-white text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 outline-none transition-all" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#17201A] mb-1">Role</label>
              <select name="role" value={form.role} onChange={handleChange} className="w-full rounded-xl border border-[#E2E8E3] bg-white text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 outline-none transition-all">
                {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#17201A] mb-1">Account Status</label>
              <select name="account_status" value={form.account_status} onChange={handleChange} className="w-full rounded-xl border border-[#E2E8E3] bg-white text-sm px-3 py-2 focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50 outline-none transition-all">
                <option value="pending_review">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl transition-colors">{saving ? 'Creating...' : 'Create User'}</button>
            <button type="button" onClick={() => navigate('/admin/users')} className="px-5 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] rounded-xl hover:bg-[#F3F8F4] transition-colors">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}