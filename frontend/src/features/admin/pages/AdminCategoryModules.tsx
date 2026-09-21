import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, del } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  X,
  Package,
} from 'lucide-react'

interface CategoryModule {
  id: number
  name: string
  code: string
}

interface CategoryWithModules {
  id: number
  name: string
  slug: string
  modules: CategoryModule[]
}

interface AvailableModule {
  id: number
  name: string
  code: string
}

export default function AdminCategoryModules() {
  const queryClient = useQueryClient()
  const [openCategories, setOpenCategories] = useState<Set<number>>(new Set())
  const [assignModal, setAssignModal] = useState<{ categoryId: number; categoryName: string } | null>(null)
  const [selectedModuleId, setSelectedModuleId] = useState<number | ''>('')
  const [confirmRemove, setConfirmRemove] = useState<{ categoryId: number; moduleId: number; moduleName: string } | null>(null)

  const { data: categories, isLoading } = useQuery({
    queryKey: ['admin-category-modules'],
    queryFn: () => get<{ data: CategoryWithModules[] }>('/admin/category-modules'),
  })

  const { data: availableModules } = useQuery({
    queryKey: ['admin-available-modules'],
    queryFn: () => get<{ data: AvailableModule[] }>('/admin/category-modules/available'),
    enabled: !!assignModal,
  })

  const assignMutation = useMutation({
    mutationFn: (data: { category_id: number; module_id: number }) =>
      post('/admin/category-modules', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-category-modules'] })
      queryClient.invalidateQueries({ queryKey: ['admin-available-modules'] })
      setAssignModal(null)
      setSelectedModuleId('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (data: { categoryId: number; moduleId: number }) =>
      del(`/admin/category-modules/${data.categoryId}/modules/${data.moduleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-category-modules'] })
      queryClient.invalidateQueries({ queryKey: ['admin-available-modules'] })
      setConfirmRemove(null)
    },
  })

  const toggleCategory = (id: number) => {
    setOpenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAssign = () => {
    if (!assignModal || !selectedModuleId) return
    assignMutation.mutate({ category_id: assignModal.categoryId, module_id: selectedModuleId as number })
  }

  const categoryList = categories?.data ?? []

  if (isLoading) return <TableSkeleton rows={6} cols={3} />

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden>
          <svg className="w-full h-full" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice" fill="none">
            <circle cx="1060" cy="52" r="24" fill="#F4B400" />
            <path d="M0 240 L150 96 L330 240 Z" fill="#1E7A48" />
            <path d="M260 240 L440 48 L660 240 Z" fill="#126B32" />
            <path d="M580 240 L780 104 L1000 240 Z" fill="#16803C" />
          </svg>
        </div>
        <div className="relative px-6 py-5 lg:px-8 lg:py-6">
          <h1 className="text-2xl lg:text-[32px] font-bold text-[#126B32] leading-tight">Category Modules</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Assign and manage modules for each business category</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        {categoryList.length === 0 ? (
          <div className="p-12 text-center text-[#6B7280]">
            <Package className="w-8 h-8 mx-auto mb-3 text-[#6B7280]" />
            <p>No categories found</p>
          </div>
        ) : (
          <div className="divide-y divide-[#E2E8E3]">
            {categoryList.map((cat) => {
              const isOpen = openCategories.has(cat.id)
              return (
                <div key={cat.id}>
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    className="w-full flex items-center gap-3 px-5 lg:px-6 py-4 hover:bg-[#F3F8F4] transition-colors text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                    )}
                    <span className="font-medium text-[#17201A]">{cat.name}</span>
                    <span className="text-xs text-[#6B7280] bg-[#F3F8F4] px-2 py-0.5 rounded-full">
                      {cat.modules.length} module{cat.modules.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-5 lg:px-6 pb-4 ml-7">
                      {cat.modules.length === 0 ? (
                        <p className="text-sm text-[#6B7280] py-2">No modules assigned</p>
                      ) : (
                        <div className="space-y-2">
                          {cat.modules.map((mod) => (
                            <div
                              key={mod.id}
                              className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#E2E8E3]"
                            >
                              <div className="flex items-center gap-3">
                                <Package className="w-4 h-4 text-[#16803C]" />
                                <div>
                                  <span className="text-[#17201A] text-sm">{mod.name}</span>
                                  <span className="text-[#6B7280] text-xs ml-2 font-mono">{mod.code}</span>
                                </div>
                              </div>
                              <button
                                onClick={() =>
                                  setConfirmRemove({
                                    categoryId: cat.id,
                                    moduleId: mod.id,
                                    moduleName: mod.name,
                                  })
                                }
                                className="p-1.5 rounded-lg text-[#6B7280] hover:text-red-500 hover:bg-red-50 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setAssignModal({ categoryId: cat.id, categoryName: cat.name })
                          setSelectedModuleId('')
                        }}
                        className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm text-[#16803C] hover:text-[#126B32] bg-[#EAF6ED] hover:bg-[#D7E8DB] rounded-lg transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Assign Module
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal show={assignModal !== null} onClose={() => setAssignModal(null)} maxWidth="md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[#17201A]">
              Assign Module to {assignModal?.categoryName}
            </h2>
            <button
              onClick={() => setAssignModal(null)}
              className="p-1 rounded-lg text-[#6B7280] hover:text-[#17201A] hover:bg-[#F3F8F4] transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-[#17201A] mb-2">Select Module</label>
            <select
              value={selectedModuleId}
              onChange={(e) => setSelectedModuleId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50"
            >
              <option value="">Choose a module...</option>
              {availableModules?.data?.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {mod.name} ({mod.code})
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setAssignModal(null)}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAssign}
              disabled={!selectedModuleId || assignMutation.isPending}
              className="px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {assignMutation.isPending ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal show={confirmRemove !== null} onClose={() => setConfirmRemove(null)} maxWidth="sm">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-2">Remove Module</h2>
          <p className="text-sm text-[#6B7280] mb-6">
            Remove <span className="text-[#17201A] font-medium">{confirmRemove?.moduleName}</span> from this category?
            This action can be undone by re-assigning.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setConfirmRemove(null)}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (confirmRemove) {
                  removeMutation.mutate({
                    categoryId: confirmRemove.categoryId,
                    moduleId: confirmRemove.moduleId,
                  })
                }
              }}
              disabled={removeMutation.isPending}
              className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {removeMutation.isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
