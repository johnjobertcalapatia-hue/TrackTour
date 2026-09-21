import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { API_ENDPOINTS } from '@/shared/constants'
import type { BusinessCategory, RequiredDocument } from '@/shared/types'
import {
  Plus, Pencil, Archive, ArchiveRestore, ChevronRight,
  ChevronDown, FileText, ToggleLeft, ToggleRight, Trash2
} from 'lucide-react'

export default function AdminBusinessCategories() {
  const queryClient = useQueryClient()
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<BusinessCategory | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null)
  const [showDocModal, setShowDocModal] = useState(false)
  const [editingDoc, setEditingDoc] = useState<RequiredDocument | null>(null)
  const [docCategoryId, setDocCategoryId] = useState<number | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryDesc, setCategoryDesc] = useState('')
  const [docName, setDocName] = useState('')
  const [docCode, setDocCode] = useState('')
  const [docRequired, setDocRequired] = useState(true)
  const [docHasExpiration, setDocHasExpiration] = useState(false)
  const [docDescription, setDocDescription] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const { data: categories, isLoading } = useQuery({
    queryKey: ['admin-business-categories'],
    queryFn: () => get<BusinessCategory[]>(API_ENDPOINTS.ADMIN.CATEGORIES),
  })

  const categoryMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      editingCategory
        ? put(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${editingCategory.id}`, data)
        : post(API_ENDPOINTS.ADMIN.CATEGORIES, data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-categories'] })
      setShowCategoryModal(false)
      setEditingCategory(null)
      setCategoryName('')
      setCategoryDesc('')
      flash(editingCategory ? 'Category updated.' : 'Category created.')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => post(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${id}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-categories'] })
      flash('Category archived.')
    },
  })

  const unarchiveMutation = useMutation({
    mutationFn: (id: number) => post(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${id}/unarchive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-categories'] })
      flash('Category restored.')
    },
  })

  const docMutation = useMutation({
    mutationFn: (data: { categoryId: number; docId?: number; payload: Record<string, unknown> }) =>
      data.docId
        ? put(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${data.categoryId}/documents/${data.docId}`, data.payload)
        : post(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${data.categoryId}/documents`, data.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-categories'] })
      setShowDocModal(false)
      setEditingDoc(null)
      setDocCategoryId(null)
      setDocName('')
      setDocCode('')
      setDocRequired(true)
      setDocHasExpiration(false)
      setDocDescription('')
      flash(editingDoc ? 'Document updated.' : 'Document added.')
    },
  })

  const toggleRequiredMutation = useMutation({
    mutationFn: (data: { categoryId: number; docId: number }) =>
      post(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${data.categoryId}/documents/${data.docId}/toggle-required`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-categories'] })
    },
  })

  const archiveDocMutation = useMutation({
    mutationFn: (data: { categoryId: number; docId: number }) =>
      post(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${data.categoryId}/documents/${data.docId}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-categories'] })
      flash('Document archived.')
    },
  })

  const unarchiveDocMutation = useMutation({
    mutationFn: (data: { categoryId: number; docId: number }) =>
      post(`${API_ENDPOINTS.ADMIN.CATEGORIES}/${data.categoryId}/documents/${data.docId}/unarchive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-categories'] })
      flash('Document restored.')
    },
  })

  const openCategoryModal = (cat?: BusinessCategory) => {
    setEditingCategory(cat || null)
    setCategoryName(cat?.name || '')
    setCategoryDesc(cat?.description || '')
    setShowCategoryModal(true)
  }

  const openDocModal = (categoryId: number, doc?: RequiredDocument) => {
    setDocCategoryId(categoryId)
    setEditingDoc(doc || null)
    setDocName(doc?.document_name || '')
    setDocCode(doc?.document_code || '')
    setDocRequired(doc?.is_required ?? true)
    setDocHasExpiration(doc?.has_expiration ?? false)
    setDocDescription(doc?.description || '')
    setShowDocModal(true)
  }

  const handleCategorySubmit = () => {
    if (!categoryName.trim()) return
    categoryMutation.mutate({
      name: categoryName.trim(),
      description: categoryDesc.trim() || undefined,
    })
  }

  const handleDocSubmit = () => {
    if (!docName.trim() || !docCategoryId) return
    docMutation.mutate({
      categoryId: docCategoryId,
      docId: editingDoc?.id,
      payload: {
        document_name: docName.trim(),
        document_code: docCode.trim() || undefined,
        is_required: docRequired,
        has_expiration: docHasExpiration,
        description: docDescription.trim() || undefined,
      },
    })
  }

  if (isLoading) return <TableSkeleton rows={6} cols={4} />

  const categoryList = categories ?? []

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl bg-[#16803C]/90 text-white text-sm font-medium shadow-tourism">
          {successMsg}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism overflow-hidden">
        <div className="relative">
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <pattern id="headerPattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="1.5" fill="currentColor" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#headerPattern)" />
          </svg>
          <div className="relative px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Business Categories</h1>
              <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage categories and their document requirements</p>
            </div>
            <button
              onClick={() => openCategoryModal()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              Add Category
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {categoryList.map((cat) => {
          const isExpanded = expandedCategory === cat.id
          const docs = cat.required_documents ?? []
          const activeDocs = docs.filter(d => !d.archived_at)

          return (
            <div key={cat.id} className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-[#F6F8F4] transition"
                onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="w-5 h-5 text-[#6B7280]" /> : <ChevronRight className="w-5 h-5 text-[#6B7280]" />}
                  <div>
                    <span className="font-semibold text-[#17201A]">{cat.name}</span>
                    {cat.description && <span className="ml-3 text-sm text-[#6B7280]">{cat.description}</span>}
                  </div>
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-[#EAF6ED] text-[#16803C]">
                    {activeDocs.length} doc{activeDocs.length !== 1 ? 's' : ''}
                  </span>
                  {cat.archived_at && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#FFF7D6] text-[#92400E]">Archived</span>
                  )}
                </div>
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => openCategoryModal(cat)}
                    className="p-2 rounded-lg text-[#6B7280] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {cat.archived_at ? (
                    <button
                      onClick={() => unarchiveMutation.mutate(cat.id)}
                      className="p-2 rounded-lg text-[#6B7280] hover:text-[#16803C] hover:bg-[#EAF6ED] transition"
                    >
                      <ArchiveRestore className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => archiveMutation.mutate(cat.id)}
                      className="p-2 rounded-lg text-[#6B7280] hover:text-[#D97706] hover:bg-[#FFF7D6] transition"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-[#E2E8E3] px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[#17201A] flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#6B7280]" />
                      Document Requirements
                    </h3>
                    <button
                      onClick={() => openDocModal(cat.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#EAF6ED] hover:bg-[#D1FAE5] text-[#16803C] text-xs font-medium rounded-lg transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Document
                    </button>
                  </div>

                  {activeDocs.length === 0 ? (
                    <p className="text-sm text-[#6B7280] py-4 text-center">No document requirements yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {activeDocs.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between p-3 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-[#EAF6ED] rounded-lg flex items-center justify-center">
                              <FileText className="w-4 h-4 text-[#16803C]" />
                            </div>
                            <div>
                              <span className="text-sm text-[#17201A] font-medium">{doc.document_name}</span>
                              {doc.document_code && <span className="ml-2 text-xs text-[#6B7280] font-mono">{doc.document_code}</span>}
                              {doc.has_expiration && <span className="ml-2 text-xs text-[#D97706]">Expires</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleRequiredMutation.mutate({ categoryId: cat.id, docId: doc.id })}
                              className="flex items-center gap-1 text-xs"
                            >
                              {doc.is_required ? (
                                <ToggleRight className="w-5 h-5 text-[#16803C]" />
                              ) : (
                                <ToggleLeft className="w-5 h-5 text-[#9CA3AF]" />
                              )}
                              <span className={doc.is_required ? 'text-[#16803C]' : 'text-[#9CA3AF]'}>
                                {doc.is_required ? 'Required' : 'Optional'}
                              </span>
                            </button>
                            <button
                              onClick={() => openDocModal(cat.id, doc)}
                              className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => archiveDocMutation.mutate({ categoryId: cat.id, docId: doc.id })}
                              className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {categoryList.length === 0 && (
          <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-12 text-center text-[#6B7280]">
            No categories found.
          </div>
        )}
      </div>

      {/* Add/Edit Category Modal */}
      <Modal show={showCategoryModal} onClose={() => { setShowCategoryModal(false); setEditingCategory(null); }} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-4">
            {editingCategory ? 'Edit Category' : 'Add Category'}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Name <span className="text-[#DC2626]">*</span></label>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Restaurant"
                className="w-full px-4 py-2.5 bg-white border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Description</label>
              <textarea
                value={categoryDesc}
                onChange={(e) => setCategoryDesc(e.target.value)}
                rows={3}
                placeholder="Optional description..."
                className="w-full px-4 py-2.5 bg-white border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C] resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleCategorySubmit}
              disabled={!categoryName.trim() || categoryMutation.isPending}
              className="px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {categoryMutation.isPending ? 'Saving...' : editingCategory ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add/Edit Document Modal */}
      <Modal show={showDocModal} onClose={() => { setShowDocModal(false); setEditingDoc(null); setDocCategoryId(null); }} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[#17201A] mb-4">
            {editingDoc ? 'Edit Document' : 'Add Document Requirement'}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Document Name <span className="text-[#DC2626]">*</span></label>
              <input
                type="text"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="e.g. Business Permit"
                className="w-full px-4 py-2.5 bg-white border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Document Code</label>
              <input
                type="text"
                value={docCode}
                onChange={(e) => setDocCode(e.target.value)}
                placeholder="e.g. BP-001"
                className="w-full px-4 py-2.5 bg-white border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Description</label>
              <textarea
                value={docDescription}
                onChange={(e) => setDocDescription(e.target.value)}
                rows={2}
                placeholder="Optional description..."
                className="w-full px-4 py-2.5 bg-white border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C] resize-none"
              />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={docRequired}
                  onChange={(e) => setDocRequired(e.target.checked)}
                  className="w-4 h-4 rounded border-[#D7E8DB] text-[#16803C] focus:ring-[#16803C]/30"
                />
                <span className="text-sm text-[#374151]">Required</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={docHasExpiration}
                  onChange={(e) => setDocHasExpiration(e.target.checked)}
                  className="w-4 h-4 rounded border-[#D7E8DB] text-[#16803C] focus:ring-[#16803C]/30"
                />
                <span className="text-sm text-[#374151]">Has Expiration</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => { setShowDocModal(false); setEditingDoc(null); setDocCategoryId(null); }}
              className="px-4 py-2.5 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] rounded-xl text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleDocSubmit}
              disabled={!docName.trim() || docMutation.isPending}
              className="px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {docMutation.isPending ? 'Saving...' : editingDoc ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
