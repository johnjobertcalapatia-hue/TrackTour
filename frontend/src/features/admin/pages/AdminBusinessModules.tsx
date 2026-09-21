import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { API_ENDPOINTS } from '@/shared/constants'
import { formatDate } from '@/shared/utils'
import { useState } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'

interface BusinessModule {
  id: number
  name: string
  slug: string
  description: string | null
  is_active: boolean
  created_at: string
}

export default function AdminBusinessModules() {
  const [showModal, setShowModal] = useState(false)
  const [editingModule, setEditingModule] = useState<BusinessModule | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-business-modules'],
    queryFn: () => get<{ data: BusinessModule[] }>(API_ENDPOINTS.ADMIN.MODULES),
  })

  if (isLoading) return <TableSkeleton rows={6} cols={4} />

  const modules = data?.data ?? []

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 lg:p-8 mb-8">
        <div className="absolute top-0 right-0 w-64 h-64 opacity-5 pointer-events-none">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" stroke="#16803C" strokeWidth="2" />
            <circle cx="100" cy="100" r="60" stroke="#16803C" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="40" stroke="#16803C" strokeWidth="1" />
            <path d="M100 20 L100 180 M20 100 L180 100" stroke="#16803C" strokeWidth="1" />
            <path d="M40 40 L160 160 M160 40 L40 160" stroke="#16803C" strokeWidth="0.5" />
          </svg>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Business Modules</h1>
            <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage available business feature modules</p>
          </div>
          <button
            onClick={() => { setEditingModule(null); setShowModal(true) }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition shadow-tourism"
          >
            <Plus className="w-4 h-4" />
            Add Module
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F9FBFA]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Module</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Slug</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Created</th>
                <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {modules.map((mod) => (
                <tr key={mod.id} className="hover:bg-[#F3F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <div className="font-medium text-[#17201A]">{mod.name}</div>
                    {mod.description && (
                      <div className="text-xs text-[#6B7280] max-w-xs truncate">{mod.description}</div>
                    )}
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] font-mono text-xs whitespace-nowrap">{mod.slug}</td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    {mod.is_active ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#16803C] bg-[#EAF6ED] rounded-full">
                        <ToggleRight className="w-3.5 h-3.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#6B7280] bg-gray-100 rounded-full">
                        <ToggleLeft className="w-3.5 h-3.5" /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                    {formatDate(mod.created_at)}
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setEditingModule(mod); setShowModal(true) }}
                        className="p-2 rounded-lg text-[#6B7280] hover:text-[#16803C] hover:bg-[#EAF6ED] transition"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button className="p-2 rounded-lg text-[#6B7280] hover:text-red-600 hover:bg-red-50 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {modules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No modules found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal show={showModal} onClose={() => setShowModal(false)}>
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-4">
            {editingModule ? 'Edit Module' : 'Add Module'}
          </h2>
          <p className="text-sm text-[#6B7280]">Module form will be implemented here.</p>
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button className="px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition shadow-tourism">
              {editingModule ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
