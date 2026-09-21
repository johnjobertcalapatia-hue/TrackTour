import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { API_ENDPOINTS } from '@/shared/constants'
import { useState } from 'react'
import { Shield, Plus, Pencil } from 'lucide-react'

interface Permission {
  id: number
  name: string
  description: string | null
}

interface Role {
  id: number
  name: string
  slug: string
  description: string | null
  permissions: Permission[]
}

export default function AdminRoles() {
  const [showModal, setShowModal] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => get<{ data: Role[] }>(API_ENDPOINTS.ADMIN.ROLES),
  })

  if (isLoading) return <TableSkeleton rows={6} cols={4} />

  const roles = data?.data ?? []

  return (
    <div>
      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 mb-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="tourism-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1.5" fill="#16803C" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#tourism-pattern)" />
          </svg>
        </div>
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Roles & Permissions</h1>
            <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage user roles and their associated permissions</p>
          </div>
          <button
            onClick={() => { setEditingRole(null); setShowModal(true) }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Add Role
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {roles.map((role) => (
          <div
            key={role.id}
            className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#EAF6ED] rounded-xl flex items-center justify-center">
                  <Shield className="w-5 h-5 text-[#16803C]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#17201A] capitalize">{role.name.replace(/_/g, ' ')}</h3>
                  <p className="text-xs text-[#6B7280] font-mono">{role.slug}</p>
                </div>
              </div>
              <button
                onClick={() => { setEditingRole(role); setShowModal(true) }}
                className="p-2 rounded-lg text-[#6B7280] hover:text-[#16803C] hover:bg-[#EAF6ED] transition"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
            {role.description && (
              <p className="text-sm text-[#6B7280] mb-4">{role.description}</p>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Permissions</p>
              <div className="flex flex-wrap gap-1.5">
                {role.permissions.map((perm) => (
                  <span
                    key={perm.id}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#F6F8F4] border border-[#E2E8E3] text-xs text-[#17201A]"
                  >
                    {perm.name}
                  </span>
                ))}
                {role.permissions.length === 0 && (
                  <span className="text-xs text-[#9CA3AF]">No permissions assigned</span>
                )}
              </div>
            </div>
          </div>
        ))}
        {roles.length === 0 && (
          <div className="col-span-full text-center py-12 text-[#6B7280]">No roles found</div>
        )}
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)}>
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-4">
            {editingRole ? 'Edit Role' : 'Add Role'}
          </h2>
          <p className="text-sm text-[#6B7280]">Role form will be implemented here.</p>
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button className="px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition">
              {editingRole ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
